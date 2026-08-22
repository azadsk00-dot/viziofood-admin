/**
 * Products admin — full catalogue management: pricing, images (drag-drop
 * upload with client-side compression, gallery reorder, cover promote),
 * details, visibility flags, per-product modifier assignment, bulk actions,
 * duplicate/archive/delete, filters and pagination.
 */

import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Archive, ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, ImagePlus, Pencil, Plus, Search, Star, Trash2, Upload, X } from 'lucide-react';
import type { ModifierGroup, Product, ProductDraft } from './types';
import { archiveProducts, createProduct, deleteProduct, deleteProductImage, getCategories, getModifierGroups, getProductModifierGroups, getProducts, setProductModifierGroups, updateProduct, updateProducts, uploadProductImage, validateProduct } from './supabase';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea, Toggle } from '../ui';
import { aud } from '../lib/money';

const blank = (): ProductDraft => ({ name: '', description: '', price: 0, category: 'Pasta', sku: '', active: true, available: true, featured: false, popular: false, archived: false, archivedAt: null, vegetarian: false, vegan: false, halal: false, glutenFree: false, preparationTime: 15, calories: null, ingredients: [], allergens: [], tags: [], displayOrder: 0, imageUrl: null, thumbnailUrl: null, gallery: [], visibility: 'public', internalNotes: '' });
const split = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);

function ImageDropzone({ label, multiple = false, onUpload, progress, disabled }: { label: string; multiple?: boolean; onUpload: (files: File[]) => Promise<void>; progress: number | null; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const add = (files: FileList | null) => { if (files?.length) void onUpload(Array.from(files)); };
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); add(event.dataTransfer.files); };
  return (
    <div
      className="image-drop"
      style={{
        border: `2px dashed ${dragging ? 'var(--terracotta)' : 'var(--line)'}`,
        background: dragging ? 'var(--terracotta-soft)' : 'var(--cream)',
        borderRadius: 'var(--radius-md)',
        padding: '18px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        marginBottom: 12,
        transition: 'border-color var(--fast), background var(--fast)',
      }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <ImagePlus size={20} color="var(--muted)" />
      <b style={{ fontSize: '0.92rem' }}>{label}</b>
      <small className="vz-muted" style={{ fontSize: '0.78rem' }}>Drop JPEG, PNG, WebP or GIF here (max 8 MB) — large images are compressed before upload.</small>
      <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple={multiple} onChange={(event) => { add(event.target.files); event.currentTarget.value = ''; }} />
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
        <Upload size={14} /> {progress === null ? 'Choose image' : `Uploading ${progress}%`}
      </Button>
    </div>
  );
}

