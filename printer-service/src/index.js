/**
 * Entry point — reads config from the environment (or printer-service/.env)
 * and runs the agent. Windows: run via Task Scheduler / NSSM at startup.
 * Linux/macOS: systemd unit in README.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrintAgent } from './agent.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VIZIO_EMAIL', 'VIZIO_PASSWORD'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`[vizio-print:error] missing configuration: ${missing.join(', ')} — copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const agent = new PrintAgent({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  email: process.env.VIZIO_EMAIL,
  password: process.env.VIZIO_PASSWORD,
  station: process.env.VIZIO_STATION || undefined,
  restaurantName: process.env.VIZIO_RESTAURANT_NAME || 'VIZIO FOOD',
});

const shutdown = async (signal) => {
  console.log(`[vizio-print:info] ${signal} — shutting down`);
  await agent.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

agent.start().catch((error) => {
  console.error('[vizio-print:error]', error instanceof Error ? error.message : error);
  process.exit(1);
});
