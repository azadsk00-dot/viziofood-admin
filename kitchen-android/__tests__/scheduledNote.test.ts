// Scheduled-pickup note normalisation tests — the real-world case: the order
// notes contain an auto-generated UTC-rendered sentence (3:15 AM) AND the
// correct local time (11:15 AM, Perth = UTC+8). The receipt must show ONE
// authoritative line (the last occurrence) and never repeat the sentence as
// an order note; genuine customer notes must survive.

import { describe, expect, it } from 'vitest';
import {
  authoritativeScheduledPickup,
  extractScheduledPickup,
  findScheduledSentences,
  stripScheduledSentences,
} from '../src/lib/scheduledNote';
import { renderKitchenTicket } from '../src/lib/starline';

const REAL_NOTES =
  'Scheduled pickup: Tue, 25 Aug, 3:15 AM Scheduled pickup: Tue, 25 Aug, 11:15 AM';

describe('findScheduledSentences', () => {
  it('finds both auto-generated sentences from the real receipt', () => {
    const found = findScheduledSentences(REAL_NOTES);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/3:15 AM/);
    expect(found[1]).toMatch(/11:15 AM/);
  });

  it('does not touch ordinary text', () => {
    expect(findScheduledSentences('Extra chilli on the side please')).toHaveLength(0);
    expect(findScheduledSentences(null)).toHaveLength(0);
  });
});

describe('authoritativeScheduledPickup', () => {
  it('the LAST occurrence wins (the correct local time followed the UTC one)', () => {
    expect(authoritativeScheduledPickup(findScheduledSentences(REAL_NOTES))).toBe('Tue, 25 Aug, 11:15 AM');
  });

  it('collapses identical duplicates and handles a single sentence', () => {
    expect(authoritativeScheduledPickup(['Scheduled pickup: Wed, 26 Aug, 1:00 PM', 'Scheduled pickup: Wed, 26 Aug, 1:00 PM'])).toBe('Wed, 26 Aug, 1:00 PM');
    expect(authoritativeScheduledPickup(['Scheduled pickup: Wed, 26 Aug, 1:00 PM'])).toBe('Wed, 26 Aug, 1:00 PM');
    expect(authoritativeScheduledPickup([])).toBeNull();
  });
});

describe('extractScheduledPickup', () => {
  it('lifts scheduled sentences out of notes and keeps the genuine note', () => {
    const { order } = extractScheduledPickup(
      { orderNumber: 'VF-1', status: 'New', paymentStatus: 'pending', fulfilment: 'Pickup', createdAt: new Date().toISOString(), notes: `${REAL_NOTES}\nLeave at the door` },
      [{ name: 'Pasta', quantity: 1, modifiers: [], notes: null }],
    );
    expect(order.scheduledPickup).toBe('Tue, 25 Aug, 11:15 AM');
    expect(order.notes).toBe('Leave at the door');
  });

  it('cleans item notes too and drops the note block when nothing genuine remains', () => {
    const { order, items } = extractScheduledPickup(
      { orderNumber: 'VF-1', status: 'New', paymentStatus: 'paid', fulfilment: 'Pickup', createdAt: new Date().toISOString(), notes: 'Scheduled pickup: Tue, 25 Aug, 3:15 AM' },
      [{ name: 'Pasta', quantity: 1, modifiers: [], notes: 'Scheduled pickup: Tue, 25 Aug, 11:15 AM' }],
    );
    expect(order.scheduledPickup).toBe('Tue, 25 Aug, 11:15 AM');
    expect(order.notes).toBeNull();
    expect(items[0].notes).toBeNull();
  });

  it('leaves payloads without scheduled sentences untouched', () => {
    const order = { orderNumber: 'VF-1', status: 'New', paymentStatus: 'paid', fulfilment: 'Pickup', createdAt: new Date().toISOString(), notes: 'Ring the bell' };
    const items = [{ name: 'Pasta', quantity: 1, modifiers: [], notes: 'no garlic' }];
    const result = extractScheduledPickup(order, items);
    expect(result.order.notes).toBe('Ring the bell');
    expect(result.order.scheduledPickup).toBeUndefined();
    expect(result.items[0].notes).toBe('no garlic');
  });
});

describe('receipt rendering with a real scheduled-pickup order', () => {
  const render = () => {
    const { order, items } = extractScheduledPickup(
      {
        orderNumber: 'VF-77CBD',
        status: 'New',
        paymentStatus: 'pending',
        fulfilment: 'Pickup',
        createdAt: '2026-08-25T03:15:00.000Z',
        total: 5.07,
        customerName: 'Jo Test',
        notes: `${REAL_NOTES} Leave at the door`,
      },
      [{ name: 'Margherita', quantity: 1, modifiers: ['Extra basil'], notes: null }],
    );
    return new TextDecoder().decode(renderKitchenTicket(order, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 }));
  };

  it('shows exactly ONE scheduled pickup line with the correct 11:15 AM value', () => {
    const text = render();
    expect(text.match(/SCHEDULED PICKUP:/g)).toHaveLength(1);
    expect(text).toContain('SCHEDULED PICKUP: Tue, 25 Aug, 11:15 AM');
    expect(text).not.toContain('3:15 AM');
  });

  it('keeps the genuine note, payment, order type and total; no phone', () => {
    const text = render();
    expect(text).toContain('ORDER NOTE: Leave at the door');
    expect(text).toContain('PAYMENT: UNPAID (CASH)');
    expect(text).toContain('ORDER TYPE: PICKUP');
    expect(text).toContain('TOTAL: $5.07');
    expect(text).not.toContain('0478');
  });
});
