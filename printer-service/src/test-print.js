/**
 * Test print — sends a test ticket straight to a printer (no Supabase
 * needed). Usage:
 *   npm run test-print -- 192.168.1.50 9100 80 star-line
 * or configure host/port/protocol in .env (VIZIO_TEST_HOST /
 * VIZIO_TEST_PORT / VIZIO_PROTOCOL). Protocol defaults to VIZIO_PROTOCOL,
 * then 'escpos'. Use 'star-line' for Star mC-Print models (MCP20/30/31) —
 * they have no ESC/POS emulation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printRaw } from './printer.js';
import { renderTestTicket } from './ticket.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
}

const host = process.argv[2] ?? process.env.VIZIO_TEST_HOST;
const port = Number(process.argv[3] ?? process.env.VIZIO_TEST_PORT ?? 9100);
const width = Number(process.argv[4] ?? 80);
const protocol = process.argv[5] ?? process.env.VIZIO_PROTOCOL ?? 'escpos';

if (!host) {
  console.error('Usage: npm run test-print -- <printer-ip> [port=9100] [width=80|48|32] [protocol=escpos|star-line]');
  process.exit(1);
}

console.log(`Sending ${protocol} test ticket to ${host}:${port} (${width}mm)…`);
try {
  await printRaw(host, port, renderTestTicket(protocol, `Agent @ ${host}`, width));
  console.log('Test ticket sent. Check the printer.');
} catch (error) {
  console.error(`Could not print: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