function Editor({ item, done, close }: { item?: Product; done: () => Promise<void>; close: () => void }) {
  const [value, setValue] = useState<ProductDraft>(item ? (() => { const { id, createdBy, updatedBy, ...draft } = item; void id; void createdBy; void updatedBy; return draft; })() : blank());
  const initialUrls = useRef(new Set(item ? [item.imageUrl, ...item.gallery].filter((url): url is string => Boolean(url)) : []));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [dragged, setDragged] = useState<number | null>(null);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [pendingDeletion, setPendingDeletion] = useState<string[]>([]);
  const toast = useToast();
  // Modifier groups assigned to THIS product — loaded per product; nothing is
  // assigned implicitly, and the ordered list is what customers see.
  const modifierGroups = useResource(getModifierGroups);
  const [assignedGroups, setAssignedGroups] = useState<ModifierGroup[]>([]);

  useEffect(() => {
    if (!item) { setAssignedGroups([]); return; }
    let active = true;
    void getProductModifierGroups(item.id).then((rows) => {
      if (active) setAssignedGroups(rows.map((row) => ({ id: row.id, name: row.name, required: row.required, minSelections: row.required ? 1 : 0, maxSelections: row.required ? 1 : 0, active: row.active, displayOrder: row.displayOrder })));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [item]);

  const moveAssignedGroup = (index: number, direction: -1 | 1) => {
    const next = [...assignedGroups];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setAssignedGroups(next);
  };
  const toggleGroupAssignment = (group: ModifierGroup) => setAssignedGroups((current) => current.some((g) => g.id === group.id) ? current.filter((g) => g.id !== group.id) : [...current, group]);
  const set = <K extends keyof ProductDraft>(key: K, next: ProductDraft[K]) => setValue((current) => ({ ...current, [key]: next }));

  const upload = async (files: File[], cover: boolean) => {
    const replacedCover = cover ? value.imageUrl : null;
    setBusy(true);
    setError('');
    try {
      const urls: string[] = [];
      for (const file of files) urls.push(await uploadProductImage(file, setProgress));
      setUploadedUrls((current) => [...current, ...urls]);
      if (replacedCover && replacedCover !== urls[0]) setPendingDeletion((deletions) => [...deletions, replacedCover]);
      setValue((current) => cover ? ({ ...current, imageUrl: urls[0], thumbnailUrl: urls[0] }) : ({ ...current, gallery: [...current.gallery, ...urls] }));
      toast.show(files.length === 1 ? 'Image uploaded' : `${files.length} images uploaded`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Image upload failed.');
    } finally { setProgress(null); setBusy(false); }
  };

  const removeImage = async (url: string, kind: 'cover' | 'gallery') => {
    setError('');
    if (uploadedUrls.includes(url)) {
      setBusy(true);
      try {
        await deleteProductImage(url);
        setUploadedUrls((current) => current.filter((image) => image !== url));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Image deletion failed.');
        setBusy(false);
        return;
      }
      setBusy(false);
    } else if (initialUrls.current.has(url)) setPendingDeletion((deletions) => [...deletions, url]);
    setValue((current) => kind === 'cover' ? ({ ...current, imageUrl: null, thumbnailUrl: null }) : ({ ...current, gallery: current.gallery.filter((image) => image !== url) }));
  };

  const setCover = (url: string) => setValue((current) => ({ ...current, imageUrl: url, thumbnailUrl: url, gallery: [...(current.imageUrl && current.imageUrl !== url ? [current.imageUrl] : []), ...current.gallery.filter((image) => image !== url)] }));
  const reorder = (target: number) => {
    if (dragged === null || dragged === target) return;
    setValue((current) => {
      const gallery = [...current.gallery];
      const [image] = gallery.splice(dragged, 1);
      gallery.splice(target, 0, image);
      return { ...current, gallery };
    });
    setDragged(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const message = validateProduct(value);
    if (message) { setError(message); return; }
    setBusy(true);
    setError('');
    try {
      const saved = item ? await updateProduct(item.id, value) : await createProduct(value);
      await setProductModifierGroups(saved.id, assignedGroups.map((group) => group.id));
      await Promise.allSettled([...new Set(pendingDeletion)].map(deleteProductImage));
      await done();
      toast.show('Product saved');
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save product.');
    } finally { setBusy(false); }
  };

  const cancel = () => { void Promise.allSettled(uploadedUrls.map(deleteProductImage)); close(); };
  const flagLabel: Record<string, string> = {
    active: 'Active', available: 'Available', featured: 'Featured', popular: 'Popular',
    vegetarian: 'Vegetarian', vegan: 'Vegan', halal: 'Halal', glutenFree: 'Gluten-free',
  };

  return (
    <Modal
      open
      wide
      onClose={cancel}
      title={item ? 'Edit product' : 'Add product'}
      footer={
        <>
          <Button variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
          <Button type="submit" form="product-form" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</Button>
        </>
      }
    >
      <form id="product-form" onSubmit={save} noValidate>
        {error && <p className="vz-field__error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}

        <h3 style={{ fontSize: '1.02rem' }}>General</h3>
        <Field label="Name" htmlFor="p-name"><Input id="p-name" required value={value.name} onChange={(event) => set('name', event.target.value)} /></Field>
        <Field label="Description" htmlFor="p-desc"><Textarea id="p-desc" rows={3} value={value.description} onChange={(event) => set('description', event.target.value)} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <Field label="Category" htmlFor="p-cat"><Input id="p-cat" required value={value.category} onChange={(event) => set('category', event.target.value)} /></Field>
          <Field label="Price (AUD)" htmlFor="p-price"><Input id="p-price" required type="number" min={0} step="0.01" value={value.price} onChange={(event) => set('price', Number(event.target.value))} /></Field>
          <Field label="SKU" htmlFor="p-sku"><Input id="p-sku" value={value.sku} onChange={(event) => set('sku', event.target.value)} /></Field>
          <Field label="Display order" htmlFor="p-order"><Input id="p-order" type="number" value={value.displayOrder} onChange={(event) => set('displayOrder', Number(event.target.value))} /></Field>
        </div>

        <h3 style={{ fontSize: '1.02rem', marginTop: 20 }}>Images</h3>
        <p className="vz-muted" style={{ fontSize: '0.82rem' }}>The cover image is shown first. Gallery order changes by dragging thumbnails.</p>
        <ImageDropzone label="Featured image" disabled={busy} progress={progress} onUpload={(files) => upload(files.slice(0, 1), true)} />
        {value.imageUrl && (
          <figure style={{ margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={value.imageUrl} alt="Product cover preview" style={{ width: 110, height: 80, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void removeImage(value.imageUrl!, 'cover')}>
              <Trash2 size={14} /> Remove cover
            </Button>
          </figure>
        )}
        <ImageDropzone label="Gallery images" multiple disabled={busy} progress={progress} onUpload={(files) => upload(files, false)} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }} aria-label="Product gallery">
          {value.gallery.map((url, index) => (
            <figure
              key={url}
              draggable
              onDragStart={() => setDragged(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => reorder(index)}
              style={{ margin: 0, position: 'relative', width: 84, height: 84, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--line)', cursor: 'grab' }}
            >
              <img src={url} alt={`Gallery image ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <figcaption style={{ position: 'absolute', top: 3, left: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.65rem', borderRadius: 4, padding: '0 5px' }}>{index + 1}</figcaption>
              <button type="button" title="Use as cover image" style={{ position: 'absolute', bottom: 24, right: 3, background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: 4, cursor: 'pointer', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCover(url)}><Star size={13} /></button>
              <button type="button" title="Remove gallery image" disabled={busy} style={{ position: 'absolute', bottom: 2, right: 3, background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: 4, cursor: 'pointer', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => void removeImage(url, 'gallery')}><X size={13} /></button>
            </figure>
          ))}
        </div>

        <h3 style={{ fontSize: '1.02rem', marginTop: 20 }}>Product details</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <Field label="Preparation time (min)" htmlFor="p-prep"><Input id="p-prep" type="number" min={0} value={value.preparationTime} onChange={(event) => set('preparationTime', Number(event.target.value))} /></Field>
          <Field label="Calories" htmlFor="p-cal"><Input id="p-cal" type="number" min={0} value={value.calories ?? ''} onChange={(event) => set('calories', event.target.value === '' ? null : Number(event.target.value))} /></Field>
          <Field label="Tags" htmlFor="p-tags"><Input id="p-tags" value={value.tags.join(', ')} onChange={(event) => set('tags', split(event.target.value))} placeholder="pasta, seasonal" /></Field>
        </div>
        <Field label="Ingredients" htmlFor="p-ing"><Input id="p-ing" value={value.ingredients.join(', ')} onChange={(event) => set('ingredients', split(event.target.value))} /></Field>
        <Field label="Allergens" htmlFor="p-allerg"><Input id="p-allerg" value={value.allergens.join(', ')} onChange={(event) => set('allergens', split(event.target.value))} /></Field>

        <h3 style={{ fontSize: '1.02rem', marginTop: 20 }}>Visibility &amp; availability</h3>
        <Field label="Visibility" htmlFor="p-visibility">
          <Select id="p-visibility" value={value.visibility} onChange={(event) => set('visibility', event.target.value as ProductDraft['visibility'])}>
            <option value="public">Public</option>
            <option value="hidden">Hidden</option>
            <option value="private">Private</option>
          </Select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 6 }}>
          {(['active', 'available', 'featured', 'popular', 'vegetarian', 'vegan', 'halal', 'glutenFree'] as const).map((key) => (
            <Toggle key={key} checked={value[key]} onChange={(next) => set(key, next)} label={flagLabel[key]} />
          ))}
        </div>

        <h3 style={{ fontSize: '1.02rem', marginTop: 20 }}>Modifiers</h3>
        {assignedGroups.length > 0 && (
          <div className="admin-list" style={{ marginBottom: 12 }}>
            {assignedGroups.map((group, index) => (
              <div className="admin-list__row" key={group.id}>
                <strong style={{ color: 'var(--terracotta)' }}>{index + 1}</strong>
                <div className="admin-list__main">
                  <div className="admin-list__title">{group.name} <Badge tone={group.required ? 'terracotta' : 'neutral'}>{group.required ? 'Required' : 'Optional'}</Badge></div>
                </div>
                <div className="vz-row">
                  <Button type="button" size="sm" variant="ghost" title="Move up" disabled={index === 0} onClick={() => moveAssignedGroup(index, -1)}><ArrowUp size={14} /></Button>
                  <Button type="button" size="sm" variant="ghost" title="Move down" disabled={index === assignedGroups.length - 1} onClick={() => moveAssignedGroup(index, 1)}><ArrowDown size={14} /></Button>
                  <Button type="button" size="sm" variant="danger" title="Remove from this product" onClick={() => toggleGroupAssignment(group)}><X size={14} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {modifierGroups.loading ? (
          <p className="vz-muted">Loading modifier groups…</p>
        ) : modifierGroups.error ? (
          <p className="vz-muted">Modifier groups could not be loaded — saving keeps the current assignment unchanged.</p>
        ) : (
          <>
            {(modifierGroups.data ?? []).filter((group) => group.active && !assignedGroups.some((assigned) => assigned.id === group.id)).map((group) => (
              <button
                type="button"
                key={group.id}
                className="vz-btn vz-btn--secondary vz-btn--sm"
                style={{ marginRight: 8, marginBottom: 8 }}
                onClick={() => toggleGroupAssignment(group)}
              >
                <Plus size={13} /> {group.name} ({group.required ? 'required' : 'optional'})
              </button>
            ))}
            {!(modifierGroups.data ?? []).length && <p className="vz-muted">No modifier groups exist yet — create them in Admin → Modifiers.</p>}
          </>
        )}
        <p className="vz-muted" style={{ fontSize: '0.82rem' }}>
          Click a group to offer it on this product. The numbered order is what customers see; required groups force a
          choice before the product can be added to the cart.
        </p>

        <h3 style={{ fontSize: '1.02rem', marginTop: 20 }}>Internal</h3>
        <Field label="Internal notes" htmlFor="p-notes">
          <Textarea id="p-notes" rows={3} value={value.internalNotes} onChange={(event) => set('internalNotes', event.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

export default function ProductManagement() {
  const products = useResource(getProducts);
  const categories = useResource(getCategories);
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [show, setShow] = useState('active');
  const [featured, setFeatured] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<Product>();
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 10;

  const rows = useMemo(() => products.data?.filter((product) => {
    const haystack = `${product.name} ${product.sku} ${product.tags.join(' ')}`.toLowerCase();
    const statusMatch = show === 'all' || show === 'archived' ? show === 'all' || product.archived : show === 'inactive' ? !product.active : product.active && !product.archived;
    const featuredMatch = !featured || (featured === 'featured' ? product.featured : product.popular);
    return (!search || haystack.includes(search.toLowerCase())) && (!category || product.category === category) && statusMatch && featuredMatch;
  }) ?? [], [products.data, search, category, show, featured]);

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const paged = rows.slice((page - 1) * perPage, page * perPage);
  const reload = async () => { await products.reload(); setSelected([]); };
  const run = async (work: () => Promise<void>, success: string) => {
    try { await work(); await reload(); toast.show(success); } catch (error) { toast.show(error instanceof Error ? error.message : 'Product update failed.', 'error'); }
  };
  const bulk = async (action: string) => {
    if (action === 'delete' && !window.confirm(`Delete ${selected.length} products? This cannot be undone.`)) return;
    if (action === 'price') {
      const input = window.prompt('New price');
      const next = Number(input);
      if (input === null || !Number.isFinite(next) || next < 0) return;
      await run(() => updateProducts(selected, { price: next }), 'Prices updated');
      return;
    }
    await run(() => action === 'delete'
      ? Promise.all(selected.map(deleteProduct)).then(() => undefined)
      : action === 'archive' || action === 'restore'
        ? archiveProducts(selected, action === 'archive')
        : updateProducts(selected, { active: action === 'activate' }), 'Bulk update complete');
  };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Products</h1>
          <p className="admin-head__sub">The catalogue — prices, images, modifiers and availability.</p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus size={16} /> Add product</Button>
      </div>

      <div className="admin-toolbar">
        <div className="vz-row" style={{ flex: 1, minWidth: 200 }}>
          <Search size={16} color="var(--muted)" style={{ position: 'absolute', marginLeft: 12 }} />
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, SKU or tag" aria-label="Search products" style={{ paddingLeft: 38 }} />
        </div>
        <Select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} aria-label="Filter by category" style={{ width: 'auto' }}>
          <option value="">All categories</option>
          {categories.data?.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
        </Select>
        <Select value={show} onChange={(event) => { setShow(event.target.value); setPage(1); }} aria-label="Filter by status" style={{ width: 'auto' }}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </Select>
        <Select value={featured} onChange={(event) => { setFeatured(event.target.value); setPage(1); }} aria-label="Filter by featured" style={{ width: 'auto' }}>
          <option value="">All products</option>
          <option value="featured">Featured</option>
          <option value="popular">Popular</option>
        </Select>
      </div>

      {selected.length > 0 && (
        <Card pad flat style={{ marginBottom: 14, background: 'var(--sand)' }}>
          <div className="vz-row vz-row--wrap">
            <strong>{selected.length} selected</strong>
            {['activate', 'deactivate', 'archive', 'restore', 'price', 'delete'].map((action) => (
              <Button key={action} size="sm" variant={action === 'delete' ? 'danger' : 'secondary'} onClick={() => void bulk(action)}>
                {action === 'price' ? 'Set price' : action}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {products.loading ? (
        <div className="vz-stack">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={58} />)}</div>
      ) : products.error ? (
        <p className="vz-error-box">{products.error}</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No products match">Adjust the filters or add your first product.</EmptyState>
      ) : (
        <>
          <div className="vz-table-wrap">
            <table className="vz-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all products"
                      checked={paged.length > 0 && paged.every((product) => selected.includes(product.id))}
                      onChange={(event) => setSelected(event.target.checked
                        ? Array.from(new Set([...selected, ...paged.map((product) => product.id)]))
                        : selected.filter((id) => !paged.some((product) => product.id === id)))}
                    />
                  </th>
                  <th>Product</th><th>Category</th><th>Price</th><th>Status</th><th>Featured</th><th>Popular</th><th>Availability</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${product.name}`}
                        checked={selected.includes(product.id)}
                        onChange={(event) => setSelected(event.target.checked ? [...selected, product.id] : selected.filter((id) => id !== product.id))}
                      />
                    </td>
                    <td>
                      <div className="vz-row">
                        {product.thumbnailUrl || product.imageUrl
                          ? <img src={product.thumbnailUrl || product.imageUrl || ''} alt="" loading="lazy" style={{ width: 42, height: 42, borderRadius: 'var(--radius-sm)', objectFit: 'cover' }} />
                          : <span style={{ width: 42, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sand)', borderRadius: 'var(--radius-sm)' }}><ImagePlus size={16} color="var(--muted)" /></span>}
                        <span>
                          <b>{product.name}</b>
                          <div className="vz-muted" style={{ fontSize: '0.78rem' }}>{product.sku || product.description}</div>
                        </span>
                      </div>
                    </td>
                    <td>{product.category}</td>
                    <td><b>{aud(product.price)}</b></td>
                    <td>{product.archived ? <Badge tone="neutral">Archived</Badge> : product.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
                    <td>{product.featured ? <Check aria-label="Featured" size={17} color="var(--olive)" /> : '—'}</td>
                    <td>{product.popular ? <Check aria-label="Popular" size={17} color="var(--olive)" /> : '—'}</td>
                    <td>{product.available ? <Badge tone="info">Available</Badge> : <Badge tone="danger">Unavailable</Badge>}</td>
                    <td>
                      <div className="vz-row">
                        <Button size="sm" variant="ghost" title="Edit product" onClick={() => setEditor(product)}><Pencil size={15} /></Button>
                        <Button size="sm" variant="ghost" title="Duplicate product" onClick={() => void run(() => createProduct({ ...product, name: `${product.name} copy`, sku: '', archived: false, archivedAt: null }).then(() => undefined), 'Product duplicated')}><Copy size={15} /></Button>
                        <Button size="sm" variant="ghost" title={product.archived ? 'Restore product' : 'Archive product'} onClick={() => void run(() => archiveProducts([product.id], !product.archived), product.archived ? 'Product restored' : 'Product archived')}><Archive size={15} /></Button>
                        <Button size="sm" variant="danger" title="Delete product" onClick={() => { if (window.confirm(`Delete ${product.name}? This cannot be undone.`)) void run(() => deleteProduct(product.id), 'Product deleted'); }}><Trash2 size={15} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="vz-row vz-row--between" style={{ marginTop: 12 }}>
            <span className="vz-muted">{rows.length} products · page {page} of {pageCount}</span>
            <div className="vz-row">
              <Button size="sm" variant="secondary" aria-label="Previous page" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} /></Button>
              <Button size="sm" variant="secondary" aria-label="Next page" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}><ChevronRight size={15} /></Button>
            </div>
          </div>
        </>
      )}

      {adding && <Editor close={() => setAdding(false)} done={reload} />}
      {editor && <Editor item={editor} close={() => setEditor(undefined)} done={reload} />}
    </>
  );
}
