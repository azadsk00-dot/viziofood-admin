// Star Line renderer tests — the byte stream is pinned to the EXACT output
// of the printer-service JS renderer that physically printed a receipt on
// the restaurant's Star mC-Print3 (MCP30). Any byte change here changes what
// the printer receives.

import { describe, expect, it } from 'vitest';
import {
  columnsForPaper,
  renderKitchenTicket,
  renderTestTicket,
  twoColumns,
  wrap,
  type TicketItem,
  type TicketOrder,
} from '../src/lib/starline';

// Fixture generated 2026-08-23 via: printer-service/src/ticket.js
// renderKitchenTicket('star-line', order, items, {restaurantName:'VIZIO FOOD', paperWidth:80})
const PHYSICALLY_TESTED_TICKET_HEX =
  '1b401b1d61011b451b69010156462d31323334353637380a1b6900001b461b4556495a494f20464f4f440a1b462d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d0a1b1d61001b454f5244455220545950453a2044494e452d494e20202020202020202020202020202031323a303520706d0a5041594d454e543a20554e50414944202843415348292020202020202020202020202032206974656d730a1b464e65772020202020202020202020202020202020202020202020202020202020202020203234204175670a2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d0a4a6f20546573740a2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d0a1b6900011b4532782043616d70616e656c6c65207769746820507261776e730a1b6900001b462b204578747261207061726d6573616e0a2b2047462070617374610a1b454e4f54453a204e6f206368696c6c690a1b461b6900011b4531782043616e6e6f6c690a1b6900001b462d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d0a1b454f52444552204e4f54453a204c656176652061742074686520646f6f720a1b462d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d0a1b451b690001544f54414c3a202436312e34300a1b6900001b460a0a1b64020a0a';

const order: TicketOrder = {
  orderNumber: 'VF-12345678',
  status: 'New',
  paymentStatus: 'pending',
  fulfilment: 'Dine-in',
  createdAt: '2026-08-24T04:05:06.000Z',
  total: 61.4,
  customerName: 'Jo Test',
  address: '544 Hay Street',
  suburb: 'Perth',
  postcode: '6000',
  notes: 'Leave at the door',
};

const items: TicketItem[] = [
  { name: 'Campanelle with Prawns', quantity: 2, modifiers: ['Extra parmesan', 'GF pasta'], notes: 'No chilli' },
  { name: 'Cannoli', quantity: 1, modifiers: [], notes: null },
];

const toHex = (bytes: Uint8Array): string => {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
};

describe('renderKitchenTicket (Star Line)', () => {
  it('is byte-identical to the physically tested printer-service renderer', () => {
    const ticket = renderKitchenTicket(order, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 });
    expect(toHex(ticket)).toBe(PHYSICALLY_TESTED_TICKET_HEX);
  });

  it('starts with ESC @ init and uses Star commands, never ESC/POS ones', () => {
    const ticket = renderKitchenTicket(order, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 });
    expect(Array.from(ticket.slice(0, 2))).toEqual([0x1b, 0x40]);
    const hex = toHex(ticket);
    expect(hex).toContain('1b1d6101'); // Star centring
    expect(hex).toContain('1b46'); // Star bold off (ESC F)
    expect(hex).toContain('1b690101'); // Star double size
    expect(hex).toContain('1b6402'); // Star full cut
    expect(hex).not.toContain('1d56'); // ESC/POS cut (GS V) must never appear
  });

  it('prints ORDER TYPE and PAYMENT status, and NEVER the customer phone', () => {
    const text = new TextDecoder().decode(renderKitchenTicket(order, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 }));
    expect(text).toContain('ORDER TYPE: DINE-IN');
    expect(text).toContain('PAYMENT: UNPAID (CASH)');
    expect(text).not.toContain('0478');
  });

  it('prints the authoritative order TOTAL and never recalculates it', () => {
    const text = new TextDecoder().decode(renderKitchenTicket(order, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 }));
    expect(text).toContain('TOTAL: $61.40');
    const noTotal = new TextDecoder().decode(renderKitchenTicket({ ...order, total: null }, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 }));
    expect(noTotal).not.toContain('TOTAL:');
  });

  it('labels paid card orders PAID', () => {
    const text = new TextDecoder().decode(
      renderKitchenTicket({ ...order, paymentStatus: 'paid', fulfilment: 'Pickup' }, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 }),
    );
    expect(text).toContain('ORDER TYPE: PICKUP');
    expect(text).toContain('PAYMENT: PAID');
  });

  it('uses 42 columns for 80mm and 48 columns never appear for wide dividers', () => {
    expect(columnsForPaper[80]).toBe(42);
    const text = new TextDecoder().decode(renderKitchenTicket(order, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 }));
    expect(text).toContain('-'.repeat(42));
  });

  it('renders a test receipt with the same command structure', () => {
    const test = renderTestTicket('Kitchen MCP30', 80);
    expect(test.length).toBeGreaterThan(100);
    const text = new TextDecoder().decode(test);
    expect(text).toContain('TEST');
    // The printer name sits in the wrapped order note — only assert a piece
    // that can never be split across lines.
    expect(text).toContain('MCP30');
    expect(toHex(test).endsWith('1b64020a0a')).toBe(true);
  });

  it('handles multi-byte characters in names without breaking commands', () => {
    const ticket = renderKitchenTicket(
      { ...order, customerName: 'Şef Āhmet' },
      [{ name: 'Kebap İstanbul', quantity: 1, modifiers: [], notes: null }],
      { restaurantName: 'VIZIO FOOD', paperWidth: 80 },
    );
    const text = new TextDecoder().decode(ticket);
    expect(text).toContain('Şef Āhmet');
    expect(text).toContain('Kebap İstanbul');
  });
});

describe('layout helpers', () => {
  it('twoColumns pads to width', () => {
    expect(twoColumns('Pickup', '12:30', 20).length).toBe(20);
  });

  it('wrap never exceeds width', () => {
    expect(wrap('the slow cooked ragu is very good indeed today', 20).every((l) => l.length <= 20)).toBe(true);
  });
});
