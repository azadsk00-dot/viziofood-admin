/**
 * Entry point — reads config from the environment (or printer-service/.env)
 * and runs the agent. Windows: run via Task Scheduler / NSSM at startup.
 * Linux/macOS: systemd unit in README.
 *
 * Startup order: the LAN HTTP endpoint (VIZIO_AGENT_HTTP_PORT) starts FIRST
 * and independently of Supabase — the kitchen tablet's status/test-print keep
 * working while sign-in retries (bad credentials, Supabase outage, or the
 * account not being created yet). If VIZIO_EMAIL/VIZIO_PASSWORD are missing
 * the agent runs in HTTP-only mode (health + test-print; no job polling).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrintAgent } from './agent.js';
import { startHttpServer } from './http.js';
import { resolveProtocol } from './ticket.js';

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

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`[vizio-print:error] missing configuration: ${missing.join(', ')} — copy .env.example to .env and fill it in.`);
  process.exit(1);
}

// Printer command protocol: 'escpos' (default) or 'star-line' for
// StarPRNT-only printers (Star mC-Print3 / MCP30 …).
const protocol = process.env.VIZIO_PROTOCOL || 'escpos';
try {
  resolveProtocol(protocol);
} catch (error) {
  console.error(`[vizio-print:error] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const agent = new PrintAgent({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  email: process.env.VIZIO_EMAIL,
  password: process.env.VIZIO_PASSWORD,
  station: process.env.VIZIO_STATION || undefined,
  restaurantName: process.env.VIZIO_RESTAURANT_NAME || 'VIZIO FOOD',
  protocol,
});

let httpServer = null;

const shutdown = async (signal) => {
  console.log(`[vizio-print:info] ${signal} — shutting down`);
  if (httpServer) httpServer.close();
  await agent.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// 1. LAN HTTP endpoint first — tablet status/test-print must not depend on
//    Supabase sign-in succeeding.
const httpPort = Number(process.env.VIZIO_AGENT_HTTP_PORT || 0);
if (httpPort > 0) {
  httpServer = await startHttpServer(agent, {
    port: httpPort,
    token: process.env.VIZIO_AGENT_HTTP_TOKEN || undefined,
    protocol,
  });
}

// 2. Job polling: needs the staff/kitchen account. Retry forever — a
//    temporary Supabase outage or wrong password must not take the agent
//    (and its HTTP endpoint) down.
const SIGNIN_RETRY_MS = 30_000;

const startPolling = async () => {
  if (!process.env.VIZIO_EMAIL || !process.env.VIZIO_PASSWORD) {
    console.warn(
      '[vizio-print:warn] VIZIO_EMAIL/VIZIO_PASSWORD not set — HTTP-only mode: health and test-print work, but paid-order jobs are NOT polled. Create the kitchen account and restart.',
    );
    return;
  }
  for (;;) {
    try {
      await agent.start();
      return; // started; internal loops take over
    } catch (error) {
      console.error(`[vizio-print:error] agent start failed: ${error instanceof Error ? error.message : error}`);
      console.error(`[vizio-print:info] retrying sign-in in ${SIGNIN_RETRY_MS / 1000}s…`);
      await new Promise((resolve) => setTimeout(resolve, SIGNIN_RETRY_MS));
    }
  }
};

void startPolling();
