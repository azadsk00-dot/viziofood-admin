// Report aggregation — pure, unit-tested. Mirrors web src/services/reports.ts
// with the day-bucketing bug FIXED: the web derives bucket keys from UTC
// (toISOString) while orders are keyed locally, so in UTC+ timezones today's
// orders never matched a bucket and were dropped from charts. Here every day
// key uses LOCAL date parts consistently.

import type { AdminOrder } from './adminTypes';
import { toCents } from './money';

export interface ReportWindow {
  from: number; // epoch ms, inclusive
  to: number; // epoch ms, exclusive
  days: number;
}

export type RangePreset = 'today' | 'yesterday' | 'week7' | 'month30' | 'month' | 'custom';

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week7: '7 days',
  month30: '30 days',
  month: 'This month',
  custom: 'Custom',
};

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** All windows are LOCAL-midnight aligned (fixes the web's 24h-slice reuse). */
export function windowFor(preset: RangePreset, now = Date.now(), custom?: { from: string; to: string }): ReportWindow {
  const today = startOfDay(now);
  switch (preset) {
    case 'today':
      return { from: today, to: now + 1, days: 1 };
    case 'yesterday':
      return { from: today - 86_400_000, to: today, days: 1 };
    case 'week7':
      return { from: today - 6 * 86_400_000, to: now + 1, days: 7 };
    case 'month30':
      return { from: today - 29 * 86_400_000, to: now + 1, days: 30 };
    case 'month': {
      const d = new Date(now);
      const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      return { from: first, to: now + 1, days: Math.max(1, Math.ceil((now - first) / 86_400_000)) };
    }
    case 'custom': {
      const from = custom?.from ? startOfDay(Date.parse(custom.from)) : today - 6 * 86_400_000;
      const toExclusive = custom?.to ? startOfDay(Date.parse(custom.to)) + 86_400_000 : now + 1;
      return { from, to: toExclusive, days: Math.max(1, Math.round((toExclusive - from) / 86_400_000)) };
    }
  }
}

/** LOCAL day key — single source of truth for both orders and buckets. */
export function dayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function isCountedOrder(order: AdminOrder): boolean {
  if (order.status === 'Cancelled' || order.status === 'Rejected') return false;
  return order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded' || order.paymentStatus === 'refunded';
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD (local)
  revenueCents: number;
  orders: number;
}

export interface TopProduct {
  name: string;
  quantity: number;
  revenueCents: number;
}

export interface Report {
  scoped: AdminOrder[];
  netRevenueCents: number;
  grossRevenueCents: number;
  refundedCents: number;
  paidOrders: number;
  cancelledOrders: number;
  averageOrderCents: number;
  discountCents: number;
  taxCents: number;
  serviceChargeCents: number;
  cardFeeCents: number;
  deliveryFeeCents: number;
  pickupOrders: number;
  deliveryOrders: number;
  daily: DailyPoint[];
  topProducts: TopProduct[];
}

export function buildReport(allOrders: AdminOrder[], window: ReportWindow, now = Date.now()): Report {
  const scoped = allOrders.filter((order) => {
    const t = Date.parse(order.createdAt);
    return !Number.isNaN(t) && t >= window.from && t < window.to;
  });
  const counted = scoped.filter(isCountedOrder);

  let netRevenueCents = 0;
  let grossRevenueCents = 0;
  let refundedCents = 0;
  let discountCents = 0;
  let taxCents = 0;
  let serviceChargeCents = 0;
  let cardFeeCents = 0;
  let deliveryFeeCents = 0;
  let pickupOrders = 0;
  let deliveryOrders = 0;

  const productMap = new Map<string, TopProduct>();

  for (const order of counted) {
    const totalCents = toCents(order.total);
    const refundCents = Math.max(0, toCents(order.refundAmount));
    grossRevenueCents += totalCents;
    refundedCents += refundCents;
    netRevenueCents += Math.max(0, totalCents - refundCents);
    discountCents += toCents(order.discountTotal);
    taxCents += toCents(order.taxTotal);
    serviceChargeCents += toCents(order.serviceCharge);
    cardFeeCents += toCents(order.cardProcessingFee);
    deliveryFeeCents += toCents(order.deliveryFee);
    if (order.fulfilment === 'Delivery') deliveryOrders += 1;
    else pickupOrders += 1;
    for (const item of order.items ?? []) {
      const entry = productMap.get(item.name) ?? { name: item.name, quantity: 0, revenueCents: 0 };
      entry.quantity += item.quantity;
      entry.revenueCents += toCents(item.unitPrice) * item.quantity;
      productMap.set(item.name, entry);
    }
  }

  // Daily series zero-filled across the window, LOCAL keys for both sides.
  const daily: DailyPoint[] = [];
  const byDay = new Map<string, DailyPoint>();
  for (let i = 0; i < window.days; i += 1) {
    const point: DailyPoint = { date: dayKey(window.from + i * 86_400_000), revenueCents: 0, orders: 0 };
    daily.push(point);
    byDay.set(point.date, point);
  }
  for (const order of counted) {
    const entry = byDay.get(dayKey(Date.parse(order.createdAt)));
    if (!entry) continue;
    const totalCents = toCents(order.total);
    const refundCents = Math.max(0, toCents(order.refundAmount));
    entry.revenueCents += Math.max(0, totalCents - refundCents);
    entry.orders += 1;
  }

  return {
    scoped,
    netRevenueCents,
    grossRevenueCents,
    refundedCents,
    paidOrders: counted.length,
    cancelledOrders: scoped.filter((o) => o.status === 'Cancelled' || o.status === 'Rejected').length,
    averageOrderCents: counted.length ? Math.round(netRevenueCents / counted.length) : 0,
    discountCents,
    taxCents,
    serviceChargeCents,
    cardFeeCents,
    deliveryFeeCents,
    pickupOrders,
    deliveryOrders,
    daily,
    topProducts: [...productMap.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 10),
  };
}
