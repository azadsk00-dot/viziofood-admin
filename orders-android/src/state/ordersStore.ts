// Orders store — the terminal's local mirror of the backend order list.
// Persisted (AsyncStorage) so orders received before an outage/restart stay
// visible offline. The database remains the source of truth; every mutation
// goes through Supabase and the realtime/reconciliation loop updates the
// store. Merging is keyed by order id, so duplicate cards are impossible.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Order } from '../types';
import { mergeOrders, pruneOrders } from '../orders/reconcile';

export type SyncStatus = 'idle' | 'connecting' | 'syncing' | 'ready' | 'offline' | 'error';

interface OrdersState {
  orders: Record<string, Order>;
  /** Realtime websocket connected (independent of internet connectivity UI). */
  realtimeConnected: boolean;
  /** NetInfo internet reachability. */
  internetOnline: boolean;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  /**
   * Order ids this device has already alerted (notification + sound + auto
   * print) — THE durable duplicate protection. Persisted so an app restart,
   * realtime replay or webhook replay can never re-alert an order.
   */
  alertedOrderIds: string[];

  upsertOrders: (orders: Order[]) => void;
  removeOrder: (id: string) => void;
  markAlerted: (id: string) => void;
  hasAlerted: (id: string) => boolean;
  setRealtimeConnected: (connected: boolean) => void;
  setInternetOnline: (online: boolean) => void;
  setSyncStatus: (status: SyncStatus, error?: string | null) => void;
  setLastSyncAt: (iso: string) => void;
  prune: () => void;
  clearAll: () => void;
}

export const useOrdersStore = create<OrdersState>()(
  persist(
    (set, get) => ({
      orders: {},
      realtimeConnected: false,
      internetOnline: true,
      syncStatus: 'idle',
      lastSyncAt: null,
      lastSyncError: null,
      alertedOrderIds: [],

      upsertOrders: (incoming) =>
        set((state) => ({ orders: mergeOrders(state.orders, incoming) })),
      removeOrder: (id) =>
        set((state) => {
          const next = { ...state.orders };
          delete next[id];
          return { orders: next };
        }),
      markAlerted: (id) =>
        set((state) => ({
          alertedOrderIds: state.alertedOrderIds.includes(id)
            ? state.alertedOrderIds
            : [...state.alertedOrderIds.slice(-499), id],
        })),
      hasAlerted: (id) => get().alertedOrderIds.includes(id),
      setRealtimeConnected: (connected) => set({ realtimeConnected: connected }),
      setInternetOnline: (online) => set({ internetOnline: online }),
      setSyncStatus: (status, error = null) => set({ syncStatus: status, lastSyncError: error }),
      setLastSyncAt: (iso) => set({ lastSyncAt: iso }),
      prune: () => set((state) => ({ orders: pruneOrders(state.orders, 24) })),
      clearAll: () =>
        set({
          orders: {},
          syncStatus: 'idle',
          lastSyncError: null,
        }),
    }),
    {
      name: 'vizio.orders.orders',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the durable domain data persists — transient flags don't.
      partialize: (state) => ({
        orders: state.orders,
        alertedOrderIds: state.alertedOrderIds,
        lastSyncAt: state.lastSyncAt,
      }),
    },
  ),
);

// ─── Helpers ────────────────────────────────────────────────────────────────

export const getOrder = (id: string): Order | undefined => useOrdersStore.getState().orders[id];

export const allOrders = (): Order[] => Object.values(useOrdersStore.getState().orders);
