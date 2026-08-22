// Kitchen tablet print actions — reprint + retry with audit.
//
// Deploy: supabase functions deploy kitchen-actions
//
// Why an Edge Function: the kitchen role cannot INSERT print_jobs (RLS allows
// admin/staff only) and manual reprints must be audited. The function runs
// with the service role AFTER verifying the caller's profile role.
//
// IMPORTANT design note: print_jobs has a partial unique index
//   (printer_id, order_id) WHERE status <> 'FAILED'
// so a reprint never inserts a second live row for a printer+order pair —
// it REQUEUES the existing row (status='QUEUED', attempts=0, origin='reprint').
// The printer agent's realtime listener picks up any transition TO 'QUEUED'
// and reprints. If no row exists at all for a printer+order, a fresh row is
// inserted (origin='reprint').
//
// Actions (POST JSON, Authorization: Bearer <user JWT>, role admin/staff/kitchen):
//   { action: 'reprint',  orderId, printerId? }  — reprint all (or one) printer jobs for an order
//   { action: 'retry-job', jobId }               — requeue one FAILED/RETRYING job

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function caller(bearer: string): Promise<{ userId: string; role: string } | null> {
  const { data, error } = await db.auth.getUser(bearer);
  if (error || !data.user) return null;
  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  const role = String((profile as { role?: string } | null)?.role ?? '');
  if (role !== 'admin' && role !== 'staff' && role !== 'kitchen') return null;
  return { userId: data.user.id, role };
}

async function logIncident(input: {
  kind: string;
  severity?: string;
  orderId?: string | null;
  deviceId?: string;
  message: string;
  details?: Record<string, unknown>;
  userId: string;
}): Promise<void> {
  const { error } = await db.from('kitchen_incidents').insert({
    kind: input.kind,
    severity: input.severity ?? 'info',
    order_id: input.orderId ?? null,
    device_id: input.deviceId ?? '',
    message: input.message.slice(0, 300),
    details: input.details ?? {},
    user_id: input.userId,
  });
  if (error) console.error('kitchen_incidents insert failed:', error.message);
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!bearer) return Response.json({ error: 'Authentication required' }, { status: 401 });

  let body: {
    action?: string;
    orderId?: string;
    printerId?: string;
    jobId?: string;
    deviceId?: string;
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const actor = await caller(bearer);
  if (!actor) return Response.json({ error: 'Admin, staff or kitchen account required.' }, { status: 403 });

  try {
    // ── Reprint: requeue existing job(s) for an order, or create missing ones ──
    if (body.action === 'reprint') {
      const orderId = String(body.orderId ?? '');
      if (!orderId) return Response.json({ error: 'orderId is required' }, { status: 400 });

      const { data: order } = await db
        .from('orders')
        .select('id,order_number')
        .eq('id', orderId)
        .maybeSingle();
      if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

      let query = db
        .from('print_jobs')
        .select('id,printer_id,status')
        .eq('order_id', orderId);
      if (body.printerId) query = query.eq('printer_id', body.printerId);
      const { data: jobs, error: jobsError } = await query;
      if (jobsError) throw new Error(jobsError.message);

      const requeued: string[] = [];

      if (jobs && jobs.length) {
        for (const job of jobs) {
          const { error } = await db
            .from('print_jobs')
            .update({
              status: 'QUEUED',
              attempts: 0,
              last_error: '',
              printed_at: null,
              origin: 'reprint',
            })
            .eq('id', job.id);
          if (error) throw new Error(error.message);
          requeued.push(job.id);
        }
      } else {
        // No job row exists (e.g. printer was disabled at payment time):
        // create fresh jobs for every enabled auto-print printer, mirroring
        // the webhook's enqueue logic. (Idempotent via the unique index.)
        const { data: printers, error: printersError } = await db
          .from('printers')
          .select('id,name')
          .eq('enabled', true)
          .eq('auto_print', true);
        if (printersError) throw new Error(printersError.message);
        for (const printer of printers ?? []) {
          if (body.printerId && printer.id !== body.printerId) continue;
          const { data: inserted, error: insertError } = await db
            .from('print_jobs')
            .insert({
              order_id: orderId,
              order_number: order.order_number ?? '',
              printer_id: printer.id,
              status: 'QUEUED',
              origin: 'reprint',
            })
            .select('id')
            .maybeSingle();
          if (insertError) {
            // 23505 = unique violation: a live job already exists (race).
            if (!insertError.message.includes('duplicate key')) throw new Error(insertError.message);
          } else if (inserted) {
            requeued.push(inserted.id);
          }
        }
      }

      await logIncident({
        kind: 'manual_reprint',
        orderId,
        deviceId: body.deviceId,
        severity: 'info',
        message: `Manual reprint of order ${order.order_number ?? orderId} (${requeued.length} job(s))${
          body.reason ? ` — ${body.reason}` : ''
        }`,
        details: { jobIds: requeued, printerId: body.printerId ?? null, role: actor.role },
        userId: actor.userId,
      });

      return Response.json({ ok: true, requeued: requeued.length, jobIds: requeued });
    }

    // ── Retry one failed/stuck job ──
    if (body.action === 'retry-job') {
      const jobId = String(body.jobId ?? '');
      if (!jobId) return Response.json({ error: 'jobId is required' }, { status: 400 });

      const { data: job, error: jobError } = await db
        .from('print_jobs')
        .select('id,order_id,order_number,status,attempts,last_error')
        .eq('id', jobId)
        .maybeSingle();
      if (jobError) throw new Error(jobError.message);
      if (!job) return Response.json({ error: 'Print job not found' }, { status: 404 });

      const { error } = await db
        .from('print_jobs')
        .update({
          status: 'QUEUED',
          attempts: 0,
          last_error: '',
          printed_at: null,
          origin: 'retry',
        })
        .eq('id', jobId);
      if (error) throw new Error(error.message);

      await logIncident({
        kind: 'print_retry',
        orderId: job.order_id,
        deviceId: body.deviceId,
        severity: 'info',
        message: `Manual retry of print job ${jobId} (${job.order_number ?? ''}) after ${job.attempts ?? 0} attempt(s)`,
        details: { jobId, previousStatus: job.status, lastError: job.last_error, role: actor.role },
        userId: actor.userId,
      });

      return Response.json({ ok: true, jobId });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('kitchen-actions error:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Action failed' }, { status: 500 });
  }
});
