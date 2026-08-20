import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AtSign,
  CheckCircle2,
  Clock,
  Globe,
  MapPin,
  MessageSquare,
  Phone,
  Save,
  ShoppingBag,
  XCircle,
} from 'lucide-react';
import { PageTitle } from './components';
import { getSettings, saveSettings } from './supabase';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';
import type { DayHours, OpeningHours, RestaurantSettings } from './types';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const defaultHours = (): OpeningHours =>
  Object.fromEntries(DAY_KEYS.map(d => [d, { open: '11:00', close: '21:00', closed: false }])) as OpeningHours;

const emptyDay = (): DayHours => ({ open: '', close: '', closed: true });

// Surfaces the underlying PostgREST error (message + code) instead of a
// generic "failed" so admin issues are diagnosable from the toast alone.
const describeError = (err: unknown, fallback: string): string => {
  if (!(err instanceof Error)) return fallback;
  const code = (err as Error & { code?: string }).code;
  return code ? `${err.message} (${code})` : err.message;
};

export function SettingsPage() {
  const resource = useResource(getSettings);
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  // Local form state — initialised from loaded settings
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
  const [openingHours, setOpeningHours] = useState<OpeningHours>(defaultHours);
  const [ordersEnabled, setOrdersEnabled] = useState(true);
  const [orderPauseMessage, setOrderPauseMessage] = useState('');

  // Sync from loaded data
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
  }, [resource.data]);

  const updateDay = useCallback((day: string, patch: Partial<DayHours>) => {
    setOpeningHours(prev => ({ ...prev, [day]: { ...(prev[day] || emptyDay()), ...patch } }));
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
      });
      toast.show('Settings saved.');
    } catch (err) {
      toast.show(describeError(err, 'Could not save settings.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [name, phone, email, address, suburb, state, postcode, googleMaps, instagram, facebook, deliveryFee, taxRate, serviceChargeRate, cardFeeRate, openingHours, ordersEnabled, orderPauseMessage, toast]);

  const toggleOrders = useCallback(async () => {
    const next = !ordersEnabled;
    setOrdersEnabled(next);
    setSaving(true);
    try {
      await saveSettings({ ordersEnabled: next, orderPauseMessage });
      toast.show(next ? 'Online ordering enabled.' : 'Online ordering paused.');
    } catch (err) {
      setOrdersEnabled(!next); // revert
      toast.show(describeError(err, 'Could not update ordering status.'), 'error');
    } finally {
      setSaving(false);
    }
  }, [ordersEnabled, orderPauseMessage, toast]);

  if (resource.loading) return <section className="admin-page"><PageTitle title="Settings" /><p className="admin-message">Loading…</p></section>;
  if (resource.error) return <section className="admin-page"><PageTitle title="Settings" /><p className="admin-message error">{resource.error}</p></section>;

  return (
    <section className="admin-page settings-page">
      <PageTitle title="Settings">
        <button className="admin-primary" onClick={() => void handleSave()} disabled={saving}>
          <Save size={16} /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </PageTitle>

      {/* ── Online Orders Control ── */}
      <section className="admin-card settings-section">
        <div className="settings-section-header">
          <ShoppingBag size={18} />
          <h2>Online Orders</h2>
        </div>
        <div className="orders-toggle">
          <button
            className={`orders-toggle-button ${ordersEnabled ? 'enabled' : 'paused'}`}
            onClick={toggleOrders}
            disabled={saving}
          >
            <span className="orders-toggle-dot" />
            {ordersEnabled ? 'ACCEPTING ORDERS' : 'ORDERS PAUSED'}
          </button>
          {ordersEnabled ? (
            <p className="orders-status-note">
              <CheckCircle2 size={14} /> Customers can place orders online.
            </p>
          ) : (
            <p className="orders-status-note paused">
              <XCircle size={14} /> Online ordering is currently paused.
            </p>
          )}
          {!ordersEnabled && (
            <label className="settings-field">
              <span>Pause message (shown to customers)</span>
              <input
                value={orderPauseMessage}
                onChange={e => setOrderPauseMessage(e.target.value)}
                placeholder="Online ordering is currently paused. Please try again later."
              />
            </label>
          )}
        </div>
      </section>

      {/* ── Restaurant Information ── */}
      <section className="admin-card settings-section">
        <div className="settings-section-header">
          <MapPin size={18} />
          <h2>Restaurant</h2>
        </div>
        <form className="admin-form settings-grid" onSubmit={handleSave}>
          <label className="settings-field">
            <span>Business name</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Vizio Food" />
          </label>
          <label className="settings-field">
            <span><Phone size={13} /> Phone</span>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(08) 1234 5678" />
          </label>
          <label className="settings-field">
            <span>Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="hello@viziofood.com" />
          </label>
          <label className="settings-field full">
            <span><MapPin size={13} /> Street address</span>
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="18 Oxford Street" />
          </label>
          <label className="settings-field">
            <span>Suburb / locality</span>
            <input value={suburb} onChange={e => setSuburb(e.target.value)} placeholder="Leederville" />
          </label>
          <label className="settings-field">
            <span>State</span>
            <input value={state} onChange={e => setState(e.target.value)} placeholder="WA" />
          </label>
          <label className="settings-field">
            <span>Postcode</span>
            <input value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="6007" />
          </label>
          <label className="settings-field full">
            <span><Globe size={13} /> Google Maps URL</span>
            <input value={googleMaps} onChange={e => setGoogleMaps(e.target.value)} placeholder="https://maps.google.com/..." />
          </label>
          <label className="settings-field">
            <span><AtSign size={13} /> Instagram URL</span>
            <input value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="https://instagram.com/viziofood" />
          </label>
          <label className="settings-field">
            <span>Facebook URL</span>
            <input value={facebook} onChange={e => setFacebook(e.target.value)} placeholder="https://facebook.com/viziofood" />
          </label>
        </form>
      </section>

      {/* ── Opening Hours ── */}
      <section className="admin-card settings-section">
        <div className="settings-section-header">
          <Clock size={18} />
          <h2>Opening Hours</h2>
        </div>
        <div className="hours-grid">
          {DAY_KEYS.map(day => {
            const h = openingHours[day] || emptyDay();
            return (
              <div key={day} className={`hours-row ${h.closed ? 'closed' : ''}`}>
                <label className="hours-day">
                  <span>{DAY_LABELS[day]}</span>
                </label>
                <label className="hours-closed">
                  <input
                    type="checkbox"
                    checked={h.closed}
                    onChange={e => updateDay(day, { closed: e.target.checked })}
                  />
                  Closed
                </label>
                {!h.closed && (
                  <div className="hours-inputs">
                    <input
                      type="time"
                      value={h.open}
                      onChange={e => updateDay(day, { open: e.target.value })}
                    />
                    <span>to</span>
                    <input
                      type="time"
                      value={h.close}
                      onChange={e => updateDay(day, { close: e.target.value })}
                    />
                  </div>
                )}
                {h.closed && <div className="hours-inputs"><em>Closed all day</em></div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Delivery & Charges ── */}
      <section className="admin-card settings-section">
        <div className="settings-section-header">
          <MessageSquare size={18} />
          <h2>Delivery &amp; Charges</h2>
        </div>
        <div className="admin-form settings-grid">
          <label className="settings-field">
            <span>Delivery fee ($)</span>
            <input type="number" step="0.01" min="0" value={deliveryFee} onChange={e => setDeliveryFee(Number(e.target.value))} />
          </label>
          <label className="settings-field">
            <span>Tax rate (%)</span>
            <input type="number" step="0.01" min="0" value={taxRate} onChange={e => setTaxRate(Number(e.target.value))} />
          </label>
          <label className="settings-field">
            <span>Service charge (%)</span>
            <input type="number" step="0.01" min="0" value={serviceChargeRate} onChange={e => setServiceChargeRate(Number(e.target.value))} />
          </label>
          <label className="settings-field">
            <span>Card processing fee (%)</span>
            <input type="number" step="0.01" min="0" value={cardFeeRate} onChange={e => setCardFeeRate(Number(e.target.value))} />
          </label>
        </div>
        <p className="settings-hint">
          Percentages apply to the order subtotal; the card processing fee applies to the checkout amount before the fee itself. Delivery fee is a fixed amount charged for Delivery orders only. All four feed the public checkout and the Stripe total.
        </p>
      </section>
    </section>
  );
}
