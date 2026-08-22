/**
 * Orders service — the extended order read model.
 *
 * Extends the proven admin/supabase.ts queries with the columns added by
 * the 20260826 migration: fulfilment_method, delivery address parts, and
 * the persisted charge breakdown (subtotal, discount, coupon_code, fees).
 * Before that migration runs, reads fall back to the legacy column list
 * and default fulfilment to Pickup, exactly like the old admin did.
 */

import { supabase, supabaseConfigurationError } from '../lib/supabase';
import type { Order, OrderItem, OrderStatus } from '../types';

type Row = Record<string, unknown>;

const client = () => {
  if (!supabase) throw new Error(supabaseConfigurationError);
  return supabase;
};

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const nullableText = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => Number(v ?? 0);

const BASE = 'id,order_number,customer_name,customer_email,customer_phone,payment_status,total,status,created_at,items_count,special_instructions,tax_total,stripe_session_id,payment_intent_id,refund_status,refund_id,refund_amount,refunded_at,refund_reason,cancelled_at,cancellation_reason';
// Extended columns: fulfilment + full charge breakdown. subtotal/tax_total/
// delivery_fee/service_charge/card_processing_fee exist from the 20260821
// migration; discount/coupon/fulfilment/address arrive with 20260826120000.
const EXTENDED = `${BASE},fulfilment_method,delivery_address,delivery_suburb,delivery_postcode,delivery_instructions,subtotal,discount_total,coupon_code,delivery_fee,service_charge,card_processing_fee`;

const orderStatus = (value: unknown): OrderStatus => {
  const s = text(value);
  return (['New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Rejected', 'Cancelled'] as const).includes(s as OrderStatus)
    ? (s as OrderStatus)
    : 'New';
};

const PAYMENT_STATUSES = ['paid', 'pending', 'failed', 'refunded', 'partially_refunded'] as const;
const REFUND_STATUSES = ['pending', 'succeeded', 'partially_refunded', 'failed'] as const;

const paymentStatus = (value: unknown): Order['paymentStatus'] => {
  const s = text(value).toLowerCase() as Order['paymentStatus'];
  return (PAYMENT_STATUSES as readonly string[]).includes(s) ? s : 'unknown';
};

const refundStatus = (value: unknown): Order['refundStatus'] => {
  const s = text(value).toLowerCase() as Order['refundStatus'];
  return (REFUND_STATUSES as readonly string[]).includes(s) ? s : '';
};

const modifiers = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'object' && item !== null && 'name' in item ? text((item as Row).name) : text(item)))
        .filter(Boolean)
    : [];

const orderItem = (row: Row): OrderItem => ({
  id: text(row.id),
  name: text(row.product_name),
  quantity: num(row.quantity),
  unitPrice: num(row.unit_price),
  modifiers: modifiers(row.modifiers),
  notes: text(row.special_instructions),
});

const mapOrder = (row: Row, extended: boolean): Order => {
  const base: Order = {
    orderId: text(row.id),
    orderNumber: text(row.order_number) || text(row.id),
    customer: text(row.customer_name),
    email: text(row.customer_email),
    phone: text(row.customer_phone),
    fulfilment: 'Pickup',
    address: '',
    suburb: '',
    postcode: '',
    paymentStatus: paymentStatus(row.payment_status),
    refundStatus: refundStatus(row.refund_status),
    refundId: text(row.refund_id),
    refundAmount: num(row.refund_amount),
    refundedAt: nullableText(row.refunded_at),
    refundReason: text(row.refund_reason),
    paymentIntentId: text(row.payment_intent_id || row.stripe_payment_intent),
    stripeSessionId: text(row.stripe_session_id),
    cancelledAt: nullableText(row.cancelled_at),
    cancellationReason: text(row.cancellation_reason),
    specialInstructions: text(row.special_instructions),
    subtotal: num(row.total) - num(row.tax_total),
    discountTotal: 0,
    couponCode: '',
    taxTotal: num(row.tax_total),
    deliveryFeeTotal: 0,
    serviceChargeTotal: 0,
    cardFeeTotal: 0,
    total: num(row.total),
    status: orderStatus(row.status),
    createdAt: text(row.created_at),
    items: [],
    itemsCount: num(row.items_count),
    notes: text(row.special_instructions),
  };
  if (extended) {
    base.fulfilment = row.fulfilment_method === 'Delivery' ? 'Delivery' : 'Pickup';
    base.address = text(row.delivery_address);
    base.suburb = text(row.delivery_suburb);
    base.postcode = text(row.delivery_postcode);
    base.subtotal = row.subtotal === null || row.subtotal === undefined ? base.subtotal : num(row.subtotal);
    base.discountTotal = num(row.discount_total);
    base.couponCode = text(row.coupon_code);
    base.deliveryFeeTotal = num(row.delivery_fee);
    base.serviceChargeTotal = num(row.service_charge);
    base.cardFeeTotal = num(row.card_processing_fee);
  }
  return base;
};

const isMissingColumn = (error: { code?: string; message?: string } | null) =>
  error?.code === '42703' || error?.code === 'PGRST204';

export async function getOrders(limit?: number): Promise<Order[]> {
  const run = async (columns: string) => {
    let query = client().from('orders').select(columns).neq('status', 'Draft').order('created_at', { ascending: false });
    if (limit) query = query.limit(limit);
    return query;
  };

  let result = await run(EXTENDED);
  let extended = true;
  if (result.error && isMissingColumn(result.error)) {
    result = await run(BASE);
    extended = false;
  }
  if (result.error) throw result.error;

  const rows = (result.data ?? []) as unknown as Row[];
  const ids = rows.map((r) => text(r.id)).filter(Boolean);
  if (!ids.length) return [];

  const { data: itemRows, error: itemError } = await client()
    .from('order_items')
    .select('id,order_id,product_name,unit_price,quantity,modifiers,special_instructions')
    .in('order_id', ids)
    .order('created_at');
  if (itemError) throw itemError;

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const row of (itemRows ?? []) as unknown as Row[]) {
    const orderId = text(row.order_id);
    itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) ?? []), orderItem(row)]);
  }
  return rows.map((row) => ({ ...mapOrder(row, extended), items: itemsByOrder.get(text(row.id)) ?? [] }));
}

export async function getMyOrders(email: string): Promise<Order[]> {
  if (!email) return [];
  const all = await getOrders(50);
  return all.filter((o) => o.email.toLowerCase() === email.toLowerCase());
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  if (!uuid.test(orderId)) throw new Error('Invalid order ID.');
  const { error } = await client().from('orders').update({ status }).eq('id', orderId).select('id').single();
  if (error) throw new Error(`Unable to update order status: ${error.message}`);
}
