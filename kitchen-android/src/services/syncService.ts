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
import { autoPrepareOrder } from './autoPrepare';
import { recordIncident } from './incidents';
import { rowToOrder, itemRowToItem, rowToPrintJob, rowToPrinter } from './mappers';

const ORDER_COLUMNS =
  'id,order_number,status,payment_status,fulfilment_method,customer_name,customer_phone,customer_email,delivery_address,delivery_suburb,delivery_postcode,delivery_instructions,special_instructions,total,items_count,coupon_code,created_at,updated_at,acknowledged_at,acknowledged_by,cancelled_at,cancellation_reason,refund_status';
// Fallback when the kitchen-support migration (acknowledged_at/acknowledged_by)
// has not been applied yet — every column here is verified to exist in the
// original platform schema, so reconciliation keeps working either way.
const ORDER_COLUMNS_BASE =
  'id,order_number,status,payment_status,fulfilment_method,customer_name,customer_phone,customer_email,delivery_address,delivery_suburb,delivery_postcode,delivery_instructions,special_instructions,total,items_count,coupon_code,created_at,updated_at,cancelled_at,cancellation_reason,refund_status';

const JOB_COLUMNS = 'id,order_id,order_number,printer_id,status,attempts,max_attempts,last_error,origin,created_at,printed_at';
const JOB_COLUMNS_BASE = 'id,order_id,order_number,printer_id,status,attempts,max_attempts,last_error,created_at,printed_at';

/** True when the error is a missing column (42703/PGRST204) — schema older than the app. */
const isMissingColumn = (message: string): boolean =>
  /42703|PGRST204|does not exist/i.test(message);

const FETCH_PAGE_SIZE = 100;
/**
 * Hard ceiling for one reconcile pass. Without it a single request that
 * never resolves (network cut mid-fetch when the screen turned off) left
 * `reconciling` true FOREVER — every later reconcile returned early and the
 * tablet silently stopped discovering missed orders (2026-08-30 diagnostic:
 * LAST SYNC frozen at 23:55:55 while orders were missed).
 */
const RECONCILE_TIMEOUT_MS = 90_000;

