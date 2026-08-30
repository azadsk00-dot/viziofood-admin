// Row mappers — snake_case Postgres rows → domain Order objects.
// Numerics arrive as strings; every field is coerced defensively. Scheduled
// sentences embedded in the notes are lifted out here (see orders/scheduled).

import type {
  Fulfilment,
  Order,
  OrderItem,
  OrderItemRow,
  PaymentStatus,
} from '../types';
import {
  authoritativeScheduledText,
  findScheduledSentences,
  parseScheduledTime,
  stripScheduledSentences,
} from '../orders/scheduled';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullableText = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const number = (value: unknown): number => Number(value ?? 0);

function orderStatus(value: unknown): Order['status'] {
  const status = text(value);
  return (
    ['Draft', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Rejected'].includes(
      status,
    )
      ? status
      : 'New'
  ) as Order['status'];
}

function paymentStatus(value: unknown): PaymentStatus {
  const status = text(value).toLowerCase();
  return status === 'paid' ||
    status === 'pending' ||
    status === 'failed' ||
    status === 'refunded' ||
    status === 'partially_refunded'
    ? status
    : 'unknown';
}

function fulfilment(value: unknown): Fulfilment {
  const method = text(value).toLowerCase();
  if (method === 'delivery') return 'Delivery';
  if (method === 'dine-in' || method === 'dinein' || method === 'dine_in') return 'Dine-in';
  return 'Pickup';
}

function modifiers(value: unknown): OrderItem['modifiers'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === 'object' && item !== null && 'name' in item
        ? { name: text((item as { name: unknown }).name), price: number((item as { price?: unknown }).price) }
        : { name: text(item), price: 0 },
    )
    .filter((m) => m.name.length > 0);
}

export function itemRowToItem(row: OrderItemRow | Record<string, unknown>): OrderItem {
  return {
    id: text(row.id),
    orderId: text((row as OrderItemRow).order_id),
    name: text((row as OrderItemRow).product_name),
    quantity: number(row.quantity) || 1,
    unitPrice: number((row as OrderItemRow).unit_price),
    modifiers: modifiers((row as OrderItemRow).modifiers),
    notes: text((row as OrderItemRow).special_instructions),
  };
}

/** Realtime payloads may carry partial rows — only the id is guaranteed. */
export function rowToOrder(row: Record<string, unknown>): Order {
  const notes = text(row.special_instructions);
  const sentences = findScheduledSentences(notes);
  const scheduledText = authoritativeScheduledText(sentences);
  return {
    id: text(row.id),
    orderNumber: text(row.order_number) || text(row.id),
    status: orderStatus(row.status),
    paymentStatus: paymentStatus(row.payment_status),
    fulfilment: fulfilment(row.fulfilment_method),
    customerName: text(row.customer_name) || 'Customer',
    customerPhone: text(row.customer_phone),
    customerEmail: text(row.customer_email),
    address: text(row.delivery_address),
    suburb: text(row.delivery_suburb),
    postcode: text(row.delivery_postcode),
    deliveryInstructions: text(row.delivery_instructions),
    specialInstructions: sentences.length ? stripScheduledSentences(notes) : notes,
    scheduledText,
    scheduledAt: scheduledText ? parseScheduledTime(scheduledText) : null,
    total: number(row.total),
    taxTotal: number(row.tax_total),
    itemsCount: number(row.items_count),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at) || text(row.created_at),
    cancelledAt: nullableText(row.cancelled_at),
    cancellationReason: text(row.cancellation_reason),
    refundStatus: text(row.refund_status),
    items: [],
  };
}

/** Merge a realtime/reconciled order into the store shape, keeping fetched items. */
export function withItems(order: Order, items: OrderItem[]): Order {
  return { ...order, items };
}
