// Deploy with: supabase functions deploy process-refund
// Required secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// POST body: { orderId: string, amount?: number, reason?: string }
// If amount is omitted, a full refund is issued.
//
// The caller must include an Authorization header with a valid Supabase JWT
// belonging to an admin or staff user.

import Stripe from 'https://esm.sh/stripe@15.12.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );

async function getAdminRole(jwt: string): Promise<string | null> {
  try {
    const { data, error } = await db.auth.getUser(jwt);
    if (error || !data.user) return null;
    const { data: profile } = await db
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .maybeSingle();
    return profile ? String(profile.role) : null;
  } catch {
    return null;
  }
}

async function auditLog(
  userId: string | null,
  action: string,
  details: Record<string, unknown>,
  orderId?: string,
  reason?: string,
) {
  await db.from('admin_audit_log').insert({
    user_id: userId && userId.length > 0 ? userId : null,
    action,
    details,
    order_id: orderId || null,
    reason: reason || '',
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (request: Request) => {
  try {
    // ── Authenticate caller ──
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Authorization required.' }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const role = await getAdminRole(token);
    if (!role || (role !== 'admin' && role !== 'staff')) {
      return Response.json({ error: 'Admin access required.' }, { status: 403 });
    }

    // ── Parse request ──
    const { orderId, amount, reason } = await request.json();
    if (!orderId || !isUuid(orderId)) {
      return Response.json({ error: 'Valid order ID is required.' }, { status: 400 });
    }

    // ── Fetch order ──
    const { data: order, error: orderError } = await db
      .from('orders')
      .select(
        'id, order_number, total, payment_status, payment_intent_id, stripe_session_id, stripe_payment_intent, refund_status, refund_amount',
      )
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return Response.json({ error: 'Order not found.' }, { status: 404 });
    }

    // ── Validate refund eligibility ──
    if (order.refund_status === 'succeeded' || order.refund_status === 'partially_refunded') {
      const refundable =
        Number(order.total) - Number(order.refund_amount || 0);
      if (refundable <= 0.005) {
        return Response.json(
          { error: 'Order has already been fully refunded.' },
          { status: 409 },
        );
      }
    }

    // ── Determine payment eligibility and find the PaymentIntent ──
    // Legacy orders were inserted by an older webhook that never stored
    // payment_status='paid', so when the DB status is ambiguous we verify the
    // Checkout Session directly with Stripe.
    let paymentIntentId =
      order.payment_intent_id ||
      order.stripe_payment_intent ||
      '';
    let paid = order.payment_status === 'paid';

    if (!paymentIntentId && order.stripe_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(
          order.stripe_session_id,
        );
        paymentIntentId = (session.payment_intent as string) || '';
        if (!paid && session.payment_status === 'paid') {
          paid = true;
        }
      } catch {
        // fall through
      }
    }

    if (!paid) {
      return Response.json(
        { error: 'Cannot refund an order that has not been paid.' },
        { status: 409 },
      );
    }

    if (!paymentIntentId) {
      return Response.json(
        { error: 'No Stripe payment reference found for this order.' },
        { status: 409 },
      );
    }

    // ── Determine refund amount ──
    const orderTotal = Number(order.total);
    const alreadyRefunded = Number(order.refund_amount || 0);
    const refundableAmount = Math.max(0, orderTotal - alreadyRefunded);

    const refundAmountCents =
      amount != null
        ? Math.round(Math.min(Number(amount), refundableAmount) * 100)
        : Math.round(refundableAmount * 100);

    if (refundAmountCents <= 0) {
      return Response.json(
        { error: 'Refund amount must be greater than zero.' },
        { status: 400 },
      );
    }

    // ── Create Stripe refund ──
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
      amount: refundAmountCents,
      reason: 'requested_by_customer',
    };

    const refund = await stripe.refunds.create(refundParams);

    // ── Get caller's user ID for audit ──
    const { data: userData } = await db.auth.getUser(token);
    const userId = userData?.user?.id ?? null;

    // ── Calculate new refund status ──
    const refundAmountAud = refundAmountCents / 100;
    const newTotalRefunded = alreadyRefunded + refundAmountAud;
    const isFullRefund = Math.abs(newTotalRefunded - orderTotal) < 0.01;
    const newRefundStatus = isFullRefund
      ? 'succeeded'
      : 'partially_refunded';

    // ── Update order in database ──
    const updateData: Record<string, unknown> = {
      refund_status: newRefundStatus,
      refund_id: refund.id,
      refund_amount: newTotalRefunded,
      refund_reason: reason || 'Refund requested by admin',
      // Persist the resolved intent so webhook refund events can match
      // legacy orders whose payment_intent_id was never stored.
      payment_intent_id: paymentIntentId,
    };

    if (isFullRefund) {
      updateData.payment_status = 'refunded';
    }

    await db.from('orders').update(updateData).eq('id', orderId);

    // ── Audit log ──
    await auditLog(
      userId,
      'refund_initiated',
      {
        order_number: order.order_number,
        refund_id: refund.id,
        refund_amount: refundAmountAud,
        refund_status: newRefundStatus,
        stripe_payment_intent: paymentIntentId,
      },
      orderId,
      reason,
    );

    return Response.json({
      ok: true,
      refund_id: refund.id,
      refund_amount: refundAmountAud,
      refund_status: refund.status,
      order_refund_status: newRefundStatus,
    });
  } catch (error) {
    console.error('Refund error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Refund failed' },
      { status: 400 },
    );
  }
});