/** Resolve/reject a promise with a timeout; the underlying work continues. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

class OrderSyncService {
  private ordersChannel: RealtimeChannel | null = null;
  private printChannel: RealtimeChannel | null = null;
  private netUnsubscribe: (() => void) | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private reconciling = false;
  private offlineAt: number | null = null;
  private ordersStatus: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | 'other' = 'other';

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const store = useOrdersStore.getState();
    store.setSyncStatus('connecting');

    await this.reconcile('startup');

    this.subscribeOrders();
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

    // Foreground: reconcile to catch anything missed while backgrounded, and
    // rebuild the orders channel if it died while we were away (a saturated
    // JS thread — e.g. a render loop — can exhaust the phoenix heartbeat).
    this.appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void this.reconcile('foreground');
        this.reviveOrdersChannel();
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

  /** (Re)create the orders realtime channel. */
  private subscribeOrders(): void {
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
        this.ordersStatus = status === 'SUBSCRIBED' ? 'SUBSCRIBED'
          : status === 'CHANNEL_ERROR' ? 'CHANNEL_ERROR'
          : status === 'TIMED_OUT' ? 'TIMED_OUT'
          : status === 'CLOSED' ? 'CLOSED'
          : 'other';
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
  }

  /**
   * Phoenix usually reconnects on its own; this is the belt-and-braces path
   * for a channel that stayed dead after e.g. a saturated JS thread ate the
   * heartbeat (the OrderDetailScreen loop incident). Runs on foreground.
   */
  private reviveOrdersChannel(): void {
    if (!this.started) return;
    if (this.ordersStatus === 'SUBSCRIBED') return;
    const dead = this.ordersChannel;
    this.ordersChannel = null;
    if (dead) void supabase.removeChannel(dead).then(() => undefined).catch(() => undefined);
    this.subscribeOrders();
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
   *
   * Timeout-guarded: a hung request releases the lock so later passes run.
   */
  private async reconcile(reason: string): Promise<{ ok: boolean; error?: string }> {
    if (this.reconciling) return { ok: true };
    this.reconciling = true;
    try {
      return await withTimeout(this.reconcileInner(reason), RECONCILE_TIMEOUT_MS, `Reconcile timed out after ${RECONCILE_TIMEOUT_MS / 1000}s (${reason}) — likely a stalled request from a network drop.`);
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileInner(reason: string): Promise<{ ok: boolean; error?: string }> {
    const store = useOrdersStore.getState();
    if (store.internetOnline) store.setSyncStatus('syncing');

    try {
      const since = startOfToday();
      const rows: OrderRow[] = [];
      let from = 0;
      // Page through today's orders (paid or live — kitchen doesn't need Drafts).
      // Falls back to the base column set when the kitchen-support migration
      // (acknowledged_* columns) is not applied yet.
      let orderColumns = ORDER_COLUMNS;
      for (;;) {
        const { data, error } = await supabase
          .from('orders')
          .select(orderColumns)
          .gte('created_at', since)
          .neq('status', 'Draft')
          .order('created_at', { ascending: false })
          .range(from, from + FETCH_PAGE_SIZE - 1);
        if (error && isMissingColumn(error.message) && orderColumns !== ORDER_COLUMNS_BASE) {
          orderColumns = ORDER_COLUMNS_BASE;
          continue;
        }
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
          // Discovered-after-a-gap orders auto-prepare too — the kitchen
          // must not depend on a human tapping ACCEPT on this tablet.
          void autoPrepareOrder(order);
        }
      }
      if (reason === 'reconnect') this.offlineAt = null;

      // Already-alerted but still-NEW orders (alerted before a restart, the
      // prepare step never ran): auto-prepare them WITHOUT re-alerting —
      // autoPrepareOrder's own gates (persisted dedupe + age window + race
      // guards) keep this idempotent.
      for (const order of orders) {
        if (order.status === 'New') void autoPrepareOrder(order);
      }

      await this.refreshPrintState();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useOrdersStore.getState().setSyncStatus('error', message);
      return { ok: false, error: message };
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
      // Auto-advance fresh NEW orders in every app state (gated by settings,
      // persisted dedupe and the eligibility window inside autoPrepare).
      void autoPrepareOrder(order);
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
    let result: { data: Record<string, unknown> | null; error: { message: string } | null } = await supabase
      .from('print_jobs')
      .select(JOB_COLUMNS)
      .eq('id', jobId)
      .maybeSingle();
    if (result.error && isMissingColumn(result.error.message)) {
      // print_jobs.origin not migrated yet — fetch without it.
      result = await supabase.from('print_jobs').select(JOB_COLUMNS_BASE).eq('id', jobId).maybeSingle();
    }
    if (!result.error && result.data) printStore.upsertJobs([rowToPrintJob(result.data)]);
  }

  async refreshPrintState(): Promise<void> {
    const { data: printers, error: printersError } = await supabase
      .from('printers')
      .select('id,name,station,host,port,paper_width,enabled,auto_print,copies');
    if (!printersError && printers) {
      usePrintStore.getState().setPrinters((printers as Record<string, unknown>[]).map(rowToPrinter));
    }

    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    let jobResult: { data: Record<string, unknown>[] | null; error: { message: string } | null } = await supabase
      .from('print_jobs')
      .select(JOB_COLUMNS)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(300);
    if (jobResult.error && isMissingColumn(jobResult.error.message)) {
      jobResult = await supabase
        .from('print_jobs')
        .select(JOB_COLUMNS_BASE)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(300);
    }
    if (!jobResult.error && jobResult.data) {
      usePrintStore.getState().upsertJobs(jobResult.data.map(rowToPrintJob));
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
