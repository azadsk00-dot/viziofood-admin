// Deploy with: supabase functions deploy create-checkout
// Required secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Order-first checkout: the order and its items are persisted to Supabase
// BEFORE the Stripe session is created, so the session metadata only needs
// to carry the order UUID. Stripe caps metadata values at 500 characters —
// the previous flow stored the whole cart JSON in metadata and failed on
// large carts. Items, modifiers and instructions live in order_items, never
// in Stripe metadata.
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
  try {
    // ── Check if ordering is enabled (server-side enforcement) ──
    const { data: settings, error: settingsError } = await db
      .from('restaurant_settings')
      .select('orders_enabled, order_pause_message, delivery_fee')
      .limit(1)
      .maybeSingle();

    if (settingsError) {
      console.error('Settings fetch error:', settingsError);
      return Response.json(
        { error: 'Unable to verify order settings.' },
        { status: 500 },
      );
    }

    if (!settings || !settings.orders_enabled) {
      const message =
        settings?.order_pause_message?.trim() ||
        'Online ordering is currently paused.';
      return Response.json({ error: message }, { status: 409 });
    }

    // ── Validate the payload ──
    const { cart, customer, successUrl, cancelUrl } = await request.json();
    if (
      !cart || !Array.isArray(cart.items) || cart.items.length === 0 ||
      !customer?.name || !customer?.email
    ) {
      return Response.json(
        { error: 'A cart with items and customer details is required.' },
        { status: 400 },
      );
    }

    // Integer-cent arithmetic mirrors src/cart.ts totals() exactly, so the
    // Stripe charge, the stored order total and the checkout page total are
    // identical by construction. GST is 10% (matching the frontend's TAX_RATE)
    // and the delivery fee is the configured restaurant_settings value —
    // $0 for Pickup.
    const TAX_RATE = 0.1;
    const itemUnitCents = cart.items.map(
      (item: { price: number; modifiers: { price: number }[] }) =>
        Math.round(
          (item.price +
            item.modifiers.reduce(
              (s: number, m: { price: number }) => s + m.price,
              0,
            )) *
            100,
        ),
    );
    const subtotalCents = itemUnitCents.reduce(
      (sum: number, cents: number, index: number) =>
        sum + cents * cart.items[index].quantity,
      0,
    );
    const isDelivery = cart.fulfilment === 'Delivery';
    const deliveryCents = isDelivery
      ? Math.round(Number(settings?.delivery_fee ?? 0) * 100)
      : 0;
    const taxCents = Math.round(subtotalCents * TAX_RATE);
    const totalCents = subtotalCents + taxCents + deliveryCents;
    const itemsCount = cart.items.reduce(
      (sum: number, item: { quantity: number }) => sum + item.quantity,
      0,
    );

    // ── 1. Stage the order (payment_status stays pending until the webhook
    //      confirms payment) ──
    const { data: order, error: orderError } = await db
      .from('orders')
      .insert({
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone ?? '',
        total: totalCents / 100,
        items_count: itemsCount,
        status: 'New',
        payment_status: 'pending',
      })
      .select('id')
      .single();
    if (orderError) throw orderError;

    // ── 2. Persist items + initial status history, then create the session.
    //      Anything failing here is rolled back while NO payable session
    //      exists, so a customer can never pay for a deleted order. ──
    let sessionUrl: string | null = null;
    try {
      const itemRows = cart.items.map(
        (item: {
          productId: string;
          name: string;
          price: number;
          quantity: number;
          modifiers: unknown[];
          instructions: string;
        }) => ({
          order_id: order.id,
          product_id: isUuid(item.productId ?? '') ? item.productId : null,
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

      const { error: historyError } = await db
        .from('order_status_history')
        .insert({ order_id: order.id, status: 'New' });
      if (historyError) throw historyError;

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: customer.email,
        // Identifiers only — Stripe metadata values are capped at 500
        // characters. The webhook loads the order by this id.
        metadata: { order_id: order.id },
        line_items: [
          ...cart.items.map(
            (item: { name: string; quantity: number }, index: number) => ({
              quantity: item.quantity,
              price_data: {
                currency: 'aud',
                unit_amount: itemUnitCents[index],
                product_data: { name: item.name },
              },
            }),
          ),
          // GST and delivery are explicit lines so the Stripe page total
          // equals the checkout page total exactly.
          ...(taxCents > 0
            ? [{
                quantity: 1,
                price_data: {
                  currency: 'aud',
                  unit_amount: taxCents,
                  product_data: { name: 'GST (10%)' },
                },
              }]
            : []),
          ...(deliveryCents > 0
            ? [{
                quantity: 1,
                price_data: {
                  currency: 'aud',
                  unit_amount: deliveryCents,
                  product_data: { name: 'Delivery' },
                },
              }]
            : []),
        ],
      });

      // Traceability link — non-fatal: the webhook re-asserts it on
      // completion.
      const { error: linkError } = await db
        .from('orders')
        .update({ stripe_session_id: session.id })
        .eq('id', order.id);
      if (linkError) {
        console.error('Session link failed for', order.id, linkError);
      }

      sessionUrl = session.url;
    } catch (error) {
      const { error: deleteError } = await db
        .from('orders')
        .delete()
        .eq('id', order.id); // cascades to order_items and history
      if (deleteError) {
        console.error('Rollback of unpaid order failed:', order.id, deleteError);
      }
      throw error;
    }

    return Response.json({ url: sessionUrl });
  } catch (error) {
    console.error('Checkout error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 400 },
    );
  }
});
