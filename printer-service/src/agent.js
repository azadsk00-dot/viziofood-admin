/**
 * Print agent — the bridge between Supabase and the local printers.
 *
 * Flow: subscribe to realtime INSERTs on print_jobs (+ a polling sweep for
 * resilience), claim a QUEUED job by flipping it to PRINTING, load the order
 * + items, render the ESC/POS ticket, print over raw TCP. Failures mark the
 * job RETRYING with backoff and keep it in a local queue — when the printer
 * comes back, everything prints. No job is ever dropped: after max_attempts
 * the job is marked FAILED for admin-side retry.
 *
 * Job claiming is race-safe: the claim update is guarded by status='QUEUED',
 * so two agents (or a poll racing realtime) can never both print a job.
 */

import { createClient } from '@supabase/supabase-js';
import { printRaw, probe } from './printer.js';
import { renderKitchenTicket } from './escpos.js';

const RETRY_BASE_MS = 5_000;   // first retry after 5s
const RETRY_MAX_MS = 60_000;   // cap backoff at 60s
const SWEEP_INTERVAL_MS = 15_000;
const PRINT_TIMEOUT_MS = 10_000;

const log = (level, message, data) => {
  const line = `[vizio-print:${level}] ${message}`;
  if (data === undefined) console.log(line);
  else console.log(line, typeof data === 'string' ? data : JSON.stringify(data));
};

export class PrintAgent {
  /**
   * @param {object} config
   * @param {string} config.supabaseUrl
   * @param {string} config.supabaseAnonKey
   * @param {string} config.email        staff/kitchen account email
   * @param {string} config.password     staff/kitchen account password
   * @param {string} [config.station]    restrict to one station ('kitchen')
   * @param {string} [config.restaurantName]
   */
  constructor(config) {
    this.config = config;
    this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
    /** @type {Map<string, {jobId: string, attemptAt: number, attempt: number}>} */
    this.localQueue = new Map();
    this.printers = [];
    this.stopped = false;
    this.timers = [];
  }

