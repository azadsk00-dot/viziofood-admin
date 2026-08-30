/**
 * Post-checkout pages. Success NEVER trusts the URL: the session_id is
 * re-verified server-side (verify-checkout-session Edge Function with the
 * Stripe secret key) and the cart is cleared only when paid===true. Cancel
 * keeps the cart intact.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import { useCart } from '../context/CartProvider';
import { verifyCheckoutSession } from '../orderService';
import { Button, Card, Spinner } from '../ui';

type VerifyState = 'verifying' | 'paid' | 'unconfirmed';

export function CheckoutSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const [state, setState] = useState<VerifyState>(sessionId ? 'verifying' : 'unconfirmed');
  const { clear } = useCart();
  const cleared = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void verifyCheckoutSession(sessionId)
      .then((paid) => {
        if (cancelled) return;
        if (paid) {
          setState('paid');
          if (!cleared.current) {
            clear();
            cleared.current = true;
          }
        } else {
          setState('unconfirmed');
        }
      })
      .catch(() => !cancelled && setState('unconfirmed'));
    return () => {
      cancelled = true;
    };
    // Clear-once depends on the ref, not the callback identity.
  }, [sessionId]);

  return (
    <div className="center-page">
      {state === 'verifying' && (
        <>
          <Spinner />
          <h1 style={{ marginTop: 18 }}>Confirming your payment…</h1>
          <p className="vz-muted">Checking with Stripe — one moment.</p>
        </>
      )}
      {state === 'paid' && (
        <Card pad>
          <CheckCircle2 size={46} color="var(--olive)" style={{ margin: '0 auto 14px' }} />
          <h1>Grazie.</h1>
          <p className="vz-muted">Your order is in — we’ve started turning flour into dinner. Watch your phone; we’ll ping you at each step.</p>
          <div className="vz-row" style={{ justifyContent: 'center', marginTop: 20 }}>
            <Link to="/account" className="vz-btn vz-btn--primary">Track my order</Link>
            <Link to="/menu" className="vz-btn vz-btn--secondary">Back to menu</Link>
          </div>
        </Card>
      )}
      {state === 'unconfirmed' && (
        <Card pad>
          <HelpCircle size={46} color="var(--gold)" style={{ margin: '0 auto 14px' }} />
          <h1>Payment not confirmed yet.</h1>
          <p className="vz-muted">
            We couldn’t confirm this payment. If you were charged, the order is already safely recorded —
            refresh this page in a minute, or contact us with your card statement.
          </p>
          <p className="vz-muted">Your cart has been kept.</p>
          <div className="vz-row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Link to="/checkout" className="vz-btn vz-btn--secondary">Back to checkout</Link>
          </div>
        </Card>
      )}
    </div>
  );
}

export function CheckoutCancel() {
  return (
    <div className="center-page">
      <Card pad>
        <XCircle size={46} color="var(--muted)" style={{ margin: '0 auto 14px' }} />
        <h1>Checkout cancelled.</h1>
        <p className="vz-muted">No charge was made — your cart is exactly as you left it.</p>
        <div className="vz-row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <Link to="/menu" className="vz-btn vz-btn--primary">Back to the menu</Link>
          <Link to="/checkout" className="vz-btn vz-btn--secondary">Retry checkout</Link>
        </div>
      </Card>
    </div>
  );
}
