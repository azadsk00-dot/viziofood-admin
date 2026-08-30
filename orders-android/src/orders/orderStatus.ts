// Order workflow logic — mirrors the database state machine
// (migration 20260826120002_order_state_machine.sql). The DB trigger is the
// authority; these pure helpers drive the UI (which buttons to show) and give
// fast client-side validation so invalid updates are never attempted.

import type { Fulfilment, Order, OrderStatus } from '../types';

export const TERMINAL_STATUSES: OrderStatus[] = ['Completed', 'Cancelled', 'Rejected'];

/** The board groups the workflow into four kitchen sections. */
export type BoardSection = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED';

/** Forward-only chain; Cancelled/Rejected reachable from any active state. */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  Draft: [],
  New: ['Accepted', 'Cancelled', 'Rejected'],
  Accepted: ['Preparing', 'Cancelled', 'Rejected'],
  Preparing: ['Ready', 'Cancelled', 'Rejected'],
  Ready: ['Completed', 'Cancelled', 'Rejected'],
  Completed: [],
  Cancelled: [],
  Rejected: [],
};

/** Ranks mirror order_status_rank() in the DB trigger. */
const STATUS_RANK: Record<OrderStatus, number> = {
  Draft: 0,
  New: 1,
  Accepted: 2,
  Preparing: 3,
  Ready: 4,
  Completed: 5,
  Cancelled: 99,
  Rejected: 99,
};

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Mirrors enforce_order_status_transition(): forward-only movement (skipping
 * ahead allowed), Cancelled/Rejected from any active state, terminal states
 * locked, no-op updates pass.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  if (isTerminal(from)) return false;
  if (from === 'Draft') return false; // Draft is server-side only (webhook)
  return STATUS_RANK[to] > STATUS_RANK[from];
}

export function advanceTarget(status: OrderStatus): OrderStatus | null {
  return NEXT_STATUS[status]?.[0] ?? null;
}

/** The one-tap progression shown on the detail screen (no manual Accept — new paid orders auto-enter Preparing). */
export const ADVANCE_LABEL: Record<string, string> = {
  New: 'PREPARING', // fallback only — auto-accept normally handles it
  Accepted: 'READY',
  Preparing: 'READY',
  Ready: 'COMPLETE',
};

/**
 * A genuinely new paid order: the moment the kitchen must be alerted.
 * payment_status=paid AND status=New — reached either as a PAID INSERT
 * (legacy path) or as the stripe-webhook's Draft→New UPDATE. Keyed on the
 * resulting row state, never on payload.old.
 */
export function isNewPaidOrder(order: Pick<Order, 'status' | 'paymentStatus'>): boolean {
  return order.status === 'New' && order.paymentStatus === 'paid';
}

export function fulfilmentLabel(fulfilment: Fulfilment): string {
  if (fulfilment === 'Delivery') return 'DELIVERY';
  if (fulfilment === 'Dine-in') return 'DINE-IN';
  return 'PICKUP';
}

/**
 * Payment state for the kitchen — immediately understandable, derived ONLY
 * from the existing payment_status field (all card payments go through
 * Stripe; nothing is invented):
 *   paid               → PAID
 *   pending / failed   → NOT PAID
 *   refunded / partial → REFUNDED / PARTIALLY REFUNDED
 */
export function paymentLabel(status: Order['paymentStatus']): string {
  switch (status) {
    case 'paid':
      return 'PAID';
    case 'pending':
    case 'failed':
      return 'NOT PAID';
    case 'refunded':
      return 'REFUNDED';
    case 'partially_refunded':
      return 'PARTIALLY REFUNDED';
    default:
      return 'NOT PAID';
  }
}

/** True when the customer's payment is confirmed. */
export function isPaid(status: Order['paymentStatus']): boolean {
  return status === 'paid';
}

/** Total item quantity across the order (falls back to the DB count). */
export function itemCount(order: Pick<Order, 'items' | 'itemsCount'>): number {
  if (order.items.length) {
    return order.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  }
  return order.itemsCount;
}

export function modifierNames(item: Order['items'][number]): string[] {
  return item.modifiers
    .map((m) => (typeof m === 'object' && m ? m.name : String(m)))
    .filter(Boolean);
}
