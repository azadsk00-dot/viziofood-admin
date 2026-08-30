// Star Line (StarPRNT) ticket renderer for Star Micronics printers with no
// ESC/POS emulation — the mC-Print3 / MCP30 speaks StarPRNT only.
//
// This is a byte-identical TypeScript port of the physically-tested
// printer-service renderer (printer-service/src/layout.js + starline.js);
// __tests__/starline.test.ts pins the output to the exact byte stream that
// produced a real receipt on the restaurant's MCP30.
//
// Star Line command meanings (NOT ESC/POS):
//   ESC @      initialize
//   ESC GS a n alignment (0 left, 1 centre, 2 right)
//   ESC E / ESC F  bold on / bold off (off is ESC F, not ESC E 0)
//   ESC i h w character size (height/width multipliers 0|1)
//   ESC d 2    paper feed + full cut
//   LF         line feed
//
// Pure module: no React Native imports, fully unit-testable.

export interface TicketOrder {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  fulfilment: string;
  createdAt: string;
  /** Authoritative scheduled pickup text, lifted out of the notes (see scheduledNote.ts). */
  scheduledPickup?: string | null;
  /** Authoritative order total from the orders row (never recalculated). */
  total?: number | null;
  customerName?: string | null;
  address?: string | null;
  suburb?: string | null;
  postcode?: string | null;
  notes?: string | null;
}

export interface TicketItem {
  name: string;
  quantity: number;
  modifiers: string[];
  notes?: string | null;
}

export interface TicketOptions {
  restaurantName?: string;
  /** Paper width in mm (32/48/80) — mapped to columns. */
  paperWidth: number;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const commands = {
  init: (): number[] => [ESC, 0x40],
  cut: (): number[] => [ESC, 0x64, 0x02], // feed + full cut
  feed: (lines: number): number[] => Array(Math.max(0, lines)).fill(LF),
  alignLeft: (): number[] => [ESC, GS, 0x61, 0x00],
  alignCenter: (): number[] => [ESC, GS, 0x61, 0x01],
  boldOn: (): number[] => [ESC, 0x45],
  boldOff: (): number[] => [ESC, 0x46],
  sizeNormal: (): number[] => [ESC, 0x69, 0x00, 0x00],
  sizeDouble: (): number[] => [ESC, 0x69, 0x01, 0x01],
  sizeWide: (): number[] => [ESC, 0x69, 0x00, 0x01],
};

/** paper width (mm) → columns (Star Line font A; 42 on 80mm — physically verified). */
export const columnsForPaper: Record<number, number> = { 80: 42, 48: 26, 32: 16 };

const utf8Bytes = (text: string): number[] => {
  // UTF-8 encode without depending on the buffer package in tests.
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x7f) out.push(code);
    else if (code <= 0x7ff) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code <= 0xffff) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return out;
};

/** Split a line into [left, right] padded to the width. */
export const twoColumns = (left: unknown, right: unknown, width: number): string => {
  const l = String(left ?? '');
  const r = String(right ?? '');
  const space = Math.max(1, width - l.length - r.length);
  return l + ' '.repeat(space) + r;
};

