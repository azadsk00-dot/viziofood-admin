/**
 * Star Line Mode (StarPRNT) command set — for Star Micronics printers that
 * have NO ESC/POS emulation, e.g. the mC-Print3 / MCP30 (the MCP30 speaks
 * StarPRNT only; Star's emulation-switch utilities cover TSP/desktop models,
 * not mC-Print). Sending ESC/POS bytes to these printers produces unformatted
 * text without a cut, because the command meanings differ:
 *
 *   ESC E      bold ON (same bytes, but bold OFF is ESC F — not ESC E 0)
 *   ESC GS a n alignment (ESC a alone is not an alignment command)
 *   ESC i h w character size (instead of GS !)
 *   ESC d 2    feed + FULL CUT (in ESC/POS, ESC d is just "feed n lines")
 *   GS …       mostly barcodes in Star Line, NOT size/cut
 *
 * Command reference: Star Line Mode Command Specifications (mirrored by the
 * widely used node-thermal-printer 'star' backend).
 *
 * Columns: Star Line font A on the 72mm printable width — 42 columns for
 * 80mm paper (conservative; bump to 48 if the physical ticket shows room).
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const commands = {
  init: () => Buffer.from([ESC, 0x40]),                        // initialize
  cut: () => Buffer.from([ESC, 0x64, 0x02]),                   // paper feed + full cut
  feed: (lines) => Buffer.alloc(Math.max(0, lines), LF),       // n line feeds
  alignLeft: () => Buffer.from([ESC, GS, 0x61, 0x00]),
  alignCenter: () => Buffer.from([ESC, GS, 0x61, 0x01]),
  boldOn: () => Buffer.from([ESC, 0x45]),
  boldOff: () => Buffer.from([ESC, 0x46]),
  sizeNormal: () => Buffer.from([ESC, 0x69, 0x00, 0x00]),
  sizeDouble: () => Buffer.from([ESC, 0x69, 0x01, 0x01]),      // double width+height
  sizeWide: () => Buffer.from([ESC, 0x69, 0x00, 0x01]),        // double width only
};

/** paper width (mm) → columns for Star Line font A. */
export const columnsForPaper = { 80: 42, 48: 26, 32: 16 };
