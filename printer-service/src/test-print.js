/**
 * Test print — sends a test ticket straight to a printer (no Supabase
 * needed). Usage:
 *   npm run test-print -- 192.168.1.50 9100 48
 * or configure host/port in .env (VIZIO_TEST_HOST / VIZIO_TEST_PORT).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printRaw } from './printer.js';
import { renderTestTicket } from './escpos.js';

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
const width = Number(process.argv[4] ?? 48);

if (!host) {
  console.error('Usage: npm run test-print -- <printer-ip> [port=9100] [width=48|80|32]');
  process.exit(1);
}

console.log(`Sending test ticket to ${host}:${port} (${width}mm)…`);
try {
  await printRaw(host, port, renderTestTicket(`Agent @ ${host}`, width));
  console.log('Test ticket sent. Check the printer.');
} catch (error) {
  console.error(`Could not print: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
