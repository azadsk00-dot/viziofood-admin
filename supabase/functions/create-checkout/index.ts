// Deploy with: supabase functions deploy create-checkout
// Required secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import Stripe from 'https://esm.sh/stripe@15.12.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (request: Request) => {
  try {
    // ── Check if ordering is enabled (server-side enforcement) ──
    const { data: settings, error: settingsError } = await db
      .from('restaurant_settings')
      .select('orders_enabled, order_pause_message')
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

    // ── Create Stripe Checkout Session ──
    const { cart, customer, successUrl, cancelUrl } = await request.json();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: customer.email,
      metadata: {
        cart: JSON.stringify(cart),
        customer: JSON.stringify(customer),
      },
      line_items: cart.items.map(
        (item: {
          name: string;
          price: number;
          quantity: number;
          modifiers: { price: number }[];
        }) => ({
          quantity: item.quantity,
          price_data: {
            currency: 'aud',
            unit_amount: Math.round(
              (item.price +
                item.modifiers.reduce(
                  (sum: number, m: { price: number }) => sum + m.price,
                  0,
                )) *
                100,
            ),
            product_data: { name: item.name },
          },
        }),
      ),
    });

    return Response.json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 400 },
    );
  }
});
