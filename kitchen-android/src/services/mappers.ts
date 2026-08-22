// Row mappers — snake_case database rows → camelCase domain objects.

import type {
  Fulfilment,
  KitchenOrder,
  OrderItem,
  OrderItemRow,
  OrderRow,
} from '../lib/types';

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function rowToOrder(row: OrderRow): KitchenOrder {
  return {
    id: str(row.id),
    orderNumber: str(row.order_number),
    status: str(row.status, 'New') as KitchenOrder['status'],
    paymentStatus: str(row.payment_status, 'unknown') as KitchenOrder['paymentStatus'],
    fulfilment: (str(row.fulfilment_method, 'Pickup').toLowerCase() === 'delivery'
      ? 'Delivery'
      : 'Pickup') as Fulfilment,
    customerName: str(row.customer_name),
    customerPhone: str(row.customer_phone),
    customerEmail: str(row.customer_email),
    address: str(row.delivery_address),
    suburb: str(row.delivery_suburb),
    postcode: str(row.delivery_postcode),
    deliveryInstructions: str(row.delivery_instructions),
    specialInstructions: str(row.special_instructions),
    total: num(row.total),
    itemsCount: num(row.items_count),
    couponCode: str(row.coupon_code),
    createdAt: str(row.created_at, new Date().toISOString()),
    updatedAt: str(row.updated_at, str(row.created_at)),
    acknowledgedAt: row.acknowledged_at ?? null,
    acknowledgedBy: row.acknowledged_by ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancellationReason: str(row.cancellation_reason),
    refundStatus: str(row.refund_status),
    items: [],
  };
}

export function itemRowToItem(row: OrderItemRow): OrderItem {
  const modifiers = Array.isArray(row.modifiers)
    ? row.modifiers.map((m) => {
        if (typeof m === 'object' && m !== null) {
          const mo = m as { name?: unknown; label?: unknown; price?: unknown };
          return { name: str(mo.name ?? mo.label), price: num(mo.price) };
        }
        return { name: String(m), price: 0 };
      })
    : [];
  return {
    id: str(row.id),
    orderId: str(row.order_id),
    productId: row.product_id ?? null,
    name: str(row.product_name, 'Item'),
    quantity: Math.max(1, num(row.quantity, 1)),
    unitPrice: num(row.unit_price),
    modifiers,
    notes: str(row.special_instructions),
  };
}
