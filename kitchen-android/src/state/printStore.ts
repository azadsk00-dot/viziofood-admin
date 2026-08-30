// Print state — printers, print jobs and reachability probes for the LAN
// printers. print_jobs is realtime (migration 20260826120000) so queue depth
// and failures update live; printer "online" comes from direct TCP probes
// (this tablet prints itself — there is no separate printer agent).

import { create } from 'zustand';
import type { PrintJob, PrintJobStatus, Printer } from '../lib/types';

export type PrinterHealth = 'unknown' | 'online' | 'offline' | 'error' | 'printing';

export interface PrinterProbe {
  online: boolean;
  checkedAt: string;
}

export interface PrinterWithStatus extends Printer {
  health: PrinterHealth;
  lastPrintedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  queueCount: number;
  retryingCount: number;
  failedCount: number;
}

interface PrintState {
  printers: Record<string, PrinterWithStatus>;
  jobs: Record<string, PrintJob>;
  probes: Record<string, PrinterProbe>;
  lastPrintAt: string | null;
  setPrinters: (printers: Printer[]) => void;
  upsertJobs: (jobs: PrintJob[]) => void;
  setProbe: (printerId: string, online: boolean) => void;
  recompute: () => void;
  clearAll: () => void;
}

export const usePrintStore = create<PrintState>((set, get) => ({
  printers: {},
  jobs: {},
  probes: {},
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

  setProbe: (printerId, online) => {
    set({
      probes: { ...get().probes, [printerId]: { online, checkedAt: new Date().toISOString() } },
    });
    get().recompute();
  },

  recompute: () => {
    const { printers, jobs, probes } = get();
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
      const probe = probes[printer.id];

      let health: PrinterHealth = printer.health;
      if (printing) health = 'printing';
      else if (probe) health = probe.online ? 'online' : 'offline';
      else if (failed.some((j) => Date.now() - Date.parse(j.createdAt) < 15 * 60_000)) health = 'error';
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

  clearAll: () => set({ printers: {}, jobs: {}, probes: {}, lastPrintAt: null }),
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
