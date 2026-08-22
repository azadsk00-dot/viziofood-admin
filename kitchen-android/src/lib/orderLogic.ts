// Order workflow logic — mirrors the database state machine
// (migrations/20260826120002_order_state_machine.sql). The DB trigger is the
// authority; these pure helpers drive the UI (which buttons to show) and give
// fast client-side validation so invalid updates are never attempted.

import type { Fulfilment, KitchenOrder, OrderItem, OrderStatus } from './types';
import type { KitchenSettings } from './settings';

export const LIVE_STATUSES: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready'];
export const TERMINAL_STATUSES: OrderStatus[] = ['Completed', 'Cancelled', 'Rejected'];
export const KITCHEN_STATUSES: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Completed'];

/** Forward-only chain; Cancelled/Rejected reachable from any active state. */
export const NEXT_STATUS: Record<string, OrderStatus[]> = {
  Draft: ['New', 'Cancelled'],
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

export function isLive(status: OrderStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

/**
 * Mirrors enforce_order_status_transition(): forward-only movement (skipping
 * ahead allowed), Cancelled/Rejected from any active state, Draft only → New,
 * terminal states locked, no-op updates pass.
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true; // no-op updates are allowed by the trigger
  if (isTerminal(from)) return false;
  if (from === 'Draft') return to === 'New' || to === 'Cancelled';
  // Active states (New/Accepted/Preparing/Ready): forward-only by rank, or out
  // via Cancelled/Rejected (which sit at rank 99).
  return STATUS_RANK[to] > STATUS_RANK[from];
}

export function advanceTarget(status: OrderStatus): OrderStatus | null {
  return NEXT_STATUS[status]?.[0] ?? null;
}

/** The one-tap kitchen progression: New → Accepted → Preparing → Ready → Completed. */
export const ADVANCE_LABEL: Partial<Record<OrderStatus, string>> = {
  New: 'ACCEPT',
  Accepted: 'START PREPARING',
  Preparing: 'MARK READY',
  Ready: 'COMPLETE',
};

// ─── Age / escalation ───────────────────────────────────────────────────────

export type EscalationLevel = 'none' | 'warning' | 'urgent' | 'manager' | 'overdue';

export function orderAgeSeconds(order: Pick<KitchenOrder, 'createdAt'>, now: number = Date.now()): number {
  const created = Date.parse(order.createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.round((now - created) / 1000));
}

/**
 * Escalation for NEW orders (warning → urgent → manager) and OVERDUE for
 * in-preparation orders past the overdue threshold. All thresholds come from
 * settings — nothing is hard-coded.
 */
export function escalationLevel(
  order: Pick<KitchenOrder, 'createdAt' | 'status'>,
  settings: Pick<KitchenSettings, 'warnMinutes' | 'urgentMinutes' | 'managerMinutes' | 'overdueMinutes'>,
  now: number = Date.now(),
): EscalationLevel {
  const minutes = orderAgeSeconds(order, now) / 60;
  if (order.status === 'New') {
    if (minutes >= settings.managerMinutes) return 'manager';
    if (minutes >= settings.urgentMinutes) return 'urgent';
    if (minutes >= settings.warnMinutes) return 'warning';
    return 'none';
  }
  if (order.status === 'Accepted' || order.status === 'Preparing') {
    return minutes >= settings.overdueMinutes ? 'overdue' : 'none';
  }
  return 'none';
}

export function isUnacknowledged(order: Pick<KitchenOrder, 'acknowledgedAt' | 'status'>): boolean {
  return order.status === 'New' && !order.acknowledgedAt;
}

// ─── Filters / search / sort ────────────────────────────────────────────────

export type OrderFilter =
  | 'live'
  | 'new'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'pickup'
  | 'delivery'
  | 'overdue'
  | 'urgent'
  | 'unacknowledged';

export const FILTER_LABELS: Record<OrderFilter, string> = {
  live: 'LIVE',
  new: 'NEW',
  accepted: 'ACCEPTED',
  preparing: 'PREPARING',
  ready: 'READY',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  pickup: 'PICKUP',
  delivery: 'DELIVERY',
  overdue: 'OVERDUE',
  urgent: 'URGENT',
  unacknowledged: 'UNACKNOWLEDGED',
};

export function filterOrders(
  orders: KitchenOrder[],
  filter: OrderFilter,
  query: string,
  settings: KitchenSettings,
  now: number = Date.now(),
): KitchenOrder[] {
  const q = query.trim().toLowerCase();
  return orders.filter((order) => {
    if (!matchesFilter(order, filter, settings, now)) return false;
    if (!q) return true;
    if (order.orderNumber.toLowerCase().includes(q)) return true;
    if (order.customerName.toLowerCase().includes(q)) return true;
    if (order.customerPhone.replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))) return true;
    return order.items.some((item) => item.name.toLowerCase().includes(q));
  });
}

export function matchesFilter(
  order: KitchenOrder,
  filter: OrderFilter,
  settings: KitchenSettings,
  now: number,
): boolean {
  switch (filter) {
    case 'live':
      return isLive(order.status);
    case 'new':
      return order.status === 'New';
    case 'accepted':
      return order.status === 'Accepted';
    case 'preparing':
      return order.status === 'Preparing';
    case 'ready':
      return order.status === 'Ready';
    case 'completed':
      return order.status === 'Completed';
    case 'cancelled':
      return order.status === 'Cancelled' || order.status === 'Rejected';
    case 'pickup':
      return isLive(order.status) && order.fulfilment === 'Pickup';
    case 'delivery':
      return isLive(order.status) && order.fulfilment === 'Delivery';
    case 'overdue': {
      const level = escalationLevel(order, settings, now);
      return isLive(order.status) && (level === 'overdue' || level === 'urgent' || level === 'manager');
    }
    case 'urgent': {
      const level = escalationLevel(order, settings, now);
      return isLive(order.status) && (level === 'urgent' || level === 'manager');
    }
    case 'unacknowledged':
      return isUnacknowledged(order);
    default:
      return true;
  }
}

export function sortOrders(orders: KitchenOrder[], oldestFirst: boolean): KitchenOrder[] {
  const sorted = [...orders].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return oldestFirst ? sorted : sorted.reverse();
}

// ─── Item summaries for card display ────────────────────────────────────────

export function modifierNames(item: OrderItem): string[] {
  return item.modifiers.map((m) => (typeof m === 'object' && m ? m.name : String(m))).filter(Boolean);
}

export function itemCount(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + (item.quantity || 1), 0);
}

export function hasAllergies(order: KitchenOrder): boolean {
  return /aller/i.test(order.specialInstructions) || order.items.some((i) => /aller/i.test(i.notes));
}

export function fulfilmentLabel(fulfilment: Fulfilment): string {
  return fulfilment === 'Delivery' ? 'DELIVERY' : 'PICKUP';
}
