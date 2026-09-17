import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2, ArrowUp, ArrowDown, CopyPlus, Upload, X } from 'lucide-react';
import {
  createCateringCategory, createCateringOnlyProduct, deleteCateringCategory, duplicateCateringProduct,
  getCateringCategories, getCateringOrders, updateCateringCategory, updateCateringProductFields,
  type CateringCategory, type CateringOrderRow,
} from './cateringService';
import { uploadProductImage, deleteProductImage, type AdminCateringProduct } from './cateringServiceExports';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';

const money = (value: number) => `$${value.toFixed(2)}`;

// ── Categories CRUD (with product counts + safe delete) ──
export function CategoriesTab({ productCounts }: { productCounts?: Record<string, number> }) {
  const resource = useResource(getCateringCategories);
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const cats = resource.data ?? [];
  const add = async () => {
    if (name.trim().length < 2) { toast.show('Add a category name.', 'error'); return; }
    try { await createCateringCategory(name, description); setName(''); setDescription(''); toast.show('Category added.'); void resource.reload(); }
    catch (error) { toast.show(error instanceof Error ? error.message : 'Could not add.', 'error'); }
  };
  const move = async (index: number, direction: -1 | 1) => {
    const swap = index + direction;
    if (swap < 0 || swap >= cats.length) return;
    try {
      await updateCateringCategory(cats[index].id, { displayOrder: cats[swap].displayOrder });
      await updateCateringCategory(cats[swap].id, { displayOrder: cats[index].displayOrder });
      void resource.reload();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not reorder.', 'error'); }
  };
  const remove = async (cat: CateringCategory) => {
    const count = productCounts?.[cat.id] ?? 0;
    if (count > 0) {
      toast.show(`${count} product(s) are assigned to "${cat.name}". Unassign them first (Products → Edit details → category).`, 'error');
      return;
    }
    if (!confirm(`Delete the category "${cat.name}"?`)) return;
    try { await deleteCateringCategory(cat.id); void resource.reload(); } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not delete.', 'error'); }
  };
  if (resource.loading) return <div className="admin-card"><p>Loading…</p></div>;
  return (
    <div className="admin-card">
      {resource.error && <p className="admin-message">{resource.error} — apply the 20260917140000 migration to enable categories.</p>}
      <h3>Add category</h3>
      <div className="admin-product-fields">
        <label className="admin-field">Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Party Catering" /></label>
        <label className="admin-field">Description (optional)<input value={description} onChange={e => setDescription(e.target.value)} /></label>
      </div>
      <button className="button small" type="button" onClick={() => void add()}><Plus size={14} /> Add category</button>
      <h3 style={{ marginTop: '2rem' }}>Categories ({cats.length})</h3>
      {cats.map((cat, index) => (
        <div className="admin-product-row" key={cat.id}>
          <div className="admin-product-head">
            <div>
              <strong>{cat.name}</strong>{productCounts?.[cat.id] ? <span className="status new">{productCounts[cat.id]} products</span> : <span className="status completed">empty</span>}
              {cat.description && <div><small>{cat.description}</small></div>}
            </div>
            <div className="admin-product-toggles">
              <label className="admin-toggle"><input type="checkbox" checked={cat.active} onChange={event => void updateCateringCategory(cat.id, { active: event.target.checked }).then(() => resource.reload())} /><span>{cat.active ? 'On' : 'Off'}</span></label>
              <button className="textlink" type="button" aria-label="Move up" disabled={index === 0} onClick={() => void move(index, -1)}><ArrowUp size={14} /></button>
              <button className="textlink" type="button" aria-label="Move down" disabled={index === cats.length - 1} onClick={() => void move(index, 1)}><ArrowDown size={14} /></button>
              <button className="textlink" type="button" aria-label="Delete category" onClick={() => void remove(cat)}><Trash2 size={14} /></button>
            </div>
          </div>
        </div>
      ))}
      {cats.length === 0 && <p className="muted">No categories yet — create any grouping you like; products can then be assigned per category.</p>}
    </div>
  );
}

// ── Image picker: upload → preview → replace/remove, using the existing
//    product-images storage bucket and admin uploader. ──
function ImageField({ label, url, onChange }: { label: string; url: string | null; onChange: (next: string | null) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await uploadProductImage(file);
      if (url) void deleteProductImage(url).catch(() => undefined); // old image is replaced
      onChange(uploaded);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Upload failed.', 'error');
    } finally { setBusy(false); }
  };
  return (
    <div className="admin-field">
      {label}
      {url && <img src={url} alt="" style={{ width: 96, height: 64, objectFit: 'cover', borderRadius: 8, marginTop: 6, display: 'block' }} />}
      <div className="admin-product-toggles" style={{ marginTop: 6 }}>
        <input ref={input} type="file" accept="image/*" hidden onChange={event => void pick(event.target.files?.[0])} />
        <button className="button small light" type="button" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} /> {busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}</button>
        {url && <button className="textlink" type="button" onClick={() => { void deleteProductImage(url).catch(() => undefined); onChange(null); }}><X size={14} /> Remove</button>}
      </div>
    </div>
  );
}

