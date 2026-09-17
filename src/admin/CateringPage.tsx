// Admin → Catering & Bulk Buy — the complete management surface for the
// public catering page, delivery rules, raw pasta and enquiries. Everything
// saves to catering_settings / products / catering_faqs / catering_steps /
// catering_enquiries and reaches the public page + payment Edge Functions in
// realtime. Frontend values are NEVER authoritative for pricing — the server
// re-reads them at checkout time.

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, MapPin, Plus, Save, Trash2 } from 'lucide-react';
import {
  createCateringFaq, createCateringStep, deleteCateringFaq, deleteCateringStep,
  getCateringEnquiries, getCateringFaqs, getCateringProducts, getCateringSettings, getCateringSteps,
  saveCateringSettings, updateCateringEnquiry, updateCateringFaq, updateCateringProduct, updateCateringStep,
  verifyOriginLocation, type AdminCateringProduct,
} from './cateringService';
import { CATERING_UNIT, cateringServesText, defaultCateringSettings, DEFAULT_CATERING_CONTENT, DEFAULT_CATERING_SEO, type CateringSettings } from '../lib/catering';
import { useToast } from '../components/Toast';
import { useResource } from './useResource';
import { PageTitle } from './components';
import { CategoriesTab, CateringOrdersTab, NewCateringProduct, ProductEditor, duplicateProduct } from './cateringTabs';
import { getCateringCategories, type CateringCategory } from './cateringService';
import { CopyPlus, Pencil } from 'lucide-react';

const money = (value: number) => `$${value.toFixed(2)}`;
type TabId = 'overview' | 'delivery' | 'products' | 'categories' | 'rawPasta' | 'content' | 'faq' | 'steps' | 'enquiries' | 'orders';
const TABS: [TabId, string][] = [
  ['overview', 'Overview'], ['delivery', 'Delivery'], ['products', 'Products'], ['rawPasta', 'Raw pasta'],
  ['categories', 'Categories'], ['content', 'Page content'], ['faq', 'FAQ'], ['steps', 'How it works'], ['enquiries', 'Enquiries'], ['orders', 'Catering orders'],
];

const label = (text: string, node: React.ReactNode, hint?: string) => (
  <label className="admin-field">{text}{node}{hint && <small>{hint}</small>}</label>
);

function Toggle({ checked, onChange, text }: { checked: boolean; onChange: (next: boolean) => void; text: string }) {
  return (
    <label className="admin-toggle">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>{text}</span>
    </label>
  );
}

function Chip({ on, onText, offText }: { on: boolean; onText: string; offText: string }) {
  return <span className={`status ${on ? 'active' : 'cancelled'}`}>{on ? onText : offText}</span>;
}