/** Word-wrap text to width, returning lines. */
export const wrap = (text: unknown, width: number): string[] => {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
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

const divider = (width: number) => '-'.repeat(width);

/** Receipt payment label — kitchen staff must see at a glance whether payment already happened. */
export function paymentLabel(paymentStatus: string): string {
  switch ((paymentStatus ?? '').toLowerCase()) {
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

/** Render a kitchen ticket for an order as Star Line bytes. */
export function renderKitchenTicket(order: TicketOrder, items: TicketItem[], opts: TicketOptions): Uint8Array {
  const width = columnsForPaper[Number(opts.paperWidth)] ?? 42;
  const chunks: number[][] = [];

  const push = (buffer: number[], text: string) => {
    chunks.push(buffer, utf8Bytes(`${text}\n`));
  };

  chunks.push(commands.init());

  // Header
  chunks.push(commands.alignCenter(), commands.boldOn(), commands.sizeDouble());
  push([], (order.orderNumber ?? 'ORDER').toString());
  chunks.push(commands.sizeNormal(), commands.boldOff());

  if (opts.restaurantName) {
    chunks.push(commands.boldOn());
    push([], opts.restaurantName);
    chunks.push(commands.boldOff());
  }

  push([], divider(width));
  chunks.push(commands.alignLeft());

  const placedAt = order.createdAt ? new Date(order.createdAt) : new Date();
  const time = placedAt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });

  // ORDER TYPE + PAYMENT — bold, staff must see these without the tablet.
  chunks.push(commands.boldOn());
  push([], twoColumns(`ORDER TYPE: ${(order.fulfilment ?? 'Pickup').toUpperCase()}`, time, width));
  push([], twoColumns(`PAYMENT: ${paymentLabel(order.paymentStatus ?? '')}`, `${items.length} item${items.length === 1 ? '' : 's'}`, width));
  chunks.push(commands.boldOff());
  // ONE authoritative scheduled-pickup line (auto-generated sentences are
  // never repeated as order notes — see scheduledNote.ts).
  if (order.scheduledPickup) {
    chunks.push(commands.boldOn());
    const schedLabel = order.fulfilment === 'Dine-in' ? 'SCHEDULED DINE-IN' : 'SCHEDULED PICKUP';
    for (const line of wrap(`${schedLabel}: ${order.scheduledPickup}`, width)) push([], line);
    chunks.push(commands.boldOff());
  }
  push([], twoColumns(order.status ?? 'NEW', placedAt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), width));
  push([], divider(width));

  // Customer block (NO phone number — privacy requirement).
  if (order.customerName) push([], order.customerName);
  if (order.fulfilment === 'Delivery' && order.address) {
    for (const line of wrap([order.address, order.suburb, order.postcode].filter(Boolean).join(', '), width)) {
      push([], line);
    }
  }
  push([], divider(width));

  // Items
  for (const item of items) {
    chunks.push(commands.sizeWide(), commands.boldOn());
    push([], `${item.quantity ?? 1}x ${item.name ?? 'Item'}`);
    chunks.push(commands.sizeNormal(), commands.boldOff());
    for (const modifier of item.modifiers ?? []) {
      for (const line of wrap(`   + ${modifier}`, width)) push([], line);
    }
    if (item.notes) {
      chunks.push(commands.boldOn());
      for (const line of wrap(`   NOTE: ${item.notes}`, width)) push([], line);
      chunks.push(commands.boldOff());
    }
  }

  if (order.notes) {
    push([], divider(width));
    chunks.push(commands.boldOn());
    for (const line of wrap(`ORDER NOTE: ${order.notes}`, width)) push([], line);
    chunks.push(commands.boldOff());
  }

  // Total — the authoritative order total, never recalculated.
  if (typeof order.total === 'number' && Number.isFinite(order.total)) {
    push([], divider(width));
    chunks.push(commands.boldOn(), commands.sizeWide());
    push([], `TOTAL: $${order.total.toFixed(2)}`);
    chunks.push(commands.sizeNormal(), commands.boldOff());
  }

  // Footer
  chunks.push(commands.feed(2), commands.cut(), commands.feed(2));
  return new Uint8Array(chunks.flat());
}

/** A printable Star Line test receipt. */
export function renderTestTicket(printerName: string, paperWidth: number): Uint8Array {
  return renderKitchenTicket(
    {
      orderNumber: 'TEST',
      status: 'TEST PRINT',
      paymentStatus: 'paid',
      fulfilment: 'Pickup',
      createdAt: new Date().toISOString(),
      customerName: 'Printer test',
      notes: `If you can read this, ${printerName} is working.`,
    },
    [{ name: 'Test item', quantity: 1, modifiers: ['Extra check'], notes: 'Test note' }],
    { restaurantName: 'VIZIO FOOD', paperWidth },
  );
}

export const starLineCommands = commands;
