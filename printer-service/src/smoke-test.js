/**
 * Smoke test for the ticket renderers — plain node, no framework:
 *   node src/smoke-test.js
 * Verifies command bytes, wrapping, column layout, and that tickets render
 * to non-trivial buffers for BOTH protocols (escpos + star-line) without
 * touching the network.
 */

import assert from 'node:assert/strict';
import { renderKitchenTicket, renderTestTicket, resolveProtocol } from './ticket.js';
import { twoColumns, wrap } from './layout.js';

const order = {
  orderNumber: 'VF-12345678',
  status: 'New',
  paymentStatus: 'pending',
  fulfilment: 'Delivery',
  createdAt: '2026-08-24T04:05:06.000Z',
  customerName: 'Jo Test',
  address: '544 Hay Street',
  suburb: 'Perth',
  postcode: '6000',
  notes: 'Leave at the door',
};
const items = [
  { name: 'Campanelle with Prawns', quantity: 2, modifiers: ['Extra parmesan', 'GF pasta'], notes: 'No chilli' },
  { name: 'Cannoli', quantity: 1, modifiers: [], notes: null },
];

// twoColumns keeps left/right within width
assert.equal(twoColumns('Pickup', '12:30', 20).length, 20);
assert.equal(twoColumns('A'.repeat(30), 'B', 20).length >= 20, true);

// wrap splits long text and never exceeds width (unless a single word does)
assert.deepEqual(wrap('short line', 20), ['short line']);
assert.equal(wrap('the slow cooked ragu is very good indeed today', 20).every((l) => l.length <= 20), true);

// ─── ESC/POS (Epson-style) ──────────────────────────────────────────────────
const escposTicket = renderKitchenTicket('escpos', order, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 });
assert.ok(Buffer.isBuffer(escposTicket));
assert.ok(escposTicket.length > 100, 'escpos ticket should be substantial');

// ESC @ init is the first bytes
assert.equal(escposTicket[0], 0x1b);
assert.equal(escposTicket[1], 0x40);

// Order number and item text survive the round trip
const escposText = escposTicket.toString('utf8');
assert.ok(escposText.includes('VF-12345678'));
assert.ok(escposText.includes('Campanelle with Prawns'));
assert.ok(escposText.includes('Extra parmesan'));
assert.ok(escposText.includes('No chilli'));
assert.ok(escposText.includes('Leave at the door'));
assert.ok(escposText.includes('544 Hay Street, Perth, 6000'));
assert.ok(escposText.includes('ORDER TYPE: DELIVERY'));
assert.ok(escposText.includes('PAYMENT: UNPAID (CASH)'));
assert.ok(!escposText.includes('0478'));

// Cut command present (GS V)
assert.ok(escposTicket.includes(Buffer.from([0x1d, 0x56])));
// 80mm → 48 columns: divider is 48 dashes
assert.ok(escposTicket.includes(Buffer.from('-'.repeat(48) + '\n')));

// ─── Star Line (mC-Print3/MCP30 — StarPRNT only) ────────────────────────────
const starTicket = renderKitchenTicket('star-line', order, items, { restaurantName: 'VIZIO FOOD', paperWidth: 80 });
assert.ok(Buffer.isBuffer(starTicket));
assert.ok(starTicket.length > 100, 'star-line ticket should be substantial');

// ESC @ init, then Star centering ESC GS a 1 before the header
assert.equal(starTicket[0], 0x1b);
assert.equal(starTicket[1], 0x40);
assert.ok(starTicket.includes(Buffer.from([0x1b, 0x1d, 0x61, 0x01])), 'star center command');
assert.ok(starTicket.includes(Buffer.from([0x1b, 0x45])), 'star bold on (ESC E)');
assert.ok(starTicket.includes(Buffer.from([0x1b, 0x46])), 'star bold off (ESC F)');
assert.ok(starTicket.includes(Buffer.from([0x1b, 0x69, 0x01, 0x01])), 'star double size (ESC i 1 1)');
// Star full cut ESC d 2 — and NO ESC/POS cut (GS V) anywhere
assert.ok(starTicket.includes(Buffer.from([0x1b, 0x64, 0x02])), 'star full cut');
assert.ok(!starTicket.includes(Buffer.from([0x1d, 0x56])), 'must not contain ESC/POS cut');

const starText = starTicket.toString('utf8');
assert.ok(starText.includes('VF-12345678'));
assert.ok(starText.includes('Campanelle with Prawns'));
assert.ok(starText.includes('Leave at the door'));
assert.ok(starText.includes('ORDER TYPE: DELIVERY'));
assert.ok(starText.includes('PAYMENT: UNPAID (CASH)'));
assert.ok(!starText.includes('0478'));
// 80mm → 42 columns on Star Line font A
assert.ok(starTicket.includes(Buffer.from('-'.repeat(42) + '\n')));

// Test tickets render in both protocols
const escposTest = renderTestTicket('escpos', 'Kitchen printer', 80);
assert.ok(escposTest.length > 50);
assert.ok(escposTest.toString('utf8').includes('TEST'));
const starTest = renderTestTicket('star-line', 'Kitchen printer', 80);
assert.ok(starTest.length > 50);
assert.ok(starTest.toString('utf8').includes('TEST'));

// Unknown protocol is rejected loudly
assert.throws(() => resolveProtocol('postscript'), /Unknown printer protocol/);

console.log(
  `smoke test passed — escpos ${escposTicket.length}B, star-line ${starTicket.length}B, ` +
    `test tickets ${escposTest.length}B/${starTest.length}B`,
);
