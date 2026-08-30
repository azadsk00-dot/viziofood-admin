// Reconciliation logic — merging backend truth into the local store.
// Pure functions, unit-tested in __tests__/reconcile.test.ts.

import type { Order } from '../types';

/**
 * Merge incoming orders (fresh query / realtime payload) into the local map.
 * Incoming always wins (the database is the source of truth); orders not
 * present in `incoming` are left untouched — pruning is an explicit separate
 * decision (pruneOrders) so a partial fetch never deletes known orders.
 */
export function mergeOrders(
  existing: Record<string, Order>,
  incoming: Order[],
): Record<string, Order> {
  const merged: Record<string, Order> = { ...existing };
  for (const order of incoming) {
    merged[order.id] = order;
  }
  return merged;
}

/** Orders in `incoming` that were not previously known. */
export function findNewOrders(knownIds: Set<string>, incoming: Order[]): Order[] {
  return incoming.filter((order) => !knownIds.has(order.id));
}

/**
 * Drop terminal orders older than `keepHours` from the local cache so the
 * persisted store doesn't grow forever. Live and scheduled orders are never
 * pruned.
 */
export function pruneOrders(
  orders: Record<string, Order>,
  keepHours: number,
  now: number = Date.now(),
): Record<string, Order> {
  const cutoff = now - keepHours * 3600_000;
  const kept: Record<string, Order> = {};
  for (const [id, order] of Object.entries(orders)) {
    const terminal =
      order.status === 'Completed' || order.status === 'Cancelled' || order.status === 'Rejected';
    if (order.scheduledAt !== null && order.scheduledAt > cutoff - 24 * 3600_000) {
      kept[id] = order; // future scheduled order — keep regardless of status
      continue;
    }
    const updated = Date.parse(order.updatedAt || order.createdAt);
    if (!terminal || Number.isNaN(updated) || updated >= cutoff) {
      kept[id] = order;
    }
  }
  return kept;
}

/**
 * A reconciliation-discovered order only alerts when it is recent — a fresh
 * install (or cleared storage) must not ring through this morning's orders.
 * Realtime events are always fresh by nature and skip this guard.
 */
export const RECONCILE_ALERT_WINDOW_MS = 2 * 3600_000;

export function isRecentOrder(order: Pick<Order, 'createdAt'>, now: number = Date.now()): boolean {
  const created = Date.parse(order.createdAt);
  if (Number.isNaN(created)) return false;
  return now - created <= RECONCILE_ALERT_WINDOW_MS;
}
