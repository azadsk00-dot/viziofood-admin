/**
 * Checkout client — hands the cart + customer to the create-checkout Edge
 * Function (which recomputes every price server-side) and redirects to the
 * Stripe Checkout URL it returns. The success page never trusts the URL:
 * it re-verifies the session via verify-checkout-session before clearing
 * the cart.
 */

import { supabase, supabaseConfigurationError } from './lib/supabase';
import type { CartState, CheckoutCustomer } from './types';

const endpoint = import.meta.env.VITE_STRIPE_CHECKOUT_ENDPOINT;
const verifyEndpoint = import.meta.env.VITE_CHECKOUT_VERIFY_ENDPOINT;

export async function beginStripeCheckout(cart: CartState, customer: CheckoutCustomer): Promise<void> {
  if (!supabase) throw new Error(supabaseConfigurationError);
  if (!endpoint) throw new Error('Stripe checkout endpoint is not configured. Set VITE_STRIPE_CHECKOUT_ENDPOINT.');

  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({
      cart,
      customer,
      successUrl: `${location.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${location.origin}/checkout/cancel`,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Unable to start secure checkout.');
  }
  const payload = await response.json() as { url?: string };
  if (!payload.url) throw new Error('Checkout URL was not returned.');
  location.assign(payload.url);
}

/**
 * Server-side verification of a completed Stripe session. Returns true only
 * when Stripe reports the session complete AND paid.
 */
export async function verifyCheckoutSession(sessionId: string): Promise<boolean> {
  if (!verifyEndpoint) throw new Error('Checkout verification endpoint is not configured.');
  const response = await fetch(verifyEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) return false;
  const payload = await response.json() as { paid?: boolean };
  return payload.paid === true;
}
