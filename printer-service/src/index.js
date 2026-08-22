/**
 * Entry point — reads config from the environment (or printer-service/.env)
 * and runs the agent. Windows: run via Task Scheduler / NSSM at startup.
 * Linux/macOS: systemd unit in README.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrintAgent } from './agent.js';
import { startHttpServer } from './http.js';

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

let httpServer = null;
const startAgent = async () => {
  await agent.start();

  // Optional LAN HTTP endpoint for the kitchen tablets (health/test-print).
  // Disabled unless VIZIO_AGENT_HTTP_PORT is set — existing setups unaffected.
  const httpPort = Number(process.env.VIZIO_AGENT_HTTP_PORT || 0);
  if (httpPort > 0) {
    httpServer = await startHttpServer(agent, {
      port: httpPort,
      token: process.env.VIZIO_AGENT_HTTP_TOKEN || undefined,
    });
  }
};

const shutdown = async (signal) => {
  console.log(`[vizio-print:info] ${signal} — shutting down`);
  if (httpServer) httpServer.close();
  await agent.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

startAgent().catch((error) => {
  console.error('[vizio-print:error]', error instanceof Error ? error.message : error);
  process.exit(1);
});
