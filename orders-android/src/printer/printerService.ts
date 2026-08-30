// PrinterService — kitchen receipt printing via Star's official StarXpand
// SDK (react-native-star-io10) for the Star mC-Print3 (MCP30) over LAN.
//
// This is the SAME recipe as the working VIZIO FOOD Admin implementation
// (mobile/src/printer/kitchenReceipt.ts — fixed and confirmed working):
//   * addressing: the SDK's Lan interface accepts "TCP:<ip>" or a MAC
//     address; the app stores the IP the operator enters and builds
//     "TCP:<ip>" automatically (identifierFor). LAN uses TCP port 9100.
//   * autoSwitchInterface = false — with it on, the SDK probes other
//     interfaces for the identifier and the direct IP connection can fail.
//   * openTimeout 15s; close is best-effort after errors.
//   * printing failures never throw to the caller — { ok:false, error }.
//
// Identifier validation happens in printer/identifier.ts BEFORE anything is
// passed to the SDK.

import {
  StarPrinter,
  StarConnectionSettings,
  InterfaceType,
  StarXpandCommand,
} from 'react-native-star-io10';
import type { Order, PrinterSettings, ReceiptSnapshot } from '../types';
import { formatDateTime, formatMoney } from '../lib/format';
import { describeAddress, identifierFor, validateAddress } from './identifier';

export type PrintResult = { ok: boolean; error?: string };

function friendlyError(address: string, reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason ?? 'Unknown error');
  const where = describeAddress(address);
  if (/timeout|open|connect/i.test(raw)) {
    return `Could not reach the printer ${where}. Check that the printer is powered on and connected to the same network as this device.`;
  }
  if (/not found|no printer|network/i.test(raw)) {
    return `Printer ${where} is unreachable — verify the IP address in Printer settings.`;
  }
  if (/paper/i.test(raw)) {
    return `The printer ${where} is out of paper or its cover is open.`;
  }
  return `Print failed: ${raw}`;
}

/** Capture everything the receipt needs, at enqueue time. */
export function snapshotForReceipt(order: Order): ReceiptSnapshot {
  return {
    orderNumber: order.orderNumber,
    customer: order.customerName,
    fulfilment: order.fulfilment,
    createdAt: order.createdAt,
    scheduledText: order.scheduledText,
    notes: order.specialInstructions,
    lines: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.name,
      modifiers: item.modifiers.map((m) => m.name).filter(Boolean),
      notes: item.notes,
    })),
    total: order.total,
  };
}

/** Build the StarXpand command JSON for a kitchen receipt. */
function buildReceiptCommands(receipt: ReceiptSnapshot): Promise<string> {
  const { DocumentBuilder, PrinterBuilder, MagnificationParameter } = StarXpandCommand;
  const { Alignment, CutType } = StarXpandCommand.Printer;

  const divider = '--------------------------------\n';

  const printer = new PrinterBuilder();

  // Header — centred, large
  printer
    .styleAlignment(Alignment.Center)
    .styleBold(true)
    .styleMagnification(new MagnificationParameter(2, 2));
  printer.actionPrintText('VIZIO FOOD\n');
  printer.actionPrintText(`ORDER ${receipt.orderNumber}\n`);
  printer.styleMagnification(new MagnificationParameter(1, 1));
  printer.actionPrintText(`${formatDateTime(receipt.createdAt)}\n`);
  if (receipt.scheduledText) {
    // Exactly ONE authoritative scheduled line — the scheduling signal the
    // kitchen acts on (never duplicated from the notes below).
    printer.styleBold(true);
    printer.actionPrintText(`${receipt.scheduledText.toUpperCase()}\n`);
    printer.styleBold(false);
  }
  printer.actionPrintText(receipt.fulfilment.toUpperCase());
  printer.styleBold(false).styleAlignment(Alignment.Left);
  printer.actionPrintText(`\n${receipt.customer}\n\n${divider}`);

  // Items
  if (receipt.lines.length) {
    for (const line of receipt.lines) {
      printer.styleBold(true).styleMagnification(new MagnificationParameter(2, 1));
      printer.actionPrintText(`${line.quantity} x ${line.name}\n`);
      printer.styleBold(false).styleMagnification(new MagnificationParameter(1, 1));
      for (const modifier of line.modifiers) {
        printer.actionPrintText(`      + ${modifier}\n`);
      }
      if (line.notes) {
        printer.styleBold(true);
        printer.actionPrintText(`      NOTE: ${line.notes}\n`);
        printer.styleBold(false);
      }
    }
  } else {
    printer.actionPrintText('(no item details)\n');
  }

  printer.actionPrintText(divider);

  // Order-level special instructions (scheduled sentences already removed)
  if (receipt.notes) {
    printer.styleBold(true).styleInvert(true);
    printer.actionPrintText(`NOTE: ${receipt.notes}\n`);
    printer.styleBold(false).styleInvert(false);
    printer.actionPrintText(divider);
  }

  // Total
  printer.styleBold(true);
  printer.actionPrintText(`TOTAL: ${formatMoney(receipt.total)}\n`);
  printer.styleBold(false);
  printer.actionFeedLine(2);
  printer.actionCut(CutType.Partial);

  const document = new DocumentBuilder();
  document.addPrinter(printer);

  const builder = new StarXpandCommand.StarXpandCommandBuilder();
  builder.addDocument(document);
  return builder.getCommands();
}

