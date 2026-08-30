/**
 * Coupons admin — percent/fixed discounts with minimum order, product/
 * category scoping, date windows, and usage limits. Validation happens on
 * save (client) and again server-side in create-checkout before charging.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Tag } from 'lucide-react';
import { deleteCoupon, getCoupons, saveCoupon } from '../services/coupons';
import { couponDraftSchema } from '../lib/validation';
import type { Coupon } from '../types';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, Toggle } from '../ui';
import { aud } from '../lib/money';

const emptyCoupon = (): Coupon => ({
  id: '',
  code: '',
  kind: 'percent',
  value: 10,
  minimumOrder: 0,
  productIds: [],
  categoryNames: [],
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  timesUsed: 0,
  active: true,
});

function CouponEditor({ coupon, onClose, onSaved }: { coupon: Coupon; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Coupon>(coupon);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    const parsed = couponDraftSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors.');
      return;
    }
    if (form.kind === 'percent' && form.value > 100) {
      setError('A percentage discount cannot exceed 100.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveCoupon(form);
      toast.show(coupon.id ? 'Coupon updated' : 'Coupon created');
      onSaved();
      onClose();
    } catch (reason) {
      // supabase-js throws PostgrestError as a PLAIN OBJECT (not an Error),
      // so reason.message never hits the Error branch — surface message+code.
      const detail = reason instanceof Error
        ? reason.message
        : `${(reason as { message?: string })?.message ?? 'Could not save the coupon.'}${
            (reason as { code?: string })?.code ? ` (${(reason as { code: string }).code})` : ''
          }`;
      setError(detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={coupon.id ? `Edit ${coupon.code}` : 'New coupon'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save coupon'}</Button>
        </>
      }
    >
      {error && <p className="vz-field__error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      <Field label="Code" hint="Customers type this at checkout" htmlFor="cp-code">
        <Input id="cp-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="PASTA10" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Type" htmlFor="cp-kind">
          <Select id="cp-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Coupon['kind'] })}>
            <option value="percent">Percentage off</option>
            <option value="fixed">Fixed amount off</option>
          </Select>
        </Field>
        <Field label={form.kind === 'percent' ? 'Percent (0–100)' : 'Amount (AUD)'} htmlFor="cp-value">
          <Input id="cp-value" type="number" min={0} step={form.kind === 'percent' ? 1 : 0.5} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Minimum order (AUD)" hint="0 = no minimum" htmlFor="cp-min">
        <Input id="cp-min" type="number" min={0} step="0.50" value={form.minimumOrder} onChange={(e) => setForm({ ...form, minimumOrder: Number(e.target.value) })} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Starts (optional)" htmlFor="cp-start">
          <Input id="cp-start" type="datetime-local" value={form.startsAt ?? ''} onChange={(e) => setForm({ ...form, startsAt: e.target.value || null })} />
        </Field>
        <Field label="Ends (optional)" htmlFor="cp-end">
          <Input id="cp-end" type="datetime-local" value={form.endsAt ?? ''} onChange={(e) => setForm({ ...form, endsAt: e.target.value || null })} />
        </Field>
      </div>
      <Field label="Usage limit" hint="Blank = unlimited" htmlFor="cp-limit">
        <Input id="cp-limit" type="number" min={1} value={form.usageLimit ?? ''} onChange={(e) => setForm({ ...form, usageLimit: e.target.value === '' ? null : Number(e.target.value) })} />
      </Field>
      <Field label="Category scope" hint="Blank = whole order. Comma-separated category names." htmlFor="cp-cats">
        <Input id="cp-cats" value={form.categoryNames.join(', ')} onChange={(e) => setForm({ ...form, categoryNames: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="Pasta, Dessert" />
      </Field>
      <div style={{ marginTop: 16 }}>
        <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Active" />
      </div>
    </Modal>
  );
}

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Coupon | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setCoupons(await getCoupons());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load coupons.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Coupons</h1>
          <p className="admin-head__sub">Percentage or fixed discounts, validated server-side at checkout.</p>
        </div>
        <Button onClick={() => setEditing(emptyCoupon())}><Plus size={16} /> New coupon</Button>
      </div>

      {error && <p className="vz-error-box" style={{ marginBottom: 14 }}>{error}</p>}
      {error && error.includes('42P01') === false && error.toLowerCase().includes('column') && (
        <Card pad flat style={{ marginBottom: 14 }}>
          <p className="vz-muted" style={{ margin: 0 }}>
            The database may be missing the coupon extension columns — apply the 20260826 migration to unlock
            scoping, windows and usage limits.
          </p>
        </Card>
      )}

      {coupons === null ? (
        <div className="vz-stack"><Skeleton height={60} /><Skeleton height={60} /></div>
      ) : coupons.length === 0 ? (
        <EmptyState icon={<Tag size={34} />} title="No coupons yet">Create the first discount code.</EmptyState>
      ) : (
        <div className="vz-table-wrap">
          <table className="vz-table">
            <thead>
              <tr>
                <th>Code</th><th>Discount</th><th>Min order</th><th>Used</th><th>Window</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td><strong>{coupon.code}</strong></td>
                  <td>{coupon.kind === 'percent' ? `${coupon.value}%` : aud(coupon.value)}</td>
                  <td>{coupon.minimumOrder ? aud(coupon.minimumOrder) : '—'}</td>
                  <td>
                    {coupon.timesUsed}
                    {coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}
                  </td>
                  <td className="vz-muted">
                    {coupon.startsAt || coupon.endsAt
                      ? `${coupon.startsAt?.slice(0, 10) ?? '…'} → ${coupon.endsAt?.slice(0, 10) ?? '…'}`
                      : 'Always'}
                  </td>
                  <td>{coupon.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral">Off</Badge>}</td>
                  <td>
                    <div className="vz-row">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(coupon)}>Edit</Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (!window.confirm(`Delete coupon ${coupon.code}?`)) return;
                          void deleteCoupon(coupon.id).then(() => {
                            toast.show('Coupon deleted');
                            void load();
                          });
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <CouponEditor coupon={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
    </>
  );
}
