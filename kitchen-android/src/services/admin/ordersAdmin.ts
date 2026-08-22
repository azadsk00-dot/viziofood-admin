// Orders admin service — extended order model with legacy column fallback
// (mirrors web src/services/orders.ts), server-side pagination, status
// history, cancel with audit, and refunds through the process-refund Edge
// Function (includes the acknowledgement flag the server contract requires).

import { supabase } from '../../lib/supabase';
import { config } from '../../lib/config';
import type { AdminOrder, AdminOrderItemLine } from '../../lib/adminTypes';

const EXTENDED =
  'id,order_number,customer_name,customer_email,customer_phone,payment_status,total,status,created_at,items_count,special_instructions,tax_total,stripe_session_id,payment_intent_id,refund_status,refund_id,refund_amount,refunded_at,refund_reason,cancelled_at,cancellation_reason,fulfilment_method,delivery_address,delivery_suburb,delivery_postcode,delivery_instructions,subtotal,discount_total,coupon_code,delivery_fee,service_charge,card_processing_fee';
const BASE =
  'id,order_number,customer_name,customer_email,customer_phone,payment_status,total,status,created_at,items_count,special_instructions,tax_total,stripe_session_id,payment_intent_id,refund_status,refund_id,refund_amount,refunded_at,refund_reason,cancelled_at,cancellation_reason,fulfilment_method,subtotal';

export interface OrdersPage {
  orders: AdminOrder[];
  nextFrom: number | null; // range start for the next page, null = done
  usedExtendedColumns: boolean;
}

function mapOrder(row: Record<string, unknown>): AdminOrder {
  const fulfilment = String(row.fulfilment_method ?? 'Pickup').toLowerCase() === 'delivery' ? 'Delivery' : 'Pickup';
  const hasExtended = row.delivery_address !== undefined;
  const subtotal = Number(row.subtotal ?? 0);
  const tax = Number(row.tax_total ?? 0);
  return {
    id: row.id as string,
    orderNumber: (row.order_number as string) ?? '',
    customerName: (row.customer_name as string) ?? '',
    customerEmail: (row.customer_email as string) ?? '',
    customerPhone: (row.customer_phone as string) ?? '',
    paymentStatus: (row.payment_status as AdminOrder['paymentStatus']) ?? 'unknown',
    total: Number(row.total ?? 0),
    status: (row.status as AdminOrder['status']) ?? 'New',
    createdAt: (row.created_at as string) ?? '',
    itemsCount: Number(row.items_count ?? 0),
    specialInstructions: (row.special_instructions as string) ?? '',
    taxTotal: tax,
    stripeSessionId: (row.stripe_session_id as string) ?? '',
    paymentIntentId: ((row.payment_intent_id as string) || (row.stripe_payment_intent as string) || '') as string,
    refundStatus: (row.refund_status as string) ?? '',
    refundId: (row.refund_id as string) ?? '',
    refundAmount: Number(row.refund_amount ?? 0),
    refundedAt: (row.refunded_at as string | null) ?? null,
    refundReason: (row.refund_reason as string) ?? '',
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    cancellationReason: (row.cancellation_reason as string) ?? '',
    fulfilment,
    address: hasExtended ? ((row.delivery_address as string) ?? '') : '',
    suburb: hasExtended ? ((row.delivery_suburb as string) ?? '') : '',
    postcode: hasExtended ? ((row.delivery_postcode as string) ?? '') : '',
    deliveryInstructions: hasExtended ? ((row.delivery_instructions as string) ?? '') : '',
    subtotal: subtotal || Math.max(0, Number(row.total ?? 0) - tax),
    discountTotal: hasExtended ? Number(row.discount_total ?? 0) : 0,
    couponCode: hasExtended ? ((row.coupon_code as string) ?? '') : '',
    deliveryFee: hasExtended ? Number(row.delivery_fee ?? 0) : 0,
    serviceCharge: hasExtended ? Number(row.service_charge ?? 0) : 0,
    cardProcessingFee: hasExtended ? Number(row.card_processing_fee ?? 0) : 0,
    items: [],
  };
}

