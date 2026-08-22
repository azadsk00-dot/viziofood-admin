/**
 * Admin Dashboard + Orders — the operational core.
 *
 * Dashboard: REAL metrics over paid orders with proper date windows
 * (today / yesterday / 7d / 30d / custom) — the old version reused the
 * 24-hour slice for week and month. Chart data comes from actual daily
 * revenue, not placeholder bars.
 *
 * Orders: status counters, search, payment + fulfilment + date filters,
 * status progression, cancel (auto server-side refund when paid),
 * full/partial refunds via the Edge Function, CSV export, reprint via the
 * printer service queue.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Download,
  MapPin,
  Phone,
  Printer,
  RotateCcw,
  Search,
  Truck,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, orderStatusTone, Select, Skeleton, Textarea } from '../ui';
import { cancelOrder, processRefund, updateOrderStatus } from './supabase';
import { getOrders } from '../services/orders';
import { useResource } from './useResource';
import { useOrdersRealtime } from '../hooks/useOrdersRealtime';
import { useToast } from '../components/Toast';
import { notifyNewOrder, requestNotificationPermission } from './orderNotifications';
import { getPrinters, reprintOrder } from '../services/printers';
import { buildReport } from '../services/reports';
import type { Order, OrderStatus } from '../types';
import { aud } from '../lib/money';

const statuses: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Rejected'];
const counters: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled'];
const nextActions: Record<OrderStatus, OrderStatus[]> = {
  New: ['Accepted'], Accepted: ['Preparing'], Preparing: ['Ready'], Ready: ['Completed'],
  Completed: [], Cancelled: [], Rejected: [],
};
const cancellable = (order: Order) => order.status !== 'Completed' && order.status !== 'Cancelled' && order.status !== 'Rejected';
const refundableRemaining = (order: Order) => Math.max(0, order.total - order.refundAmount);
// Legacy orders inserted by the old webhook may lack payment_status='paid'
// even though Stripe holds the payment; the refund endpoint re-verifies.
const isPaid = (order: Order) =>
  order.paymentStatus === 'paid' || (order.paymentStatus !== 'failed' && Boolean(order.paymentIntentId || order.stripeSessionId));
const canRefund = (order: Order) => isPaid(order) && refundableRemaining(order) > 0.005 && order.refundStatus !== 'pending';

const elapsed = (createdAt: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
};

function PaymentBadge({ order }: { order: Order }) {
  let tone: 'success' | 'danger' | 'info' | 'gold' | 'neutral' = 'neutral';
  let label = 'Payment unknown';
  if (order.refundStatus === 'pending') { tone = 'gold'; label = 'Refund pending'; }
  else if (order.refundStatus === 'failed') { tone = 'danger'; label = 'Refund failed'; }
  else if (order.refundStatus === 'partially_refunded') { tone = 'gold'; label = 'Partially refunded'; }
  else if (order.refundStatus === 'succeeded' || order.paymentStatus === 'refunded') { tone = 'neutral'; label = 'Refunded'; }
  else if (order.paymentStatus === 'paid') { tone = 'success'; label = 'Paid'; }
  else if (order.paymentStatus === 'pending') { tone = 'info'; label = 'Unpaid'; }
  else if (order.paymentStatus === 'failed') { tone = 'danger'; label = 'Failed'; }
  return <Badge tone={tone}>{label}</Badge>;
}

// ── Cancel confirmation ────────────────────────────────────────────────────

function CancelDialog({ order, close, confirm, busy }: { order: Order; close: () => void; confirm: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState('');
  const paid = isPaid(order);
  return (
    <Modal
      open
      onClose={close}
      title={`Cancel ${order.orderNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>Keep order</Button>
          <Button variant="danger" onClick={() => confirm(reason.trim())} disabled={busy || !reason.trim()}>
            {busy ? 'Cancelling…' : 'Cancel order'}
          </Button>
        </>
      }
    >
      <p className="vz-error-box">
        <AlertTriangle size={16} /> This will cancel the order{paid ? ' and issue a full Stripe refund' : ''}. This action cannot be undone.
      </p>
      <Field label="Cancellation reason" htmlFor="cancel-reason">
        <Textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer requested cancellation, out of stock…" />
      </Field>
    </Modal>
  );
}

// ── Refund (full / partial) ────────────────────────────────────────────────

function RefundDialog({ order, close, confirm, busy }: { order: Order; close: () => void; confirm: (amount: number | null, reason: string) => void; busy: boolean }) {
  const remaining = refundableRemaining(order);
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState<string>(remaining.toFixed(2));
  const [reason, setReason] = useState('Customer requested cancellation');
  const [checked, setChecked] = useState(false);
  const parsedAmount = Math.min(Number(amount) || 0, remaining);
  const valid = mode === 'full' || (parsedAmount > 0 && parsedAmount <= remaining);

  return (
    <Modal
      open
      onClose={close}
      title={`Refund ${order.orderNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>Close</Button>
          <Button variant="gold" onClick={() => confirm(mode === 'full' ? null : parsedAmount, reason)} disabled={busy || !checked || !valid || !reason.trim()}>
            {busy ? 'Refunding…' : `Refund ${mode === 'full' ? aud(remaining) : aud(parsedAmount)}`}
          </Button>
        </>
      }
    >
      <p className="vz-muted" style={{ marginBottom: 14 }}>
        Paid {aud(order.total)}{order.refundAmount > 0 ? ` · already refunded ${aud(order.refundAmount)}` : ''} · refundable {aud(remaining)}
      </p>
      <div className="fulfilment-toggle" style={{ maxWidth: 300, marginBottom: 14 }}>
        <button className={mode === 'full' ? 'is-active' : ''} onClick={() => { setMode('full'); setAmount(remaining.toFixed(2)); }}>Full refund</button>
        <button className={mode === 'partial' ? 'is-active' : ''} onClick={() => setMode('partial')}>Partial refund</button>
      </div>
      {mode === 'partial' && (
        <Field label="Refund amount (AUD)" error={Number(amount) > remaining ? `Cannot exceed ${aud(remaining)}.` : undefined} htmlFor="refund-amount">
          <Input id="refund-amount" type="number" step="0.01" min="0.01" max={remaining.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      )}
      <Field label="Reason" htmlFor="refund-reason">
        <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <label className="vz-row" style={{ gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ accentColor: 'var(--terracotta)', width: 17, height: 17 }} />
        I understand this sends {mode === 'full' ? aud(remaining) : aud(parsedAmount)} back to the customer via Stripe.
      </label>
    </Modal>
  );
}

// ── Order detail ───────────────────────────────────────────────────────────

function OrderDetail({
  order, close, onChange, onCancel, onRefund, onReprint,
}: {
  order: Order; close: () => void; onChange: (order: Order, status: OrderStatus) => void;
  onCancel: (order: Order) => void; onRefund: (order: Order) => void; onReprint: (order: Order) => void;
}) {
  const itemsSubtotal = order.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const stripeRef = order.paymentIntentId || order.stripeSessionId;
  const actions = nextActions[order.status];

  return (
    <Modal
      open
      onClose={close}
      title={order.orderNumber}
      footer={
        <>
          {canRefund(order) && (
            <Button variant="gold" onClick={() => onRefund(order)}><RotateCcw size={15} /> Refund customer</Button>
          )}
          {actions.map((status) => (
            <Button key={status} onClick={() => onChange(order, status)}><CheckCircle2 size={15} /> {status}</Button>
          ))}
          {cancellable(order) && (
            <Button variant="danger" onClick={() => onCancel(order)}><Ban size={15} /> Cancel</Button>
          )}
        </>
      }
    >
      <div className="vz-row vz-row--between" style={{ marginBottom: 12 }}>
        <div className="vz-row">
          <Badge tone={orderStatusTone(order.status)} dot>{order.status}</Badge>
          <PaymentBadge order={order} />
        </div>
        <strong style={{ fontSize: '1.2rem' }}>{aud(order.total)}</strong>
      </div>

      <div className="vz-stack" style={{ gap: 6, marginBottom: 16 }}>
        <strong>{order.customer}</strong>
        <a href={`tel:${order.phone}`} className="vz-row" style={{ gap: 6 }}><Phone size={14} /> {order.phone || 'No phone supplied'}</a>
        <a href={`mailto:${order.email}`} className="vz-row" style={{ gap: 6 }}><CreditCard size={14} /> {order.email}</a>
        <span className="vz-row" style={{ gap: 6 }}>
          {order.fulfilment === 'Delivery' ? <Truck size={15} /> : <MapPin size={15} />}
          {order.fulfilment}
          {order.address ? ` · ${[order.address, order.suburb, order.postcode].filter(Boolean).join(', ')}` : ''}
          {' · '}
          <Clock3 size={14} /> {new Date(order.createdAt).toLocaleString('en-AU')} ({elapsed(order.createdAt)})
        </span>
      </div>

      <h3 style={{ fontSize: '1.02rem' }}>Ordered items</h3>
      {order.items.length ? (
        <ul className="order-card__items" style={{ marginBottom: 16 }}>
          {order.items.map((item) => (
            <li key={item.id}>
              <b>{item.quantity}× {item.name}</b>
              <span style={{ color: 'var(--muted)' }}>
                {' '}· {aud(item.unitPrice * item.quantity)}{item.modifiers.length ? ` · ${item.modifiers.join(', ')}` : ''}
              </span>
              {item.notes && <small style={{ display: 'block', color: 'var(--gold)' }}>{item.notes}</small>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="vz-muted">{order.itemsCount} items · details unavailable</p>
      )}

      <Card flat pad={false} className="summary-lines" style={{ padding: 14, marginBottom: 16 }}>
        <div className="summary-line"><span>Subtotal</span><b>{aud(order.subtotal || itemsSubtotal)}</b></div>
        {order.discountTotal > 0 && (
          <div className="summary-line summary-line--discount"><span>Discount {order.couponCode ? `(${order.couponCode})` : ''}</span><b>−{aud(order.discountTotal)}</b></div>
        )}
        {order.serviceChargeTotal > 0 && <div className="summary-line"><span>Service charge</span><b>{aud(order.serviceChargeTotal)}</b></div>}
        <div className="summary-line"><span>Tax</span><b>{aud(order.taxTotal)}</b></div>
        {order.deliveryFeeTotal > 0 && <div className="summary-line"><span>Delivery</span><b>{aud(order.deliveryFeeTotal)}</b></div>}
        {order.cardFeeTotal > 0 && <div className="summary-line"><span>Card processing</span><b>{aud(order.cardFeeTotal)}</b></div>}
        <div className="summary-line summary-line--total"><span>Total</span><span>{aud(order.total)}</span></div>
      </Card>

      {stripeRef && (
        <p className="vz-row vz-muted" style={{ gap: 6, fontSize: '0.85rem' }}>
          <CreditCard size={14} /> Stripe: <code className="vz-mono">{stripeRef}</code>
        </p>
      )}

      {order.notes && (
        <>
          <h3 style={{ fontSize: '1.02rem' }}>Order notes</h3>
          <p className="vz-muted">{order.notes}</p>
        </>
      )}

      {order.status === 'Cancelled' && (
        <>
          <h3 style={{ fontSize: '1.02rem' }}>Cancellation</h3>
          <p className="vz-muted">
            {order.cancellationReason || 'No reason recorded.'}{order.cancelledAt && ` · ${new Date(order.cancelledAt).toLocaleString('en-AU')}`}
          </p>
        </>
      )}

      {order.refundStatus && (
        <>
          <h3 style={{ fontSize: '1.02rem' }}>Refund</h3>
          <div className="summary-lines" style={{ marginBottom: 0 }}>
            <div className="summary-line"><span>Status</span><b>{order.refundStatus}</b></div>
            {order.refundAmount > 0 && <div className="summary-line"><span>Amount</span><b>{aud(order.refundAmount)}</b></div>}
            {order.refundId && <div className="summary-line"><span>Stripe refund</span><code className="vz-mono">{order.refundId}</code></div>}
            {order.refundReason && <div className="summary-line"><span>Reason</span><span>{order.refundReason}</span></div>}
            {order.refundedAt && <div className="summary-line"><span>Refunded at</span><span>{new Date(order.refundedAt).toLocaleString('en-AU')}</span></div>}
          </div>
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <Button variant="secondary" size="sm" onClick={() => onReprint(order)}><Printer size={14} /> Reprint ticket</Button>
      </div>
    </Modal>
  );
}

function OrderCard({ order, onChange, onCancel, onSelect }: { order: Order; onChange: (order: Order, status: OrderStatus) => void; onCancel: (order: Order) => void; onSelect: (order: Order) => void }) {
  const actions = nextActions[order.status];
  return (
    <Card className={`order-card order-card--${order.status}`}>
      <div className="order-card__head">
        <div>
          <button className="order-card__num" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit' }} onClick={() => onSelect(order)}>
            {order.orderNumber}
          </button>
          <div className="order-card__meta"><Clock3 size={13} style={{ verticalAlign: -2 }} /> {elapsed(order.createdAt)}</div>
        </div>
        <div className="vz-row">
          <Badge tone={orderStatusTone(order.status)} dot>{order.status}</Badge>
          <PaymentBadge order={order} />
        </div>
      </div>
      <div className="vz-row vz-row--between">
        <span className="vz-row vz-muted" style={{ gap: 6 }}>
          {order.fulfilment === 'Delivery' ? <Truck size={15} /> : <MapPin size={15} />} {order.fulfilment}
        </span>
        <strong>{aud(order.total)}</strong>
      </div>
      <div>
        <b>{order.customer}</b>
        <div className="order-card__meta">
          <a href={`tel:${order.phone}`}>{order.phone || 'No phone'}</a> · {order.email}
        </div>
      </div>
      {order.items.length ? (
        <ul className="order-card__items">
          {order.items.map((item) => (
            <li key={item.id}>
              <b>{item.quantity}× {item.name}</b>
              {item.modifiers.length > 0 && <span style={{ color: 'var(--muted)' }}> · {item.modifiers.join(', ')}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="order-card__meta">{order.itemsCount} items · details unavailable</p>
      )}
      {order.notes && <p className="order-card__meta"><b>Notes:</b> {order.notes}</p>}
      <div className="vz-row vz-row--wrap" style={{ gap: 8 }}>
        <Button size="sm" variant="secondary" onClick={() => onSelect(order)}>View order</Button>
        {actions.map((status) => (
          <Button key={status} size="sm" onClick={() => onChange(order, status)}><CheckCircle2 size={14} /> {status}</Button>
        ))}
        {cancellable(order) && (
          <Button size="sm" variant="ghost" onClick={() => onCancel(order)}><Ban size={14} /> Cancel</Button>
        )}
      </div>
    </Card>
  );
}

// ── Orders page ────────────────────────────────────────────────────────────

export function EnhancedOrders() {
  const resource = useResource(getOrders);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'All' | OrderStatus>('All');
  const [payment, setPayment] = useState<'All' | 'paid' | 'unpaid' | 'refunded'>('All');
  const [fulfilment, setFulfilment] = useState<'All' | 'Pickup' | 'Delivery'>('All');
  const [selected, setSelected] = useState<Order>();
  const [cancelTarget, setCancelTarget] = useState<Order>();
  const [refundTarget, setRefundTarget] = useState<Order>();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const pageSize = 12;

  // Reprint needs a printer target.
  const [printerList, setPrinterList] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void getPrinters().then((printers) => setPrinterList(printers.filter((p) => p.enabled).map(({ id, name }) => ({ id, name })))).catch(() => undefined);
  }, []);

  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(
    (event?: { eventType?: string; new?: Record<string, unknown> }) => {
      if (
        event &&
        (String(event.new?.payment_status ?? '').toLowerCase() === 'paid') &&
        (event.eventType === 'INSERT' || String(event.new?.status ?? '') === 'New')
      ) {
        const id = String(event.new?.id ?? '');
        if (id) notifyNewOrder(id, event.new ?? {}, toast);
        void requestNotificationPermission();
      }
      void resource.reload();
    },
    [resource.reload, toast],
  );
  useOrdersRealtime(refresh);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (resource.data ?? []).filter((order) => {
      if (term && ![order.orderNumber, order.customer, order.phone, order.email].some((value) => value.toLowerCase().includes(term))) return false;
      if (status !== 'All' && order.status !== status) return false;
      if (fulfilment !== 'All' && order.fulfilment !== fulfilment) return false;
      if (payment === 'paid' && !isPaid(order)) return false;
      if (payment === 'unpaid' && isPaid(order)) return false;
      if (payment === 'refunded' && order.refundAmount <= 0) return false;
      return true;
    });
  }, [resource.data, query, status, payment, fulfilment]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totals = useMemo(
    () => Object.fromEntries(counters.map((value) => [value, (resource.data ?? []).filter((order) => order.status === value).length])) as Record<OrderStatus, number>,
    [resource.data],
  );

  const update = async (order: Order, next: OrderStatus) => {
    try {
      await updateOrderStatus(order.orderId, next);
      toast.show(`${order.orderNumber} marked ${next}`);
      await resource.reload();
      setSelected((current) => (current?.orderId === order.orderId ? { ...current, status: next } : current));
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Could not update order.', 'error');
    }
  };

  // Cancel flow: mark Cancelled; if the order was paid, follow up with a full
  // server-side Stripe refund (never from the browser).
  const confirmCancel = async (order: Order, reason: string) => {
    setBusy(true);
    try {
      await cancelOrder(order.orderId, reason);
      toast.show(`${order.orderNumber} cancelled.`);
      if (isPaid(order) && refundableRemaining(order) > 0.005) {
        try {
          await processRefund(order.orderId, undefined, `Order cancelled: ${reason}`);
          toast.show(`Full refund issued for ${order.orderNumber}.`);
        } catch (refundError) {
          toast.show(
            refundError instanceof Error ? refundError.message : 'Order cancelled, but the refund could not be completed. Retry from the order detail view.',
            'error',
          );
        }
      }
      setCancelTarget(undefined);
      setSelected(undefined);
      await resource.reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Unable to cancel this order.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmRefund = async (order: Order, amount: number | null, reason: string) => {
    setBusy(true);
    try {
      await processRefund(order.orderId, amount ?? undefined, reason);
      toast.show(`Refund issued for ${order.orderNumber}.`);
      setRefundTarget(undefined);
      setSelected(undefined);
      await resource.reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Refund could not be completed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const reprint = async (order: Order) => {
    if (!printerList.length) {
      toast.show('No enabled printers configured (Admin → Printers).', 'error');
      return;
    }
    try {
      await reprintOrder(order.orderId, order.orderNumber, printerList[0].id);
      toast.show(`Reprint queued on ${printerList[0].name}`);
    } catch {
      toast.show('Could not queue the reprint.', 'error');
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Order', 'Customer', 'Phone', 'Email', 'Fulfilment', 'Payment', 'Status', 'Refund status', 'Refunded', 'Subtotal', 'Tax', 'Total', 'Placed'],
      ...filtered.map((order) => [
        order.orderNumber, order.customer, order.phone, order.email, order.fulfilment, order.paymentStatus,
        order.status, order.refundStatus, order.refundAmount.toFixed(2), order.subtotal.toFixed(2), order.taxTotal.toFixed(2), order.total.toFixed(2), order.createdAt,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `vizio-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const active = selected ? (resource.data ?? []).find((order) => order.orderId === selected.orderId) ?? selected : undefined;
  const activeCancel = cancelTarget ? (resource.data ?? []).find((order) => order.orderId === cancelTarget.orderId) ?? cancelTarget : undefined;
  const activeRefund = refundTarget ? (resource.data ?? []).find((order) => order.orderId === refundTarget.orderId) ?? refundTarget : undefined;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Orders</h1>
          <p className="admin-head__sub">Live order management — updates in real time.</p>
        </div>
        <div className="vz-row">
          <Button variant="secondary" onClick={exportCsv}><Download size={15} /> Export CSV</Button>
        </div>
      </div>

      <div className="vz-row vz-row--wrap" style={{ gap: 8, marginBottom: 14 }} aria-label="Order status counts">
        {counters.map((value) => (
          <button
            key={value}
            className={`vz-btn vz-btn--sm ${status === value ? 'vz-btn--primary' : 'vz-btn--secondary'}`}
            onClick={() => { setStatus(status === value ? 'All' : value); setPage(1); }}
          >
            {value} · {totals[value]}
          </button>
        ))}
      </div>

      <div className="admin-toolbar">
        <div className="vz-row" style={{ flex: 1, minWidth: 220 }}>
          <Search size={17} color="var(--muted)" style={{ position: 'absolute', marginLeft: 12 }} />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search order, customer, phone or email"
            aria-label="Search orders"
            style={{ paddingLeft: 38 }}
          />
        </div>
        <Select value={payment} onChange={(e) => { setPayment(e.target.value as typeof payment); setPage(1); }} aria-label="Filter by payment" style={{ width: 'auto' }}>
          <option value="All">All payments</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
          <option value="refunded">Refunded</option>
        </Select>
        <Select value={fulfilment} onChange={(e) => { setFulfilment(e.target.value as typeof fulfilment); setPage(1); }} aria-label="Filter by fulfilment" style={{ width: 'auto' }}>
          <option value="All">Pickup + delivery</option>
          <option value="Pickup">Pickup</option>
          <option value="Delivery">Delivery</option>
        </Select>
      </div>

      {resource.loading ? (
        <div className="menu-grid">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} height={220} />)}
        </div>
      ) : resource.error ? (
        <p className="vz-error-box">{resource.error}</p>
      ) : visible.length === 0 ? (
        <EmptyState title="No orders match these filters">Adjust the filters or wait for the next order.</EmptyState>
      ) : (
        <div className="menu-grid">
          {visible.map((order) => (
            <OrderCard key={order.orderId} order={order} onChange={update} onCancel={setCancelTarget} onSelect={setSelected} />
          ))}
        </div>
      )}

      {!resource.loading && (
        <div className="vz-row vz-row--between" style={{ marginTop: 16 }}>
          <span className="vz-muted">{filtered.length} orders · page {page} of {pageCount}</span>
          <div className="vz-row">
            <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>
              <ChevronLeft size={15} /> Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>
              Next <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}

      {active && (
        <OrderDetail
          order={active}
          close={() => setSelected(undefined)}
          onChange={update}
          onCancel={setCancelTarget}
          onRefund={setRefundTarget}
          onReprint={(order) => void reprint(order)}
        />
      )}
      {activeCancel && (
        <CancelDialog
          order={activeCancel}
          close={() => setCancelTarget(undefined)}
          confirm={(reason) => void confirmCancel(activeCancel, reason)}
          busy={busy}
        />
      )}
      {activeRefund && (
        <RefundDialog
          order={activeRefund}
          close={() => setRefundTarget(undefined)}
          confirm={(amount, reason) => void confirmRefund(activeRefund, amount, reason)}
          busy={busy}
        />
      )}
    </>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────

type RangeId = 'today' | 'yesterday' | '7d' | '30d';

const rangeWindow = (id: RangeId): { from: Date; to: Date; days: number } => {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const now = new Date();
  const today = startOfDay(now);
  switch (id) {
    case 'today': return { from: today, to: now, days: 1 };
    case 'yesterday': {
      const from = new Date(today.getTime() - 86_400_000);
      return { from, to: today, days: 1 };
    }
    case '7d': return { from: new Date(today.getTime() - 6 * 86_400_000), to: now, days: 7 };
    case '30d': return { from: new Date(today.getTime() - 29 * 86_400_000), to: now, days: 30 };
  }
};

export function EnhancedDashboard() {
  const orders = useResource(getOrders);
  const [range, setRange] = useState<RangeId>('today');
  const refresh = useCallback(() => void orders.reload(), [orders.reload]);
  useOrdersRealtime(refresh);

  const all = orders.data ?? [];
  const { from, to, days } = rangeWindow(range);
  const report = useMemo(
    () => buildReport(all, { from, to }),
    [all, from.getTime(), to.getTime()], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const summary = report.summary;
  const live = all.filter((order) => ['New', 'Accepted', 'Preparing', 'Ready'].includes(order.status)).length;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Dashboard</h1>
          <p className="admin-head__sub">Live figures from your orders — no placeholders.</p>
        </div>
        <div className="vz-row">
          {(['today', 'yesterday', '7d', '30d'] as RangeId[]).map((id) => (
            <Button key={id} size="sm" variant={range === id ? 'primary' : 'secondary'} onClick={() => setRange(id)}>
              {id === 'today' ? 'Today' : id === 'yesterday' ? 'Yesterday' : id === '7d' ? '7 days' : '30 days'}
            </Button>
          ))}
        </div>
      </div>

      {orders.loading ? (
        <div className="dash-grid">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} height={92} />)}</div>
      ) : orders.error ? (
        <p className="vz-error-box">{orders.error}</p>
      ) : (
        <>
          <div className="dash-grid">
            <Card className="dash-metric">
              <div className="dash-metric__label">Net revenue</div>
              <div className="dash-metric__value">{aud(summary.netRevenueCents / 100)}</div>
              <div className="dash-metric__delta">gross {aud(summary.grossRevenueCents / 100)} · refunded {aud(summary.refundedCents / 100)}</div>
            </Card>
            <Card className="dash-metric">
              <div className="dash-metric__label">Paid orders</div>
              <div className="dash-metric__value">{summary.paidOrders}</div>
              <div className="dash-metric__delta">{summary.cancelledOrders} cancelled in range</div>
            </Card>
            <Card className="dash-metric">
              <div className="dash-metric__label">Average order</div>
              <div className="dash-metric__value">{aud(summary.averageOrderCents / 100)}</div>
              <div className="dash-metric__delta">net of refunds</div>
            </Card>
            <Card className="dash-metric">
              <div className="dash-metric__label">Live now</div>
              <div className="dash-metric__value">{live}</div>
              <div className="dash-metric__delta">orders on the board</div>
            </Card>
            <Card className="dash-metric">
              <div className="dash-metric__label">Pickup / Delivery</div>
              <div className="dash-metric__value">{summary.pickupOrders} / {summary.deliveryOrders}</div>
              <div className="dash-metric__delta">paid orders in range</div>
            </Card>
            <Card className="dash-metric">
              <div className="dash-metric__label">Charges collected</div>
              <div className="dash-metric__value">{aud((summary.taxCollectedCents + summary.serviceChargeCents) / 100)}</div>
              <div className="dash-metric__delta">tax {aud(summary.taxCollectedCents / 100)} · service {aud(summary.serviceChargeCents / 100)}</div>
            </Card>
          </div>

          <div className="dash-cols">
            <Card pad>
              <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Revenue — last {days} day{days === 1 ? '' : 's'}</h2>
              {report.daily.length ? (
                <div className="bar-chart" role="img" aria-label="Daily net revenue">
                  {report.daily.map((point) => {
                    const max = Math.max(...report.daily.map((p) => p.revenueCents), 1);
                    return (
                      <div className="bar-chart__col" key={point.date} title={`${point.date}: ${aud(point.revenueCents / 100)} (${point.orders} orders)`}>
                        <div className="bar-chart__bar" style={{ height: `${Math.max(2, (point.revenueCents / max) * 100)}%` }} />
                        <span className="bar-chart__label">
                          {range === 'today' ? point.date.slice(11) : point.date.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="vz-muted">No data in this range yet.</p>
              )}
            </Card>

            <Card pad>
              <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Top products</h2>
              {report.topProducts.length ? (
                <div className="vz-stack" style={{ gap: 10 }}>
                  {report.topProducts.slice(0, 6).map((product, index) => (
                    <div key={product.name} className="vz-row vz-row--between">
                      <span className="vz-row" style={{ gap: 10 }}>
                        <strong style={{ color: 'var(--terracotta)' }}>{String(index + 1).padStart(2, '0')}</strong>
                        {product.name}
                      </span>
                      <span className="vz-muted">{product.quantity}× · {aud(product.revenueCents / 100)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="vz-muted">No product sales in this range.</p>
              )}
            </Card>
          </div>

          <Card pad style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Recent orders</h2>
            {all.length ? (
              <div className="vz-stack" style={{ gap: 10 }}>
                {all.slice(0, 6).map((order) => (
                  <div key={order.orderId} className="vz-row vz-row--between">
                    <span className="vz-row" style={{ gap: 10 }}>
                      <strong>{order.orderNumber}</strong>
                      <span className="vz-muted">{order.customer}</span>
                      <Badge tone={orderStatusTone(order.status)}>{order.status}</Badge>
                    </span>
                    <strong>{aud(order.total)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="vz-muted">No orders yet.</p>
            )}
          </Card>
        </>
      )}
    </>
  );
}
