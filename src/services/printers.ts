/**
 * Printers & print jobs service. The local printer service (see
 * printer-service/) authenticates with a staff JWT, subscribes to realtime
 * INSERTs on print_jobs, claims a job by flipping QUEUED→PRINTING, prints,
 * and marks it PRINTED/FAILED. This module is the admin-side control
 * surface plus the enqueue helper used after payment confirmation.
 */

import { supabase, supabaseConfigurationError } from '../lib/supabase';
import type { PrinterConfig, PrintJob } from '../types';

type Row = Record<string, unknown>;

const client = () => {
  if (!supabase) throw new Error(supabaseConfigurationError);
  return supabase;
};

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const nullableText = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => Number(v ?? 0);
const bool = (v: unknown) => v === true;

const PRINTER_COLUMNS = 'id,name,station,connection,host,port,paper_width,enabled,auto_print,copies,created_at,updated_at';
const JOB_COLUMNS = 'id,order_id,order_number,printer_id,status,attempts,max_attempts,last_error,created_at,printed_at';

export const mapPrinter = (row: Row): PrinterConfig => ({
  id: text(row.id),
  name: text(row.name),
  station: (['kitchen', 'bar', 'coffee', 'dessert', 'pickup', 'receipt'].includes(text(row.station))
    ? text(row.station)
    : 'kitchen') as PrinterConfig['station'],
  connection: row.connection === 'system' ? 'system' : 'network',
  host: text(row.host),
  port: num(row.port) || 9100,
  paperWidth: ([32, 48, 80].includes(num(row.paper_width)) ? num(row.paper_width) : 80) as PrinterConfig['paperWidth'],
  enabled: bool(row.enabled),
  autoPrint: bool(row.auto_print),
  copies: Math.min(5, Math.max(1, num(row.copies) || 1)),
  createdAt: text(row.created_at),
  updatedAt: text(row.updated_at),
});

export const mapPrintJob = (row: Row): PrintJob => ({
  id: text(row.id),
  orderId: text(row.order_id),
  orderNumber: text(row.order_number),
  printerId: text(row.printer_id),
  status: (['QUEUED', 'PRINTING', 'PRINTED', 'FAILED', 'RETRYING'].includes(text(row.status))
    ? text(row.status)
    : 'QUEUED') as PrintJob['status'],
  attempts: num(row.attempts),
  maxAttempts: num(row.max_attempts) || 5,
  lastError: text(row.last_error),
  createdAt: text(row.created_at),
  printedAt: nullableText(row.printed_at),
});

const isTableMissing = (error: { code?: string; message?: string } | null) =>
  error?.code === '42P01' || error?.code === 'PGRST205' || /relation .* does not exist/i.test(error?.message ?? '');

// ── Printer configs ──

export async function getPrinters(): Promise<PrinterConfig[]> {
  const { data, error } = await client().from('printers').select(PRINTER_COLUMNS).order('name');
  if (error) {
    if (isTableMissing(error)) return [];
    throw error;
  }
  return ((data ?? []) as Row[]).map(mapPrinter);
}

export async function savePrinter(value: Partial<PrinterConfig> & { name: string }): Promise<void> {
  const row: Record<string, unknown> = {
    name: value.name.trim(),
    station: value.station ?? 'kitchen',
    connection: value.connection ?? 'network',
    host: (value.host ?? '').trim(),
    port: value.port ?? 9100,
    paper_width: value.paperWidth ?? 80,
    enabled: value.enabled ?? true,
    auto_print: value.autoPrint ?? true,
    copies: value.copies ?? 1,
  };
  if (value.id) {
    const { error } = await client().from('printers').update(row).eq('id', value.id);
    if (error) throw error;
  } else {
    const { error } = await client().from('printers').insert(row);
    if (error) throw error;
  }
}

export async function deletePrinter(id: string): Promise<void> {
  const { error } = await client().from('printers').delete().eq('id', id);
  if (error) throw error;
}

// ── Print jobs ──

export async function getPrintJobs(limit = 100): Promise<PrintJob[]> {
  const { data, error } = await client().from('print_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).limit(limit);
  if (error) {
    if (isTableMissing(error)) return [];
    throw error;
  }
  return ((data ?? []) as Row[]).map(mapPrintJob);
}

/**
 * Queue a print job for an order on every enabled auto-print printer.
 * Idempotent: a printer only ever gets one job per order (unique index),
 * so webhook replays and retries cannot double-print.
 */
export async function enqueueOrderPrintJobs(orderId: string, orderNumber: string): Promise<void> {
  const printers = (await getPrinters()).filter((p) => p.enabled && p.autoPrint);
  if (!printers.length) return;
  const rows = printers.map((p) => ({
    order_id: orderId,
    order_number: orderNumber,
    printer_id: p.id,
    status: 'QUEUED',
    attempts: 0,
    max_attempts: 5,
  }));
  // 23505 unique-violation rows (already queued) are expected on retries.
  const { error } = await client().from('print_jobs').insert(rows);
  if (error && error.code !== '23505' && !isTableMissing(error)) throw error;
}

/** Admin "Print again" — force a fresh job regardless of previous state. */
export async function reprintOrder(orderId: string, orderNumber: string, printerId: string): Promise<void> {
  const { error } = await client().from('print_jobs').insert({
    order_id: orderId,
    order_number: orderNumber,
    printer_id: printerId,
    status: 'QUEUED',
    attempts: 0,
    max_attempts: 5,
  });
  if (error && !isTableMissing(error)) throw error;
}

/** Reset a FAILED/RETRYING job back to QUEUED (admin retry button). */
export async function retryPrintJob(jobId: string): Promise<void> {
  const { error } = await client().from('print_jobs').update({ status: 'QUEUED', last_error: '' }).eq('id', jobId);
  if (error) throw error;
}
