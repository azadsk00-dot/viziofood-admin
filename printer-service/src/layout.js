/**
 * Ticket layout — protocol-agnostic. The same visual layout is rendered
 * through a command set supplied by the protocol module (escpos.js for
 * Epson-style printers, starline.js for StarPRNT-only printers like the
 * mC-Print3/MCP30). Widths here are COLUMNS; protocol modules map paper
 * millimetres to columns (they differ per protocol and font).
 */

/** Split a line into [left, right] padded to the width. */
export const twoColumns = (left, right, width) => {
  const l = String(left ?? '');
  const r = String(right ?? '');
  const space = Math.max(1, width - l.length - r.length);
  return l + ' '.repeat(space) + r;
};

/** Word-wrap text to width, returning lines. */
export const wrap = (text, width) => {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + (current ? ' ' : '') + word).length > width) {
      if (current) lines.push(current);
      current = word.length > width ? word.slice(0, width) : word;
    } else {
      current += (current ? ' ' : '') + word;
    }
  }
  if (current) lines.push(current);
  return lines;
};

const divider = (width) => '-'.repeat(width);

/** Receipt payment label — PAID vs UNPAID (CASH) must be obvious. */
export function paymentLabel(paymentStatus) {
  switch (String(paymentStatus ?? '').toLowerCase()) {
    case 'paid':
      return 'PAID';
    case 'refunded':
      return 'REFUNDED';
    case 'partially_refunded':
      return 'PARTIALLY REFUNDED';
    case 'failed':
      return 'FAILED';
    default:
      return 'UNPAID (CASH)';
  }
}

/**
 * Render a kitchen ticket for an order using the given command set.
 * Receipt policy: ORDER TYPE + PAYMENT status are printed bold (kitchen
 * staff must see at a glance whether payment already happened); customer
 * phone numbers are NEVER printed (privacy).
 *
 * @param {object} commands  protocol command set (see escpos.js / starline.js)
 * @param {object} order     { orderNumber, status, paymentStatus, fulfilment, createdAt, total, customerName, address, suburb, postcode, notes }
 * @param {Array}  items     [{ name, quantity, modifiers: string[], notes }]
 * @param {object} opts      { restaurantName, columns }
 */
export function buildKitchenTicket(commands, order, items, opts = {}) {
  const width = opts.columns ?? 48;
  const chunks = [];

  const push = (buffer, text) => {
    chunks.push(buffer, Buffer.from(text + '\n', 'utf8'));
  };

  chunks.push(commands.init());

  // Header
  chunks.push(commands.alignCenter(), commands.boldOn(), commands.sizeDouble());
  push(Buffer.from([]), (order.orderNumber ?? 'ORDER').toString());
  chunks.push(commands.sizeNormal(), commands.boldOff());

  if (opts.restaurantName) {
    chunks.push(commands.boldOn());
    push(Buffer.from([]), opts.restaurantName);
    chunks.push(commands.boldOff());
  }

  push(Buffer.from([]), divider(width));
  chunks.push(commands.alignLeft());

  const placedAt = order.createdAt ? new Date(order.createdAt) : new Date();
  const time = placedAt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

  // ORDER TYPE + PAYMENT — bold, staff must see these without the tablet.
  chunks.push(commands.boldOn());
  push(Buffer.from([]), twoColumns(`ORDER TYPE: ${String(order.fulfilment ?? 'Pickup').toUpperCase()}`, time, width));
  push(Buffer.from([]), twoColumns(`PAYMENT: ${paymentLabel(order.paymentStatus ?? '')}`, `${items.length} item${items.length === 1 ? '' : 's'}`, width));
  chunks.push(commands.boldOff());
  // ONE authoritative scheduled-pickup line (auto-generated sentences are
  // never repeated as order notes — see scheduled.js).
  if (order.scheduledPickup) {
    chunks.push(commands.boldOn());
    for (const line of wrap(`SCHEDULED PICKUP: ${order.scheduledPickup}`, width)) push(Buffer.from([]), line);
    chunks.push(commands.boldOff());
  }
  push(Buffer.from([]), twoColumns(order.status ?? 'NEW', placedAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), width));
  push(Buffer.from([]), divider(width));

  // Customer block (NO phone number — privacy requirement).
  if (order.customerName) push(Buffer.from([]), order.customerName);
  if (order.fulfilment === 'Delivery' && order.address) {
    for (const line of wrap([order.address, order.suburb, order.postcode].filter(Boolean).join(', '), width)) {
      push(Buffer.from([]), line);
    }
  }
  push(Buffer.from([]), divider(width));

  // Items
  for (const item of items) {
    chunks.push(commands.sizeWide(), commands.boldOn());
    push(Buffer.from([]), `${item.quantity ?? 1}x ${item.name ?? 'Item'}`);
    chunks.push(commands.sizeNormal(), commands.boldOff());
    for (const modifier of item.modifiers ?? []) {
      for (const line of wrap(`   + ${modifier}`, width)) push(Buffer.from([]), line);
    }
    if (item.notes) {
      chunks.push(commands.boldOn());
      for (const line of wrap(`   NOTE: ${item.notes}`, width)) push(Buffer.from([]), line);
      chunks.push(commands.boldOff());
    }
  }

  if (order.notes) {
    push(Buffer.from([]), divider(width));
    chunks.push(commands.boldOn());
    for (const line of wrap(`ORDER NOTE: ${order.notes}`, width)) push(Buffer.from([]), line);
    chunks.push(commands.boldOff());
  }

  // Total — the authoritative order total, never recalculated.
  if (typeof order.total === 'number' && Number.isFinite(order.total)) {
    push(Buffer.from([]), divider(width));
    chunks.push(commands.boldOn(), commands.sizeWide());
    push(Buffer.from([]), `TOTAL: $${order.total.toFixed(2)}`);
    chunks.push(commands.sizeNormal(), commands.boldOff());
  }

  // Footer
  chunks.push(commands.feed(2), commands.cut(), commands.feed(2));
  return Buffer.concat(chunks.filter((chunk) => chunk.length > 0));
}

/** Order/items fixture for a printable test ticket. */
export function testTicketOrder(printerName) {
  return {
    order: {
      orderNumber: 'TEST',
      status: 'TEST PRINT',
      fulfilment: 'Pickup',
      createdAt: new Date().toISOString(),
      customerName: 'Printer test',
      notes: `If you can read this, ${printerName} is working.`,
    },
    items: [{ name: 'Test item', quantity: 1, modifiers: ['Extra check'], notes: 'Test note' }],
  };
}
