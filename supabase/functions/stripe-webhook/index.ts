import Stripe from 'https://esm.sh/stripe@15.12.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

Deno.serve(async (request: Request) => {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    );

    // ── Checkout completion (existing logic, unchanged) ──
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const cart = JSON.parse(
        session.metadata?.cart ?? '{"items":[],"fulfilment":"pickup"}',
      );
      const customer = JSON.parse(session.metadata?.customer ?? '{}');

      const subtotal = cart.items.reduce(
        (
          sum: number,
          item: {
            price: number;
            quantity: number;
            modifiers: { price: number }[];
          },
        ) =>
          sum +
          (item.price +
            item.modifiers.reduce(
              (s: number, m: { price: number }) => s + m.price,
              0,
            )) *
            item.quantity,
        0,
      );

      const { data: created, error } = await db
        .from('orders')
        .insert({
          customer_name: customer.name,
          customer_email: customer.email,
          customer_phone: customer.phone ?? '',
          total:
            subtotal * 1.1 + (cart.fulfilment === 'Delivery' ? 5 : 0),
          items_count: cart.items.reduce(
            (sum: number, item: { quantity: number }) => sum + item.quantity,
            0,
          ),
          status: 'New',
          payment_status: 'paid',
          stripe_session_id: session.id,
          payment_intent_id: session.payment_intent
            ? String(session.payment_intent)
            : '',
          stripe_payment_intent: session.payment_intent
            ? String(session.payment_intent)
            : '',
        })
        .select('id')
        .single();

      if (error) throw error;

      const itemRows = cart.items.map(
        (item: {
          productId: string;
          name: string;
          price: number;
          quantity: number;
          modifiers: unknown[];
          instructions: string;
        }) => ({
          order_id: created.id,
          product_id: isUuid(item.productId) ? item.productId : null,
          product_name: item.name,
          unit_price: item.price,
          quantity: item.quantity,
          modifiers: item.modifiers,
          special_instructions: item.instructions,
        }),
      );
      const { error: itemError } = await db
        .from('order_items')
        .insert(itemRows);
      if (itemError) throw itemError;

      await db
        .from('order_status_history')
        .insert({ order_id: created.id, status: 'New' });
    }

    // ── Refund events ──
    // Refund totals are recomputed from the PaymentIntent on every event, so
    // processing is idempotent (replays and concurrent events converge to the
    // same state) and never double-counts against locally stored amounts.
    if (
      event.type === 'refund.created' ||
      event.type === 'refund.updated' ||
      event.type === 'charge.refunded'
    ) {
      const object = event.data.object as Stripe.Refund & { refunds?: { data: Stripe.Refund[] } };
      const paymentIntentId =
        (object.payment_intent as string | null) ?? '';

      if (paymentIntentId) {
        const { data: order } = await db
          .from('orders')
          .select('id, total, refund_id, refund_reason')
          .eq('payment_intent_id', paymentIntentId)
          .maybeSingle();

        if (order) {
          const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
          const chargedCents = intent.amount_received || intent.amount;
          const refundedCents = intent.amount_refunded;
          const fullyRefunded =
            intent.status === 'succeeded' && refundedCents >= chargedCents - 1;

          let refundStatus: string;
          if (object.status === 'failed' && event.type !== 'charge.refunded') {
            refundStatus = 'failed';
          } else if (refundedCents <= 0) {
            refundStatus = 'pending';
          } else if (fullyRefunded) {
            refundStatus = 'succeeded';
          } else {
            refundStatus = 'partially_refunded';
          }

          const latestRefundId =
            event.type === 'charge.refunded'
              ? (object.refunds?.data?.[0]?.id ?? order.refund_id ?? '')
              : object.id;

          const updatePayload: Record<string, unknown> = {
            refund_status: refundStatus,
            refund_id: latestRefundId,
          };
          if (refundedCents > 0) {
            updatePayload.refund_amount = refundedCents / 100;
          }
          if (refundStatus === 'succeeded') {
            updatePayload.refunded_at = new Date().toISOString();
            updatePayload.payment_status = 'refunded';
          }
          if (refundStatus === 'failed') {
            updatePayload.refund_reason = 'Stripe refund failed';
          }

          await db.from('orders').update(updatePayload).eq('id', order.id);

          await db.from('admin_audit_log').insert({
            user_id: null, // Stripe webhook — no admin user context
            action: `refund_${refundStatus}`,
            details: {
              order_id: order.id,
              refund_id: latestRefundId,
              refunded_amount: refundedCents / 100,
              event_type: event.type,
            },
            order_id: order.id,
            reason: refundStatus === 'failed' ? 'Stripe refund failed' : '',
          });
        }
      }
    }

    return new Response('ok');
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      error instanceof Error ? error.message : 'Webhook error',
      { status: 400 },
    );
  }
});