export async function fetchOrdersPage(from: number, count: number, search?: string): Promise<OrdersPage> {
  const buildQuery = (columns: string) => {
    let query = supabase.from('orders').select(columns).neq('status', 'Draft').order('created_at', { ascending: false });
    if (search && search.trim()) {
      const q = search.trim();
      query = query.or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%,customer_email.ilike.%${q}%`);
    }
    return query.range(from, from + count - 1);
  };
  const first = await buildQuery(EXTENDED);
  if (first.error && /delivery_address|coupon_code|42703|PGRST204/i.test(first.error.message)) {
    const fallback = await buildQuery(BASE);
    if (fallback.error) throw new Error(fallback.error.message);
    const orders = ((fallback.data ?? []) as unknown[]).map((row) => mapOrder(row as Record<string, unknown>));
    return { orders, nextFrom: orders.length === count ? from + count : null, usedExtendedColumns: false };
  }
  if (first.error) throw new Error(first.error.message);
  const orders = ((first.data ?? []) as unknown[]).map((row) => mapOrder(row as Record<string, unknown>));
  return { orders, nextFrom: orders.length === count ? from + count : null, usedExtendedColumns: true };
}

export async function attachOrderItems(orders: AdminOrder[]): Promise<void> {
  const ids = orders.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data, error } = await supabase
      .from('order_items')
      .select('id,order_id,product_name,unit_price,quantity,modifiers,special_instructions')
      .in('order_id', chunk)
      .order('created_at');
    if (error || !data) continue; // items enrich; absence is not fatal
    const byOrder = new Map<string, AdminOrderItemLine[]>();
    for (const raw of data as unknown as Array<Record<string, unknown>>) {
      const orderId = raw.order_id as string;
      const list = byOrder.get(orderId) ?? [];
      const mods = Array.isArray(raw.modifiers)
        ? (raw.modifiers as unknown[]).map((m) =>
            typeof m === 'object' && m !== null ? String((m as { name?: unknown }).name ?? '') : String(m),
          )
        : [];
      list.push({
        id: raw.id as string,
        name: (raw.product_name as string) ?? 'Item',
        quantity: Number(raw.quantity ?? 1),
        unitPrice: Number(raw.unit_price ?? 0),
        modifiers: mods.filter(Boolean),
        notes: (raw.special_instructions as string) ?? '',
      });
      byOrder.set(orderId, list);
    }
    for (const order of orders) {
      order.items = byOrder.get(order.id) ?? [];
    }
  }
}

export async function getOrderStatusHistory(orderId: string): Promise<
  Array<{ id: string; status: string; changedBy: string | null; createdAt: string }>
> {
  const { data, error } = await supabase
    .from('order_status_history')
    .select('id,status,changed_by,created_at')
    .eq('order_id', orderId)
    .order('created_at');
  if (error || !data) return []; // degrade if RLS/migration blocks the read
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    status: (r.status as string) ?? '',
    changedBy: (r.changed_by as string | null) ?? null,
    createdAt: (r.created_at as string) ?? '',
  }));
}

export async function updateOrderStatus(orderId: string, status: string): Promise<void> {
  const { error } = await supabase.from('orders').update({ status }).eq('id', orderId);
  if (error) throw new Error(error.message);
}

export async function cancelOrderWithAudit(order: AdminOrder, reason: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const previousStatus = order.status;
  const { error } = await supabase
    .from('orders')
    .update({
      status: 'Cancelled',
      cancelled_at: now,
      cancelled_by: userData.user?.id ?? null,
      cancellation_reason: reason.slice(0, 300),
    })
    .eq('id', order.id);
  if (error) throw new Error(error.message);
  try {
    await supabase.from('admin_audit_log').insert({
      user_id: userData.user?.id ?? null,
      action: 'order_cancelled',
      details: { order_id: order.id, previous_status: previousStatus },
      order_id: order.id,
      reason: reason.slice(0, 300),
    });
  } catch {
    // audit is best-effort (web parity)
  }
}

export interface RefundResult {
  ok: boolean;
  refundId?: string;
  refundAmount?: number;
  refundStatus?: string;
  error?: string;
}

/**
 * Full or partial Stripe refund via the process-refund Edge Function.
 * amount undefined = full refund. Requires live connectivity — refunds are
 * financial operations and are never queued offline.
 */
export async function processRefund(orderId: string, amount?: number, reason = 'Customer request'): Promise<RefundResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return { ok: false, error: 'Not signed in.' };
  try {
    const res = await fetch(`${config.functionsUrl}/process-refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ orderId, ...(amount !== undefined ? { amount } : {}), reason, acknowledgement: true }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok || !body.ok) return { ok: false, error: (body.error as string) ?? `Refund failed (${res.status}).` };
    return {
      ok: true,
      refundId: body.refund_id as string | undefined,
      refundAmount: body.refund_amount as number | undefined,
      refundStatus: body.refund_status as string | undefined,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Refund request failed (network).' };
  }
}

export function isPaidOrder(order: AdminOrder): boolean {
  return (
    order.paymentStatus === 'paid' ||
    (order.paymentStatus !== 'failed' && Boolean(order.paymentIntentId || order.stripeSessionId))
  );
}

export function refundableRemainingCents(order: AdminOrder): number {
  return Math.max(0, Math.round((order.total - order.refundAmount) * 100));
}
