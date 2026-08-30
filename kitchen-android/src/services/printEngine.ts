// Print engine — the tablet prints paid orders DIRECTLY to the LAN printer
// (Star Line over TCP). This replaces the old restaurant-PC printer agent:
// print_jobs still live in Supabase (created by the payment webhook), and
// this engine claims and prints them from the tablet, so a job is never lost
// when the tablet restarts — it stays QUEUED in Postgres until printed.
//
// Guarantees (same as the agent it replaces):
//   - No double prints: claiming flips QUEUED→PRINTING guarded by
//     status='QUEUED' — a race can never print one job twice.
//   - No lost tickets: offline printers move jobs to RETRYING with
//     exponential backoff (5s→60s, max_attempts from the job row); the jobs
//     live in Postgres, so an app restart requeues and prints them.
//   - A job is only marked PRINTED after the TCP write+flush succeeds.
//
// The Android foreground service (modules/print-service) keeps this engine
// alive when the screen is off or the app is minimized.

import { supabase } from '../lib/supabase';
import type { Printer, PrintJob } from '../lib/types';
import { renderKitchenTicket } from '../lib/starline';
import { retryDelayMs, toTicketPayload, type EngineJobRow } from '../lib/printLogic';
import { printRaw } from './printerTcp';
import { usePrintStore } from '../state/printStore';
import { useOrdersStore } from '../state/ordersStore';
import type { KitchenOrder } from '../lib/types';
import { recordIncident } from './incidents';
import { rowToPrintJob, rowToPrinter } from './mappers';
import { getDeviceId } from '../lib/device';

const SWEEP_INTERVAL_MS = 15_000;
const PRINT_TIMEOUT_MS = 10_000;
const RESTAURANT_NAME = 'VIZIO FOOD';

class PrintEngine {
  private running = false;
  private unsubscribeStore: (() => void) | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = new Set<string>();
  private retryQueue = new Map<string, { attemptAt: number; attempt: number }>();
  private unsubscribeOrders: (() => void) | null = null;
  /** Order ids this run has already checked for print-job existence. */
  private ensuredOrders = new Set<string>();

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Keep the process alive (screen off / minimized) while printing.
    try {
      const { startPrintService } = await import('../../modules/print-service');
      startPrintService();
    } catch (error) {
      console.warn('[print-engine] foreground service unavailable:', error instanceof Error ? error.message : error);
    }

    // Jobs left RETRYING by a previous run: local retry state died with the
    // process, so requeue anything still under its attempt budget. Jobs stuck
    // in PRINTING (the app died mid-print) are requeued too — this tablet is
    // the single printing authority, so nobody else is printing them.
    await this.requeueInterruptedJobs();

    // React instantly when a job arrives (realtime lands in the print store).
    this.unsubscribeStore = usePrintStore.subscribe((state) => {
      for (const job of Object.values(state.jobs)) {
        if (job.status === 'QUEUED') this.processJob(job.id);
      }
    });

    // Bridge: a valid NEW order MUST lead to printing. Server-side job
    // creation covers card orders (Stripe webhook) and, once the
    // print_jobs_on_new_order migration is applied, every order. Until then
    // the tablet enqueues the job itself when it sees a NEW order, and falls
    // back to printing directly when RLS blocks the insert (kitchen role).
    // Idempotent: existing (printer, order) jobs are always respected.
    this.unsubscribeOrders = useOrdersStore.subscribe((state) => {
      for (const order of Object.values(state.orders)) {
        if (order.status === 'New') void this.ensureJobForOrder(order);
      }
    });
    for (const order of Object.values(useOrdersStore.getState().orders)) {
      if (order.status === 'New') void this.ensureJobForOrder(order);
    }

