import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search, Star, X } from 'lucide-react';
import { PageTitle } from './components';
import { getProducts, updateProduct } from './supabase';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';
import type { Product } from './types';

// Only products the public site can actually show are eligible: active,
// available, unarchived, public. Mirrors the products RLS read policy.
const publishable = (product: Product) =>
  product.active && product.available && !product.archived && product.visibility === 'public';

export function FeaturedDishesPage() {
  const products = useResource(getProducts);
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const featured = useMemo(
    () => (products.data ?? []).filter(p => p.featured && publishable(p))
      .sort((a, b) => (a.featuredOrder ?? 0) - (b.featuredOrder ?? 0) || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [products.data],
  );

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (products.data ?? []).filter(p => !p.featured && publishable(p))
      .filter(p => !term || `${p.name} ${p.category} ${p.sku}`.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products.data, search]);

  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await work();
      toast.show(message);
      void products.reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Update failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // featured_order is rewritten 1..n on every change so the homepage order is
  // always a dense sequence regardless of add/remove history.
  const reorder = async (list: Product[], from: number, to: number) => {
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await Promise.all(next.map((p, index) => updateProduct(p.id, { featuredOrder: index + 1 })));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= featured.length) return;
    void run(() => reorder(featured, index, target), 'Order updated.');
  };

  const add = (product: Product) =>
    void run(() => updateProduct(product.id, { featured: true, featuredOrder: featured.length + 1 }), `${product.name} is now featured.`);

  const remove = (product: Product) =>
    void run(() => updateProduct(product.id, { featured: false, featuredOrder: 0 }), `${product.name} removed from featured.`);

  if (products.loading) return <section className="admin-page"><PageTitle title="Featured Dishes" /><p className="admin-message">Loading…</p></section>;
  if (products.error) return <section className="admin-page"><PageTitle title="Featured Dishes" /><p className="admin-message error">{products.error}</p></section>;

  return (
    <section className="admin-page">
      <PageTitle title="Featured Dishes">
        <a className="admin-primary outline" href="/" target="_blank" rel="noreferrer">View homepage</a>
      </PageTitle>

      <div className="featured-admin-grid">
        <section className="admin-card settings-section">
          <div className="settings-section-header">
            <Star size={18} />
            <h2>On the homepage</h2>
          </div>
          {featured.length === 0
            ? <p className="admin-message">No featured dishes yet. The homepage shows “Featured dishes are coming soon.” until you add some.</p>
            : <ol className="featured-list">
                {featured.map((product, index) => (
                  <li key={product.id} className="featured-row">
                    <span className="featured-rank">{index + 1}</span>
                    {product.thumbnailUrl || product.imageUrl
                      ? <img src={product.thumbnailUrl || product.imageUrl || ''} alt="" />
                      : <span className="product-placeholder"><Star size={16} /></span>}
                    <span className="featured-name"><b>{product.name}</b><small>{product.category}</small></span>
                    <span className="featured-actions">
                      <button className="table-button" title="Move up" disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
                      <button className="table-button" title="Move down" disabled={busy || index === featured.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
                      <button className="table-button danger" title="Remove from featured" disabled={busy} onClick={() => remove(product)}><X size={16} /></button>
                    </span>
                  </li>
                ))}
              </ol>}
          <p className="settings-hint">Order here is the display order on the public homepage. Changes appear without a redeploy.</p>
        </section>

        <section className="admin-card settings-section">
          <div className="settings-section-header">
            <Plus size={18} />
            <h2>Add a dish</h2>
          </div>
          <label className="admin-search">
            <Search size={16} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search active products" aria-label="Search active products" />
          </label>
          {candidates.length === 0
            ? <p className="admin-message">{search ? 'No matching products.' : 'Every active product is already featured.'}</p>
            : <ul className="featured-candidates">
                {candidates.map(product => (
                  <li key={product.id}>
                    <span><b>{product.name}</b><small>{product.category}</small></span>
                    <button className="table-button" title={`Feature ${product.name}`} disabled={busy} onClick={() => add(product)}><Plus size={16} /></button>
                  </li>
                ))}
              </ul>}
          <p className="settings-hint">Only active, available, public products can be featured — the same products visitors can order.</p>
        </section>
      </div>
    </section>
  );
}
