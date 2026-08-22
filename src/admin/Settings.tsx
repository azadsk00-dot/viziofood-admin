/**
 * Settings — grouped admin control surface: ordering (pause, pickup/
 * delivery, min order), restaurant info, opening hours, delivery & charges,
 * and kitchen/notification preferences. Everything saved here is the single
 * source of truth the public site and Edge Functions read in real time.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Clock, MapPin, Save, ShoppingBag, XCircle } from 'lucide-react';
import { getSettings, saveSettings } from './supabase';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';
import type { DayHours, OpeningHours } from './types';
import { Button, Card, Field, Input, Skeleton, Toggle } from '../ui';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const defaultHours = (): OpeningHours =>
  Object.fromEntries(DAY_KEYS.map((d) => [d, { open: '11:00', close: '21:00', closed: false }])) as OpeningHours;

const emptyDay = (): DayHours => ({ open: '', close: '', closed: true });

const describeError = (err: unknown, fallback: string): string => {
  if (!(err instanceof Error)) return fallback;
  const code = (err as Error & { code?: string }).code;
  return code ? `${err.message} (${code})` : err.message;
};

export function SettingsPage() {
  const resource = useResource(getSettings);
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [suburb, setSuburb] = useState('');
  const [state, setState] = useState('');
  const [postcode, setPostcode] = useState('');
  const [googleMaps, setGoogleMaps] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [taxRate, setTaxRate] = useState(0);
  const [serviceChargeRate, setServiceChargeRate] = useState(0);
  const [cardFeeRate, setCardFeeRate] = useState(0);
  const [minimumOrder, setMinimumOrder] = useState(0);
  const [deliveryMinimumOrder, setDeliveryMinimumOrder] = useState(0);
  const [pickupTime, setPickupTime] = useState(15);
  const [deliveryTime, setDeliveryTime] = useState(35);
  const [pickupInstructions, setPickupInstructions] = useState('');
  const [openingHours, setOpeningHours] = useState<OpeningHours>(defaultHours);
  const [ordersEnabled, setOrdersEnabled] = useState(true);
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [orderPauseMessage, setOrderPauseMessage] = useState('');
  const [orderSoundEnabled, setOrderSoundEnabled] = useState(true);
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(true);

  useEffect(() => {
    const s = resource.data;
    if (!s) return;
    setName(s.name); setPhone(s.phone); setEmail(s.email);
    setAddress(s.address); setSuburb(s.suburb); setState(s.state); setPostcode(s.postcode);
    setGoogleMaps(s.googleMaps); setInstagram(s.instagram); setFacebook(s.facebook);
    setDeliveryFee(s.deliveryFee); setTaxRate(s.taxRate);
    setServiceChargeRate(s.serviceChargeRate); setCardFeeRate(s.cardFeeRate);
    setOpeningHours(Object.keys(s.openingHours).length ? s.openingHours : defaultHours());
    setOrdersEnabled(s.ordersEnabled); setOrderPauseMessage(s.orderPauseMessage);
    setPickupEnabled(s.pickupEnabled); setDeliveryEnabled(s.deliveryEnabled);
    // Extended fields arrive once the 20260826 migration has run; defaults hold until then.
    if (s.minimumOrder !== undefined) setMinimumOrder(s.minimumOrder);
    if (s.deliveryMinimumOrder !== undefined) setDeliveryMinimumOrder(s.deliveryMinimumOrder);
    if (s.pickupTime !== undefined) setPickupTime(s.pickupTime);
    if (s.deliveryTime !== undefined) setDeliveryTime(s.deliveryTime);
    if (s.pickupInstructions !== undefined) setPickupInstructions(s.pickupInstructions);
    if (s.orderSoundEnabled !== undefined) setOrderSoundEnabled(s.orderSoundEnabled);
    if (s.autoPrintEnabled !== undefined) setAutoPrintEnabled(s.autoPrintEnabled);
  }, [resource.data]);

  const updateDay = useCallback((day: string, patch: Partial<DayHours>) => {
    setOpeningHours((prev) => ({ ...prev, [day]: { ...(prev[day] || emptyDay()), ...patch } }));
  }, []);

  const handleSave = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      await saveSettings({
        name, phone, email, address, suburb, state, postcode,
        googleMaps, instagram, facebook, deliveryFee, taxRate,
        serviceChargeRate, cardFeeRate,
        openingHours, ordersEnabled, orderPauseMessage,
        pickupEnabled, deliveryEnabled,
        minimumOrder, deliveryMinimumOrder,
        pickupTime, deliveryTime, pickupInstructions,
        orderSoundEnabled, autoPrintEnabled,
      });
      toast.show('Settings saved.');
    } catch (err) {
      toast.show(describeError(err, 'Could not save settings.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [name, phone, email, address, suburb, state, postcode, googleMaps, instagram, facebook, deliveryFee, taxRate, serviceChargeRate, cardFeeRate, openingHours, ordersEnabled, orderPauseMessage, pickupEnabled, deliveryEnabled, minimumOrder, deliveryMinimumOrder, pickupTime, deliveryTime, pickupInstructions, orderSoundEnabled, autoPrintEnabled, toast]);

  const toggleOrders = useCallback(async () => {
    const next = !ordersEnabled;
    setOrdersEnabled(next);
    setSaving(true);
    try {
      await saveSettings({ ordersEnabled: next, orderPauseMessage });
      toast.show(next ? 'Online ordering enabled.' : 'Online ordering paused.');
    } catch (err) {
      setOrdersEnabled(!next);
      toast.show(describeError(err, 'Could not update ordering status.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [ordersEnabled, orderPauseMessage, toast]);

  if (resource.loading) {
    return (
      <>
        <div className="admin-head"><h1>Settings</h1></div>
        <div className="vz-stack"><Skeleton height={120} /><Skeleton height={120} /><Skeleton height={120} /></div>
      </>
    );
  }
  if (resource.error) return <p className="vz-error-box">{resource.error}</p>;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Settings</h1>
          <p className="admin-head__sub">The backend source of truth for the whole platform.</p>
        </div>
        <Button onClick={() => void handleSave()} disabled={saving}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      <div className="vz-stack" style={{ gap: 18 }}>
        {/* ── Online ordering ── */}
        <Card pad>
          <div className="vz-row" style={{ gap: 8, marginBottom: 14 }}>
            <ShoppingBag size={18} color="var(--terracotta)" />
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Online orders</h2>
          </div>
          <div className={`orders-toggle ${ordersEnabled ? 'orders-toggle--open' : 'orders-toggle--paused'}`}>
            <div>
              <div className="orders-toggle__status">{ordersEnabled ? 'ACCEPTING ORDERS' : 'ORDERS PAUSED'}</div>
              <div className="vz-muted" style={{ fontSize: '0.85rem' }}>
                {ordersEnabled
                  ? <><CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> Customers can order online.</>
                  : <><XCircle size={13} style={{ verticalAlign: -2 }} /> The public site shows your pause message.</>}
              </div>
            </div>
            <Button variant={ordersEnabled ? 'danger' : 'primary'} onClick={() => void toggleOrders()} disabled={saving}>
              {ordersEnabled ? 'Pause ordering' : 'Resume ordering'}
            </Button>
          </div>
          <div className="vz-row vz-row--wrap" style={{ gap: 22, marginTop: 14 }}>
            <Toggle checked={pickupEnabled} onChange={setPickupEnabled} label="Pickup available" />
            <Toggle checked={deliveryEnabled} onChange={setDeliveryEnabled} label="Delivery available" />
            <Toggle checked={orderSoundEnabled} onChange={setOrderSoundEnabled} label="New-order sound" />
            <Toggle checked={autoPrintEnabled} onChange={setAutoPrintEnabled} label="Auto-print paid orders" />
          </div>
          <p className="vz-muted" style={{ fontSize: '0.82rem', margin: '10px 0 0' }}>
            Toggles save with the button above. Sound and auto-print take effect after the 20260826 migration.
          </p>
          {!ordersEnabled && (
            <Field label="Pause message (shown to customers)" htmlFor="pause-msg">
              <Input id="pause-msg" value={orderPauseMessage} onChange={(e) => setOrderPauseMessage(e.target.value)} placeholder="Online ordering is currently paused. Please try again later." />
            </Field>
          )}
        </Card>

        {/* ── Restaurant info ── */}
        <Card pad>
          <div className="vz-row" style={{ gap: 8, marginBottom: 14 }}>
            <MapPin size={18} color="var(--terracotta)" />
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Restaurant</h2>
          </div>
          <div className="settings-grid">
            <Field label="Business name" htmlFor="s-name"><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vizio Food" /></Field>
            <Field label="Phone" htmlFor="s-phone"><Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(08) 1234 5678" /></Field>
            <Field label="Email" htmlFor="s-email"><Input id="s-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="hello@viziofood.com" /></Field>
            <Field label="Street address" htmlFor="s-address"><Input id="s-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="18 Oxford Street" /></Field>
            <Field label="Suburb" htmlFor="s-suburb"><Input id="s-suburb" value={suburb} onChange={(e) => setSuburb(e.target.value)} placeholder="Leederville" /></Field>
            <Field label="State" htmlFor="s-state"><Input id="s-state" value={state} onChange={(e) => setState(e.target.value)} placeholder="WA" /></Field>
            <Field label="Postcode" htmlFor="s-postcode"><Input id="s-postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="6007" /></Field>
            <Field label="Google Maps URL" htmlFor="s-maps"><Input id="s-maps" value={googleMaps} onChange={(e) => setGoogleMaps(e.target.value)} placeholder="https://maps.google.com/…" /></Field>
            <Field label="Instagram URL" htmlFor="s-ig"><Input id="s-ig" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/viziofood" /></Field>
            <Field label="Facebook URL" htmlFor="s-fb"><Input id="s-fb" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/viziofood" /></Field>
          </div>
        </Card>

        {/* ── Opening hours ── */}
        <Card pad>
          <div className="vz-row" style={{ gap: 8, marginBottom: 14 }}>
            <Clock size={18} color="var(--terracotta)" />
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Opening hours</h2>
          </div>
          <div className="hours-grid">
            {DAY_KEYS.map((day) => {
              const h = openingHours[day] || emptyDay();
              return (
                <div key={day} className="hours-row">
                  <strong>{DAY_LABELS[day]}</strong>
                  <Input type="time" value={h.open} disabled={h.closed} onChange={(e) => updateDay(day, { open: e.target.value })} aria-label={`${DAY_LABELS[day]} opening time`} />
                  <Input type="time" value={h.close} disabled={h.closed} onChange={(e) => updateDay(day, { close: e.target.value })} aria-label={`${DAY_LABELS[day]} closing time`} />
                  <Toggle checked={!h.closed} onChange={(open) => updateDay(day, { closed: !open })} label={h.closed ? 'Closed' : 'Open'} />
                </div>
              );
            })}
          </div>
        </Card>

        {/* ── Delivery, timing & charges ── */}
        <Card pad>
          <div className="vz-row" style={{ gap: 8, marginBottom: 14 }}>
            <Clock size={18} color="var(--terracotta)" />
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Delivery, timing &amp; charges</h2>
          </div>
          <div className="settings-grid">
            <Field label="Delivery fee (AUD)" htmlFor="s-fee">
              <Input id="s-fee" type="number" step="0.01" min="0" value={deliveryFee} onChange={(e) => setDeliveryFee(Number(e.target.value))} />
            </Field>
            <Field label="Minimum order (AUD)" htmlFor="s-min">
              <Input id="s-min" type="number" step="0.01" min="0" value={minimumOrder} onChange={(e) => setMinimumOrder(Number(e.target.value))} />
            </Field>
            <Field label="Delivery minimum order (AUD)" htmlFor="s-dmin">
              <Input id="s-dmin" type="number" step="0.01" min="0" value={deliveryMinimumOrder} onChange={(e) => setDeliveryMinimumOrder(Number(e.target.value))} />
            </Field>
            <Field label="Pickup time (minutes)" htmlFor="s-pTime">
              <Input id="s-pTime" type="number" min="5" value={pickupTime} onChange={(e) => setPickupTime(Number(e.target.value))} />
            </Field>
            <Field label="Delivery time (minutes)" htmlFor="s-dTime">
              <Input id="s-dTime" type="number" min="10" value={deliveryTime} onChange={(e) => setDeliveryTime(Number(e.target.value))} />
            </Field>
            <Field label="Tax rate (%)" htmlFor="s-tax">
              <Input id="s-tax" type="number" step="0.01" min="0" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
            </Field>
            <Field label="Service charge (%)" htmlFor="s-service">
              <Input id="s-service" type="number" step="0.01" min="0" value={serviceChargeRate} onChange={(e) => setServiceChargeRate(Number(e.target.value))} />
            </Field>
            <Field label="Card processing fee (%)" htmlFor="s-card">
              <Input id="s-card" type="number" step="0.01" min="0" value={cardFeeRate} onChange={(e) => setCardFeeRate(Number(e.target.value))} />
            </Field>
            <Field label="Pickup instructions (shown at checkout)" htmlFor="s-pick">
              <Input id="s-pick" value={pickupInstructions} onChange={(e) => setPickupInstructions(e.target.value)} placeholder="Collect from the counter on Oxford Street" />
            </Field>
          </div>
          <p className="vz-muted" style={{ fontSize: '0.84rem', marginBottom: 0 }}>
            Percentages apply to the order subtotal; the card fee applies to the checkout amount before the fee itself
            (no circular math). Delivery fee is fixed and charged for Delivery orders only. All four feed the public
            checkout display and the Stripe total charged by the Edge Function.
          </p>
        </Card>
      </div>
    </>
  );
}
