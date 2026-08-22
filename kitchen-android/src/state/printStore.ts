// Print state — printers, print jobs and the LAN agent health probe.
// print_jobs is realtime (migration 20260826120000) so queue depth and
// failures update live; printer "online" is derived from the agent probe
// when configured, otherwise from recent job outcomes.

import { create } from 'zustand';
import type { PrintJob, PrintJobStatus, Printer } from '../lib/types';

export type PrinterHealth = 'unknown' | 'online' | 'offline' | 'error' | 'printing';

export interface PrinterWithStatus extends Printer {
  health: PrinterHealth;
  lastPrintedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  queueCount: number;
  retryingCount: number;
  failedCount: number;
}

export interface AgentHealth {
  online: boolean;
  checkedAt: string | null;
  printers: Array<{ id: string; name: string; host: string; port: number; station: string }>;
  retryQueue: number;
}

interface PrintState {
  printers: Record<string, PrinterWithStatus>;
  jobs: Record<string, PrintJob>;
  agent: AgentHealth;
  lastPrintAt: string | null;
  setPrinters: (printers: Printer[]) => void;
  upsertJobs: (jobs: PrintJob[]) => void;
  setAgentHealth: (health: Partial<AgentHealth> | null) => void;
  recompute: () => void;
  clearAll: () => void;
}

export const usePrintStore = create<PrintState>((set, get) => ({
  printers: {},
  jobs: {},
  agent: { online: false, checkedAt: null, printers: [], retryQueue: 0 },
  lastPrintAt: null,

  setPrinters: (printers) => {
    const next: Record<string, PrinterWithStatus> = {};
    for (const printer of printers) {
      const existing = get().printers[printer.id];
      next[printer.id] = { ...printer, health: existing?.health ?? 'unknown', lastPrintedAt: null, lastError: null, lastErrorAt: null, queueCount: 0, retryingCount: 0, failedCount: 0 };
    }
    set({ printers: next });
    get().recompute();
  },

  upsertJobs: (incoming) => {
    const jobs = { ...get().jobs };
    for (const job of incoming) jobs[job.id] = job;
    set({ jobs });
    get().recompute();
  },

  setAgentHealth: (health) => {
    const current = get().agent;
    set({
      agent: {
        online: health?.online ?? current.online,
        checkedAt: new Date().toISOString(),
        printers: health?.printers ?? current.printers,
        retryQueue: health?.retryQueue ?? current.retryQueue,
      },
    });
    get().recompute();
  },

  recompute: () => {
    const { printers, jobs, agent } = get();
    const jobList = Object.values(jobs);

    let lastPrintAt: string | null = get().lastPrintAt;
    const nextPrinters: Record<string, PrinterWithStatus> = {};
    for (const printer of Object.values(printers)) {
      const printerJobs = jobList.filter((j) => j.printerId === printer.id);
      const printing = printerJobs.some((j) => j.status === 'PRINTING');
      const queued = printerJobs.filter((j) => j.status === 'QUEUED').length;
      const retrying = printerJobs.filter((j) => j.status === 'RETRYING').length;
      const failed = printerJobs.filter((j) => j.status === 'FAILED');
      const printed = printerJobs.filter((j) => j.printedAt).sort((a, b) => Date.parse(b.printedAt!) - Date.parse(a.printedAt!));

      let health: PrinterHealth = printer.health;
      if (printing) health = 'printing';
      else if (agent.online) {
        const known = agent.printers.some((p) => p.id === printer.id);
        health = known ? 'online' : 'offline';
      } else if (failed.some((j) => Date.now() - Date.parse(j.createdAt) < 15 * 60_000)) health = 'error';
      else if (printed.length > 0) health = 'online';
      else health = 'unknown';

      if (printed[0]?.printedAt) {
        const t = Date.parse(printed[0].printedAt);
        if (!lastPrintAt || t > Date.parse(lastPrintAt)) lastPrintAt = printed[0].printedAt;
      }

      nextPrinters[printer.id] = {
        ...printer,
        health,
        lastPrintedAt: printed[0]?.printedAt ?? null,
        lastError: failed[0]?.lastError ?? null,
        lastErrorAt: failed[0]?.createdAt ?? null,
        queueCount: queued,
        retryingCount: retrying,
        failedCount: failed.length,
      };
    }
    set({ printers: nextPrinters, lastPrintAt });
  },

  clearAll: () => set({ printers: {}, jobs: {}, agent: { online: false, checkedAt: null, printers: [], retryQueue: 0 }, lastPrintAt: null }),
}));

// ─── Selectors ──────────────────────────────────────────────────────────────

export const printerQueueDepth = (): number =>
  Object.values(usePrintStore.getState().jobs).filter(
    (j) => j.status === 'QUEUED' || j.status === 'PRINTING' || j.status === 'RETRYING',
  ).length;

export const failedJobs = (): PrintJob[] =>
  Object.values(usePrintStore.getState().jobs).filter((j) => j.status === 'FAILED');

export const jobsForOrder = (orderId: string): PrintJob[] =>
  Object.values(usePrintStore.getState().jobs).filter((j) => j.orderId === orderId);

export const statusOf = (job: PrintJobStatus): string => job;
