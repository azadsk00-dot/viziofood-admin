/**
 * ESC/POS command builder + kitchen-ticket renderer.
 *
 * Pure functions: bytes in, bytes out — no I/O — so the layout is unit
 * testable and identical across printers. Widths are characters (32/48/80mm).
 */

const ESC = 0x1b;
const GS = 0x1d;

export const commands = {
  init: () => Buffer.from([ESC, 0x40]),                       // initialize
  cut: () => Buffer.from([GS, 0x56, 0x42, 0x00]),             // full cut
  feed: (lines) => Buffer.from([ESC, 0x64, lines]),           // feed n lines
  alignLeft: () => Buffer.from([ESC, 0x61, 0x00]),
  alignCenter: () => Buffer.from([ESC, 0x61, 0x01]),
  boldOn: () => Buffer.from([ESC, 0x45, 0x01]),
  boldOff: () => Buffer.from([ESC, 0x45, 0x00]),
  sizeNormal: () => Buffer.from([GS, 0x21, 0x00]),
  sizeDouble: () => Buffer.from([GS, 0x21, 0x11]),            // double width+height
  sizeWide: () => Buffer.from([GS, 0x21, 0x10]),              // double width only
};

/** Split a line into [left, right] padded to the paper width. */
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

/**
 * Render a kitchen ticket for an order.
 *
 * @param {object} order  { orderNumber, status, fulfilment, createdAt, customerName, customerPhone, address, suburb, postcode, notes }
 * @param {Array}  items  [{ name, quantity, modifiers: string[], notes }]
 * @param {object} opts   { restaurantName, paperWidth }
 */
export function renderKitchenTicket(order, items, opts = {}) {
  const width = opts.paperWidth ?? 48;
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
  push(Buffer.from([]), twoColumns(order.fulfilment ?? 'Pickup', time, width));
  push(Buffer.from([]), twoColumns(order.status ?? 'NEW', `${items.length} item${items.length === 1 ? '' : 's'}`, width));
  push(Buffer.from([]), divider(width));

  // Customer block
  if (order.customerName) push(Buffer.from([]), order.customerName);
  if (order.fulfilment === 'Delivery' && order.address) {
    for (const line of wrap([order.address, order.suburb, order.postcode].filter(Boolean).join(', '), width)) {
      push(Buffer.from([]), line);
    }
  }
  if (order.customerPhone) push(Buffer.from([]), order.customerPhone);
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

  // Footer
  chunks.push(commands.feed(2), commands.cut(), commands.feed(2));
  return Buffer.concat(chunks.filter((chunk) => chunk.length > 0));
}

/** A printable test ticket. */
export function renderTestTicket(printerName, paperWidth = 48) {
  return renderKitchenTicket(
    {
      orderNumber: 'TEST',
      status: 'TEST PRINT',
      fulfilment: 'Pickup',
      createdAt: new Date().toISOString(),
      customerName: 'Printer test',
      notes: `If you can read this, ${printerName} is working.`,
    },
    [{ name: 'Test item', quantity: 1, modifiers: ['Extra check'], notes: 'Test note' }],
    { restaurantName: 'VIZIO FOOD', paperWidth },
  );
}
