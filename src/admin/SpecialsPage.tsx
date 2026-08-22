/**
 * Specials admin — full lifecycle for the Special of the Day: create, edit,
 * duplicate, schedule (dates, time window, days of week), activate, archive,
 * and a live "what's showing now" preview using the exact resolution rules
 * the public homepage applies.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Copy, Eye, Pencil, Plus, Sparkles } from 'lucide-react';
import {
  archiveSpecial,
  createSpecial,
  deleteSpecial,
  duplicateSpecial,
  getSpecials,
  updateSpecial,
} from '../services/specials';
import { describeSchedule, isSpecialLive } from '../lib/specials';
import { specialDraftSchema } from '../lib/validation';
import type { Special, SpecialDraft } from '../types';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea, Toggle } from '../ui';
import { aud } from '../lib/money';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const emptyDraft = (): SpecialDraft => ({
  title: '',
  description: '',
  imageUrl: null,
  price: 0,
  originalPrice: null,
  active: false,
  archived: false,
  startDate: null,
  endDate: null,
  startTime: null,
  endTime: null,
  daysOfWeek: [],
  ctaText: 'Order now',
  ctaLink: '/menu',
  category: '',
  dietary: [],
  ingredients: [],
  allergens: [],
  badge: 'Special',
  priority: 100,
  displayLocation: 'both',
  productId: null,
  stockQuantity: null,
});

const draftFromSpecial = (special: Special): SpecialDraft => ({
  title: special.title,
  description: special.description,
  imageUrl: special.imageUrl,
  price: special.price,
  originalPrice: special.originalPrice,
  active: special.active,
  archived: special.archived,
  startDate: special.startDate,
  endDate: special.endDate,
  startTime: special.startTime,
  endTime: special.endTime,
  daysOfWeek: special.daysOfWeek,
  ctaText: special.ctaText,
  ctaLink: special.ctaLink,
  category: special.category,
  dietary: special.dietary,
  ingredients: special.ingredients,
  allergens: special.allergens,
  badge: special.badge,
  priority: special.priority,
  displayLocation: special.displayLocation,
  productId: special.productId,
  stockQuantity: special.stockQuantity,
});

function SpecialEditor({
  draft,
  editingId,
  onClose,
  onSaved,
}: {
  draft: SpecialDraft;
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SpecialDraft>(draft);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const set = <K extends keyof SpecialDraft>(key: K, value: SpecialDraft[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const parsed = specialDraftSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      if (editingId) await updateSpecial(editingId, form);
      else await createSpecial(form);
      toast.show(editingId ? 'Special updated' : 'Special created');
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the special.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={editingId ? 'Edit special' : 'New special'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save special'}</Button>
        </>
      }
    >
      {error && <p className="vz-field__error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}

      <Field label="Title" htmlFor="sp-title">
        <Input id="sp-title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Chicken Alfredo Special" />
      </Field>
      <Field label="Description" htmlFor="sp-desc">
        <Textarea id="sp-desc" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Price (AUD)" htmlFor="sp-price">
          <Input id="sp-price" type="number" min={0} step="0.10" value={form.price} onChange={(e) => set('price', Number(e.target.value))} />
        </Field>
        <Field label="Original price" hint="For the strike-through" htmlFor="sp-was">
          <Input id="sp-was" type="number" min={0} step="0.10" value={form.originalPrice ?? ''} onChange={(e) => set('originalPrice', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
        <Field label="Badge" htmlFor="sp-badge">
          <Input id="sp-badge" value={form.badge} onChange={(e) => set('badge', e.target.value)} placeholder="Special" />
        </Field>
      </div>

      <Field label="Image URL" hint="Upload via Products or Branding, then paste the URL" htmlFor="sp-image">
        <Input id="sp-image" value={form.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value || null)} placeholder="https://…" />
      </Field>

      <h3 style={{ marginTop: 22, fontSize: '1.05rem' }}>Schedule</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Start date" htmlFor="sp-start">
          <Input id="sp-start" type="date" value={form.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || null)} />
        </Field>
        <Field label="End date" htmlFor="sp-end">
          <Input id="sp-end" type="date" value={form.endDate ?? ''} onChange={(e) => set('endDate', e.target.value || null)} />
        </Field>
        <Field label="Start time" hint="Blank = all day" htmlFor="sp-time-start">
          <Input id="sp-time-start" type="time" value={form.startTime ?? ''} onChange={(e) => set('startTime', e.target.value || null)} />
        </Field>
        <Field label="End time" htmlFor="sp-time-end">
          <Input id="sp-time-end" type="time" value={form.endTime ?? ''} onChange={(e) => set('endTime', e.target.value || null)} />
        </Field>
      </div>
      <Field label="Days of week" hint="Leave all unchecked to run every day">
        <div className="vz-row vz-row--wrap">
          {DAYS.map((day, index) => {
            const checked = form.daysOfWeek.includes(index);
            return (
              <button
                key={day}
                type="button"
                className={`vz-btn vz-btn--sm ${checked ? 'vz-btn--primary' : 'vz-btn--secondary'}`}
                aria-pressed={checked}
                onClick={() =>
                  set('daysOfWeek', checked ? form.daysOfWeek.filter((d) => d !== index) : [...form.daysOfWeek, index])
                }
              >
                {day}
              </button>
            );
          })}
        </div>
      </Field>

      <h3 style={{ marginTop: 22, fontSize: '1.05rem' }}>Display</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="CTA text" htmlFor="sp-cta">
          <Input id="sp-cta" value={form.ctaText} onChange={(e) => set('ctaText', e.target.value)} />
        </Field>
        <Field label="CTA link" htmlFor="sp-link">
          <Input id="sp-link" value={form.ctaLink} onChange={(e) => set('ctaLink', e.target.value)} placeholder="/menu" />
        </Field>
        <Field label="Where it shows" htmlFor="sp-location">
          <Select id="sp-location" value={form.displayLocation} onChange={(e) => set('displayLocation', e.target.value as SpecialDraft['displayLocation'])}>
            <option value="homepage">Homepage only</option>
            <option value="menu">Menu only</option>
            <option value="both">Homepage + menu</option>
          </Select>
        </Field>
        <Field label="Priority" hint="Lower shows first" htmlFor="sp-priority">
          <Input id="sp-priority" type="number" min={0} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
        </Field>
      </div>

      <Field label="Dietary tags (comma separated)" htmlFor="sp-dietary">
        <Input id="sp-dietary" value={form.dietary.join(', ')} onChange={(e) => set('dietary', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </Field>
      <Field label="Ingredients (comma separated)" htmlFor="sp-ingredients">
        <Input id="sp-ingredients" value={form.ingredients.join(', ')} onChange={(e) => set('ingredients', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </Field>
      <Field label="Allergens (comma separated)" htmlFor="sp-allergens">
        <Input id="sp-allergens" value={form.allergens.join(', ')} onChange={(e) => set('allergens', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
      </Field>

      <div className="vz-row vz-row--wrap" style={{ gap: 22, marginTop: 18 }}>
        <Toggle checked={form.active} onChange={(v) => set('active', v)} label="Active" />
        <Toggle checked={form.archived} onChange={(v) => set('archived', v)} label="Archived" />
      </div>
    </Modal>
  );
}

export default function SpecialsPage() {
  const [specials, setSpecials] = useState<Special[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; draft: SpecialDraft } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setSpecials(await getSpecials());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load specials.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (specials ?? []).filter((s) => (showArchived ? true : !s.archived)),
    [specials, showArchived],
  );
  const liveNow = useMemo(
    () => (specials ?? []).filter((s) => isSpecialLive(s)).length,
    [specials],
  );

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Specials</h1>
          <p className="admin-head__sub">
            Dedicated Special of the Day — scheduled by date, time and day of week.
            {specials && ` ${liveNow} live right now.`}
          </p>
        </div>
        <Button onClick={() => setEditing({ id: null, draft: emptyDraft() })}>
          <Plus size={16} /> New special
        </Button>
      </div>

      {error && <p className="vz-error-box" style={{ marginBottom: 14 }}>{error}</p>}

      <div className="vz-row" style={{ marginBottom: 14 }}>
        <Toggle checked={showArchived} onChange={setShowArchived} label="Show archived" />
      </div>

      {specials === null ? (
        <div className="vz-stack">
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<Sparkles size={34} />} title="No specials yet">
          Create the first Special of the Day — it can be scheduled for specific weekdays.
        </EmptyState>
      ) : (
        <div className="admin-list">
          {visible.map((special) => {
            const live = isSpecialLive(special);
            return (
              <div className="admin-list__row" key={special.id}>
                <div className="admin-list__main">
                  <div className="admin-list__title">
                    {special.title}{' '}
                    {live ? <Badge tone="olive" dot>Live now</Badge> : special.archived ? <Badge tone="neutral">Archived</Badge> : special.active ? <Badge tone="info">Scheduled</Badge> : <Badge tone="neutral">Off</Badge>}
                  </div>
                  <div className="admin-list__sub">
                    <CalendarClock size={13} style={{ verticalAlign: -2 }} /> {describeSchedule(special)} · {aud(special.price)}
                    {special.originalPrice ? ` (was ${aud(special.originalPrice)})` : ''}
                  </div>
                </div>
                <div className="vz-row">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ id: special.id, draft: draftFromSpecial(special) })} aria-label={`Edit ${special.title}`}>
                    <Pencil size={15} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void duplicateSpecial(special.id).then(() => { toast.show('Special duplicated'); void load(); })}
                    aria-label={`Duplicate ${special.title}`}
                  >
                    <Copy size={15} />
                  </Button>
                  <Button
                    size="sm"
                    variant={special.active ? 'secondary' : 'primary'}
                    disabled={special.archived}
                    onClick={() =>
                      void updateSpecial(special.id, { active: !special.active }).then(() => {
                        toast.show(special.active ? 'Special deactivated' : 'Special activated');
                        void load();
                      })
                    }
                  >
                    {special.active ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void archiveSpecial(special.id, !special.archived).then(() => {
                        toast.show(special.archived ? 'Restored' : 'Archived');
                        void load();
                      })
                    }
                  >
                    {special.archived ? 'Restore' : 'Archive'}
                  </Button>
                  {!special.archived && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (!window.confirm(`Delete "${special.title}" permanently?`)) return;
                        void deleteSpecial(special.id).then(() => {
                          toast.show('Special deleted');
                          void load();
                        });
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <SpecialEditor
          draft={editing.draft}
          editingId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}

      <Card pad flat style={{ marginTop: 26 }}>
        <div className="vz-row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <Eye size={18} color="var(--muted)" />
          <p className="vz-muted" style={{ margin: 0 }}>
            The homepage picks the highest-priority live special (lower number wins, ties broken by age).
            Display rules: date window → time window → days of week → stock.
          </p>
        </div>
      </Card>
    </>
  );
}
