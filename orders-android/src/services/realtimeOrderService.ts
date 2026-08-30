// RealtimeOrderService — realtime-first order sync with reconciliation.
//
//   Realtime (instant, primary — no polling)  +  reconciliation (safety net)
//
// Realtime alone is never fully trusted: on startup, realtime recovery,
// reconnect, app foreground and a conservative periodic sweep the service
// re-queries today's orders and merges them, so an order that arrived while
// the terminal was offline/locked/killed is always discovered. Realtime
// remains the primary path — the sweep exists for missed events, not as a
// refresh interval.
//
// Lifecycle handled: SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT (reconnect),
// NetInfo offline→online, AppState background→foreground (channel health
// check + reconcile), and periodic (60s) reconciliation while online.

import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useOrdersStore } from '../state/ordersStore';
import { rowToOrder } from './mappers';
import { fetchTodaysOrders } from './orderService';
import { processIncomingOrder } from './orderEventProcessor';
import { printerQueue } from './printerQueue';

const PERIODIC_RECONCILE_MS = 60_000;
/** If realtime stays down this long while online, recreate the channel. */
const CHANNEL_RECREATE_AFTER_MS = 45_000;

type ReconcileReason =
  | 'startup'
  | 'realtime-recovered'
  | 'reconnect'
  | 'foreground'
  | 'periodic'
  | 'manual';

class RealtimeOrderService {
  private channel: RealtimeChannel | null = null;
  private netUnsubscribe: (() => void) | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private reconciling = false;
  private realtimeDownSince: number | null = null;
  private offlineAt: number | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    useOrdersStore.getState().setSyncStatus('connecting');
    await this.reconcile('startup');
    this.subscribeOrders();
    this.watchConnectivity();
    this.watchAppState();
    this.schedulePeriodicReconcile();
  }

  stop(): void {
    if (this.channel) void supabase.removeChannel(this.channel);
    this.netUnsubscribe?.();
    this.appStateSubscription?.remove();
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.channel = null;
    this.netUnsubscribe = null;
    this.appStateSubscription = null;
    this.reconcileTimer = null;
    this.started = false;
    useOrdersStore.getState().setRealtimeConnected(false);
  }

  /** SYNC NOW — manual force-reconcile (connection banner / pull). */
  async syncNow(): Promise<{ ok: boolean; error?: string }> {
    return this.reconcile('manual');
  }

  // ── Realtime ──────────────────────────────────────────────────────────────

  private subscribeOrders(): void {
    this.channel = supabase
      .channel('orders-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload: {
          eventType: string;
          new: Record<string, unknown> | null;
          old: Record<string, unknown> | null;
        }) => {
          void this.handleOrderEvent(payload);
        },
      )
      .subscribe((status) => {
        const store = useOrdersStore.getState();
        if (status === 'SUBSCRIBED') {
          this.realtimeDownSince = null;
          store.setRealtimeConnected(true);
          // An event may have been missed during (re)subscription — reconcile.
          if (store.lastSyncAt) void this.reconcile('realtime-recovered');
          if (store.syncStatus !== 'syncing') store.setSyncStatus('ready');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (this.realtimeDownSince === null) this.realtimeDownSince = Date.now();
          store.setRealtimeConnected(false);
          store.setSyncStatus('error', `Realtime connection lost — reconnecting…`);
          // supabase-js auto-retries the socket; recreate the channel if it
          // stays down (checked by the periodic sweep below).
        }
      });
  }

  private recreateChannel(): void {
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
    this.realtimeDownSince = Date.now();
    this.subscribeOrders();
  }

  private async handleOrderEvent(payload: {
    eventType: string;
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
  }): Promise<void> {
    const row = (payload.new ?? payload.old) as Record<string, unknown> | null;
    if (!row?.id) return;

    if (payload.eventType === 'DELETE') {
      useOrdersStore.getState().removeOrder(String(row.id));
      return;
    }

    const order = rowToOrder(row);
    // Realtime payloads carry no item rows — keep what we already fetched;
    // the processor re-fetches when we have none.
    const existing = useOrdersStore.getState().orders[order.id];
    if (existing?.items.length) order.items = existing.items;

    await processIncomingOrder(order, 'realtime');
  }

  // ── Reconciliation ────────────────────────────────────────────────────────

  private async reconcile(reason: ReconcileReason): Promise<{ ok: boolean; error?: string }> {
    if (this.reconciling) return { ok: true };
    this.reconciling = true;
    const store = useOrdersStore.getState();
    if (store.internetOnline) store.setSyncStatus('syncing');

    try {
      const orders = await fetchTodaysOrders();
      for (const order of orders) {
        await processIncomingOrder(order, 'reconcile');
      }
      const after = useOrdersStore.getState();
      after.setLastSyncAt(new Date().toISOString());
      after.prune();
      after.setSyncStatus(after.internetOnline ? 'ready' : 'offline');
      if (reason === 'reconnect') this.offlineAt = null;
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useOrdersStore.getState().setSyncStatus(
        useOrdersStore.getState().internetOnline ? 'error' : 'offline',
        message,
      );
      return { ok: false, error: message };
    } finally {
      this.reconciling = false;
    }
  }

  // ── Watchdogs ─────────────────────────────────────────────────────────────

  private watchConnectivity(): void {
    this.netUnsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected);
      const store = useOrdersStore.getState();
      const was = store.internetOnline;
      store.setInternetOnline(online);
      if (!online && was) {
        this.offlineAt = Date.now();
        store.setSyncStatus('offline', 'Connection lost — reconnecting…');
      } else if (online && !was) {
        // Internet returned: reconcile and verify the channel is alive.
        void this.reconcile('reconnect');
        if (!store.realtimeConnected) this.recreateChannel();
      }
    });
  }

  private watchAppState(): void {
    this.appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active') return;
      // Verify the subscription survived the background; recreate if not.
      const store = useOrdersStore.getState();
      if (!store.realtimeConnected && store.internetOnline) this.recreateChannel();
      void this.reconcile('foreground');
      printerQueue.onWake();
    });
  }

  private schedulePeriodicReconcile(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = setInterval(() => {
      const store = useOrdersStore.getState();
      if (!store.internetOnline) return;
      void this.reconcile('periodic');
      // Realtime stuck down while online → recreate the channel.
      if (
        !store.realtimeConnected &&
        this.realtimeDownSince !== null &&
        Date.now() - this.realtimeDownSince > CHANNEL_RECREATE_AFTER_MS
      ) {
        this.recreateChannel();
      }
    }, PERIODIC_RECONCILE_MS);
  }
}

export const realtimeOrderService = new RealtimeOrderService();
