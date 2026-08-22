// Deploy with: supabase functions deploy verify-checkout-session
// Required secrets: STRIPE_SECRET_KEY
//
// POST { "sessionId": "cs_test_..." }
// → { "paid": true }  only when Stripe confirms the Checkout Session is
//   complete AND its payment_status is "paid".
// → { "paid": false }  for anything else (pending, processing, unpaid,
//   expired, unknown/expired id, malformed input, Stripe error).
//
// The response is intentionally minimal: no amounts, customer data, or error
// details are exposed. STRIPE_SECRET_KEY never leaves the server.
// This function is read-only: it does not create orders or mutate anything —
// order creation remains the stripe-webhook function's job.

import Stripe from 'https://esm.sh/stripe@15.12.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});

// Stripe Checkout Session ids look like cs_test_… / cs_live_…
const SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9_-]{8,255}$/;

Deno.serve(async (request: Request) => {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = (body as { sessionId?: unknown }).sessionId;

    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      return Response.json({ paid: false });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid =
      session.status === 'complete' && session.payment_status === 'paid';

    return Response.json({ paid });
  } catch (error) {
    // Invalid/expired id, network failure, etc. — never leak details.
    console.error('verify-checkout-session error:', error);
    return Response.json({ paid: false });
  }
});
