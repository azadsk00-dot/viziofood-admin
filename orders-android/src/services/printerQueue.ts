// PrinterQueue — the reliable local receipt queue.
//
//   * Serialized: one job prints at a time. Order A completes, then Order B —
//     printer commands can never corrupt or overlap.
//   * Durable: jobs persist in AsyncStorage. A printer/network outage never
//     loses a receipt — failed jobs stay until a human retries or clears.
//   * Retry: exponential backoff 5s→10s→20s→40s→60s (cap), 5 attempts, then
//     FAILED with a clear error and a print-errors notification.
//   * Exactly-once auto print: keyed by order id — the same order can never
//     queue two auto receipts. Manual REPRINT requeues explicitly.
//
// The queue never throws: every failure becomes job state.

import type { Order, PrintJob } from '../types';
import { usePrintQueueStore } from '../state/printQueueStore';
import { getPrinterSettings } from '../state/settingsStore';
import { printReceipt, snapshotForReceipt } from '../printer/printerService';
import { notifyPrintFailure } from './notificationService';

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

const store = () => usePrintQueueStore.getState();

function backoffFor(attempt: number): number {
  // attempt 1 → 5s, 2 → 10s, … capped at 60s.
  const index = Math.min(Math.max(attempt - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[index] ?? 60_000;
}

class PrinterQueue {
  private pumping = false;
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

  /** Called once after sign-in. Recovers jobs stranded by a restart. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.recoverStrandedJobs();
    void this.pump();
  }

  /**
   * A job left "printing" by a crashed/killed app cannot have printed
   * reliably-unknown output — the safe assumption for receipts is to print
   * again (a duplicate receipt is recoverable; a lost one is not). Requeue
   * it and let due retries run.
   */
  private recoverStrandedJobs(): void {
    const jobs = store().jobs;
    const now = Date.now();
    for (const job of Object.values(jobs)) {
      if (job.state === 'printing') {
        store().upsertJob({ ...job, state: 'queued' });
      } else if (
        job.state === 'retrying' &&
        job.nextAttemptAt &&
        Date.parse(job.nextAttemptAt) <= now
      ) {
        store().upsertJob({ ...job, state: 'queued', nextAttemptAt: null });
      }
    }
  }

  /** Enqueue the automatic receipt for a new paid order — exactly once. */
  enqueueAuto(order: Order): void {
    const existing = store().jobs[order.id];
    if (existing && existing.state !== 'failed') return; // never duplicate
    this.insertJob(order, existing ? 'retry' : 'auto');
  }

  /** Manual (RE)PRINT — explicit user action always requeues. */
  enqueueReprint(order: Order): void {
    this.insertJob(order, 'reprint');
  }

  private insertJob(order: Order, origin: PrintJob['origin']): void {
    // Only reached when no live job exists (or the previous one FAILED), so
    // the attempt counter always starts fresh.
    const previous = store().jobs[order.id];
    const job: PrintJob = {
      id: order.id,
      orderNumber: order.orderNumber,
      state: 'queued',
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      lastError: null,
      nextAttemptAt: null,
      origin,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      printedAt: null,
      receipt: snapshotForReceipt(order),
    };
    store().upsertJob(job);
    void this.pump();
  }

  /** Retry a FAILED job from the Printer screen. */
  retryJob(jobId: string): void {
    const job = store().jobs[jobId];
    if (!job) return;
    store().upsertJob({
      ...job,
      state: 'queued',
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      origin: 'retry',
    });
    void this.pump();
  }

  /** Retry ALL failed jobs at once. */
  retryAllFailed(): void {
    const jobs = store().jobs;
    for (const job of Object.values(jobs)) {
      if (job.state === 'failed') this.retryJob(job.id);
    }
  }

  /** Clear completed (printed) jobs from the list. */
  clearCompleted(): void {
    const jobs = store().jobs;
    const done = Object.values(jobs)
      .filter((job) => job.state === 'printed')
      .map((job) => job.id);
    store().removeJobs(done);
  }

  /** Foreground wake: due retries requeue; the pump restarts. */
  onWake(): void {
    this.recoverStrandedJobs();
    void this.pump();
  }

  /** Serialized processing loop. */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    store().setProcessing(true);
    try {
      for (;;) {
        const settings = getPrinterSettings();
        const next = Object.values(store().jobs)
          .filter((job) => job.state === 'queued')
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
        if (!next) break;

        store().upsertJob({ ...next, state: 'printing', nextAttemptAt: null });
        // printReceipt resolves { ok, error } and never throws — the guard is
        // defence in depth: an unexpected throw must become job state, not
        // kill the pump loop.
        const result = await printReceipt(settings, next.receipt).catch((reason: unknown) => ({
          ok: false,
          error: reason instanceof Error ? reason.message : String(reason),
        }));

        // Re-read: a manual retry/reprint may have replaced the job meanwhile.
        const current = store().jobs[next.id];
        if (!current || current.state !== 'printing') continue;

        if (result.ok) {
          store().setPrinterStatus('reachable');
          store().upsertJob({
            ...current,
            state: 'printed',
            printedAt: new Date().toISOString(),
            lastError: null,
            nextAttemptAt: null,
          });
          continue;
        }

        const attempts = current.attempts + 1;
        store().setPrinterStatus('unreachable', result.error ?? null);
        if (attempts < current.maxAttempts) {
          const dueAt = new Date(Date.now() + backoffFor(attempts)).toISOString();
          store().upsertJob({
            ...current,
            state: 'retrying',
            attempts,
            lastError: result.error ?? 'Print failed',
            nextAttemptAt: dueAt,
          });
          this.scheduleRetry(current.id, Date.parse(dueAt) - Date.now());
        } else {
          store().upsertJob({
            ...current,
            state: 'failed',
            attempts,
            lastError: result.error ?? 'Print failed',
            nextAttemptAt: null,
          });
          void notifyPrintFailure(current.orderNumber, current.id);
        }
      }
    } finally {
      this.pumping = false;
      store().setProcessing(false);
    }
  }

  private scheduleRetry(jobId: string, delayMs: number): void {
    const existing = this.retryTimers.get(jobId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.retryTimers.delete(jobId);
      const job = store().jobs[jobId];
      if (!job || job.state !== 'retrying') return;
      store().upsertJob({ ...job, state: 'queued', nextAttemptAt: null });
      void this.pump();
    }, Math.max(0, delayMs));
    this.retryTimers.set(jobId, timer);
  }
}

export const printerQueue = new PrinterQueue();
