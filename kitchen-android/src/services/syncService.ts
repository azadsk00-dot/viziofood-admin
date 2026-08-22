// Sync service — THE reliability core of the kitchen tablet.
//
//   Realtime (instant) + periodic reconciliation (authoritative)
//
// Realtime alone is never trusted: on startup, reconnect, app foreground and
// a periodic timer the service re-queries the backend for today's orders and
// merges them into the store, so orders that arrived while the tablet was
// offline/locked/killed are always discovered ("missed order protection").
// Duplicate protection: merge is keyed by order id; alerts are keyed by
// order id in the persisted alertedOrderIds set.

import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type {
  KitchenOrder,
  OrderItemRow,
  OrderRow,
} from '../lib/types';
import { isAlertWorthy, nextCursor } from '../lib/reconcile';
import { startOfToday } from '../lib/format';
import { useOrdersStore } from '../state/ordersStore';
import { usePrintStore } from '../state/printStore';
import { getSettings } from '../state/settingsStore';
import { notifyNewOrder } from './notifications';
import { recordIncident } from './incidents';
import { rowToOrder, itemRowToItem } from './mappers';

const ORDER_COLUMNS =
  'id,order_number,status,payment_status,fulfilment_method,customer_name,customer_phone,customer_email,delivery_address,delivery_suburb,delivery_postcode,delivery_instructions,special_instructions,total,items_count,coupon_code,created_at,updated_at,acknowledged_at,acknowledged_by,cancelled_at,cancellation_reason,refund_status';

const FETCH_PAGE_SIZE = 100;

class OrderSyncService {
  private ordersChannel: RealtimeChannel | null = null;
  private printChannel: RealtimeChannel | null = null;
  private netUnsubscribe: (() => void) | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private reconciling = false;
  private offlineAt: number | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const store = useOrdersStore.getState();
    store.setSyncStatus('connecting');

    await this.reconcile('startup');