  async start() {
    log('info', 'signing in…');
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: this.config.email,
      password: this.config.password,
    });
    if (error) throw new Error(`Agent sign-in failed: ${error.message}`);
    const role = data.user?.user_metadata?.role;
    log('info', `signed in as ${this.config.email}`);
    if (role && !['admin', 'staff', 'kitchen'].includes(role)) {
      log('warn', `account role is "${role}" — the RLS policies require admin/staff/kitchen`);
    }

    // Keep the session fresh over long shifts.
    this.timers.push(setInterval(() => void this.supabase.auth.refreshSession(), 30 * 60_000));

    await this.loadPrinters();

    // Realtime: react instantly to new jobs.
    const channel = this.supabase
      .channel('print-jobs-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'print_jobs' },
        (payload) => {
          log('info', `realtime job ${payload.new?.id}`);
          void this.claimAndPrint(payload.new);
        },
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'print_jobs' }, (payload) => {
        // Admin "retry" resets a FAILED job to QUEUED — pick it up.
        if (payload.new?.status === 'QUEUED' && payload.old?.status !== 'QUEUED') {
          void this.claimAndPrint(payload.new);
        }
      })
      .subscribe();
    this.channel = channel;

    // Poll sweep: catches jobs created while offline + realtime hiccups.
    this.timers.push(setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS));

    // Retry loop for offline printers.
    this.timers.push(setInterval(() => void this.drainLocalQueue(), RETRY_BASE_MS));

    log('info', 'agent ready — waiting for paid orders');
    await this.sweep();
  }

  async stop() {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    if (this.channel) await this.supabase.removeChannel(this.channel);
  }

  async loadPrinters() {
    const { data, error } = await this.supabase
      .from('printers')
      .select('id,name,station,host,port,paper_width,enabled,auto_print,copies')
      .eq('enabled', true);
    if (error) {
      log('warn', 'could not load printers (table missing before migration?)', error.message);
      this.printers = [];
      return;
    }
    const station = this.config.station;
    this.printers = (data ?? []).filter((p) => !station || p.station === station);
    log('info', `loaded ${this.printers.length} enabled printer(s)`, this.printers.map((p) => `${p.name}@${p.host}:${p.port}`).join(', '));
  }

  /** Pick up every QUEUED job for our printers (poll sweep). */
  async sweep() {
    if (this.stopped) return;
    const { data, error } = await this.supabase
      .from('print_jobs')
      .select('id,order_id,order_number,printer_id,status,attempts,max_attempts')
      .eq('status', 'QUEUED')
      .order('created_at')
      .limit(20);
    if (error) {
      log('warn', 'sweep failed', error.message);
      return;
    }
    for (const job of data ?? []) {
      if (this.localQueue.has(job.id)) continue;
      await this.claimAndPrint(job);
    }
  }

  /** Flip QUEUED→PRINTING; returns false when another agent claimed it first. */
  async claim(jobId) {
    const { data, error } = await this.supabase
      .from('print_jobs')
      .update({ status: 'PRINTING' })
      .eq('id', jobId)
      .eq('status', 'QUEUED') // race guard
      .select('id,printer_id,order_id,order_number,attempts,max_attempts')
      .maybeSingle();
    if (error) {
      log('warn', `claim failed for ${jobId}`, error.message);
      return null;
    }
    return data ?? null;
  }

  async markPrinted(jobId) {
    await this.supabase
      .from('print_jobs')
      .update({ status: 'PRINTED', printed_at: new Date().toISOString(), last_error: '' })
      .eq('id', jobId);
  }

  async markRetry(job, attempt, message) {
    const canRetry = attempt < (job.max_attempts ?? 5);
    const backoff = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
    await this.supabase
      .from('print_jobs')
      .update({
        status: canRetry ? 'RETRYING' : 'FAILED',
        attempts: attempt,
        last_error: message.slice(0, 300),
      })
      .eq('id', job.id);
    if (canRetry) {
      this.localQueue.set(job.id, { jobId: job.id, attemptAt: Date.now() + backoff, attempt });
      log('warn', `job ${job.id} retry #${attempt} in ${Math.round(backoff / 1000)}s — ${message}`);
    } else {
      log('error', `job ${job.id} FAILED after ${attempt} attempts — ${message}`);
    }
  }

  /** Load the full order for ticket rendering. */
  async loadOrder(orderId) {
    const { data: order, error } = await this.supabase
      .from('orders')
      .select('id,order_number,status,fulfilment_method,customer_name,customer_phone,delivery_address,delivery_suburb,delivery_postcode,special_instructions,created_at')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !order) {
      log('warn', `could not load order ${orderId}`, error?.message ?? 'not found');
      return null;
    }
    const { data: items, error: itemError } = await this.supabase
      .from('order_items')
      .select('id,product_name,quantity,modifiers,special_instructions')
      .eq('order_id', orderId)
      .order('created_at');
    if (itemError) log('warn', `could not load items for ${orderId}`, itemError.message);
    return { order, items: items ?? [] };
  }

  async claimAndPrint(jobRow) {
    if (this.stopped) return;
    const claimed = await this.claim(jobRow.id);
    if (!claimed) return; // someone else took it
    await this.print(claimed);
  }

  async print(job) {
    const printer = this.printers.find((p) => p.id === job.printer_id);
    if (!printer) {
      // Not our station — leave QUEUED? No: a disabled/deleted printer's jobs
      // must not spin forever; mark failed with a clear reason.
      await this.markRetry(job, (job.attempts ?? 0) + 1, `printer ${job.printer_id} is not available on this agent`);
      return;
    }

    const loaded = await this.loadOrder(job.order_id);
    if (!loaded) {
      await this.markRetry(job, (job.attempts ?? 0) + 1, 'order data unavailable');
      return;
    }

    const { order, items } = loaded;
    const ticket = renderKitchenTicket(
      {
        orderNumber: order.order_number ?? job.order_number,
        status: order.status,
        fulfilment: order.fulfilment_method ?? 'Pickup',
        createdAt: order.created_at,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        address: order.delivery_address,
        suburb: order.delivery_suburb,
        postcode: order.delivery_postcode,
        notes: order.special_instructions,
      },
      (items ?? []).map((item) => ({
        name: item.product_name,
        quantity: item.quantity,
        modifiers: Array.isArray(item.modifiers)
          ? item.modifiers.map((m) => (typeof m === 'object' && m ? m.name : m))
          : [],
        notes: item.special_instructions,
      })),
      { restaurantName: this.config.restaurantName ?? 'VIZIO FOOD', paperWidth: printer.paper_width ?? 80 },
    );

    const attempt = (job.attempts ?? 0) + 1;
    try {
      const copies = printer.copies ?? 1;
      for (let copy = 0; copy < copies; copy += 1) {
        await printRaw(printer.host, printer.port, ticket, { timeoutMs: PRINT_TIMEOUT_MS });
      }
      await this.markPrinted(job.id);
      log('info', `printed ${order.order_number ?? job.order_number} on ${printer.name}`);
    } catch (error) {
      await this.markRetry(job, attempt, error instanceof Error ? error.message : String(error));
    }
  }

  /** Retry locally queued jobs whose backoff has elapsed. */
  async drainLocalQueue() {
    if (this.stopped) return;
    const now = Date.now();
    for (const [id, entry] of this.localQueue) {
      if (entry.attemptAt > now) continue;
      this.localQueue.delete(id);
      const { data: job, error } = await this.supabase
        .from('print_jobs')
        .select('id,printer_id,order_id,order_number,attempts,max_attempts,status')
        .eq('id', entry.jobId)
        .maybeSingle();
      if (error || !job) continue;
      if (job.status === 'PRINTED' || job.status === 'PRINTING') continue;
      // Reset to QUEUED then claim through the normal path.
      await this.supabase.from('print_jobs').update({ status: 'QUEUED' }).eq('id', job.id);
      await this.claimAndPrint(job);
    }
  }
}
