/**
 * Protocol dispatch — renders tickets through the command set matching the
 * physical printer. Selected globally per agent with VIZIO_PROTOCOL
 * ('escpos' default | 'star-line' for StarPRNT-only models like mC-Print3),
 * and per request on the HTTP /test-print endpoint.
 */

import { buildKitchenTicket, testTicketOrder } from './layout.js';
import { extractScheduledPickup } from './scheduled.js';
import * as escpos from './escpos.js';
import * as starline from './starline.js';

const PROTOCOLS = {
  escpos,
  'star-line': starline,
};

export function resolveProtocol(name) {
  const key = String(name ?? 'escpos').toLowerCase().replace(/[\s_]+/g, '-');
  const protocol = PROTOCOLS[key];
  if (!protocol) {
    throw new Error(`Unknown printer protocol "${name}" — use 'escpos' or 'star-line'.`);
  }
  return protocol;
}

function columnsFor(protocol, paperWidthMm) {
  return protocol.columnsForPaper[Number(paperWidthMm)] ?? 48;
}

/**
 * Render a kitchen ticket in the given protocol.
 *
 * @param {string} protocolName 'escpos' | 'star-line'
 * @param {object} order   see layout.js buildKitchenTicket
 * @param {Array}  items   see layout.js buildKitchenTicket
 * @param {object} opts    { restaurantName, paperWidth (mm) }
 */
export function renderKitchenTicket(protocolName, order, items, opts = {}) {
  const protocol = resolveProtocol(protocolName);
  const normalised = extractScheduledPickup(order, items);
  return buildKitchenTicket(protocol.commands, normalised.order, normalised.items, {
    restaurantName: opts.restaurantName,
    columns: columnsFor(protocol, opts.paperWidth ?? 80),
  });
}

/** A printable test ticket in the given protocol. */
export function renderTestTicket(protocolName, printerName, paperWidth = 80) {
  const protocol = resolveProtocol(protocolName);
  const { order, items } = testTicketOrder(printerName);
  return buildKitchenTicket(protocol.commands, order, items, {
    restaurantName: 'VIZIO FOOD',
    columns: columnsFor(protocol, paperWidth),
  });
}
