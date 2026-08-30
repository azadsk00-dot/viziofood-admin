// Print engine logic tests — retry backoff and order→ticket mapping (the
// pure parts of the engine; claiming goes through Supabase RLS).

import { describe, expect, it } from 'vitest';
import { retryDelayMs, toTicketPayload } from '../src/lib/printLogic';

describe('retryDelayMs', () => {
  it('follows the 5s→60s exponential backoff policy', () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(10_000);
    expect(retryDelayMs(3)).toBe(20_000);
    expect(retryDelayMs(4)).toBe(40_000);
    expect(retryDelayMs(5)).toBe(60_000); // capped
    expect(retryDelayMs(9)).toBe(60_000);
  });
});

describe('toTicketPayload', () => {
  it('maps database rows to the ticket renderer input', () => {
    const { order, items } = toTicketPayload(
      {
        order_number: 'VF-99',
        status: 'New',
        fulfilment_method: 'Delivery',
        created_at: '2026-08-23T00:00:00.000Z',
        customer_name: 'Jo',
        customer_phone: '0400 000 000',
        delivery_address: '544 Hay Street',
        delivery_suburb: 'Perth',
        delivery_postcode: '6000',
        special_instructions: 'Ring the bell',
      },
      [
        { product_name: 'Pasta', quantity: 2, modifiers: [{ name: 'Extra cheese' }, 'GF'], special_instructions: 'No chilli' },
      ],
    );
    expect(order.orderNumber).toBe('VF-99');
    expect(order.fulfilment).toBe('Delivery');
    expect(order.address).toBe('544 Hay Street');
    expect(order.notes).toBe('Ring the bell');
    expect(items[0].name).toBe('Pasta');
    expect(items[0].quantity).toBe(2);
    expect(items[0].modifiers).toEqual(['Extra cheese', 'GF']);
    expect(items[0].notes).toBe('No chilli');
  });

  it('survives null-ish fields with safe fallbacks', () => {
    const { order, items } = toTicketPayload({ order_number: 'VF-1' }, [{ product_name: null, quantity: null, modifiers: null }]);
    expect(order.fulfilment).toBe('Pickup');
    expect(order.customerName).toBeNull();
    expect(items[0].name).toBe('Item');
    expect(items[0].quantity).toBe(1);
    expect(items[0].modifiers).toEqual([]);
  });
});
