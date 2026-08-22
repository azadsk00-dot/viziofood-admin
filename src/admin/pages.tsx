/**
 * Admin: Categories, Customers, and REAL Reports.
 * The legacy placeholder Dashboard/Orders/Login components were removed —
 * EnhancedDashboard/EnhancedOrders in AdminEnhanced.tsx and AdminLogin.tsx
 * are the live implementations.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Download, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import type { AdminCategory } from './types';
import { createCategory, deleteCategory, getCategories, getCustomers, updateCategory } from './supabase';
import { getOrders } from '../services/orders';
import { useResource } from './useResource';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Skeleton, Textarea } from '../ui';
import { aud } from '../lib/money';
import { buildReport, downloadCsv, ordersToCsv, type DateRange } from '../services/reports';

// ── Categories ─────────────────────────────────────────────────────────────

function CategoryEditor({ item, done, close }: { item?: AdminCategory; done: () => Promise<void>; close: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (item) await updateCategory(item.id, { name, description });
      else await createCategory(name, description);
      await done();
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the category.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={item ? 'Edit category' : 'Add category'}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button form="category-form" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save category'}</Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit}>
        {error && <p className="vz-field__error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
        <Field label="Name" htmlFor="cat-name">
          <Input id="cat-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pasta" />
        </Field>
        <Field label="Description" htmlFor="cat-desc">
          <Textarea id="cat-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </Field>
      </form>
    </Modal>
  );
}

export function Categories() {
  const resource = useResource(getCategories);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<AdminCategory>();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(
    () => (resource.data ?? []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase())),
    [resource.data, search],
  );

  const move = async (category: AdminCategory, direction: -1 | 1) => {
    const list = [...(resource.data ?? [])];
    const index = list.findIndex((c) => c.id === category.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setBusy(true);
    try {
      await Promise.all(list.map((c, position) => updateCategory(c.id, { displayOrder: position + 1 })));
      await resource.reload();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (category: AdminCategory) => {
    setBusy(true);
    try {
      await updateCategory(category.id, { active: !category.active });
      await resource.reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (category: AdminCategory) => {
    const message = category.count > 0
      ? `Delete ${category.name}? ${category.count} product${category.count === 1 ? '' : 's'} keep their category label but this section disappears from the menu.`
      : `Delete ${category.name}?`;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      await deleteCategory(category.id);
      await resource.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Categories</h1>
          <p className="admin-head__sub">The order here is the section order on the public menu.</p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus size={16} /> Add category</Button>
      </div>

      <div className="admin-toolbar">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search categories" aria-label="Search categories" />
      </div>

      {resource.loading ? (
        <div className="vz-stack"><Skeleton height={52} /><Skeleton height={52} /><Skeleton height={52} /></div>
      ) : resource.error ? (
        <p className="vz-error-box">{resource.error}</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No categories yet">Add your first menu section.</EmptyState>
      ) : (
        <div className="vz-table-wrap">
          <table className="vz-table">
            <thead>
              <tr><th>Order</th><th>Category</th><th>Products</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((category) => (
                <tr key={category.id}>
                  <td>
                    <div className="vz-row">
                      <Button size="sm" variant="ghost" title="Move up" disabled={busy} onClick={() => void move(category, -1)}><ArrowUp size={15} /></Button>
                      <Button size="sm" variant="ghost" title="Move down" disabled={busy} onClick={() => void move(category, 1)}><ArrowDown size={15} /></Button>
                    </div>
                  </td>
                  <td><b>{category.name}</b><div className="vz-muted" style={{ fontSize: '0.8rem' }}>{category.description}</div></td>
                  <td>{category.count}</td>
                  <td>{category.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
                  <td>
                    <div className="vz-row">
                      <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditor(category)}><Pencil size={15} /></Button>
                      <Button size="sm" variant="ghost" title={category.active ? 'Deactivate' : 'Activate'} disabled={busy} onClick={() => void toggle(category)}><Power size={15} /></Button>
                      <Button size="sm" variant="danger" title="Delete" disabled={busy} onClick={() => void remove(category)}><Trash2 size={15} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="vz-muted" style={{ marginTop: 12, fontSize: '0.85rem' }}>
        Products inside each section follow their own display order. Deactivated categories and their products are hidden from the menu.
      </p>

      {adding && <CategoryEditor close={() => setAdding(false)} done={resource.reload} />}
      {editor && <CategoryEditor item={editor} close={() => setEditor(undefined)} done={resource.reload} />}
    </>
  );
}

// ── Customers ──────────────────────────────────────────────────────────────

export function Customers() {
  const resource = useResource(getCustomers);
  const [query, setQuery] = useState('');
  const list = resource.data?.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())) ?? [];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Customers</h1>
          <p className="admin-head__sub">Derived from order history — spend and visit counts are live.</p>
        </div>
      </div>

      <div className="admin-toolbar">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customers" aria-label="Search customers" />
      </div>

      {resource.loading ? (
        <div className="vz-stack"><Skeleton height={52} /><Skeleton height={52} /></div>
      ) : resource.error ? (
        <p className="vz-error-box">{resource.error}</p>
      ) : list.length === 0 ? (
        <EmptyState title="No customers match that search.">Customer records appear as orders come in.</EmptyState>
      ) : (
        <div className="vz-table-wrap">
          <table className="vz-table">
            <thead>
              <tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Total spend</th><th>Last order</th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b><div className="vz-muted" style={{ fontSize: '0.8rem' }}>{c.email}</div></td>
                  <td>—</td>
                  <td>{c.orders}</td>
                  <td><b>{aud(c.spend)}</b></td>
                  <td>{c.lastOrder ? new Date(c.lastOrder).toLocaleDateString('en-AU') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Reports (real data) ────────────────────────────────────────────────────

type ReportRange = '7d' | '30d' | '90d';

const reportWindow = (id: ReportRange): DateRange => {
  const days = id === '7d' ? 7 : id === '30d' ? 30 : 90;
  const now = new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  return { from, to: now };
};

export function Reports() {
  const resource = useResource(getOrders);
  const [range, setRange] = useState<ReportRange>('30d');
  const window = reportWindow(range);
  const report = useMemo(
    () => buildReport(resource.data ?? [], window),
    [resource.data, range], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const s = report.summary;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Reports</h1>
          <p className="admin-head__sub">Sales, fees, refunds and product performance — from real order data.</p>
        </div>
        <div className="vz-row">
          {(['7d', '30d', '90d'] as ReportRange[]).map((id) => (
            <Button key={id} size="sm" variant={range === id ? 'primary' : 'secondary'} onClick={() => setRange(id)}>
              {id === '7d' ? 'Last 7 days' : id === '30d' ? 'Last 30 days' : 'Last 90 days'}
            </Button>
          ))}
          <Button size="sm" variant="secondary" onClick={() => downloadCsv(`vizio-report-${range}.csv`, ordersToCsv(report.scoped))}>
            <Download size={14} /> Export CSV
          </Button>
        </div>
      </div>

      {resource.loading ? (
        <div className="dash-grid">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={92} />)}</div>
      ) : resource.error ? (
        <p className="vz-error-box">{resource.error}</p>
      ) : (
        <>
          <div className="dash-grid">
            <Card className="dash-metric"><div className="dash-metric__label">Net revenue</div><div className="dash-metric__value">{aud(s.netRevenueCents / 100)}</div></Card>
            <Card className="dash-metric"><div className="dash-metric__label">Paid orders</div><div className="dash-metric__value">{s.paidOrders}</div></Card>
            <Card className="dash-metric"><div className="dash-metric__label">Average order</div><div className="dash-metric__value">{aud(s.averageOrderCents / 100)}</div></Card>
            <Card className="dash-metric"><div className="dash-metric__label">Refunded</div><div className="dash-metric__value">{aud(s.refundedCents / 100)}</div></Card>
            <Card className="dash-metric"><div className="dash-metric__label">Discounts given</div><div className="dash-metric__value">{aud(s.discountCents / 100)}</div></Card>
            <Card className="dash-metric"><div className="dash-metric__label">Cancelled orders</div><div className="dash-metric__value">{s.cancelledOrders}</div></Card>
          </div>

          <div className="dash-cols" style={{ marginTop: 16 }}>
            <Card pad>
              <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Daily net revenue</h2>
              <div className="bar-chart" role="img" aria-label="Daily net revenue">
                {report.daily.map((point) => {
                  const max = Math.max(...report.daily.map((p) => p.revenueCents), 1);
                  return (
                    <div className="bar-chart__col" key={point.date} title={`${point.date}: ${aud(point.revenueCents / 100)}`}>
                      <div className="bar-chart__bar" style={{ height: `${Math.max(2, (point.revenueCents / max) * 100)}%` }} />
                      <span className="bar-chart__label">{point.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card pad>
              <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Charges & fees</h2>
              <div className="summary-lines">
                <div className="summary-line"><span>Tax collected</span><b>{aud(s.taxCollectedCents / 100)}</b></div>
                <div className="summary-line"><span>Service charge</span><b>{aud(s.serviceChargeCents / 100)}</b></div>
                <div className="summary-line"><span>Card processing fees</span><b>{aud(s.cardFeeCents / 100)}</b></div>
                <div className="summary-line"><span>Delivery fees</span><b>{aud(s.deliveryFeeCents / 100)}</b></div>
                <div className="summary-line"><span>Pickup orders</span><b>{s.pickupOrders}</b></div>
                <div className="summary-line"><span>Delivery orders</span><b>{s.deliveryOrders}</b></div>
              </div>
            </Card>
          </div>

          <Card pad style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Top products</h2>
            {report.topProducts.length ? (
              <div className="vz-table-wrap" style={{ border: 'none' }}>
                <table className="vz-table">
                  <thead><tr><th>#</th><th>Product</th><th>Quantity</th><th>Revenue</th></tr></thead>
                  <tbody>
                    {report.topProducts.map((product, index) => (
                      <tr key={product.name}>
                        <td>{index + 1}</td>
                        <td><b>{product.name}</b></td>
                        <td>{product.quantity}</td>
                        <td><b>{aud(product.revenueCents / 100)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="vz-muted">No product sales in this range.</p>
            )}
          </Card>
        </>
      )}
    </>
  );
}