function Overview({ draft }: { draft: CateringSettings }) {
  const cards: [string, React.ReactNode, string][] = [
    ['Catering', <Chip on={draft.cateringOrdersEnabled} onText="ACTIVE" offText="OFF" key="c" />, 'Customers can place catering orders.'],
    ['Raw Pasta', <Chip on={draft.rawPastaOrdersEnabled} onText="ACTIVE" offText="OFF" key="r" />, `${money(draft.rawPastaPrice)} per ${draft.rawPastaWeightGrams}g portion.`],
    ['Pickup', <Chip on={draft.pickupEnabled} onText="ACTIVE" offText="OFF" key="p" />, 'Available for all eligible orders.'],
    ['Delivery', <Chip on={draft.deliveryEnabled} onText="ACTIVE" offText="OFF" key="d" />, `Within ${draft.deliveryRadiusKm} km of the restaurant.`],
    ['Delivery Radius', <span className="status new">{draft.deliveryRadiusKm} km</span>, draft.originLat !== null ? 'Origin configured — radius enforced at checkout.' : 'Set the restaurant coordinates to enforce the radius.'],
    ['Delivery Fee', <span className="status new">{money(draft.deliveryFee)}</span>, `Applies below the ${money(draft.freeDeliveryThreshold)} free-delivery threshold.`],
    ['Free Delivery', <span className="status confirmed">{money(draft.freeDeliveryThreshold)}+</span>, 'Orders at or above the threshold pay no delivery fee.'],
    ['Service Charge', <span className="status confirmed">$0 at {money(draft.serviceChargeWaiverThreshold)}+</span>, 'Orders at or above the threshold pay no service charge.'],
    ['Page', <Chip on={draft.pageEnabled} onText="PUBLISHED" offText="UNPUBLISHED" key="pg" />, 'The public Catering & Bulk Buy page.'],
  ];
  return (
    <div className="admin-card">
      {draft.originLat === null && (
        <p className="admin-message"><MapPin size={13} style={{ verticalAlign: -2 }} /> Delivery radius is not enforced yet — set the restaurant coordinates in the Delivery tab.</p>
      )}
      <div className="admin-glance">
        {cards.map(([title, chip, hint]) => (
          <div className="admin-glance-card" key={title}>
            <div><strong>{title}</strong> {chip}</div>
            <small>{hint}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductsTab() {
  const resource = useResource(getCateringProducts);
  const categoriesResource = useResource(getCateringCategories);
  const categories: CateringCategory[] = categoriesResource.data ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const toast = useToast();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminCateringProduct[]>([]);
  useEffect(() => { setRows(resource.data ?? []); }, [resource.data]);
  const patch = (id: string, changes: Partial<AdminCateringProduct['flags']>) =>
    setRows(current => current.map(product => product.id === id ? { ...product, flags: { ...product.flags, ...changes } } : product));
  const save = async (product: AdminCateringProduct) => {
    setSavingId(product.id);
    try {
      await updateCateringProduct(product.id, { ...product.flags });
      toast.show(`${product.name} saved.`);
      void resource.reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save.', 'error');
    } finally {
      setSavingId(null);
    }
  };
  if (resource.loading) return <div className="admin-card"><p>Loading products…</p></div>;
  if (resource.error) return <div className="admin-card"><p className="admin-message">{resource.error} — the 20260917 migration may not be applied yet.</p></div>;
  return (
    <div className="admin-card">
      <NewCateringProduct categories={categories} onCreated={() => void resource.reload()} />
      <p className="muted">Control which products appear on the Catering &amp; Bulk Buy page. Lasagna is excluded from catering and raw pasta by default — its row shows where it is switched off. Empty price overrides fall back to the central catering/raw price.</p>
      <div className="admin-product-list">
        {rows.map(product => (
          <div className="admin-product-row" key={product.id}>
            <div className="admin-product-head">
              <div>
                <strong>{product.name}</strong>
                {product.isLasagna && <span className="status cancelled">Lasagna — excluded by default</span>}
                {product.isExcluded && !product.isLasagna && <span className="status cancelled">Excluded from catering</span>}
                {product.isCombo && <span className="status new">Combo</span>}
                {!product.active && <span className="status cancelled">Inactive</span>}
                {product.archived && <span className="status cancelled">Archived</span>}
                <div><small>{product.category} · menu {money(product.price)} · catering unit: {CATERING_UNIT} — {cateringServesText.replace('Serves approximately ', 'serves ').replace('.', '')}</small></div>
              </div>
              <div className="admin-product-toggles">
                <Toggle checked={product.flags.cateringAvailable} onChange={next => patch(product.id, { cateringAvailable: next })} text="Catering" />
                <Toggle checked={product.flags.bulkAvailable} onChange={next => patch(product.id, { bulkAvailable: next })} text="Bulk buy" />
                <Toggle checked={product.flags.rawPastaAvailable} onChange={next => patch(product.id, { rawPastaAvailable: next })} text="Raw pasta" />
              </div>
            </div>
            <div className="admin-product-fields">
              {label(`Catering price per ${CATERING_UNIT}`, <input type="number" step="0.01" min="0" value={product.flags.cateringPrice ?? ''} onChange={e => patch(product.id, { cateringPrice: e.target.value === '' ? null : Number(e.target.value) })} />, 'Default $75 — Campanelle with Prawns $85. Blank falls back to that rule.')}
              {label('Raw pasta price (optional)', <input type="number" step="0.01" min="0" value={product.flags.rawPastaPriceOverride ?? ''} onChange={e => patch(product.id, { rawPastaPriceOverride: e.target.value === '' ? null : Number(e.target.value) })} />, 'Blank = central raw price.')}
              {label('Raw weight g (optional)', <input type="number" min="1" value={product.flags.rawPastaWeightGramsOverride ?? ''} onChange={e => patch(product.id, { rawPastaWeightGramsOverride: e.target.value === '' ? null : Number(e.target.value) })} />, 'Blank = central weight.')}
              {label('Min qty', <input type="number" min="1" value={product.flags.cateringMinQty} onChange={e => patch(product.id, { cateringMinQty: Number(e.target.value) })} />)}
              {label('Max qty (optional)', <input type="number" min="1" value={product.flags.cateringMaxQty ?? ''} onChange={e => patch(product.id, { cateringMaxQty: e.target.value === '' ? null : Number(e.target.value) })} />, 'Blank = no limit.')}
            </div>
            <div className="admin-product-toggles" style={{ justifyContent: 'flex-end' }}>
              <button className="textlink" type="button" onClick={() => setEditing(editing === product.id ? null : product.id)}><Pencil size={14} /> Edit details</button>
              <button className="textlink" type="button" onClick={() => void duplicateProduct(product.id).then(() => { toast.show('Product duplicated (hidden copy).'); void resource.reload(); }).catch(reason => toast.show(reason instanceof Error ? reason.message : 'Could not duplicate.', 'error'))}><CopyPlus size={14} /> Duplicate</button>
              <button className="button small" type="button" onClick={() => void save(product)} disabled={savingId === product.id}>
                <Save size={14} /> {savingId === product.id ? 'Saving…' : 'Save flags'}
              </button>
            </div>
            {editing === product.id && <ProductEditor product={product} categories={categories} onClose={() => setEditing(null)} onSaved={() => void resource.reload()} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqTab() {
  const resource = useResource(getCateringFaqs);
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const faqs = resource.data ?? [];
  const add = async () => {
    if (question.trim().length < 3 || answer.trim().length < 1) { toast.show('Add both a question and an answer.', 'error'); return; }
    try {
      await createCateringFaq(question, answer);
      setQuestion(''); setAnswer('');
      toast.show('FAQ added.');
      void resource.reload();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not add.', 'error'); }
  };
  const move = async (index: number, direction: -1 | 1) => {
    const swap = index + direction;
    if (swap < 0 || swap >= faqs.length) return;
    try {
      await updateCateringFaq(faqs[index].id, { displayOrder: faqs[swap].displayOrder });
      await updateCateringFaq(faqs[swap].id, { displayOrder: faqs[index].displayOrder });
      void resource.reload();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not reorder.', 'error'); }
  };
  return (
    <div className="admin-card">
      <h3>Add FAQ</h3>
      {label('Question', <input value={question} onChange={e => setQuestion(e.target.value)} />)}
      {label('Answer', <textarea rows={3} value={answer} onChange={e => setAnswer(e.target.value)} />)}
      <button className="button small" type="button" onClick={() => void add()}><Plus size={14} /> Add FAQ</button>
      <h3 style={{ marginTop: '2rem' }}>FAQ items ({faqs.length})</h3>
      {faqs.length === 0 && <p className="muted">Built-in defaults show until you add some.</p>}
      {faqs.map((faq, index) => (
        <div className="admin-product-row" key={faq.id}>
          <div className="admin-product-head">
            <div>
              <strong>{faq.question}</strong>
              <div><small>{faq.answer}</small></div>
            </div>
            <div className="admin-product-toggles">
              <Toggle checked={faq.active} onChange={next => void updateCateringFaq(faq.id, { active: next }).then(() => resource.reload())} text={faq.active ? 'On' : 'Off'} />
              <button className="textlink" type="button" aria-label="Move up" disabled={index === 0} onClick={() => void move(index, -1)}><ArrowUp size={14} /></button>
              <button className="textlink" type="button" aria-label="Move down" disabled={index === faqs.length - 1} onClick={() => void move(index, 1)}><ArrowDown size={14} /></button>
              <button className="textlink" type="button" aria-label="Delete FAQ" onClick={() => { if (confirm('Delete this FAQ?')) void deleteCateringFaq(faq.id).then(() => resource.reload()); }}><Trash2 size={14} /></button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StepsTab() {
  const resource = useResource(getCateringSteps);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const steps = resource.data ?? [];
  const add = async () => {
    if (title.trim().length < 2) { toast.show('Add a step title.', 'error'); return; }
    try {
      await createCateringStep(title, description);
      setTitle(''); setDescription('');
      toast.show('Step added.');
      void resource.reload();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not add.', 'error'); }
  };
  const move = async (index: number, direction: -1 | 1) => {
    const swap = index + direction;
    if (swap < 0 || swap >= steps.length) return;
    try {
      await updateCateringStep(steps[index].id, { displayOrder: steps[swap].displayOrder });
      await updateCateringStep(steps[swap].id, { displayOrder: steps[index].displayOrder });
      void resource.reload();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not reorder.', 'error'); }
  };
  return (
    <div className="admin-card">
      <h3>Add step</h3>
      {label('Step title', <input value={title} onChange={e => setTitle(e.target.value)} />)}
      {label('Step description (optional)', <input value={description} onChange={e => setDescription(e.target.value)} />)}
      <button className="button small" type="button" onClick={() => void add()}><Plus size={14} /> Add step</button>
      <h3 style={{ marginTop: '2rem' }}>Steps ({steps.length})</h3>
      {steps.length === 0 && <p className="muted">Built-in defaults show until you add some.</p>}
      {steps.map((step, index) => (
        <div className="admin-product-row" key={step.id}>
          <div className="admin-product-head">
            <div>
              <strong>{index + 1}. {step.stepTitle}</strong>
              {step.stepDescription && <div><small>{step.stepDescription}</small></div>}
            </div>
            <div className="admin-product-toggles">
              <Toggle checked={step.active} onChange={next => void updateCateringStep(step.id, { active: next }).then(() => resource.reload())} text={step.active ? 'On' : 'Off'} />
              <button className="textlink" type="button" aria-label="Move step up" disabled={index === 0} onClick={() => void move(index, -1)}><ArrowUp size={14} /></button>
              <button className="textlink" type="button" aria-label="Move step down" disabled={index === steps.length - 1} onClick={() => void move(index, 1)}><ArrowDown size={14} /></button>
              <button className="textlink" type="button" aria-label="Delete step" onClick={() => { if (confirm('Delete this step?')) void deleteCateringStep(step.id).then(() => resource.reload()); }}><Trash2 size={14} /></button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EnquiriesTab() {
  const resource = useResource(getCateringEnquiries);
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const enquiries = resource.data ?? [];
  const setStatus = async (id: string, name: string, status: string) => {
    try {
      await updateCateringEnquiry(id, { status: status as Parameters<typeof updateCateringEnquiry>[1]['status'] });
      toast.show(`${name} → ${status}`);
      void resource.reload();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not update.', 'error'); }
  };
  if (resource.loading) return <div className="admin-card"><p>Loading enquiries…</p></div>;
  if (resource.error) return <div className="admin-card"><p className="admin-message">{resource.error} — the 20260917 migration may not be applied yet.</p></div>;
  return (
    <div className="admin-card">
      <h3>Catering enquiries ({enquiries.length})</h3>
      {enquiries.length === 0 && <p className="muted">Enquiries from the public catering page land here.</p>}
      {enquiries.map(enquiry => (
        <div className="admin-product-row" key={enquiry.id}>
          <div className="admin-product-head">
            <div>
              <strong>{enquiry.name}</strong> <span className={`status ${enquiry.status.toLowerCase()}`}>{enquiry.status}</span>
              {enquiry.notificationSent === true && <span className="status active">Email sent</span>}
              {enquiry.notificationSent !== true && enquiry.notificationError && <span className="status cancelled" title={enquiry.notificationError}>Email failed</span>}
              {enquiry.notificationSent === false && !enquiry.notificationError && <span className="status completed">Email not sent</span>}
              <div>
                <small>
                  <a href={`tel:${enquiry.phone}`}>{enquiry.phone}</a> · <a href={`mailto:${enquiry.email}`}>{enquiry.email}</a>
                  {enquiry.eventDate && <> · Event {new Date(enquiry.eventDate).toLocaleDateString('en-AU')}</>}
                  {enquiry.guests !== null && <> · Guests {enquiry.guests}</>}
                  {enquiry.estimatedOrderSize && <> · Size {enquiry.estimatedOrderSize}</>}
                  {enquiry.preferredFulfilment !== 'Unsure' && <> · Prefers {enquiry.preferredFulfilment}</>}
                  {' '}· {new Date(enquiry.createdAt).toLocaleString('en-AU')}
                </small>
              </div>
            </div>
            <div>
              <select value={enquiry.status} onChange={event => void setStatus(enquiry.id, enquiry.name, event.target.value)} aria-label={`Status for ${enquiry.name}`}>
                {['New', 'Contacted', 'Quoted', 'Confirmed', 'Completed', 'Cancelled'].map(status => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
          </div>
          {enquiry.preferredFulfilment === 'Delivery' && enquiry.deliveryAddress && <p><small>Delivery: {enquiry.deliveryAddress}</small></p>}
          {enquiry.dietaryNotes && <p><small><b>Dietary:</b> {enquiry.dietaryNotes}</small></p>}
          {enquiry.message && <p><small><b>Message:</b> {enquiry.message}</small></p>}
          <div className="admin-product-fields" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
            {label('Internal notes', <input value={notes[enquiry.id] ?? enquiry.adminNotes} onChange={e => setNotes(current => ({ ...current, [enquiry.id]: e.target.value }))} />)}
            <button className="button small" type="button" onClick={() => void updateCateringEnquiry(enquiry.id, { adminNotes: notes[enquiry.id] ?? enquiry.adminNotes }).then(() => { toast.show('Notes saved.'); void resource.reload(); })}>Save notes</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CateringAdminPage() {
  const [tab, setTab] = useState<TabId>('overview');
  const [draft, setDraft] = useState<CateringSettings>(defaultCateringSettings());
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    getCateringSettings()
      .then(settings => { if (cancelled) return; if (settings) { setDraft(settings); setConfigured(true); } else setConfigured(false); setLoadError(null); })
      .catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load catering settings.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const patch = useCallback((next: Partial<CateringSettings>) => setDraft(current => ({ ...current, ...next })), []);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      await saveCateringSettings(draft);
      setConfigured(true);
      toast.show('Catering settings saved.');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save catering settings.', 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, toast]);

  const verifyOrigin = async () => {
    if (draft.originAddress.trim().length < 5) { toast.show('Enter the restaurant street address first.', 'error'); return; }
    setVerifying(true);
    try {
      const point = await verifyOriginLocation(draft.originAddress);
      patch({ originLat: Number(point.lat.toFixed(6)), originLng: Number(point.lng.toFixed(6)) });
      toast.show('Location found — coordinates filled. Remember to save.');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Address lookup failed.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) return <div className="catering-admin"><PageTitle title="Catering & Bulk Buy"><p>Loading…</p></PageTitle></div>;
  if (loadError) return <div className="catering-admin"><PageTitle title="Catering & Bulk Buy"><p className="admin-message">{loadError}</p></PageTitle></div>;

  return (
    <div className="catering-admin">
      <PageTitle title="Catering & Bulk Buy">
        <button className="button small" type="button" onClick={() => void save()} disabled={saving}>
          <Save size={15} /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </PageTitle>

      {configured === false && (
        <p className="admin-message">The catering tables are not in the database yet — run the <code>20260917120000_catering_bulk_buy</code> migration. Until then the public page uses its built-in defaults and this panel edits a draft.</p>
      )}

      <div className="admin-tabs" role="tablist">
        {TABS.map(([id, text]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{text}</button>
        ))}
      </div>

      {tab === 'overview' && <Overview draft={draft} />}

      {tab === 'delivery' && (
        <div className="admin-card">
          <div className="admin-product-toggles" style={{ marginBottom: '1rem' }}>
            <Toggle checked={draft.deliveryEnabled} onChange={next => patch({ deliveryEnabled: next })} text="Delivery available" />
            <Toggle checked={draft.pickupEnabled} onChange={next => patch({ pickupEnabled: next })} text="Pickup available" />
            <Toggle checked={draft.cateringOrdersEnabled} onChange={next => patch({ cateringOrdersEnabled: next })} text="Catering orders" />
          </div>
          <div className="admin-product-fields">
            {label('Delivery fee (AUD)', <input type="number" step="0.01" min="0" value={draft.deliveryFee} onChange={e => patch({ deliveryFee: Number(e.target.value) })} />, 'Orders below the free-delivery threshold pay this fee.')}
            {label('Free delivery threshold (AUD)', <input type="number" step="0.01" min="0" value={draft.freeDeliveryThreshold} onChange={e => patch({ freeDeliveryThreshold: Number(e.target.value) })} />, 'Orders with this subtotal or more receive free delivery.')}
            {label('Service charge waiver threshold (AUD)', <input type="number" step="0.01" min="0" value={draft.serviceChargeWaiverThreshold} onChange={e => patch({ serviceChargeWaiverThreshold: Number(e.target.value) })} />, 'Orders at or above this subtotal have no service charge.')}
            {label('Delivery radius (km)', <input type="number" step="0.5" min="0.5" value={draft.deliveryRadiusKm} onChange={e => patch({ deliveryRadiusKm: Number(e.target.value) })} />, 'Customers outside this radius cannot select delivery.')}
          </div>
          <p className="muted">Thresholds are measured on the order subtotal (what the customer pays for the food) — never on subtotal + delivery fee. All rules are enforced again server-side at checkout.</p>
          <h3>Restaurant location (delivery origin)</h3>
          {draft.originLat === null && <p className="admin-message">The radius is only enforced once coordinates are set. Until then delivery keeps the legacy flat-fee behaviour.</p>}
          <div className="admin-product-fields">
            {label('Street address', <input value={draft.originAddress} onChange={e => patch({ originAddress: e.target.value })} placeholder="7/544 Hay St, Perth WA 6000" />, 'Where deliveries are measured from.')}
            {label('Latitude', <input type="number" step="0.000001" value={draft.originLat ?? ''} onChange={e => patch({ originLat: e.target.value === '' ? null : Number(e.target.value) })} />)}
            {label('Longitude', <input type="number" step="0.000001" value={draft.originLng ?? ''} onChange={e => patch({ originLng: e.target.value === '' ? null : Number(e.target.value) })} />)}
          </div>
          <button className="button small" type="button" onClick={() => void verifyOrigin()} disabled={verifying}>
            <MapPin size={14} /> {verifying ? 'Checking…' : 'Verify location'}
          </button>
          <p className="muted">Verify looks the address up and fills the coordinates automatically. Save afterwards.</p>
        </div>
      )}

      {tab === 'rawPasta' && (
        <div className="admin-card">
          <div className="admin-product-toggles" style={{ marginBottom: '1rem' }}>
            <Toggle checked={draft.rawPastaOrdersEnabled} onChange={next => patch({ rawPastaOrdersEnabled: next })} text="Raw pasta orders" />
          </div>
          <div className="admin-product-fields">
            {label('Raw pasta price (AUD per portion)', <input type="number" step="0.01" min="0" value={draft.rawPastaPrice} onChange={e => patch({ rawPastaPrice: Number(e.target.value) })} />, 'The price is validated server-side at checkout.')}
            {label('Portion weight (grams)', <input type="number" min="1" value={draft.rawPastaWeightGrams} onChange={e => patch({ rawPastaWeightGrams: Number(e.target.value) })} />)}
          </div>
          {label('Raw pasta intro (public page)', <textarea rows={2} value={draft.rawPastaIntro} onChange={e => patch({ rawPastaIntro: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.rawPastaIntro} />)}
        </div>
      )}

      {tab === 'content' && (
        <div className="admin-card">
          <div className="admin-product-toggles" style={{ marginBottom: '1rem' }}>
            <Toggle checked={draft.pageEnabled} onChange={next => patch({ pageEnabled: next })} text={draft.pageEnabled ? 'Page published' : 'Page unpublished'} />
          </div>
          <p className="muted">Empty fields use the built-in default copy (shown as placeholders). Changes go live on the public page immediately after saving.</p>
          <div className="admin-product-fields">
            {label('Hero title', <input value={draft.heroTitle} onChange={e => patch({ heroTitle: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.heroTitle} />)}
            {label('CTA button text', <input value={draft.ctaText} onChange={e => patch({ ctaText: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.ctaText} />)}
            {label('Contact phone', <input value={draft.contactPhone} onChange={e => patch({ contactPhone: e.target.value })} />)}
            {label('Contact email', <input value={draft.contactEmail} onChange={e => patch({ contactEmail: e.target.value })} />)}
            {label('Hero image URL (optional)', <input value={draft.heroImageUrl ?? ''} onChange={e => patch({ heroImageUrl: e.target.value || null })} placeholder="https://…" />, 'Leave blank for the text-only hero.')}
            {label('Catering intro', <input value={draft.cateringIntro} onChange={e => patch({ cateringIntro: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.cateringIntro} />)}
            {label('Bulk buy intro', <input value={draft.bulkBuyIntro} onChange={e => patch({ bulkBuyIntro: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.bulkBuyIntro} />)}
            {label('How it works title', <input value={draft.howItWorksTitle} onChange={e => patch({ howItWorksTitle: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.howItWorksTitle} />)}
          </div>
          {label('Hero description', <textarea rows={3} value={draft.heroDescription} onChange={e => patch({ heroDescription: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.heroDescription} />)}
          {label('How it works intro', <textarea rows={2} value={draft.howItWorksIntro} onChange={e => patch({ howItWorksIntro: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.howItWorksIntro} />)}
          {label('Delivery info', <textarea rows={2} value={draft.deliveryInfo} onChange={e => patch({ deliveryInfo: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.deliveryInfo} />)}
          {label('Pickup info', <textarea rows={2} value={draft.pickupInfo} onChange={e => patch({ pickupInfo: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.pickupInfo} />)}
          {label('Enquiry intro', <textarea rows={2} value={draft.enquiryIntro} onChange={e => patch({ enquiryIntro: e.target.value })} placeholder={DEFAULT_CATERING_CONTENT.enquiryIntro} />)}
          <h3 style={{ margin: '2rem 0 .6rem' }}>Search &amp; social (SEO)</h3>
          <div className="admin-product-fields">
            {label('SEO title', <input value={draft.seoTitle} onChange={e => patch({ seoTitle: e.target.value })} placeholder={DEFAULT_CATERING_SEO.title} />, 'Search result headline. Blank = built-in default.')}
            {label('Meta description', <textarea rows={2} value={draft.seoDescription} onChange={e => patch({ seoDescription: e.target.value })} placeholder={DEFAULT_CATERING_SEO.description} />, 'Search result summary. Keep under ~160 characters.')}
            {label('Social sharing title', <input value={draft.socialTitle} onChange={e => patch({ socialTitle: e.target.value })} placeholder={DEFAULT_CATERING_SEO.socialTitle} />)}
            {label('Social sharing description', <textarea rows={2} value={draft.socialDescription} onChange={e => patch({ socialDescription: e.target.value })} placeholder={DEFAULT_CATERING_SEO.socialDescription} />)}
            {label('Social sharing image URL', <input value={draft.socialImageUrl ?? ''} onChange={e => patch({ socialImageUrl: e.target.value || null })} placeholder="https://… (falls back to the hero image)" />)}
            {label('Canonical URL override (optional)', <input value={draft.seoCanonical ?? ''} onChange={e => patch({ seoCanonical: e.target.value || null })} placeholder="Leave blank for https://viziofood.com/catering" />, 'Only set this if the page should canonicalise elsewhere.')}
          </div>
        </div>
      )}

      {tab === 'categories' && <CategoriesWithCounts />}
      {tab === 'orders' && <CateringOrdersTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'faq' && <FaqTab />}
      {tab === 'steps' && <StepsTab />}
      {tab === 'enquiries' && <EnquiriesTab />}
    </div>
  );
}

/** Categories tab with live per-category product counts (safe-delete guard). */
function CategoriesWithCounts() {
  const products = useResource(getCateringProducts);
  const counts: Record<string, number> = {};
  for (const product of products.data ?? []) {
    if (product.categoryId) counts[product.categoryId] = (counts[product.categoryId] ?? 0) + 1;
  }
  return <CategoriesTab productCounts={counts} />;
}
