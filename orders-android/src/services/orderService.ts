// OrderService — the ONLY place that talks to the orders/order_items tables.
// RLS is the authorization layer; the signed-in staff/kitchen/admin session
// scopes every query. No service-role keys, no direct Stripe access.

import { supabase } from '../lib/supabase';
import { startOfToday } from '../lib/format';
import type { Order, OrderStatus } from '../types';
import { itemRowToItem, rowToOrder } from './mappers';

const ORDER_COLUMNS =
  'id,order_number,status,payment_status,fulfilment_method,customer_name,customer_phone,customer_email,delivery_address,delivery_suburb,delivery_postcode,delivery_instructions,special_instructions,total,tax_total,items_count,created_at,updated_at,cancelled_at,cancellation_reason,refund_status';

const ITEM_COLUMNS =
  'id,order_id,product_name,quantity,unit_price,modifiers,special_instructions';

const PAGE_SIZE = 100;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Fetch items for the given orders (chunked .in query) and attach them. */
async function attachItems(orders: Order[]): Promise<Order[]> {
  const missing = orders.filter((order) => order.items.length === 0);
  if (!missing.length) return orders;
  const ids = missing.map((order) => order.id);
  const byOrder = new Map<string, Order>(missing.map((order) => [order.id, order]));
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data, error } = await supabase
      .from('order_items')
      .select(ITEM_COLUMNS)
      .in('order_id', chunk);
    if (error) continue; // items enrich the view; their absence isn't fatal
    for (const raw of (data ?? []) as Record<string, unknown>[]) {
      const item = itemRowToItem(raw);
      const order = byOrder.get(item.orderId);
      if (order) order.items.push(item);
    }
  }
  return orders;
}

/**
 * Today's operational orders (paged). Draft checkouts are excluded — they
 * become operational only when the stripe-webhook promotes them to New on
 * payment. Used for startup/reconnect/foreground reconciliation.
 */
export async function fetchTodaysOrders(): Promise<Order[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      .gte('created_at', startOfToday())
      .neq('status', 'Draft')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return attachItems(rows.map(rowToOrder));
}

/** A single order with items — detail screen and printing. */
export async function fetchOrder(orderId: string): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const order = rowToOrder(data as Record<string, unknown>);
  const { data: items, error: itemError } = await supabase
    .from('order_items')
    .select(ITEM_COLUMNS)
    .eq('order_id', orderId);
  if (!itemError && items) {
    order.items = (items as Record<string, unknown>[]).map(itemRowToItem);
  }
  return order;
}

/** Refetch items for one order (realtime updates carry no item rows). */
export async function fetchOrderItems(orderId: string) {
  const { data, error } = await supabase
    .from('order_items')
    .select(ITEM_COLUMNS)
    .eq('order_id', orderId);
  if (error || !data) return null;
  return (data as Record<string, unknown>[]).map(itemRowToItem);
}

// ── History ─────────────────────────────────────────────────────────────────

export interface HistoryFilter {
  /** Substring match on order number or customer name. */
  query: string;
  /** Inclusive lower bound (ISO) — null = unbounded. */
  from: string | null;
  /** Inclusive upper bound (ISO, end of day) — null = unbounded. */
  to: string | null;
  /** Restrict to a status; null = all non-Draft. */
  status: OrderStatus | 'all';
}

export const HISTORY_PAGE_SIZE = 25;

/**
 * One page of history, newest first. Search and date filters are applied
 * server-side (ILIKE / range) so thousands of old orders never load at once.
 */
export async function fetchHistoryPage(
  filter: HistoryFilter,
  pageIndex: number,
): Promise<{ orders: Order[]; hasMore: boolean }> {
  let query = supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .neq('status', 'Draft')
    .order('created_at', { ascending: false })
    .range(pageIndex * HISTORY_PAGE_SIZE, (pageIndex + 1) * HISTORY_PAGE_SIZE - 1);
  if (filter.status !== 'all') query = query.eq('status', filter.status);
  if (filter.from) query = query.gte('created_at', filter.from);
  if (filter.to) query = query.lte('created_at', filter.to);
  const trimmed = filter.query.trim();
  if (trimmed) {
    query = query.or(`order_number.ilike.%${escapeLike(trimmed)}%,customer_name.ilike.%${escapeLike(trimmed)}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const orders = (data ?? []) as Record<string, unknown>[];
  return {
    orders: orders.map(rowToOrder),
    hasMore: orders.length === HISTORY_PAGE_SIZE,
  };
}

/** PostgREST `or` filters are comma-separated — escape commas in user input. */
function escapeLike(value: string): string {
  return value.replace(/[,()%.]/g, ' ');
}

// ── Status actions ──────────────────────────────────────────────────────────

/**
 * Advance an order's status. Guarded client-side by the state-machine mirror
 * and server-side by RLS + the enforce_order_status_transition trigger.
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<{ orderId: string; status: OrderStatus }> {
  if (!uuid.test(orderId)) {
    throw new Error(`Order update blocked: expected a UUID, received "${orderId}".`);
  }
  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .select('id,status')
    .single();
  if (error) {
    throw new Error(
      `Unable to update order status: ${error.message}${error.code ? ` (${error.code})` : ''}`,
    );
  }
  const row = data as Record<string, unknown>;
  return { orderId: String(row.id), status: rowToOrder(row).status };
}
