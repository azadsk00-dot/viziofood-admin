// Print actions from the tablet.
//
// - retryJob: direct print_jobs update (RLS allows kitchen) + audit incident.
// - reprintOrder: Edge Function kitchen-actions (service role can insert
//   missing jobs; requeues existing ones). Falls back to a direct requeue
//   update if the function is not deployed yet — the agent picks up any
//   transition back to QUEUED via realtime.

import { supabase } from '../lib/supabase';
import { config } from '../lib/config';
import { getDeviceId } from '../lib/device';
import type { PrintJobRow } from '../lib/types';
import { recordIncident } from './incidents';

export async function retryPrintJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const deviceId = await getDeviceId();
  const { error } = await supabase
    .from('print_jobs')
    .update({ status: 'QUEUED', attempts: 0, last_error: '', printed_at: null, origin: 'retry' })
    .eq('id', jobId);
  if (error) return { ok: false, error: error.message };
  void recordIncident({
    kind: 'print_retry',
    severity: 'info',
    message: `Manual retry of print job ${jobId.slice(0, 8)} from tablet`,
    details: { jobId, deviceId },
  });
  return { ok: true };
}

export async function reprintOrder(
  orderId: string,
  printerId?: string,
): Promise<{ ok: boolean; requeued: number; error?: string }> {
  const deviceId = await getDeviceId();

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return { ok: false, requeued: 0, error: 'Not signed in.' };

  try {
    const res = await fetch(`${config.functionsUrl}/kitchen-actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'reprint', orderId, printerId, deviceId }),
    });
    const body = (await res.json()) as { ok?: boolean; requeued?: number; error?: string };
    if (res.ok && body.ok) return { ok: true, requeued: body.requeued ?? 0 };
    if (res.status !== 404) return { ok: false, requeued: 0, error: body.error ?? `kitchen-actions responded ${res.status}` };
    // Function not deployed — fall through to the direct requeue path.
  } catch (error) {
    // Network problem talking to the function — fall through only if we can
    // still reach Supabase for the direct path.
    if (!supabase.realtime) return { ok: false, requeued: 0, error: error instanceof Error ? error.message : String(error) };
  }

  // Fallback: direct requeue of existing job rows (kitchen RLS allows update).
  let query = supabase.from('print_jobs').select('id').eq('order_id', orderId);
  if (printerId) query = query.eq('printer_id', printerId);
  const { data: jobs, error: jobsError } = await query;
  if (jobsError) return { ok: false, requeued: 0, error: jobsError.message };
  const rows = (jobs ?? []) as Pick<PrintJobRow, 'id'>[];
  if (!rows.length) {
    return { ok: false, requeued: 0, error: 'No print jobs exist for this order and the kitchen-actions function is not deployed.' };
  }
  for (const row of rows) {
    const { error } = await supabase
      .from('print_jobs')
      .update({ status: 'QUEUED', attempts: 0, last_error: '', printed_at: null, origin: 'reprint' })
      .eq('id', row.id);
    if (error) return { ok: false, requeued: 0, error: error.message };
  }
  void recordIncident({
    kind: 'manual_reprint',
    severity: 'info',
    orderId,
    message: `Manual reprint (direct requeue, ${rows.length} job(s))`,
    details: { deviceId, printerId: printerId ?? null },
  });
  return { ok: true, requeued: rows.length };
}
