// Reconciliation logic — merging backend truth into the local store.
// Pure functions: unit-tested in __tests__/reconcile.test.ts.

import { isUnacknowledged } from './orderLogic';
import type { KitchenOrder } from './types';

/**
 * Merge incoming orders (fresh query / realtime payload) into the local map.
 * Incoming always wins (database is the source of truth); orders not present
 * in `incoming` are left untouched — pruning is an explicit separate decision
 * (see pruneOrders) so a partial fetch never deletes known orders.
 */
export function mergeOrders(
  existing: Record<string, KitchenOrder>,
  incoming: KitchenOrder[],
): Record<string, KitchenOrder> {
  const merged: Record<string, KitchenOrder> = { ...existing };
  for (const order of incoming) {
    merged[order.id] = order;
  }
  return merged;
}

/**
 * A paid NEW order that we have never alerted about and nobody acknowledged.
 * Used by realtime inserts AND reconnect reconciliation — the webhook flips
 * Draft→New as an UPDATE, so reconciliation (not just INSERT events) must be
 * able to discover it.
 */
export function isAlertWorthy(order: KitchenOrder, alreadyAlertedIds: Set<string>): boolean {
  return (
    order.paymentStatus === 'paid' &&
    order.status === 'New' &&
    isUnacknowledged(order) &&
    !alreadyAlertedIds.has(order.id)
  );
}

/** Orders in `incoming` that were not previously known — the "missed orders". */
export function findNewOrders(
  knownIds: Set<string>,
  incoming: KitchenOrder[],
): KitchenOrder[] {
  return incoming.filter((order) => !knownIds.has(order.id));
}

/**
 * Drop terminal orders older than `keepHours` from the local cache so the
 * persisted store doesn't grow forever. Live orders are never pruned.
 */
export function pruneOrders(
  orders: Record<string, KitchenOrder>,
  keepHours: number,
  now: number = Date.now(),
): Record<string, KitchenOrder> {
  const cutoff = now - keepHours * 3600_000;
  const kept: Record<string, KitchenOrder> = {};
  for (const [id, order] of Object.entries(orders)) {
    const terminal = order.status === 'Completed' || order.status === 'Cancelled' || order.status === 'Rejected';
    const updated = Date.parse(order.updatedAt || order.createdAt);
    if (!terminal || Number.isNaN(updated) || updated >= cutoff) {
      kept[id] = order;
    }
  }
  return kept;
}

/** Cursor for incremental sync — latest updated_at seen, ISO string. */
export function nextCursor(orders: KitchenOrder[], previous: string | null): string | null {
  let latest = previous ? Date.parse(previous) : 0;
  for (const order of orders) {
    const t = Date.parse(order.updatedAt || order.createdAt);
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  return latest > 0 ? new Date(latest).toISOString() : previous;
}

/** True when two order snapshots differ in anything the kitchen UI renders. */
export function orderChanged(a: KitchenOrder | undefined, b: KitchenOrder): boolean {
  if (!a) return true;
  return (
    a.status !== b.status ||
    a.paymentStatus !== b.paymentStatus ||
    a.acknowledgedAt !== b.acknowledgedAt ||
    a.updatedAt !== b.updatedAt ||
    a.items.length !== b.items.length
  );
}
