// Order state machine mirror + board routing (two-column home).

import { describe, expect, it } from 'vitest';
import {
  advanceTarget,
  canTransition,
  fulfilmentLabel,
  isNewPaidOrder,
  paymentLabel,
} from '../src/orders/orderStatus';
import { boardColumns, scheduledGroups } from '../src/orders/board';
import type { Order } from '../src/types';

function order(overrides: Partial<Order>): Order {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    orderNumber: 'VF-1001',
    status: 'New',
    paymentStatus: 'paid',
    fulfilment: 'Pickup',
    customerName: 'John Smith',
    customerPhone: '',
    customerEmail: '',
    address: '',
    suburb: '',
    postcode: '',
    deliveryInstructions: '',
    specialInstructions: '',
    scheduledText: null,
    scheduledAt: null,
    total: 28.5,
    taxTotal: 2.5,
    itemsCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAt: null,
    cancellationReason: '',
    refundStatus: '',
    items: [],
    ...overrides,
  };
}

describe('canTransition (DB trigger mirror)', () => {
  it('follows the forward-only chain (New → Preparing skip used by auto-accept)', () => {
    expect(canTransition('New', 'Preparing')).toBe(true); // the auto-accept path
    expect(canTransition('New', 'Accepted')).toBe(true);
    expect(canTransition('Accepted', 'Preparing')).toBe(true);
    expect(canTransition('Preparing', 'Ready')).toBe(true);
    expect(canTransition('Ready', 'Completed')).toBe(true);
    expect(canTransition('New', 'Completed')).toBe(true); // skipping ahead is allowed
  });

  it('blocks backwards movement', () => {
    expect(canTransition('Preparing', 'New')).toBe(false);
    expect(canTransition('Completed', 'New')).toBe(false);
    expect(canTransition('Cancelled', 'Accepted')).toBe(false);
  });

  it('allows cancel from any active state and no-ops', () => {
    expect(canTransition('New', 'Cancelled')).toBe(true);
    expect(canTransition('Ready', 'Cancelled')).toBe(true);
    expect(canTransition('Preparing', 'Preparing')).toBe(true);
  });

  it('never advances Draft client-side (server/webhook owns that flip)', () => {
    expect(canTransition('Draft', 'New')).toBe(false);
  });

  it('advanceTarget walks the one-tap path', () => {
    expect(advanceTarget('New')).toBe('Accepted');
    expect(advanceTarget('Accepted')).toBe('Preparing');
    expect(advanceTarget('Preparing')).toBe('Ready');
    expect(advanceTarget('Ready')).toBe('Completed');
    expect(advanceTarget('Completed')).toBeNull();
  });
});

describe('isNewPaidOrder (the alert moment)', () => {
  it('requires paid AND New', () => {
    expect(isNewPaidOrder({ status: 'New', paymentStatus: 'paid' })).toBe(true);
    expect(isNewPaidOrder({ status: 'New', paymentStatus: 'pending' })).toBe(false);
    expect(isNewPaidOrder({ status: 'Draft', paymentStatus: 'paid' })).toBe(false);
    expect(isNewPaidOrder({ status: 'Preparing', paymentStatus: 'paid' })).toBe(false);
  });
});

describe('paymentLabel (kitchen-clear payment state)', () => {
  it('maps the existing payment_status values without inventing data', () => {
    expect(paymentLabel('paid')).toBe('PAID');
    expect(paymentLabel('pending')).toBe('NOT PAID');
    expect(paymentLabel('failed')).toBe('NOT PAID');
    expect(paymentLabel('refunded')).toBe('REFUNDED');
    expect(paymentLabel('partially_refunded')).toBe('PARTIALLY REFUNDED');
    expect(paymentLabel('unknown')).toBe('NOT PAID');
  });
});

describe('boardColumns (two-column home)', () => {
  it('PREPARING holds New (transient), Accepted, Preparing; READY holds Ready', () => {
    const columns = boardColumns([
      order({ status: 'New' }),
      order({ status: 'Accepted' }),
      order({ status: 'Preparing' }),
      order({ status: 'Ready' }),
      order({ status: 'Completed' }),
      order({ status: 'Cancelled' }),
      order({ status: 'Rejected' }),
    ]);
    expect(columns.PREPARING).toHaveLength(3);
    expect(columns.READY).toHaveLength(1);
  });

  it('sorts BOTH columns newest first (top card = latest order)', () => {
    const older = order({ status: 'Preparing', createdAt: new Date(Date.now() - 600_000).toISOString() });
    const newer = order({ status: 'Preparing', createdAt: new Date().toISOString() });
    const readyOlder = order({ status: 'Ready', createdAt: new Date(Date.now() - 600_000).toISOString() });
    const readyNewer = order({ status: 'Ready', createdAt: new Date().toISOString() });
    const columns = boardColumns([older, newer, readyOlder, readyNewer]);
    expect(columns.PREPARING[0]?.id).toBe(newer.id);
    expect(columns.READY[0]?.id).toBe(readyNewer.id);
  });

  it('keeps future-scheduled orders OFF the home board', () => {
    const columns = boardColumns([
      order({ status: 'Preparing', scheduledAt: Date.now() + 3 * 3600_000 }),
      order({ status: 'Ready', scheduledAt: Date.now() + 3 * 3600_000 }),
    ]);
    expect(columns.PREPARING).toHaveLength(0);
    expect(columns.READY).toHaveLength(0);
  });

  it('shows scheduled orders once inside the preparation window', () => {
    const columns = boardColumns([
      order({ status: 'Preparing', scheduledAt: Date.now() + 10 * 60_000 }),
    ]);
    expect(columns.PREPARING).toHaveLength(1);
  });
});

describe('scheduledGroups', () => {
  it('splits upcoming vs ready to process, chronological', () => {
    const soon = order({ status: 'New', scheduledAt: Date.now() + 10 * 60_000 });
    const later = order({ status: 'New', scheduledAt: Date.now() + 3 * 3600_000 });
    const later2 = order({ status: 'New', scheduledAt: Date.now() + 2 * 3600_000 });
    const groups = scheduledGroups([later, later2, soon]);
    expect(groups.readyToProcess.map((o) => o.id)).toEqual([soon.id]);
    expect(groups.upcoming.map((o) => o.id)).toEqual([later2.id, later.id]);
  });

  it('excludes terminal and unscheduled orders', () => {
    const groups = scheduledGroups([
      order({ status: 'Completed', scheduledAt: Date.now() + 3600_000 }),
      order({ status: 'Cancelled', scheduledAt: Date.now() + 3600_000 }),
      order({ status: 'New', scheduledAt: null }),
    ]);
    expect(groups.upcoming).toHaveLength(0);
    expect(groups.readyToProcess).toHaveLength(0);
  });
});

describe('fulfilmentLabel', () => {
  it('labels the three methods', () => {
    expect(fulfilmentLabel('Pickup')).toBe('PICKUP');
    expect(fulfilmentLabel('Delivery')).toBe('DELIVERY');
    expect(fulfilmentLabel('Dine-in')).toBe('DINE-IN');
  });
});
