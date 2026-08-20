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

// CORS: the live site plus the Vite dev server (local development calls
// this deployed function via VITE_STRIPE_CHECKOUT_ENDPOINT). The caller's
// origin is echoed only when allow-listed; otherwise the site origin is
// returned, so access is never broadened to arbitrary origins.
const ALLOWED_ORIGINS = new Set([
  'https://viziofood.com',
  'http://localhost:5173',
]);
const corsHeaders = (request: Request): Record<string, string> => {
  const origin = request.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin)
      ? origin
      : 'https://viziofood.com',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
};

Deno.serve(async (request: Request) => {
  // Preflight is answered before any business logic runs.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  try {
    // ── Check if ordering is enabled (server-side enforcement) ──
    // Deterministic ordering (created_at, id) resolves the singleton row the
    // same way the admin panel and the public site do. Before the 20260821
    // migration runs, service_charge/card_processing_fee may not exist as
    // columns — fall back to the legacy list with those rates at 0 so
    // checkout keeps working.
    const settingsQuery = (columns: string) =>
      db
        .from('restaurant_settings')
        .select(columns)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

    let { data: settings, error: settingsError } = await settingsQuery(
      'orders_enabled, order_pause_message, delivery_fee, tax_rate, service_charge, card_processing_fee, pickup_enabled, delivery_enabled',
    );
    if (settingsError?.code === '42703') {
      const legacy = await settingsQuery(
        'orders_enabled, order_pause_message, delivery_fee, tax_rate',
      );
      settings = { ...legacy.data, service_charge: 0, card_processing_fee: 0, pickup_enabled: true, delivery_enabled: true };
      settingsError = legacy.error;
    }

    if (settingsError) {
      console.error('Settings fetch error:', settingsError);
      return Response.json(
        { error: 'Unable to verify order settings.' },
        { status: 500, headers: corsHeaders(request) },
      );
    }

    if (!settings || !settings.orders_enabled) {
      const message =
        settings?.order_pause_message?.trim() ||
        'Online ordering is currently paused.';
      return Response.json(
        { error: message },
        { status: 409, headers: corsHeaders(request) },
      );
    }

    // ── Validate the payload ──
    const { cart, customer, successUrl, cancelUrl } = await request.json();
    if (
      !cart || !Array.isArray(cart.items) || cart.items.length === 0 ||
      !customer?.name || !customer?.email
    ) {
      return Response.json(
        { error: 'A cart with items and customer details is required.' },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    // Integer-cent arithmetic mirrors src/cart.ts totals() exactly, so the
    // Stripe charge, the stored order total and the checkout page total are
    // identical by construction. All rates come from restaurant_settings
    // (Admin → Settings → Delivery & Charges) — nothing is hardcoded here.
    // Formula (each component rounded to cents independently):
    //   service  = round(subtotal × serviceCharge%)
    //   tax      = round(subtotal × tax%)           (tax basis: subtotal)
    //   delivery = fixed fee, Delivery orders only
    //   card fee = round((subtotal + service + tax + delivery) × cardFee%)
    //              — base excludes the fee itself, so there is no circular
    //              calculation
    //   total    = subtotal + service + tax + delivery + card fee
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

    // ── Fulfilment method enforcement (server-side) ──
    // Toggles default to enabled until the migration adds the columns.
    const pickupEnabled = (settings as Record<string, unknown> | null)?.pickup_enabled !== false;
    const deliveryEnabled = (settings as Record<string, unknown> | null)?.delivery_enabled !== false;
    if (!pickupEnabled && !deliveryEnabled) {
      return Response.json(
        { error: 'Online ordering is currently unavailable.' },
        { status: 409, headers: corsHeaders(request) },
      );
    }
    if (isDelivery && !deliveryEnabled) {
      return Response.json(
        { error: 'Delivery is currently unavailable. Please choose pickup.' },
        { status: 409, headers: corsHeaders(request) },
      );
    }
    if (!isDelivery && !pickupEnabled) {
      return Response.json(
        { error: 'Pickup is currently unavailable. Please choose delivery.' },
        { status: 409, headers: corsHeaders(request) },
      );
    }

    const deliveryCents = isDelivery
      ? Math.round(Number(settings?.delivery_fee ?? 0) * 100)
      : 0;
    const taxRatePct = Number(settings?.tax_rate ?? 0);
    const serviceRatePct = Number(settings?.service_charge ?? 0);
    const cardFeeRatePct = Number(settings?.card_processing_fee ?? 0);
    const serviceCents = Math.round(subtotalCents * serviceRatePct / 100);
    const taxCents = Math.round(subtotalCents * taxRatePct / 100);
    const cardFeeCents = Math.round(
      (subtotalCents + serviceCents + taxCents + deliveryCents) *
        cardFeeRatePct / 100,
    );
    const totalCents =
      subtotalCents + serviceCents + taxCents + deliveryCents + cardFeeCents;
    const itemsCount = cart.items.reduce(
      (sum: number, item: { quantity: number }) => sum + item.quantity,
      0,
    );

    // ── 1. Stage the order as a NON-OPERATIONAL Draft. Draft orders are
    //      excluded from every operational surface (admin lists, kitchen,
    //      alerts, printing); the webhook flips the order to status 'New'
    //      the moment Stripe confirms payment — that is the only path into
    //      operations. payment_status stays pending until then. The charge
    //      breakdown is persisted here so later settings changes never
    //      rewrite historical orders. Before the 20260821 migration, the
    //      breakdown columns may not exist — the legacy insert stores the
    //      total only. ──
    const insertOrder = (breakdown: boolean) =>
      db
        .from('orders')
        .insert({
          customer_name: customer.name,
          customer_email: customer.email,
          customer_phone: customer.phone ?? '',
          ...(breakdown
            ? {
                subtotal: subtotalCents / 100,
                tax_total: taxCents / 100,
                delivery_fee: deliveryCents / 100,
                service_charge: serviceCents / 100,
                card_processing_fee: cardFeeCents / 100,
              }
            : {}),
          total: totalCents / 100,
          items_count: itemsCount,
          status: 'Draft',
          payment_status: 'pending',
        })
        .select('id')
        .single();

    let { data: order, error: orderError } = await insertOrder(true);
    if (orderError?.code === '42703') {
      const legacy = await insertOrder(false);
      order = legacy.data;
      orderError = legacy.error;
    }
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
        .insert({ order_id: order.id, status: 'Draft' });
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
          // Charges are explicit lines so the Stripe page total equals the
          // checkout page total exactly. Rates come from settings, so the
          // labels state the applied rate rather than a hardcoded "10%".
          ...(serviceCents > 0
            ? [{
                quantity: 1,
                price_data: {
                  currency: 'aud',
                  unit_amount: serviceCents,
                  product_data: { name: `Service charge (${serviceRatePct}%)` },
                },
              }]
            : []),
          ...(taxCents > 0
            ? [{
                quantity: 1,
                price_data: {
                  currency: 'aud',
                  unit_amount: taxCents,
                  product_data: { name: `Tax (${taxRatePct}%)` },
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
          ...(cardFeeCents > 0
            ? [{
                quantity: 1,
                price_data: {
                  currency: 'aud',
                  unit_amount: cardFeeCents,
                  product_data: {
                    name: `Card processing fee (${cardFeeRatePct}%)`,
                  },
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

    return Response.json(
      { url: sessionUrl },
      { headers: corsHeaders(request) },
    );
  } catch (error) {
    console.error('Checkout error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 400, headers: corsHeaders(request) },
    );
  }
});
