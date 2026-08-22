/**
 * Smoke test for the ESC/POS renderer — plain node, no framework:
 *   node src/smoke-test.js
 * Verifies command bytes, wrapping, column layout, and that a ticket
 * renders to a non-trivial buffer without touching the network.
 */

import assert from 'node:assert/strict';
import { renderKitchenTicket, renderTestTicket, twoColumns, wrap } from './escpos.js';

// twoColumns keeps left/right within width
assert.equal(twoColumns('Pickup', '12:30', 20).length, 20);
assert.equal(twoColumns('A'.repeat(30), 'B', 20).length >= 20, true);

// wrap splits long text and never exceeds width (unless a single word does)
assert.deepEqual(wrap('short line', 20), ['short line']);
assert.equal(wrap('the slow cooked ragu is very good indeed today', 20).every((l) => l.length <= 20), true);

// commands
const ticket = renderKitchenTicket(
  {
    orderNumber: 'VF-12345678',
    status: 'New',
    fulfilment: 'Delivery',
    createdAt: '2026-08-24T04:05:06.000Z',
    customerName: 'Jo Test',
    customerPhone: '0478 000 000',
    address: '544 Hay Street',
    suburb: 'Perth',
    postcode: '6000',
    notes: 'Leave at the door',
  },
  [
    { name: 'Campanelle with Prawns', quantity: 2, modifiers: ['Extra parmesan', 'GF pasta'], notes: 'No chilli' },
    { name: 'Cannoli', quantity: 1, modifiers: [], notes: null },
  ],
  { restaurantName: 'VIZIO FOOD', paperWidth: 48 },
);
assert.ok(Buffer.isBuffer(ticket));
assert.ok(ticket.length > 100, 'ticket should be substantial');

// ESC @ init is the first bytes
assert.equal(ticket[0], 0x1b);
assert.equal(ticket[1], 0x40);

// Order number and item text survive the round trip
const text = ticket.toString('utf8');
assert.ok(text.includes('VF-12345678'));
assert.ok(text.includes('Campanelle with Prawns'));
assert.ok(text.includes('Extra parmesan'));
assert.ok(text.includes('No chilli'));
assert.ok(text.includes('Leave at the door'));
assert.ok(text.includes('544 Hay Street, Perth, 6000'));

// Cut command present (GS V)
assert.ok(ticket.includes(Buffer.from([0x1d, 0x56])));

// Test ticket renders too
const test = renderTestTicket('Kitchen printer', 48);
assert.ok(test.length > 50);
assert.ok(test.toString('utf8').includes('TEST'));

console.log(`escpos smoke test passed — kitchen ticket ${ticket.length} bytes, test ticket ${test.length} bytes`);
