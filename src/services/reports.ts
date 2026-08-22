/**
 * Reports service — REAL aggregation over the orders table (staff-only via
 * RLS). All figures derive from paid orders; refunds subtract from revenue.
 * Timezone: group by the browser's local date (the restaurant is in Perth;
 * staff machines are local). Currency values are summed in integer cents.
 */

import type { Order } from '../types';

export interface DateRange {
  from: Date;
  to: Date;
}

export interface DailyRevenuePoint {
  date: string;
  revenueCents: number;
  orders: number;
}

export interface CategorySalesPoint {
  category: string;
  revenueCents: number;
  quantity: number;
}

export interface ReportSummary {
  grossRevenueCents: number;
  refundedCents: number;
  netRevenueCents: number;
  orders: number;
  paidOrders: number;
  cancelledOrders: number;
  averageOrderCents: number;
  pickupOrders: number;
  deliveryOrders: number;
  taxCollectedCents: number;
  serviceChargeCents: number;
  cardFeeCents: number;
  deliveryFeeCents: number;
  discountCents: number;
}

export interface ProductSalesPoint {
  name: string;
  quantity: number;
  revenueCents: number;
}

const toCents = (amount: number) => Math.round(amount * 100);

const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const isCountedOrder = (order: Order): boolean => {
  if (order.status === 'Cancelled' || order.status === 'Rejected') return false;
  return order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded' || order.paymentStatus === 'refunded';
};

const inRange = (order: Order, range: DateRange): boolean => {
  const created = new Date(order.createdAt).getTime();
  return created >= range.from.getTime() && created < range.to.getTime();
};

/** Net revenue of one order: total minus refunds actually issued. */
export const orderNetCents = (order: Order): number => {
  const totalCents = toCents(order.total);
  const refundCents = toCents(order.refundAmount);
  return Math.max(0, totalCents - refundCents);
};

export const buildReport = (orders: Order[], range: DateRange) => {
  const scoped = orders.filter((o) => inRange(o, range));
  const counted = scoped.filter(isCountedOrder);

  const summary: ReportSummary = {
    grossRevenueCents: counted.reduce((sum, o) => sum + toCents(o.total), 0),
    refundedCents: counted.reduce((sum, o) => sum + toCents(o.refundAmount), 0),
    netRevenueCents: counted.reduce((sum, o) => sum + orderNetCents(o), 0),
    orders: scoped.length,
    paidOrders: counted.length,
    cancelledOrders: scoped.filter((o) => o.status === 'Cancelled' || o.status === 'Rejected').length,
    averageOrderCents: counted.length
      ? Math.round(counted.reduce((sum, o) => sum + orderNetCents(o), 0) / counted.length)
      : 0,
    pickupOrders: counted.filter((o) => o.fulfilment === 'Pickup').length,
    deliveryOrders: counted.filter((o) => o.fulfilment === 'Delivery').length,
    taxCollectedCents: counted.reduce((sum, o) => sum + toCents(o.taxTotal), 0),
    serviceChargeCents: counted.reduce((sum, o) => sum + toCents(o.serviceChargeTotal), 0),
    cardFeeCents: counted.reduce((sum, o) => sum + toCents(o.cardFeeTotal), 0),
    deliveryFeeCents: counted.reduce((sum, o) => sum + toCents(o.deliveryFeeTotal), 0),
    discountCents: counted.reduce((sum, o) => sum + toCents(o.discountTotal), 0),
  };

  // Daily revenue series across the whole range (zero-filled).
  const byDay = new Map<string, { revenueCents: number; orders: number }>();
  for (let d = new Date(range.from); d < range.to; d.setDate(d.getDate() + 1)) {
    byDay.set(dayKey(d.toISOString()), { revenueCents: 0, orders: 0 });
  }
  for (const order of counted) {
    const key = dayKey(order.createdAt);
    const entry = byDay.get(key);
    if (!entry) continue;
    entry.revenueCents += orderNetCents(order);
    entry.orders += 1;
  }
  const daily: DailyRevenuePoint[] = Array.from(byDay.entries()).map(([date, v]) => ({ date, ...v }));

  // Product sales from line items.
  const byProduct = new Map<string, ProductSalesPoint>();
  const byCategory = new Map<string, CategorySalesPoint>();
  for (const order of counted) {
    for (const item of order.items) {
      const lineCents = toCents(item.unitPrice) * item.quantity;
      const product = byProduct.get(item.name) ?? { name: item.name, quantity: 0, revenueCents: 0 };
      product.quantity += item.quantity;
      product.revenueCents += lineCents;
      byProduct.set(item.name, product);
    }
  }
  const topProducts = Array.from(byProduct.values()).sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 10);

  return { summary, daily, topProducts, byCategory, scoped };
};

/** CSV export of the scoped orders (one row per order). */
export const ordersToCsv = (orders: Order[]): string => {
  const header = [
    'Order', 'Date', 'Status', 'Payment', 'Fulfilment', 'Customer', 'Email', 'Phone',
    'Items', 'Subtotal', 'Discount', 'Service', 'Tax', 'Delivery', 'Card fee', 'Total',
    'Refunded', 'Coupon',
  ];
  const esc = (value: string | number) => {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = orders.map((o) =>
    [
      o.orderNumber,
      new Date(o.createdAt).toISOString(),
      o.status,
      o.paymentStatus,
      o.fulfilment,
      o.customer,
      o.email,
      o.phone,
      o.itemsCount,
      o.subtotal.toFixed(2),
      o.discountTotal.toFixed(2),
      o.serviceChargeTotal.toFixed(2),
      o.taxTotal.toFixed(2),
      o.deliveryFeeTotal.toFixed(2),
      o.cardFeeTotal.toFixed(2),
      o.total.toFixed(2),
      o.refundAmount.toFixed(2),
      o.couponCode,
    ].map(esc).join(','),
  );
  return [header.join(','), ...lines].join('\n');
};

/** Trigger a browser download of CSV content. */
export const downloadCsv = (filename: string, csv: string): void => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