    // Sweep: catches jobs missed by realtime + drains the retry queue.
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    await this.sweep();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeOrders?.();
    this.unsubscribeOrders = null;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    this.inFlight.clear();
    this.retryQueue.clear();
    try {
      void import('../../modules/print-service').then(({ stopPrintService }) => stopPrintService());
    } catch {
      // module unavailable — nothing to stop
    }
  }

  /** Pick up every QUEUED job for our printers + retry due jobs. */
  private async sweep(): Promise<void> {
    if (!this.running) return;
    const { data, error } = await supabase
      .from('print_jobs')
      .select('id,order_id,order_number,printer_id,status,attempts,max_attempts')
      .eq('status', 'QUEUED')
      .order('created_at')
      .limit(20);
    if (error) {
      console.warn('[print-engine] sweep failed:', error.message);
      return;
    }
    for (const row of (data ?? []) as unknown as EngineJobRow[]) {
      this.processJob(row.id);
    }

    const now = Date.now();
    for (const [jobId, entry] of this.retryQueue) {
      if (entry.attemptAt > now) continue;
      this.retryQueue.delete(jobId);
      const { error: requeueError } = await supabase
        .from('print_jobs')
        .update({ status: 'QUEUED' })
        .eq('id', jobId);
      if (requeueError) console.warn(`[print-engine] retry requeue failed for ${jobId}:`, requeueError.message);
      else this.processJob(jobId);
    }
  }

  private async requeueInterruptedJobs(): Promise<void> {
    const { data, error } = await supabase
      .from('print_jobs')
      .update({ status: 'QUEUED' })
      .or('status.eq.RETRYING,and(status.eq.PRINTING,attempts.lt.5)')
      .select('id');
    if (error) console.warn('[print-engine] requeue failed:', error.message);
    else if (data && data.length) {
      console.log(`[print-engine] requeued ${data.length} interrupted job(s)`);
    }
  }

  /** Flip QUEUED→PRINTING; returns null when another claimer won the race. */
  private async claim(jobId: string): Promise<EngineJobRow | null> {
    const { data, error } = await supabase
      .from('print_jobs')
      .update({ status: 'PRINTING' })
      .eq('id', jobId)
      .eq('status', 'QUEUED') // race guard
      .select('id,order_id,order_number,printer_id,status,attempts,max_attempts')
      .maybeSingle();
    if (error) {
      console.warn(`[print-engine] claim failed for ${jobId}:`, error.message);
      return null;
    }
    if (data) usePrintStore.getState().upsertJobs([rowToPrintJob(data)]);
    return (data as unknown as EngineJobRow) ?? null;
  }

  private async markPrinted(jobId: string): Promise<void> {
    const { data } = await supabase
      .from('print_jobs')
      .update({ status: 'PRINTED', printed_at: new Date().toISOString(), last_error: '' })
      .eq('id', jobId)
      .select('id,order_id,order_number,printer_id,status,attempts,max_attempts,last_error,created_at,printed_at')
      .maybeSingle();
    if (data) usePrintStore.getState().upsertJobs([rowToPrintJob(data)]);
  }

  private async markRetry(job: EngineJobRow, attempt: number, message: string): Promise<void> {
    const canRetry = attempt < (job.max_attempts ?? 5);
    const { data } = await supabase
      .from('print_jobs')
      .update({
        status: canRetry ? 'RETRYING' : 'FAILED',
        attempts: attempt,
        last_error: message.slice(0, 300),
      })
      .eq('id', job.id)
      .select('id,order_id,order_number,printer_id,status,attempts,max_attempts,last_error,created_at,printed_at')
      .maybeSingle();
    if (data) usePrintStore.getState().upsertJobs([rowToPrintJob(data)]);

    if (canRetry) {
      this.retryQueue.set(job.id, { attemptAt: Date.now() + retryDelayMs(attempt), attempt });
      console.warn(`[print-engine] job ${job.id} retry #${attempt} in ${Math.round(retryDelayMs(attempt) / 1000)}s — ${message}`);
    } else {
      console.error(`[print-engine] job ${job.id} FAILED after ${attempt} attempts — ${message}`);
    }
  }

  private async printerFor(printerId: string): Promise<Printer | null> {
    const fromStore = usePrintStore.getState().printers[printerId];
    if (fromStore) return fromStore;
    const { data, error } = await supabase
      .from('printers')
      .select('id,name,station,host,port,paper_width,enabled,auto_print,copies')
      .eq('id', printerId)
      .maybeSingle();
    if (error || !data) return null;
    return rowToPrinter(data);
  }

  /** Claim + print one job (deduped; safe to call repeatedly). */
  private processJob(jobId: string): void {
    if (!this.running || this.inFlight.has(jobId)) return;
    this.inFlight.add(jobId);
    void (async () => {
      try {
        const job = await this.claim(jobId);
        if (!job) return; // someone else took it / already handled

        const printer = await this.printerFor(job.printer_id);
        if (!printer || !printer.enabled) {
          await this.markRetry(job, (job.attempts ?? 0) + 1, `printer ${job.printer_id} is not available on this tablet`);
          return;
        }

        const loaded = await this.loadOrder(job.order_id);
        if (!loaded) {
          await this.markRetry(job, (job.attempts ?? 0) + 1, 'order data unavailable');
          return;
        }

        const { order, items } = toTicketPayload(loaded.order, loaded.items);
        const ticket = renderKitchenTicket(order, items, {
          restaurantName: RESTAURANT_NAME,
          paperWidth: printer.paperWidth ?? 80,
        });

        const attempt = (job.attempts ?? 0) + 1;
        try {
          const copies = printer.copies ?? 1;
          for (let copy = 0; copy < copies; copy += 1) {
            await printRaw(printer.host, printer.port, ticket, { timeoutMs: PRINT_TIMEOUT_MS });
          }
          await this.markPrinted(job.id);
          console.log(`[print-engine] printed ${job.order_number} on ${printer.name}`);
          void usePrintStore.getState().setProbe(printer.id, true);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          void usePrintStore.getState().setProbe(printer.id, false);
          await this.markRetry(job, attempt, message);
          void recordIncident({
            kind: 'print_retry',
            severity: 'warning',
            orderId: job.order_id,
            message: `Print retry for ${job.order_number}: ${message}`,
            details: { jobId: job.id, attempt, deviceId: await getDeviceId().catch(() => '') },
          });
        }
      } catch (error) {
        console.error('[print-engine] job processing error:', error instanceof Error ? error.message : error);
      } finally {
        this.inFlight.delete(jobId);
      }
    })();
  }

  /**
   * Guarantee a print job exists for a valid NEW order. Server-side creation
   * covers card (webhook) and — after the trigger migration — every order.
   * When neither ran (e.g. a CASH order on an unmigrated database), the
   * tablet enqueues the job; if RLS blocks the insert (kitchen role), it
   * prints directly through the exact same render+TCP path as TEST PRINT.
   */
  private async ensureJobForOrder(order: KitchenOrder): Promise<void> {
    if (!this.running || order.status !== 'New' || this.ensuredOrders.has(order.id)) return;
    this.ensuredOrders.add(order.id);
    try {
      const printers = Object.values(usePrintStore.getState().printers).filter((p) => p.enabled && p.autoPrint);
      if (!printers.length) return;

      // Any non-failed job for this order already? (webhook / trigger / prior run)
      const { data: existing, error: existingError } = await supabase
        .from('print_jobs')
        .select('id,printer_id')
        .eq('order_id', order.id)
        .neq('status', 'FAILED')
        .limit(1);
      if (existingError) {
        console.warn('[print-engine] job-existence check failed:', existingError.message);
        return;
      }
      if (existing && existing.length) return; // job pipeline already owns it

      const rows = printers.map((printer) => ({
        order_id: order.id,
        order_number: order.orderNumber,
        printer_id: printer.id,
        status: 'QUEUED',
        attempts: 0,
        max_attempts: 5,
      }));
      const { error: insertError } = await supabase.from('print_jobs').insert(rows);
      if (!insertError) {
        // The realtime channel + sweep pick the new QUEUED rows up instantly.
        console.log('[print-engine] enqueued print job(s) for NEW order ' + order.orderNumber);
        void this.sweep();
        return;
      }
      if (insertError.code === '23505') return; // concurrent insert — fine
      if (/42501|permission|row-level/i.test(insertError.message)) {
        console.warn('[print-engine] print_jobs insert blocked by RLS — direct-print fallback for ' + order.orderNumber);
        await this.directPrint(order, printers);
        return;
      }
      console.warn('[print-engine] enqueue failed:', insertError.message);
    } catch (error) {
      console.warn('[print-engine] ensureJobForOrder error:', error instanceof Error ? error.message : error);
    }
  }

  /** Fallback print without a job row (RLS-blocked insert): same render + TCP path, one attempt per run, audited. */
  private async directPrint(order: KitchenOrder, printers: Printer[]): Promise<void> {
    const loaded = await this.loadOrder(order.id);
    if (!loaded) {
      void recordIncident({ kind: 'other', severity: 'warning', orderId: order.id, message: 'Direct print for ' + order.orderNumber + ' failed: order data unavailable' });
      return;
    }
    const payload = toTicketPayload(loaded.order, loaded.items);
    const ticket = renderKitchenTicket(payload.order, payload.items, { restaurantName: RESTAURANT_NAME, paperWidth: printers[0]?.paperWidth ?? 80 });
    for (const printer of printers) {
      try {
        const copies = printer.copies ?? 1;
        for (let copy = 0; copy < copies; copy += 1) {
          await printRaw(printer.host, printer.port, ticket, { timeoutMs: PRINT_TIMEOUT_MS });
        }
        void usePrintStore.getState().setProbe(printer.id, true);
        void recordIncident({ kind: 'other', severity: 'info', orderId: order.id, message: 'Direct-printed ' + order.orderNumber + ' on ' + printer.name + ' (no print_jobs row — apply 20260823130000 for full durability)' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void usePrintStore.getState().setProbe(printer.id, false);
        void recordIncident({ kind: 'printer_failure', severity: 'critical', orderId: order.id, message: 'Direct print for ' + order.orderNumber + ' failed: ' + message });
      }
    }
  }

  /** Load the full order for ticket rendering (kitchen RLS allows reads). */
  private async loadOrder(orderId: string): Promise<{ order: Record<string, unknown>; items: Array<Record<string, unknown>> } | null> {
    const { data: order, error } = await supabase
      .from('orders')
      .select('id,order_number,status,payment_status,fulfilment_method,total,customer_name,delivery_address,delivery_suburb,delivery_postcode,special_instructions,created_at')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !order) return null;
    const { data: items, error: itemError } = await supabase
      .from('order_items')
      .select('id,product_name,quantity,modifiers,special_instructions')
      .eq('order_id', orderId)
      .order('created_at');
    if (itemError) console.warn('[print-engine] items load failed:', itemError.message);
    return { order: order as Record<string, unknown>, items: (items ?? []) as unknown as Array<Record<string, unknown>> };
  }
}

export const printEngine = new PrintEngine();
