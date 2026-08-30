/**
 * ESC/POS command set (Epson-style) + legacy render helpers. Use for
 * printers with ESC/POS support; Star mC-Print models (MCP20/30/31) do NOT
 * emulate ESC/POS — they need starline.js instead. Select with
 * VIZIO_PROTOCOL=escpos|star-line (default escpos).
 *
 * Pure functions: bytes in, bytes out — no I/O — so the layout is unit
 * testable and identical across printers.
 */

import { buildKitchenTicket, testTicketOrder, twoColumns, wrap } from './layout.js';

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

/** paper width (mm) → columns (Epson font A: 48 on 80mm paper). */
export const columnsForPaper = { 80: 48, 48: 32, 32: 16 };

const columns = (paperWidthMm) => columnsForPaper[Number(paperWidthMm)] ?? 48;

/**
 * Render a kitchen ticket (ESC/POS). `opts.paperWidth` is the paper width in
 * mm (32/48/80) — mapped to columns for layout.
 */
export function renderKitchenTicket(order, items, opts = {}) {
  return buildKitchenTicket(commands, order, items, {
    restaurantName: opts.restaurantName,
    columns: columns(opts.paperWidth ?? 80),
  });
}

/** A printable ESC/POS test ticket. */
export function renderTestTicket(printerName, paperWidth = 80) {
  const { order, items } = testTicketOrder(printerName);
  return renderKitchenTicket(order, items, { restaurantName: 'VIZIO FOOD', paperWidth });
}

export { twoColumns, wrap };
