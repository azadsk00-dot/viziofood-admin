// Admin APK logic tests — reports aggregation (incl. the day-bucket bug fix),
// coupon math, specials liveness, CSV escaping, role permissions.

import { describe, expect, it } from 'vitest';
import { buildReport, isCountedOrder, windowFor, dayKey } from '../src/lib/reports';
import { couponDiscountCents, isCouponUsable } from '../src/lib/couponLogic';
import { discountPercent, isSpecialLive, specialState, describeSchedule } from '../src/lib/specialsLogic';
import { csvFileName, ordersToCsv, reportCsv } from '../src/lib/csv';
import { canAccess, SECTION_ROLES } from '../src/lib/permissions';
import type { AdminOrder } from '../src/lib/adminTypes';
import type { AdminCoupon, AdminSpecial } from '../src/lib/adminTypes';

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: 'o1', orderNumber: 'VF-1', customerName: 'C', customerEmail: '', customerPhone: '',
    paymentStatus: 'paid', total: 50, status: 'Completed', createdAt: new Date().toISOString(),
    itemsCount: 1, specialInstructions: '', taxTotal: 4.55, stripeSessionId: '', paymentIntentId: 'pi_1',
    refundStatus: '', refundId: '', refundAmount: 0, refundedAt: null, refundReason: '',
    cancelledAt: null, cancellationReason: '', fulfilment: 'Pickup', address: '', suburb: '', postcode: '',
    deliveryInstructions: '', subtotal: 45.45, discountTotal: 0, couponCode: '', deliveryFee: 0,
    serviceCharge: 0, cardProcessingFee: 0,
    items: [{ id: 'i1', name: 'Pasta', quantity: 2, unitPrice: 20, modifiers: [], notes: '' }],
    ...overrides,
  };
}

describe('report windows (web 24h-slice bug fixed)', () => {
  it('aligns every window to local midnight', () => {
    const now = new Date(2026, 7, 22, 15, 30).getTime(); // Aug 22 2026 15:30 local
    const today = windowFor('today', now);
    expect(new Date(today.from).getHours()).toBe(0);
    expect(today.days).toBe(1);

    const week = windowFor('week7', now);
    expect(week.days).toBe(7);
    expect(new Date(week.from).getHours()).toBe(0);

    const month = windowFor('month', now);
    expect(new Date(month.from).getDate()).toBe(1);
    expect(week.from).toBeLessThan(today.from);
  });

  it('yesterday is a full closed day', () => {
    const now = new Date(2026, 7, 22, 10).getTime();
    const yesterday = windowFor('yesterday', now);
    expect(yesterday.to).toBe(windowFor('today', now).from);
  });
});

describe('buildReport aggregation', () => {
  it('counts only paid non-cancelled orders and nets refunds', () => {
    const report = buildReport(
      [
        order(),
        order({ id: 'o2', paymentStatus: 'pending' }),
        order({ id: 'o3', status: 'Cancelled' }),
        order({ id: 'o4', refundAmount: 20 }),
      ],
      windowFor('today'),
    );
    expect(report.paidOrders).toBe(2); // o1 + o4 (partially refunded still counted)
    expect(report.netRevenueCents).toBe(Math.round(50 * 100) + Math.round((50 - 20) * 100));
    expect(report.cancelledOrders).toBe(1);
    expect(report.averageOrderCents).toBe(Math.round((5000 + 3000) / 2));
  });

  it('buckets every counted order into the daily series (local keys, both sides)', () => {
    const now = Date.now();
    const fresh = order({ createdAt: new Date(now - 60_000).toISOString() });
    const report = buildReport([fresh], windowFor('today', now), now);
    const todayBucket = report.daily[report.daily.length - 1];
    expect(todayBucket.orders).toBe(1); // regression: web dropped today due to UTC keys
    expect(todayBucket.revenueCents).toBe(5000);
  });

  it('aggregates top products by revenue', () => {
    const report = buildReport([order()], windowFor('today'));
    expect(report.topProducts[0]).toMatchObject({ name: 'Pasta', quantity: 2, revenueCents: 4000 });
  });
});

describe('isCountedOrder', () => {
  it('excludes cancelled/rejected and unpaid', () => {
    expect(isCountedOrder(order())).toBe(true);
    expect(isCountedOrder(order({ status: 'Cancelled' }))).toBe(false);
    expect(isCountedOrder(order({ status: 'Rejected' }))).toBe(false);
    expect(isCountedOrder(order({ paymentStatus: 'pending' }))).toBe(false);
    expect(isCountedOrder(order({ paymentStatus: 'refunded' }))).toBe(true);
  });
});

function coupon(overrides: Partial<AdminCoupon> = {}): AdminCoupon {
  return {
    id: 'c1', code: 'SAVE10', kind: 'percent', value: 10, minimumOrder: 0, productIds: [],
    categoryNames: [], startsAt: null, endsAt: null, usageLimit: null, timesUsed: 0, active: true,
    ...overrides,
  };
}

