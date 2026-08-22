// State-machine + escalation + filter tests (pure logic, mirrors the DB
// trigger in migrations/20260826120002_order_state_machine.sql).

import { describe, expect, it } from 'vitest';
import {
  advanceTarget,
  canTransition,
  escalationLevel,
  filterOrders,
  isTerminal,
  sortOrders,
} from '../src/lib/orderLogic';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import type { KitchenOrder, OrderStatus } from '../src/lib/types';

function order(overrides: Partial<KitchenOrder> = {}): KitchenOrder {
  return {
    id: 'o1',
    orderNumber: 'VF-TEST0001',
    status: 'New',
    paymentStatus: 'paid',
    fulfilment: 'Pickup',
    customerName: 'Test Customer',
    customerPhone: '',
    customerEmail: '',
    address: '',
    suburb: '',
    postcode: '',
    deliveryInstructions: '',
    specialInstructions: '',
    total: 25,
    itemsCount: 2,
    couponCode: '',
    createdAt: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
    updatedAt: new Date().toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    cancelledAt: null,
    cancellationReason: '',
    refundStatus: '',
    items: [
      { id: 'i1', orderId: 'o1', productId: null, name: 'Chicken Alfredo', quantity: 1, unitPrice: 18, modifiers: [{ name: 'Extra Chicken', price: 3 }], notes: 'No onions' },
      { id: 'i2', orderId: 'o1', productId: null, name: 'Garlic Bread', quantity: 1, unitPrice: 7, modifiers: [], notes: '' },
    ],
    ...overrides,
  };
}

const settings = DEFAULT_SETTINGS; // warn 3 / urgent 5 / manager 10 / overdue 15

describe('order state machine (mirrors DB trigger)', () => {
  it('moves forward through the kitchen chain', () => {
    const chain: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Completed'];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(canTransition(chain[i], chain[i + 1])).toBe(true);
      expect(advanceTarget(chain[i])).toBe(chain[i + 1]);
    }
  });

  it('allows skipping ahead (like the DB rank comparison)', () => {
    expect(canTransition('New', 'Ready')).toBe(true);
    expect(canTransition('Accepted', 'Completed')).toBe(true);
  });

  it('rejects moving backwards', () => {
    expect(canTransition('Preparing', 'Accepted')).toBe(false);
    expect(canTransition('Ready', 'New')).toBe(false);
  });

  it('locks terminal states and allows cancel from active states', () => {
    expect(isTerminal('Completed')).toBe(true);
    expect(isTerminal('Cancelled')).toBe(true);
    expect(canTransition('Completed', 'New')).toBe(false);
    expect(canTransition('Cancelled', 'New')).toBe(false);
    expect(canTransition('Preparing', 'Cancelled')).toBe(true);
  });

  it('allows no-op updates (trigger skips identical status)', () => {
    expect(canTransition('Preparing', 'Preparing')).toBe(true);
  });
});

describe('escalation levels', () => {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

  it('escalates NEW orders through warning → urgent → manager', () => {
    expect(escalationLevel(order({ createdAt: at(1) }), settings)).toBe('none');
    expect(escalationLevel(order({ createdAt: at(4) }), settings)).toBe('warning');
    expect(escalationLevel(order({ createdAt: at(6) }), settings)).toBe('urgent');
    expect(escalationLevel(order({ createdAt: at(11) }), settings)).toBe('manager');
  });

  it('marks Accepted/Preparing as overdue past the overdue threshold', () => {
    expect(escalationLevel(order({ status: 'Preparing', createdAt: at(10) }), settings)).toBe('none');
    expect(escalationLevel(order({ status: 'Preparing', createdAt: at(16) }), settings)).toBe('overdue');
    expect(escalationLevel(order({ status: 'Accepted', createdAt: at(30) }), settings)).toBe('overdue');
  });

  it('does not escalate completed orders', () => {
    expect(escalationLevel(order({ status: 'Completed', createdAt: at(60) }), settings)).toBe('none');
  });
});

describe('filters and search', () => {
  const orders = [
    order({ id: 'a', status: 'New', fulfilment: 'Delivery', customerName: 'Ana' }),
    order({ id: 'b', status: 'Preparing', createdAt: new Date(Date.now() - 20 * 60_000).toISOString() }),
    order({ id: 'c', status: 'Completed' }),
    order({ id: 'd', status: 'New', acknowledgedAt: new Date().toISOString() }),
  ];

  it('filters by status', () => {
    expect(filterOrders(orders, 'new', '', settings).map((o) => o.id)).toEqual(['a', 'd']);
    expect(filterOrders(orders, 'preparing', '', settings).map((o) => o.id)).toEqual(['b']);
    expect(filterOrders(orders, 'live', '', settings).map((o) => o.id)).toEqual(['a', 'b', 'd']);
  });

  it('filters by fulfilment', () => {
    expect(filterOrders(orders, 'delivery', '', settings).map((o) => o.id)).toEqual(['a']);
  });

  it('filters unacknowledged NEW orders', () => {
    expect(filterOrders(orders, 'unacknowledged', '', settings).map((o) => o.id)).toEqual(['a']);
  });

  it('includes overdue/urgent orders', () => {
    expect(filterOrders(orders, 'overdue', '', settings).map((o) => o.id)).toEqual(['b']);
  });

  it('searches order number, customer and item names', () => {
    expect(filterOrders(orders, 'live', 'ana', settings).map((o) => o.id)).toEqual(['a']);
    expect(filterOrders(orders, 'live', 'TEST0001', settings).map((o) => o.id)).toEqual(['a', 'b', 'd']);
    expect(filterOrders(orders, 'live', 'garlic', settings).map((o) => o.id)).toEqual(['a', 'b', 'd']);
    expect(filterOrders(orders, 'live', 'no match', settings)).toHaveLength(0);
  });

  it('sorts oldest-first by default, newest-first when configured', () => {
    // b is 20 min old; a, c, d are ~1 min old in creation order.
    const list = sortOrders(orders, true);
    expect(list[0].id).toBe('b');
    const flipped = sortOrders(orders, false);
    expect(flipped[0].id).toBe('d');
  });
});