function GalleryField({ images, onChange }: { images: string[]; onChange: (next: string[]) => void }) {
  const move = (index: number, direction: -1 | 1) => {
    const next = [...images];
    const swap = index + direction;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    onChange(next);
  };
  return (
    <div className="admin-field">
      Gallery ({images.length} image{images.length === 1 ? '' : 's'})
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
        {images.map((image, index) => (
          <div key={image + index} style={{ position: 'relative' }}>
            <img src={image} alt="" style={{ width: 88, height: 60, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
            <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 2 }}>
              <button className="textlink" type="button" aria-label="Move gallery image left" disabled={index === 0} onClick={() => move(index, -1)} style={{ background: '#fff', borderRadius: 4 }}><ArrowUp size={11} /></button>
              <button className="textlink" type="button" aria-label="Move gallery image right" disabled={index === images.length - 1} onClick={() => move(index, 1)} style={{ background: '#fff', borderRadius: 4 }}><ArrowDown size={11} /></button>
              <button className="textlink" type="button" aria-label="Remove gallery image" onClick={() => onChange(images.filter((_, i) => i !== index))} style={{ background: '#fff', borderRadius: 4 }}><X size={11} /></button>
            </div>
          </div>
        ))}
      </div>
      <GalleryAdd onAdd={url => onChange([...images, url])} />
    </div>
  );
}

function GalleryAdd({ onAdd }: { onAdd: (url: string) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={input} type="file" accept="image/*" hidden onChange={async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try { onAdd(await uploadProductImage(file)); } catch (error) { toast.show(error instanceof Error ? error.message : 'Upload failed.', 'error'); } finally { setBusy(false); }
      }} />
      <button className="button small light" type="button" disabled={busy} style={{ marginTop: 6 }} onClick={() => input.current?.click()}><Plus size={14} /> {busy ? 'Uploading…' : 'Add gallery image'}</button>
    </>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ borderTop: '1px solid var(--line-c)', marginTop: 14, paddingTop: 12 }}>
    <h4 style={{ margin: '0 0 10px' }}>{title}</h4>
    {children}
  </div>
);

