// Print queue store — the persistent local receipt queue.
//
// Jobs are keyed by ORDER id: one auto receipt per order, ever. Failed jobs
// persist (a printer/network outage must never lose a receipt) until a human
// retries or clears them. The queue engine (services/printerQueue.ts) owns
// transitions; this store only holds state.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PrintJob } from '../types';

/** Live printer reachability, refreshed by every job attempt / test. */
export type PrinterStatus = 'unknown' | 'reachable' | 'unreachable';

interface PrintQueueState {
  jobs: Record<string, PrintJob>;
  printerStatus: PrinterStatus;
  lastPrinterError: string | null;
  /** True while the queue engine is between jobs (drives the UI). */
  processing: boolean;

  upsertJob: (job: PrintJob) => void;
  removeJob: (id: string) => void;
  removeJobs: (ids: string[]) => void;
  setPrinterStatus: (status: PrinterStatus, error?: string | null) => void;
  setProcessing: (processing: boolean) => void;
}

export const usePrintQueueStore = create<PrintQueueState>()(
  persist(
    (set) => ({
      jobs: {},
      printerStatus: 'unknown',
      lastPrinterError: null,
      processing: false,

      upsertJob: (job) => set((state) => ({ jobs: { ...state.jobs, [job.id]: job } })),
      removeJob: (id) =>
        set((state) => {
          const next = { ...state.jobs };
          delete next[id];
          return { jobs: next };
        }),
      removeJobs: (ids) =>
        set((state) => {
          const next = { ...state.jobs };
          for (const id of ids) delete next[id];
          return { jobs: next };
        }),
      setPrinterStatus: (status, error = null) =>
        set({ printerStatus: status, lastPrinterError: error }),
      setProcessing: (processing) => set({ processing }),
    }),
    {
      name: 'vizio.orders.print-queue',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ jobs: state.jobs }),
    },
  ),
);