describe('coupon logic (mirrors web money.ts)', () => {
  it('computes percent and fixed discounts capped at subtotal', () => {
    const lines = [{ productId: null, category: 'Mains', amountCents: 5000 }];
    expect(couponDiscountCents(coupon({ kind: 'percent', value: 10 }), lines, 5000)).toBe(500);
    expect(couponDiscountCents(coupon({ kind: 'fixed', value: 60 }), lines, 5000)).toBe(5000); // capped
    expect(couponDiscountCents(coupon({ kind: 'fixed', value: 7 }), lines, 5000)).toBe(700);
  });

  it('respects windows, usage limits, minimums and category scoping', () => {
    const lines = [{ productId: null, category: 'Drinks', amountCents: 2000 }];
    const now = Date.now();
    expect(isCouponUsable(coupon({ active: false }), 5000, now)).toBe(false);
    expect(isCouponUsable(coupon({ startsAt: new Date(now + 3600_000).toISOString() }), 5000, now)).toBe(false);
    expect(isCouponUsable(coupon({ usageLimit: 5, timesUsed: 5 }), 5000, now)).toBe(false);
    expect(isCouponUsable(coupon({ minimumOrder: 50 }), 4999, now)).toBe(false);
    // Whole-order coupon does not apply when only Drinks lines are scoped out.
    expect(couponDiscountCents(coupon({ categoryNames: ['Mains'] }), lines, 2000, now)).toBe(0);
    expect(couponDiscountCents(coupon({ categoryNames: ['drinks'] }), lines, 2000, now)).toBe(200);
  });
});

function special(overrides: Partial<AdminSpecial> = {}): AdminSpecial {
  return {
    id: 's1', title: 'Lunch special', description: '', imageUrl: null, price: 12, originalPrice: 18,
    active: true, archived: false, startDate: null, endDate: null, startTime: null, endTime: null,
    daysOfWeek: [], ctaText: 'Order now', ctaLink: '/menu', category: '', dietary: [], ingredients: [],
    allergens: [], badge: 'Special', priority: 100, displayLocation: 'both', productId: null,
    stockQuantity: null, createdAt: '', updatedAt: '',
    ...overrides,
  };
}

describe('specials liveness (independent entity)', () => {
  it('is live when active with no restrictions', () => {
    expect(isSpecialLive(special())).toBe(true);
    expect(specialState(special())).toBe('live');
  });

  it('respects date windows with an inclusive final day', () => {
    const now = new Date(2026, 7, 22, 12).getTime();
    expect(isSpecialLive(special({ startDate: '2026-08-20', endDate: '2026-08-22' }), now)).toBe(true);
    expect(isSpecialLive(special({ startDate: '2026-08-23' }), now)).toBe(false);
    expect(isSpecialLive(special({ endDate: '2026-08-21' }), now)).toBe(false);
  });

  it('respects time windows and days of week', () => {
    const wednoon = new Date(2026, 7, 19, 12).getTime(); // Wednesday Aug 19 2026
    expect(isSpecialLive(special({ startTime: '11:00', endTime: '14:00' }), wednoon)).toBe(true);
    expect(isSpecialLive(special({ startTime: '13:00', endTime: '14:00' }), wednoon)).toBe(false);
    expect(isSpecialLive(special({ daysOfWeek: [3] }), wednoon)).toBe(true); // 3 = Wed
    expect(isSpecialLive(special({ daysOfWeek: [5] }), wednoon)).toBe(false);
  });

  it('kills on stock exhaustion and archive', () => {
    expect(specialState(special({ stockQuantity: 0 }))).toBe('scheduled');
    expect(specialState(special({ archived: true }))).toBe('archived');
    expect(specialState(special({ active: false }))).toBe('off');
  });

  it('derives discount percent and schedule text', () => {
    expect(discountPercent(special())).toBe(33);
    expect(discountPercent(special({ originalPrice: 5 }))).toBeNull();
    expect(describeSchedule(special({ startTime: '11:00', endTime: '14:00', daysOfWeek: [3, 5] }))).toContain('11:00–14:00');
    expect(describeSchedule(special())).toBe('Always available');
  });
});

describe('CSV builders', () => {
  it('escapes quotes and commas', () => {
    const csv = ordersToCsv([order({ customerName: 'Doe, John "JD"' })]);
    expect(csv.split('\n')[1]).toContain('"Doe, John ""JD"""');
  });

  it('matches the report header contract', () => {
    expect(reportCsv([]).split(',')[0]).toBe('Order');
    expect(reportCsv([])).toContain('Card fee');
    expect(csvFileName('vizio-report')).toMatch(/^vizio-report-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('role permissions (UI gating only — RLS is the authority)', () => {
  it('kitchen sees kitchen/print/health/settings but not management', () => {
    expect(canAccess('kitchen', 'kitchen')).toBe(true);
    expect(canAccess('printQueue', 'kitchen')).toBe(true);
    expect(canAccess('health', 'kitchen')).toBe(true);
    expect(canAccess('products', 'kitchen')).toBe(false);
    expect(canAccess('reports', 'kitchen')).toBe(false);
    expect(canAccess('users', 'kitchen')).toBe(false);
  });

  it('staff sees operations; users is admin-only', () => {
    expect(canAccess('orders', 'staff')).toBe(true);
    expect(canAccess('coupons', 'staff')).toBe(true);
    expect(canAccess('users', 'staff')).toBe(false);
    expect(canAccess('users', 'admin')).toBe(true);
    expect(canAccess('dashboard', 'customer')).toBe(false);
  });

  it('every section grants admin', () => {
    for (const section of Object.keys(SECTION_ROLES)) {
      expect(canAccess(section as never, 'admin')).toBe(true);
    }
  });
});