// ── Full product editor — business-owner-friendly grouped sections ──
export function ProductEditor({ product, categories, onClose, onSaved }: { product: AdminCateringProduct; categories: CateringCategory[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: product.name,
    description: '',
    imageUrl: null as string | null,
    gallery: [] as string[],
    categoryId: '' as string | null,
    displayOrder: '0',
    vegetarian: false, vegan: false, halal: false, glutenFree: false,
    ingredients: '', allergens: '', internalNotes: '',
  });
  useEffect(() => {
    void (async () => {
      const { supabase } = await import('../lib/supabase');
      if (!supabase) return;
      const { data } = await supabase.from('products').select('description,image_url,gallery,catering_category_id,catering_serves_min,catering_serves_max,display_order,vegetarian,vegan,halal,gluten_free,ingredients,allergens,internal_notes').eq('id', product.id).maybeSingle();
      if (!data) return;
      const row = data as Record<string, unknown>;
      setForm(current => ({
        ...current,
        description: String(row.description ?? ''),
        imageUrl: (row.image_url as string) ?? null,
        gallery: Array.isArray(row.gallery) ? row.gallery.filter((item): item is string => typeof item === 'string') : [],
        categoryId: (row.catering_category_id as string) ?? '',
        displayOrder: String(row.display_order ?? 0),
        vegetarian: row.vegetarian === true, vegan: row.vegan === true, halal: row.halal === true, glutenFree: row.gluten_free === true,
        ingredients: Array.isArray(row.ingredients) ? (row.ingredients as string[]).join(', ') : '',
        allergens: Array.isArray(row.allergens) ? (row.allergens as string[]).join(', ') : '',
        internalNotes: String(row.internal_notes ?? ''),
      }));
    })();
  }, [product.id]);
  const update = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));
  const save = async () => {
    setBusy(true);
    try {
      await updateCateringProductFields(product.id, {
        name: form.name, description: form.description, imageUrl: form.imageUrl, gallery: form.gallery,
        categoryId: form.categoryId || null,
        displayOrder: Number(form.displayOrder) || 0,
        vegetarian: form.vegetarian, vegan: form.vegan, halal: form.halal, glutenFree: form.glutenFree,
        ingredients: form.ingredients.split(',').map(part => part.trim()).filter(Boolean),
        allergens: form.allergens.split(',').map(part => part.trim()).filter(Boolean),
        internalNotes: form.internalNotes,
      });
      toast.show('Product saved.');
      onSaved();
      onClose();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not save.', 'error');
    } finally { setBusy(false); }
  };
  return (
    <div style={{ borderTop: '2px solid var(--brand-blue-soft)', marginTop: 10, paddingTop: 12 }}>
      <Section title="Basic information">
        <div className="admin-product-fields">
          <label className="admin-field">Name<input value={form.name} onChange={e => update({ name: e.target.value })} /></label>
          <label className="admin-field">Catering category
            <select value={form.categoryId ?? ''} onChange={e => update({ categoryId: e.target.value || null })}>
              <option value="">— none —</option>
              {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
          </label>
        </div>
        <label className="admin-field">Description<textarea rows={2} value={form.description} onChange={e => update({ description: e.target.value })} /></label>
        <div className="admin-product-fields">
          <ImageField label="Product image" url={form.imageUrl} onChange={next => update({ imageUrl: next })} />
          <GalleryField images={form.gallery} onChange={next => update({ gallery: next })} />
        </div>
      </Section>
      <Section title="Dietary &amp; product information">
        <div className="admin-product-toggles">
          <label className="admin-toggle"><input type="checkbox" checked={form.vegetarian} onChange={e => update({ vegetarian: e.target.checked })} /><span>Vegetarian</span></label>
          <label className="admin-toggle"><input type="checkbox" checked={form.vegan} onChange={e => update({ vegan: e.target.checked })} /><span>Vegan</span></label>
          <label className="admin-toggle"><input type="checkbox" checked={form.halal} onChange={e => update({ halal: e.target.checked })} /><span>Halal</span></label>
          <label className="admin-toggle"><input type="checkbox" checked={form.glutenFree} onChange={e => update({ glutenFree: e.target.checked })} /><span>Gluten-free</span></label>
        </div>
        <div className="admin-product-fields" style={{ marginTop: 10 }}>
          <label className="admin-field">Ingredients (comma separated)<input value={form.ingredients} onChange={e => update({ ingredients: e.target.value })} /></label>
          <label className="admin-field">Allergens (comma separated)<input value={form.allergens} onChange={e => update({ allergens: e.target.value })} /></label>
        </div>
      </Section>
      <Section title="Internal information">
        <label className="admin-field">Internal notes (never shown to customers)<textarea rows={2} value={form.internalNotes} onChange={e => update({ internalNotes: e.target.value })} /></label>
      </Section>
      <div className="admin-product-toggles" style={{ marginTop: 14 }}>
        <button className="button small" type="button" disabled={busy} onClick={() => void save()}><Save size={14} /> {busy ? 'Saving…' : 'Save product'}</button>
        <button className="button small light" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── Catering orders view (with search/filter) ──
export function CateringOrdersTab() {
  const resource = useResource(getCateringOrders);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All');
  const orders = (resource.data ?? []).filter(order =>
    (status === 'All' || order.status === status)
    && (!query.trim() || `${order.orderNumber} ${order.customer} ${order.phone} ${order.email} ${order.items}`.toLowerCase().includes(query.trim().toLowerCase())));
  if (resource.loading) return <div className="admin-card"><p>Loading catering orders…</p></div>;
  if (resource.error) return <div className="admin-card"><p className="admin-message">{resource.error}</p></div>;
  return (
    <div className="admin-card">
      <h3>Catering orders ({orders.length}{orders.length !== (resource.data ?? []).length ? ' shown' : ''})</h3>
      <div className="admin-product-toggles" style={{ marginBottom: 12 }}>
        <input className="admin-search" style={{ margin: 0, maxWidth: 280 }} placeholder="Search orders…" value={query} onChange={e => setQuery(e.target.value)} />
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status">
          {['All', 'New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled'].map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      {(resource.data ?? []).length === 0 && <p className="muted">Catering orders (trays or raw pasta) appear here. Manage statuses in Orders.</p>}
      {orders.map(order => (
        <div className="admin-product-row" key={order.id}>
          <div className="admin-product-head">
            <div>
              <strong>{order.orderNumber}</strong> <span className={`status ${order.status.toLowerCase()}`}>{order.status}</span>
              <div><small>{order.customer} · <a href={`tel:${order.phone}`}>{order.phone}</a> · <a href={`mailto:${order.email}`}>{order.email}</a> · {new Date(order.createdAt).toLocaleString('en-AU')}</small></div>
              <div><small>{order.fulfilment}{order.distanceKm !== null ? ` (${order.distanceKm.toFixed(1)} km)` : ''}{order.address ? ` · ${order.address}` : ''}{order.eventDate ? ` · Event ${new Date(order.eventDate).toLocaleDateString('en-AU')}` : ''}{order.guestCount !== null ? ` · ${order.guestCount} guests` : ''}</small></div>
              <div><small>{order.items}</small></div>
              {order.notes && <div><small><b>Notes:</b> {order.notes}</small></div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div><small>Subtotal {money(order.subtotal)}</small></div>
              <div><small>Delivery {money(order.deliveryFee)}</small></div>
              <div><small>Service {money(order.serviceCharge)}</small></div>
              <strong>{money(order.total)}</strong>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Create new catering product ──
export function NewCateringProduct({ categories, onCreated }: { categories: CateringCategory[]; onCreated: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', price: '', categoryId: '', rawPasta: false });
  const update = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));
  const create = async () => {
    setBusy(true);
    try {
      await createCateringOnlyProduct({
        name: form.name, description: form.description, price: Number(form.price),
        categoryId: form.categoryId || null, rawPasta: form.rawPasta,
        unit: form.rawPasta ? null : 'Tray', servesMin: form.rawPasta ? null : 4, servesMax: form.rawPasta ? null : 5,
      });
      toast.show('Catering product created (hidden from the normal menu).');
      setForm({ name: '', description: '', price: '', categoryId: '', rawPasta: false });
      setOpen(false);
      onCreated();
    } catch (error) { toast.show(error instanceof Error ? error.message : 'Could not create.', 'error'); }
    finally { setBusy(false); }
  };
  if (!open) return <button className="button small" type="button" onClick={() => setOpen(true)}><Plus size={14} /> New catering product</button>;
  return (
    <div className="admin-product-row" style={{ marginTop: 12 }}>
      <div className="admin-product-fields">
        <label className="admin-field">Name<input value={form.name} onChange={e => update({ name: e.target.value })} /></label>
        <label className="admin-field">Price (AUD)<input type="number" step="0.01" min="0" value={form.price} onChange={e => update({ price: e.target.value })} placeholder={form.rawPasta ? '10' : '75'} /></label>
        <label className="admin-field">Category
          <select value={form.categoryId} onChange={e => update({ categoryId: e.target.value })}>
            <option value="">— none —</option>
            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </label>
        <label className="admin-toggle"><input type="checkbox" checked={form.rawPasta} onChange={e => update({ rawPasta: e.target.checked })} /><span>Raw pasta item (not a cooked tray)</span></label>
      </div>
      <label className="admin-field">Description<textarea rows={2} value={form.description} onChange={e => update({ description: e.target.value })} /></label>
      <div className="admin-product-toggles" style={{ marginTop: 10 }}>
        <button className="button small" type="button" disabled={busy} onClick={() => void create()}><Plus size={14} /> {busy ? 'Creating…' : 'Create'}</button>
        <button className="button small light" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export const duplicateProduct = duplicateCateringProduct;
export { CopyPlus };
