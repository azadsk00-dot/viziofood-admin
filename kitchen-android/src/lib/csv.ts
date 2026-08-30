// CSV builders — pure, unit-tested. Output is shared via Android's Share
// sheet (Share.share) as text, matching the web's export column sets.

import type { AdminOrder } from './adminTypes';

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ordersToCsv(orders: AdminOrder[]): string {
  const header = 'Order,Customer,Phone,Email,Fulfilment,Payment,Status,Refund status,Refunded,Subtotal,Tax,Total,Placed';
  const lines = orders.map((o) =>
    [
      o.orderNumber,
      o.customerName,
      o.customerPhone,
      o.customerEmail,
      o.fulfilment,
      o.paymentStatus,
      o.status,
      o.refundStatus || '',
      o.refundAmount ? o.refundAmount.toFixed(2) : '',
      o.subtotal.toFixed(2),
      o.taxTotal.toFixed(2),
      o.total.toFixed(2),
      o.createdAt,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

export function reportCsv(orders: AdminOrder[]): string {
  const header =
    'Order,Date,Status,Payment,Fulfilment,Customer,Email,Phone,Items,Subtotal,Discount,Service,Tax,Delivery,Card fee,Total,Refunded,Coupon';
  const lines = orders.map((o) =>
    [
      o.orderNumber,
      o.createdAt,
      o.status,
      o.paymentStatus,
      o.fulfilment,
      o.customerName,
      o.customerEmail,
      o.customerPhone,
      o.itemsCount,
      o.subtotal.toFixed(2),
      o.discountTotal.toFixed(2),
      o.serviceCharge.toFixed(2),
      o.taxTotal.toFixed(2),
      o.deliveryFee.toFixed(2),
      o.cardProcessingFee.toFixed(2),
      o.total.toFixed(2),
      o.refundAmount.toFixed(2),
      o.couponCode,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

export function csvFileName(prefix: string, now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${prefix}-${y}-${m}-${d}.csv`;
}
