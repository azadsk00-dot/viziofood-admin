// Reconciliation tests — the missed-order protection logic.

import { describe, expect, it } from 'vitest';
import {
  findNewOrders,
  isAlertWorthy,
  mergeOrders,
  nextCursor,
  orderChanged,
  pruneOrders,
} from '../src/lib/reconcile';
import type { KitchenOrder } from '../src/lib/types';

function order(overrides: Partial<KitchenOrder> = {}): KitchenOrder {
  return {
    id: 'o1',
    orderNumber: 'VF-1',
    status: 'New',
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
    total: 10,
    itemsCount: 1,
    couponCode: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    cancelledAt: null,
    cancellationReason: '',
    refundStatus: '',
    items: [],
    ...overrides,
  };
}

describe('mergeOrders', () => {
  it('incoming backend rows always win (DB is the source of truth)', () => {
    const merged = mergeOrders(
      { o1: order({ status: 'New' }) },
      [order({ id: 'o1', status: 'Accepted' })],
    );
    expect(merged.o1.status).toBe('Accepted');
  });

  it('a partial fetch never deletes known orders', () => {
    const merged = mergeOrders({ o1: order(), o2: order({ id: 'o2' }) }, [order({ id: 'o1', status: 'Preparing' })]);
    expect(Object.keys(merged).sort()).toEqual(['o1', 'o2']);
  });
});

describe('isAlertWorthy — duplicate + non-paid protection', () => {
  it('alerts only paid NEW unacknowledged orders', () => {
    expect(isAlertWorthy(order(), new Set())).toBe(true);
    expect(isAlertWorthy(order({ paymentStatus: 'pending' }), new Set())).toBe(false);
    expect(isAlertWorthy(order({ status: 'Accepted' }), new Set())).toBe(false);
    expect(isAlertWorthy(order({ acknowledgedAt: new Date().toISOString() }), new Set())).toBe(false);
  });

  it('never alerts twice for the same order id (webhook replay / reconnect)', () => {
    expect(isAlertWorthy(order(), new Set(['o1']))).toBe(false);
  });

  it('Discovers a Draft→New UPDATE as alert-worthy (the webhook path)', () => {
    // The webhook flips Draft→New as an UPDATE; reconciliation sees the row
    // only after the flip, so a plain New row must qualify.
    expect(isAlertWorthy(order({ status: 'New' }), new Set())).toBe(true);
  });
});

describe('findNewOrders — missed order detection', () => {
  it('finds orders that arrived while disconnected', () => {
    const known = new Set(['o1']);
    const incoming = [order({ id: 'o1' }), order({ id: 'o2', orderNumber: 'VF-2' })];
    const missed = findNewOrders(known, incoming);
    expect(missed.map((o) => o.id)).toEqual(['o2']);
  });
});

describe('pruneOrders', () => {
  it('keeps live orders and recent terminal orders, drops old terminal ones', () => {
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    const fresh = new Date(Date.now() - 3600_000).toISOString();
    const kept = pruneOrders(
      {
        live: order({ id: 'live', status: 'Preparing', updatedAt: old }),
        oldDone: order({ id: 'oldDone', status: 'Completed', updatedAt: old }),
        freshDone: order({ id: 'freshDone', status: 'Completed', updatedAt: fresh }),
      },
      24,
    );
    expect(Object.keys(kept).sort()).toEqual(['freshDone', 'live']);
  });
});

describe('nextCursor', () => {
  it('advances to the latest updated_at', () => {
    const t1 = new Date(Date.now() - 5000).toISOString();
    const t2 = new Date().toISOString();
    expect(nextCursor([order({ updatedAt: t1 })], null)).toBe(t1);
    expect(nextCursor([order({ updatedAt: t1 })], t2)).toBe(t2);
  });
});

describe('orderChanged', () => {
  it('detects meaningful differences', () => {
    const base = order();
    expect(orderChanged(undefined, base)).toBe(true);
    expect(orderChanged(base, base)).toBe(false);
    expect(orderChanged(base, order({ status: 'Accepted' }))).toBe(true);
  });
});
