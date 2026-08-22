/**
 * Checkout — cart review, fulfilment choice (pickup/delivery per settings),
 * coupon code, validated customer details, live charge breakdown using the
 * same integer-cent math the server charges, then redirect to Stripe
 * Checkout. The server is authoritative: totals here are display-only.
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { CreditCard, Minus, Plus, Tag, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartProvider';
import { beginStripeCheckout } from '../orderService';
import { useToast } from '../components/Toast';
import { useRestaurantSettings } from '../hooks/useRestaurantSettings';
import { totals, emptyCharges, aud } from '../lib/money';
import { findCoupon } from '../services/coupons';
import type { Coupon, Fulfilment } from '../types';
import { zodResolver } from '../lib/zodResolver';
import { checkoutCustomerSchema } from '../lib/validation';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Textarea } from '../ui';

type CheckoutForm = {
  name: string;
  email: string;
  phone: string;
  address?: string;
  suburb?: string;
  postcode?: string;
  deliveryInstructions?: string;
};

export default function Checkout() {
  const { cart, updateQuantity, removeItem, clear, setFulfilment, setCoupon } = useCart();
  const toast = useToast();
  const { settings, loading: settingsLoading } = useRestaurantSettings();
  const [busy, setBusy] = useState(false);
  const [coupon, setCouponState] = useState<Coupon | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState('');
  const [couponChecking, setCouponChecking] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutCustomerSchema),
  });

  const paused = !settingsLoading && settings !== null && !settings.ordersEnabled;
  const pickupOn = settings?.pickupEnabled !== false;
  const deliveryOn = settings?.deliveryEnabled !== false;
  const noFulfilment = !settingsLoading && settings !== null && !pickupOn && !deliveryOn;

  // Keep fulfilment valid against the admin's toggles.
  useEffect(() => {
    if (!settings) return;
    if (!pickupOn && cart.fulfilment === 'Pickup' && deliveryOn) setFulfilment('Delivery');
    if (!deliveryOn && cart.fulfilment === 'Delivery' && pickupOn) setFulfilment('Pickup');
  }, [settings, pickupOn, deliveryOn, cart.fulfilment, setFulfilment]);

  const charges = settings
    ? {
        deliveryFee: settings.deliveryFee,
        taxRate: settings.taxRate,
        serviceChargeRate: settings.serviceChargeRate,
        cardFeeRate: settings.cardFeeRate,
      }
    : emptyCharges;

  const value = useMemo(() => totals(cart, charges, coupon), [cart, charges, coupon]);

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    setCouponChecking(true);
    setCouponError('');
    try {
      const found = await findCoupon(code);
      if (!found) {
        setCouponState(null);
        setCoupon(undefined);
        setCouponError('That code isn’t valid.');
        return;
      }
      const subtotal = value.subtotal;
      if (found.minimumOrder > 0 && subtotal < found.minimumOrder) {
        setCouponState(null);
        setCoupon(undefined);
        setCouponError(`Code ${found.code} needs a ${aud(found.minimumOrder)} minimum order.`);
        return;
      }
      setCouponState(found);
      setCoupon(found.code);
      toast.show(`Code ${found.code} applied`);
    } catch {
      setCouponError('Could not check that code — try again.');
    } finally {
      setCouponChecking(false);
    }
  };

  const removeCoupon = () => {
    setCouponState(null);
    setCoupon(undefined);
    setCouponInput('');
    setCouponError('');
  };

  const pay = async (form: CheckoutForm) => {
    if (!cart.items.length) {
      toast.show('Your cart is empty.', { type: 'error' });
      return;
    }
    if (paused) {
      toast.show(settings?.orderPauseMessage || 'Online ordering is currently paused.', { type: 'error' });
      return;
    }
    if (noFulfilment) {
      toast.show('Online ordering is currently unavailable.', { type: 'error' });
      return;
    }
    setBusy(true);
    try {
      const customer = {
        ...form,
        // Address fields only apply to delivery orders.
        ...(cart.fulfilment === 'Delivery'
          ? { address: form.address, suburb: form.suburb, postcode: form.postcode, deliveryInstructions: form.deliveryInstructions }
          : {}),
      };
      await beginStripeCheckout(cart, customer);
      // Stripe redirect happens inside beginStripeCheckout; on failure it throws.
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Checkout could not start.', { type: 'error' });
      setBusy(false);
    }
  };

  if (!cart.items.length) {
    return (
      <div className="vz-container vz-section">
        <EmptyState title="Your table is waiting.">
          Add something delicious from our menu.
        </EmptyState>
        <div style={{ textAlign: 'center' }}>
          <Link to="/menu" className="vz-btn vz-btn--primary vz-btn--lg">Browse the menu</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="vz-container vz-section" style={{ paddingTop: 'clamp(28px, 5vw, 54px)' }}>
      <p className="vz-eyebrow">Your order</p>
      <h1 style={{ marginBottom: 26 }}>Almost at your table.</h1>

      <div className="checkout-grid">
        {/* ── Cart review ── */}
        <Card pad>
          <div className="vz-row vz-row--between" style={{ marginBottom: 12 }}>
            <strong>Items ({cart.items.length})</strong>
            <button className="vz-btn vz-btn--ghost vz-btn--sm" onClick={() => clear()}>
              <Trash2 size={15} /> Clear
            </button>
          </div>
          {cart.items.map((item) => (
            <div className="cart-line" key={item.key}>
              <div className="cart-line__main">
                <div className="cart-line__name">{item.name}</div>
                {item.modifiers.length > 0 && (
                  <div className="cart-line__mods">{item.modifiers.map((m) => m.name).join(', ')}</div>
                )}
                {item.instructions && <div className="cart-line__notes">“{item.instructions}”</div>}
                <div className="cart-line__qty" style={{ marginTop: 8 }}>
                  <button onClick={() => updateQuantity(item.key, item.quantity - 1)} aria-label={`Decrease ${item.name}`}><Minus size={14} /></button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.key, item.quantity + 1)} aria-label={`Increase ${item.name}`}><Plus size={14} /></button>
                  <button className="vz-btn vz-btn--ghost vz-btn--sm" style={{ marginLeft: 6 }} onClick={() => removeItem(item.key)} aria-label={`Remove ${item.name}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="cart-line__price">
                {aud((item.price + item.modifiers.reduce((s, m) => s + m.price, 0)) * item.quantity)}
              </div>
            </div>
          ))}
        </Card>

        {/* ── Summary + details ── */}
        <div className="vz-stack">
          <Card pad>
            <div className="summary-lines">
              <div className="summary-line"><span>Subtotal</span><b>{aud(value.subtotal)}</b></div>
              {value.discount > 0 && (
                <div className="summary-line summary-line--discount">
                  <span>Discount {coupon ? `(${coupon.code})` : ''}</span>
                  <b>−{aud(value.discount)}</b>
                </div>
              )}
              {value.service > 0 && <div className="summary-line"><span>Service charge</span><b>{aud(value.service)}</b></div>}
              <div className="summary-line"><span>Tax</span><b>{aud(value.tax)}</b></div>
              <div className="summary-line"><span>Delivery</span><b>{value.delivery ? aud(value.delivery) : '—'}</b></div>
              {value.cardFee > 0 && <div className="summary-line"><span>Card processing</span><b>{aud(value.cardFee)}</b></div>}
              <div className="summary-line summary-line--total"><span>Total</span><span>{aud(value.total)}</span></div>
            </div>

            {/* Coupon */}
            {coupon ? (
              <div className="vz-row vz-row--between" style={{ marginBottom: 14 }}>
                <Badge tone="olive" dot><Tag size={12} /> {coupon.code}</Badge>
                <button className="vz-btn vz-btn--ghost vz-btn--sm" onClick={removeCoupon}><X size={14} /> Remove</button>
              </div>
            ) : (
              <div className="vz-row" style={{ marginBottom: 14 }}>
                <Input
                  placeholder="Promo code"
                  value={couponInput}
                  onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), void applyCoupon())}
                  aria-label="Promo code"
                  style={{ flex: 1 }}
                />
                <Button variant="secondary" onClick={() => void applyCoupon()} disabled={couponChecking || !couponInput.trim()}>
                  {couponChecking ? 'Checking…' : 'Apply'}
                </Button>
              </div>
            )}
            {couponError && <p className="vz-field__error" role="alert">{couponError}</p>}
          </Card>

          <Card pad>
            {paused && (
              <ErrorBox>
                Online ordering is paused. {settings?.orderPauseMessage || ''} Your cart is saved.
              </ErrorBox>
            )}
            <form onSubmit={handleSubmit(pay)} noValidate>
              <p className="vz-eyebrow" style={{ marginBottom: 12 }}>Your details</p>
              <div className="fulfilment-toggle" role="group" aria-label="Fulfilment method">
                {(['Pickup', 'Delivery'] as Fulfilment[])
                  .filter((method) => (method === 'Pickup' ? pickupOn : deliveryOn))
                  .map((method) => (
                    <button
                      key={method}
                      type="button"
                      className={cart.fulfilment === method ? 'is-active' : ''}
                      aria-pressed={cart.fulfilment === method}
                      onClick={() => setFulfilment(method)}
                    >
                      {method}
                    </button>
                  ))}
                {noFulfilment && <p className="vz-field__error">Online ordering is currently unavailable.</p>}
              </div>

              <Field label="Full name" error={errors.name?.message} htmlFor="co-name">
                <Input id="co-name" autoComplete="name" invalid={!!errors.name} {...register('name')} />
              </Field>
              <Field label="Email" error={errors.email?.message} htmlFor="co-email">
                <Input id="co-email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
              </Field>
              <Field label="Phone" error={errors.phone?.message} htmlFor="co-phone">
                <Input id="co-phone" type="tel" autoComplete="tel" invalid={!!errors.phone} {...register('phone')} />
              </Field>

              {cart.fulfilment === 'Delivery' && (
                <>
                  <Field label="Street address" error={errors.address?.message} htmlFor="co-address">
                    <Input id="co-address" autoComplete="street-address" invalid={!!errors.address} {...register('address')} />
                  </Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="Suburb" error={errors.suburb?.message} htmlFor="co-suburb">
                      <Input id="co-suburb" {...register('suburb')} />
                    </Field>
                    <Field label="Postcode" error={errors.postcode?.message} htmlFor="co-postcode">
                      <Input id="co-postcode" inputMode="numeric" {...register('postcode')} />
                    </Field>
                  </div>
                  <Field label="Delivery instructions (optional)" htmlFor="co-notes">
                    <Textarea id="co-notes" placeholder="Gate code, where to leave it…" {...register('deliveryInstructions')} />
                  </Field>
                </>
              )}

              <div className="vz-row" style={{ margin: '18px 0', color: 'var(--muted)', fontSize: '0.88rem' }}>
                <CreditCard size={18} />
                <span>Payment is completed securely through <b>Stripe</b>. The final amount is verified server-side.</span>
              </div>

              <Button type="submit" block size="lg" disabled={busy || paused || settingsLoading || noFulfilment}>
                {paused ? 'Ordering paused' : busy || settingsLoading ? 'Opening secure checkout…' : `Pay ${aud(value.total)}`}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
