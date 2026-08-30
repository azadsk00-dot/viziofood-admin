// Derived print-job views — pure helpers so screens can select the STABLE
// jobs map from the store and derive per-order lists with useMemo. Deriving
// inside the zustand selector itself returns a fresh array per snapshot and
// caused the OrderDetailScreen "Maximum update depth exceeded" crash.

import type { PrintJob } from './types';

/** Jobs for one order, derived from the stable `jobs` map. */
export function jobsForOrder(jobs: Record<string, PrintJob>, orderId: string): PrintJob[] {
  return Object.values(jobs).filter((job) => job.orderId === orderId);
}

/**
 * Reference-stable accessor for React: returns the SAME array for the SAME
 * jobs map (so useMemo/useSyncExternalStore never see a spurious change),
 * and a fresh array only when the map itself changed.
 */
export function createJobsForOrderSelector(): (jobs: Record<string, PrintJob>, orderId: string) => PrintJob[] {
  let lastJobs: Record<string, PrintJob> | null = null;
  let lastOrderId = '';
  let lastResult: PrintJob[] = [];
  return (jobs, orderId) => {
    if (jobs !== lastJobs || orderId !== lastOrderId) {
      lastJobs = jobs;
      lastOrderId = orderId;
      lastResult = jobsForOrder(jobs, orderId);
    }
    return lastResult;
  };
}
