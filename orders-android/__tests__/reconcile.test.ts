// Reconciliation merge/prune/recency logic.

import { describe, expect, it } from 'vitest';
import { isRecentOrder, mergeOrders, pruneOrders, findNewOrders } from '../src/orders/reconcile';
import type { Order } from '../src/types';

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id,
    orderNumber: 'VF-1',
    status: 'Completed',
    paymentStatus: 'paid',
    fulfilment: 'Pickup',
    customerName: 'C',
    customerPhone: '',
    customerEmail: '',
    address: '',
    suburb: '',
    postcode: '',
    deliveryInstructions: '',
    specialInstructions: '',
    scheduledText: null,
    scheduledAt: null,
    total: 0,
    taxTotal: 0,
    itemsCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAt: null,
    cancellationReason: '',
    refundStatus: '',
    items: [],
    ...overrides,
  };
}

describe('mergeOrders', () => {
  it('incoming wins, keyed by id — no duplicates possible', () => {
    const existing = { a: order('a', { status: 'New' }) };
    const merged = mergeOrders(existing, [order('a', { status: 'Preparing' }), order('b')]);
    expect(Object.keys(merged).sort()).toEqual(['a', 'b']);
    expect(merged.a?.status).toBe('Preparing');
  });

  it('never drops orders missing from a partial fetch', () => {
    const existing = { a: order('a'), b: order('b') };
    const merged = mergeOrders(existing, [order('a')]);
    expect(merged.b).toBeDefined();
  });
});

describe('findNewOrders', () => {
  it('returns orders not previously known', () => {
    const known = new Set(['a']);
    expect(findNewOrders(known, [order('a'), order('b')]).map((o) => o.id)).toEqual(['b']);
  });
});

describe('pruneOrders', () => {
  it('drops terminal orders older than keepHours', () => {
    const now = Date.now();
    const old = order('old', {
      status: 'Completed',
      updatedAt: new Date(now - 30 * 3600_000).toISOString(),
    });
    const fresh = order('fresh', { status: 'Completed' });
    const live = order('live', {
      status: 'New',
      updatedAt: new Date(now - 30 * 3600_000).toISOString(),
    });
    const kept = pruneOrders({ old, fresh, live }, 24, now);
    expect(Object.keys(kept).sort()).toEqual(['fresh', 'live']);
  });

  it('keeps future scheduled orders regardless of status', () => {
    const now = Date.now();
    const scheduled = order('s', {
      status: 'Completed',
      updatedAt: new Date(now - 48 * 3600_000).toISOString(),
      scheduledAt: now + 24 * 3600_000,
    });
    const kept = pruneOrders({ s: scheduled }, 24, now);
    expect(kept.s).toBeDefined();
  });
});

describe('isRecentOrder', () => {
  it('true inside the 2h reconciliation alert window', () => {
    const now = Date.now();
    expect(isRecentOrder({ createdAt: new Date(now - 90 * 60_000).toISOString() }, now)).toBe(true);
    expect(isRecentOrder({ createdAt: new Date(now - 3 * 3600_000).toISOString() }, now)).toBe(false);
    expect(isRecentOrder({ createdAt: 'garbage' }, now)).toBe(false);
  });
});
