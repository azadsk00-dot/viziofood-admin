// Printer agent client — talks to the LAN printer-service HTTP endpoint
// (printer-service/src/http.js, enabled with VIZIO_AGENT_HTTP_PORT).
// Health probes power "Printer: ONLINE/OFFLINE" on the tablet; test-print
// prints a real ESC/POS ticket from the restaurant's own network.

import { config } from '../lib/config';
import { getSettings } from '../state/settingsStore';
import { usePrintStore } from '../state/printStore';

function agentBase(): string {
  const settings = getSettings();
  return (settings.agentUrl || config.printerAgentUrl || '').replace(/\/+$/, '');
}

function headers(): Record<string, string> {
  const settings = getSettings();
  const token = settings.agentToken || config.printerAgentToken;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['x-vizio-token'] = token;
  return h;
}

export interface AgentHealthResult {
  online: boolean;
  printers?: Array<{ id: string; name: string; host: string; port: number; station: string }>;
  retryQueue?: number;
  error?: string;
}

export async function printerAgentHealth(updateStore = false): Promise<AgentHealthResult> {
  const base = agentBase();
  if (!base) {
    if (updateStore) usePrintStore.getState().setAgentHealth({ online: false });
    return { online: false, error: 'No printer agent URL configured' };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${base}/health`, { headers: headers(), signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`agent responded ${res.status}`);
    const body = (await res.json()) as {
      printers?: AgentHealthResult['printers'];
      localRetryQueue?: number;
    };
    if (updateStore) {
      usePrintStore.getState().setAgentHealth({
        online: true,
        printers: body.printers ?? [],
        retryQueue: body.localRetryQueue ?? 0,
      });
    }
    return { online: true, printers: body.printers, retryQueue: body.localRetryQueue };
  } catch (error) {
    if (updateStore) usePrintStore.getState().setAgentHealth({ online: false });
    return { online: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function agentTestPrint(printerId?: string): Promise<{ ok: boolean; error?: string }> {
  const base = agentBase();
  if (!base) return { ok: false, error: 'No printer agent URL configured (Settings → Printer agent).' };
  try {
    const res = await fetch(`${base}/test-print`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(printerId ? { printerId } : {}),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) return { ok: false, error: body.error ?? `agent responded ${res.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
