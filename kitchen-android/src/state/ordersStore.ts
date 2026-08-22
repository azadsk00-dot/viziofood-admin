// Orders store — the tablet's local mirror of the backend order list.
// Persisted (AsyncStorage) so orders received before an outage/restart stay
// visible offline. The database remains the source of truth; every mutation
// goes through Supabase and the realtime/reconciliation loop updates the store.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KitchenOrder } from '../lib/types';
import { isUnacknowledged } from '../lib/orderLogic';
import { mergeOrders, pruneOrders } from '../lib/reconcile';

export type SyncStatus = 'idle' | 'connecting' | 'syncing' | 'ready' | 'offline' | 'error';

interface OrdersState {
  orders: Record<string, KitchenOrder>;
  /** Realtime websocket connected (independent of internet connectivity UI). */
  realtimeConnected: boolean;
  /** NetInfo internet reachability. */
  internetOnline: boolean;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  /** Incremental-sync cursor: latest updated_at seen from the backend. */
  cursor: string | null;
  /** Order ids this device has already alerted about (duplicate protection). */
  alertedOrderIds: string[];
  /** Order currently driving the full-screen alert overlay. */
  activeAlertOrderId: string | null;

  upsertOrders: (orders: KitchenOrder[]) => void;
  removeOrder: (id: string) => void;
  markAlerted: (id: string) => void;
  setActiveAlert: (id: string | null) => void;
  setRealtimeConnected: (connected: boolean) => void;
  setInternetOnline: (online: boolean) => void;
  setSyncStatus: (status: SyncStatus, error?: string | null) => void;
  setLastSyncAt: (iso: string) => void;
  setCursor: (cursor: string | null) => void;
  prune: () => void;
  clearAll: () => void;
}

export const useOrdersStore = create<OrdersState>()(
  persist(
    (set) => ({
      orders: {},
      realtimeConnected: false,
      internetOnline: true,
      syncStatus: 'idle',
      lastSyncAt: null,
      lastSyncError: null,
      cursor: null,
      alertedOrderIds: [],
      activeAlertOrderId: null,

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
      setActiveAlert: (id) => set({ activeAlertOrderId: id }),
      setRealtimeConnected: (connected) => set({ realtimeConnected: connected }),
      setInternetOnline: (online) => set({ internetOnline: online }),
      setSyncStatus: (status, error = null) => set({ syncStatus: status, lastSyncError: error }),
      setLastSyncAt: (iso) => set({ lastSyncAt: iso }),
      setCursor: (cursor) => set({ cursor }),
      prune: () => set((state) => ({ orders: pruneOrders(state.orders, 24) })),
      clearAll: () =>
        set({
          orders: {},
          cursor: null,
          alertedOrderIds: [],
          activeAlertOrderId: null,
          syncStatus: 'idle',
          lastSyncError: null,
        }),
    }),
    {
      name: 'vizio.kitchen-orders',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the durable domain data persists — transient flags don't.
      partialize: (state) => ({
        orders: state.orders,
        cursor: state.cursor,
        alertedOrderIds: state.alertedOrderIds,
        lastSyncAt: state.lastSyncAt,
      }),
    },
  ),
);

// ─── Selectors / helpers ────────────────────────────────────────────────────

export const getOrder = (id: string): KitchenOrder | undefined =>
  useOrdersStore.getState().orders[id];

export const allOrders = (): KitchenOrder[] => Object.values(useOrdersStore.getState().orders);

export const unacknowledgedNewOrders = (): KitchenOrder[] =>
  allOrders().filter(isUnacknowledged);

export const hasAlerted = (id: string): boolean =>
  useOrdersStore.getState().alertedOrderIds.includes(id);