async function sendToPrinter(settings: PrinterSettings, commands: string): Promise<void> {
  const connection = new StarConnectionSettings();
  connection.interfaceType = InterfaceType.Lan;
  connection.identifier = identifierFor(settings.address);
  // Direct LAN connection ONLY (see file header).
  connection.autoSwitchInterface = false;

  const printer = new StarPrinter(connection);
  printer.openTimeout = 15000;
  try {
    await printer.open();
    await printer.print(commands);
  } finally {
    try {
      await printer.close();
    } catch {
      /* closing after an error is best-effort */
    }
  }
}

function guardSettings(settings: PrinterSettings): string | null {
  return validateAddress(settings.address);
}

/** Print a receipt snapshot. Validates the identifier before the SDK sees it. */
export async function printReceipt(
  settings: PrinterSettings,
  receipt: ReceiptSnapshot,
): Promise<PrintResult> {
  const invalid = guardSettings(settings);
  if (invalid) return { ok: false, error: invalid };
  try {
    await sendToPrinter(settings, await buildReceiptCommands(receipt));
    return { ok: true };
  } catch (reason) {
    return { ok: false, error: friendlyError(settings.address, reason) };
  }
}

/**
 * Connection test — opens and closes the printer without printing. Cheap
 * liveness check for the Printer settings screen.
 */
export async function testConnection(settings: PrinterSettings): Promise<PrintResult> {
  const invalid = guardSettings(settings);
  if (invalid) return { ok: false, error: invalid };
  try {
    // An empty command set performs open→print(nothing)→close; a successful
    // open is what proves reachability.
    await sendToPrinter(settings, await emptyCommands());
    return { ok: true };
  } catch (reason) {
    return { ok: false, error: friendlyError(settings.address, reason) };
  }
}

async function emptyCommands(): Promise<string> {
  const { DocumentBuilder, PrinterBuilder } = StarXpandCommand;
  const printer = new PrinterBuilder();
  const document = new DocumentBuilder();
  document.addPrinter(printer);
  const builder = new StarXpandCommand.StarXpandCommandBuilder();
  builder.addDocument(document);
  return builder.getCommands();
}

/** Test print from the Settings screen using the currently entered config. */
export async function printTestReceipt(settings: PrinterSettings): Promise<PrintResult> {
  const invalid = guardSettings(settings);
  if (invalid) return { ok: false, error: invalid };
  const receipt: ReceiptSnapshot = {
    orderNumber: 'TEST',
    customer: 'Printer test',
    fulfilment: 'Pickup',
    createdAt: new Date().toISOString(),
    scheduledText: null,
    notes: 'VIZIO FOOD Orders printer test',
    lines: [{ quantity: 1, name: 'Test item', modifiers: ['Extra test'], notes: '' }],
    total: 0,
  };
  return printReceipt(settings, receipt);
}
