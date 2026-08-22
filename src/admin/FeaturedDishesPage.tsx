/**
 * Featured dishes admin — the ordered homepage showcase grid. featured_order
 * is rewritten 1..n on every change so the homepage order is always a dense
 * sequence; changes reach the homepage via realtime without a redeploy.
 */

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search, Star, X } from 'lucide-react';
import { getProducts, updateProduct } from './supabase';
import { useResource } from './useResource';
import { useToast } from '../components/Toast';
import type { Product } from './types';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '../ui';
import { aud } from '../lib/money';

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
    () => (products.data ?? []).filter((p) => p.featured && publishable(p))
      .sort((a, b) => (a.featuredOrder ?? 0) - (b.featuredOrder ?? 0) || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [products.data],
  );

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (products.data ?? []).filter((p) => !p.featured && publishable(p))
      .filter((p) => !term || `${p.name} ${p.category} ${p.sku}`.toLowerCase().includes(term))
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

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Featured dishes</h1>
          <p className="admin-head__sub">The homepage showcase grid — order here is the public display order.</p>
        </div>
        <a className="vz-btn vz-btn--secondary" href="/" target="_blank" rel="noreferrer">View homepage</a>
      </div>

      {products.loading ? (
        <div className="dash-cols">
          <Skeleton height={280} />
          <Skeleton height={280} />
        </div>
      ) : products.error ? (
        <p className="vz-error-box">{products.error}</p>
      ) : (
        <div className="dash-cols">
          <Card pad>
            <div className="vz-row" style={{ gap: 8, marginBottom: 14 }}>
              <Star size={18} color="var(--terracotta)" />
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>On the homepage</h2>
            </div>
            {featured.length === 0 ? (
              <EmptyState title="No featured dishes yet">Add dishes from the panel on the right.</EmptyState>
            ) : (
              <div className="admin-list">
                {featured.map((product, index) => (
                  <div className="admin-list__row" key={product.id}>
                    <strong style={{ color: 'var(--terracotta)', width: 22 }}>{index + 1}</strong>
                    {product.thumbnailUrl || product.imageUrl ? (
                      <img
                        src={product.thumbnailUrl || product.imageUrl || ''}
                        alt=""
                        style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                      />
                    ) : (
                      <span style={{ width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sand)', borderRadius: 'var(--radius-sm)' }}>
                        <Star size={16} color="var(--muted)" />
                      </span>
                    )}
                    <div className="admin-list__main">
                      <div className="admin-list__title">{product.name}</div>
                      <div className="admin-list__sub">{product.category} · {aud(product.price)}</div>
                    </div>
                    <div className="vz-row">
                      <Button size="sm" variant="ghost" title="Move up" disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></Button>
                      <Button size="sm" variant="ghost" title="Move down" disabled={busy || index === featured.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></Button>
                      <Button size="sm" variant="danger" title="Remove from featured" disabled={busy} onClick={() => remove(product)}><X size={15} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card pad>
            <div className="vz-row" style={{ gap: 8, marginBottom: 14 }}>
              <Plus size={18} color="var(--terracotta)" />
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Add a dish</h2>
            </div>
            <div className="vz-row" style={{ marginBottom: 12 }}>
              <Search size={16} color="var(--muted)" style={{ position: 'absolute', marginLeft: 12 }} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search active products"
                aria-label="Search active products"
                style={{ paddingLeft: 38 }}
              />
            </div>
            {candidates.length === 0 ? (
              <EmptyState title={search ? 'No matching products' : 'Everything active is featured'}>
                {search ? 'Try another search.' : 'Add more products first.'}
              </EmptyState>
            ) : (
              <div className="admin-list">
                {candidates.slice(0, 12).map((product) => (
                  <div className="admin-list__row" key={product.id}>
                    <div className="admin-list__main">
                      <div className="admin-list__title">{product.name}</div>
                      <div className="admin-list__sub">{product.category} · {aud(product.price)}</div>
                    </div>
                    <Button size="sm" title={`Feature ${product.name}`} disabled={busy} onClick={() => add(product)}>
                      <Plus size={15} /> Feature
                    </Button>
                  </div>
                ))}
                {candidates.length > 12 && (
                  <p className="vz-muted" style={{ textAlign: 'center', marginBottom: 0, fontSize: '0.85rem' }}>
                    + {candidates.length - 12} more — refine the search to find them.
                  </p>
                )}
              </div>
            )}
            <p className="vz-muted" style={{ fontSize: '0.82rem', marginTop: 12, marginBottom: 0 }}>
              Only <Badge tone="success">active</Badge> <Badge tone="info">available</Badge> <Badge tone="neutral">public</Badge> products can be featured — the same products visitors can order.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