    // Realtime: instant order + print job updates.
    this.ordersChannel = supabase
      .channel('kitchen-orders-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          void this.handleOrderEvent(payload);
        },
      )
      .subscribe((status) => {
        const connected = status === 'SUBSCRIBED';
        useOrdersStore.getState().setRealtimeConnected(connected);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // The periodic reconcile below is the safety net.
          useOrdersStore.getState().setSyncStatus('error', `Realtime ${status.toLowerCase()}`);
        } else if (connected) {
          useOrdersStore.getState().setSyncStatus('ready');
          void this.reconcile('realtime-recovered');
        }
      });

    this.printChannel = supabase
      .channel('kitchen-print-jobs-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'print_jobs' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { id?: string } | null;
          if (row?.id) void this.refreshJob(row.id);
          void this.refreshPrintState();
        },
      )
      .subscribe();

    // Connectivity watchdog: banner + reconnect reconciliation.
    this.netUnsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected);
      const was = useOrdersStore.getState().internetOnline;
      useOrdersStore.getState().setInternetOnline(online);
      if (!online && was) {
        this.offlineAt = Date.now();
        useOrdersStore.getState().setSyncStatus('offline');
      } else if (online && !was) {
        void this.reconcile('reconnect');
      }
    });

    // Foreground: reconcile to catch anything missed while backgrounded.
    this.appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void this.reconcile('foreground');
      }
    });

    this.schedulePeriodicReconcile();
    await this.refreshPrintState();
  }

  stop(): void {
    this.ordersChannel && void supabase.removeChannel(this.ordersChannel);
    this.printChannel && void supabase.removeChannel(this.printChannel);
    this.netUnsubscribe?.();
    this.appStateSubscription?.remove();
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.ordersChannel = null;
    this.printChannel = null;
    this.netUnsubscribe = null;
    this.appStateSubscription = null;
    this.reconcileTimer = null;
    this.started = false;
  }

  /** SYNC NOW — force full backend reconciliation (also from settings/health). */
  async syncNow(): Promise<{ ok: boolean; error?: string }> {
    const result = await this.reconcile('manual');
    return result;
  }

  private schedulePeriodicReconcile(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    const intervalMs = Math.max(30, getSettings().reconcileIntervalSec) * 1000;
    this.reconcileTimer = setInterval(() => {
      if (useOrdersStore.getState().internetOnline) {
        void this.reconcile('periodic');
      }
    }, intervalMs);
  }

  /** Re-schedule when the interval setting changes. */
  onSettingsChanged(): void {
    if (this.started) this.schedulePeriodicReconcile();
  }

  /**
   * Fetch today's orders from the backend and merge. Also fetches items for
   * orders we don't have items for. Alerts for paid NEW orders we haven't
   * alerted about (covers realtime misses AND offline gaps).
   */
  private async reconcile(reason: string): Promise<{ ok: boolean; error?: string }> {
    if (this.reconciling) return { ok: true };
    this.reconciling = true;
    const store = useOrdersStore.getState();
    if (store.internetOnline) store.setSyncStatus('syncing');

    try {
      const since = startOfToday();
      const rows: OrderRow[] = [];
      let from = 0;
      // Page through today's orders (paid or live — kitchen doesn't need Drafts).
      for (;;) {
        const { data, error } = await supabase
          .from('orders')
          .select(ORDER_COLUMNS)
          .gte('created_at', since)
          .neq('status', 'Draft')
          .order('created_at', { ascending: false })
          .range(from, from + FETCH_PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const page = (data ?? []) as unknown as OrderRow[];
        rows.push(...page);
        if (page.length < FETCH_PAGE_SIZE) break;
        from += FETCH_PAGE_SIZE;
      }

      const orders = rows.map(rowToOrder);
      await this.attachItems(orders);

      const state = useOrdersStore.getState();
      const knownIds = new Set(Object.keys(state.orders));
      const alerted = new Set(state.alertedOrderIds);

      state.upsertOrders(orders);
      state.setCursor(nextCursor(orders, state.cursor));
      state.setLastSyncAt(new Date().toISOString());
      state.setSyncStatus(useOrdersStore.getState().internetOnline ? 'ready' : 'offline');
      state.prune();

      // Missed-order protection: alert for anything alert-worthy we missed.
      const missed = orders.filter((order) => isAlertWorthy(order, alerted));
      if (missed.length && reason !== 'startup-alert-test') {
        for (const order of missed) {
          if (reason === 'reconnect' || reason === 'foreground') {
            // Discovered after a gap → log it for the audit trail.
            void recordIncident({
              kind: 'missed_order',
              severity: 'warning',
              orderId: order.id,
              message: `Order ${order.orderNumber} discovered via ${reason} reconciliation${this.offlineAt ? ` after ${(Math.round((Date.now() - this.offlineAt) / 1000))}s offline` : ''}`,
            });
          }
          await notifyNewOrder(order, 'reconciliation');
        }
      }
      if (reason === 'reconnect') this.offlineAt = null;

      await this.refreshPrintState();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useOrdersStore.getState().setSyncStatus('error', message);
      return { ok: false, error: message };
    } finally {
      this.reconciling = false;
    }
  }

  /** Realtime order event — apply immediately, fetch items when new. */
  private async handleOrderEvent(payload: {
    eventType: string;
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
  }): Promise<void> {
    const row = (payload.new ?? payload.old) as OrderRow | null;
    if (!row?.id) return;

    if (payload.eventType === 'DELETE') {
      useOrdersStore.getState().removeOrder(row.id);
      return;
    }

    const order = rowToOrder(row);
    const existing = useOrdersStore.getState().orders[order.id];
    if (!existing) {
      const { data: items } = await supabase
        .from('order_items')
        .select('id,order_id,product_id,product_name,quantity,unit_price,modifiers,special_instructions')
        .eq('order_id', order.id);
      order.items = ((items ?? []) as unknown as OrderItemRow[]).map(itemRowToItem);
    } else {
      order.items = existing.items;
    }

    const store = useOrdersStore.getState();
    store.upsertOrders([order]);

    // Paid Draft→New UPDATE (the webhook path) or fresh INSERT: alert.
    const alerted = new Set(store.alertedOrderIds);
    if (isAlertWorthy(order, alerted)) {
      await notifyNewOrder(order, 'realtime');
    } else if (order.items.length === 0 && existing) {
      void this.refetchItems(order.id);
    }
  }

  private async refetchItems(orderId: string): Promise<void> {
    const { data, error } = await supabase
      .from('order_items')
      .select('id,order_id,product_id,product_name,quantity,unit_price,modifiers,special_instructions')
      .eq('order_id', orderId);
    if (error || !data) return;
    const current = useOrdersStore.getState().orders[orderId];
    if (!current) return;
    useOrdersStore.getState().upsertOrders([
      { ...current, items: ((data ?? []) as unknown as OrderItemRow[]).map(itemRowToItem) },
    ]);
  }

  private async attachItems(orders: KitchenOrder[]): Promise<void> {
    const existing = useOrdersStore.getState().orders;
    const missing = orders.filter((order) => {
      const cached = existing[order.id];
      return !cached || cached.items.length === 0;
    });
    if (!missing.length) return;

    const ids = missing.map((o) => o.id);
    const byOrder = new Map<string, KitchenOrder>(missing.map((o) => [o.id, o]));
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { data, error } = await supabase
        .from('order_items')
        .select('id,order_id,product_id,product_name,quantity,unit_price,modifiers,special_instructions')
        .in('order_id', chunk);
      if (error) continue; // items enrich the view; their absence isn't fatal
      for (const raw of (data ?? []) as unknown as OrderItemRow[]) {
        const order = byOrder.get(raw.order_id);
        if (order) order.items.push(itemRowToItem(raw));
      }
    }
  }

  private async refreshJob(jobId: string): Promise<void> {
    const { printStore } = { printStore: usePrintStore.getState() };
    const { data, error } = await supabase
      .from('print_jobs')
      .select('id,order_id,order_number,printer_id,status,attempts,max_attempts,last_error,origin,created_at,printed_at')
      .eq('id', jobId)
      .maybeSingle();
    if (!error && data) printStore.upsertJobs([data as never]);
  }

  async refreshPrintState(): Promise<void> {
    const { data: printers, error: printersError } = await supabase
      .from('printers')
      .select('id,name,station,host,port,paper_width,enabled,auto_print,copies');
    if (!printersError && printers) {
      usePrintStore.getState().setPrinters(printers as never);
    }

    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: jobs, error: jobsError } = await supabase
      .from('print_jobs')
      .select('id,order_id,order_number,printer_id,status,attempts,max_attempts,last_error,origin,created_at,printed_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(300);
    if (!jobsError && jobs) {
      usePrintStore.getState().upsertJobs(jobs as never);
    }

    // Detect fresh failures → incident log (deduped in recordIncident).
    for (const job of Object.values(usePrintStore.getState().jobs)) {
      if (job.status === 'FAILED' && Date.now() - Date.parse(job.createdAt) < 120_000) {
        void recordIncident({
          kind: 'printer_failure',
          severity: 'critical',
          orderId: job.orderId,
          message: `Print job for ${job.orderNumber} FAILED: ${job.lastError || 'unknown error'}`,
        });
      }
    }
  }
}

export const syncService = new OrderSyncService();
