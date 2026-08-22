/**
 * Kitchen display — the operational heart. Realtime order board with one
 * tap per status advance (New→Accepted→Preparing→Ready→Completed), sound +
 * browser notification for new paid orders. Read-only money fields: kitchen
 * staff can never mutate payment data (enforced by RLS column grants).
 */

import { useCallback, useEffect, useState } from 'react';
import { getOrders, updateOrderStatus } from '../services/orders';
import { useOrdersRealtime } from '../hooks/useOrdersRealtime';
import { useToast } from '../components/Toast';
import { notifyNewOrder } from '../admin/orderNotifications';
import type { Order, OrderStatus } from '../types';
import { Spinner } from '../ui';

const NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  New: 'Accepted',
  Accepted: 'Preparing',
  Preparing: 'Ready',
  Ready: 'Completed',
};

const LIVE_STATUSES: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready'];

export default function Kitchen() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => new Date());
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const all = await getOrders();
      setError('');
      setOrders(all.filter((order) => LIVE_STATUSES.includes(order.status)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load orders.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  // Realtime: reload on any change; a new PAID order also chimes.
  const onRealtime = useCallback(
    (event?: { eventType?: string; new?: Record<string, unknown> }) => {
      const isNewPaid =
        event &&
        (event.eventType === 'INSERT' || String(event.new?.status ?? '') === 'New') &&
        String(event.new?.payment_status ?? '').toLowerCase() === 'paid';
      if (isNewPaid && event.new?.id) {
        notifyNewOrder(String(event.new.id), event.new, toast);
      }
      void load();
    },
    [load, toast],
  );
  useOrdersRealtime(onRealtime);

  const advance = async (order: Order) => {
    const next = NEXT[order.status];
    if (!next) return;
    try {
      await updateOrderStatus(order.orderId, next);
      toast.show(`Order ${order.orderNumber} → ${next}`);
      await load();
    } catch {
      toast.show('Could not update order — check connection', { type: 'error' });
    }
  };

  const minutesSince = (iso: string) =>
    Math.max(0, Math.round((clock.getTime() - new Date(iso).getTime()) / 60000));

  return (
    <main className="kitchen-shell">
      <header className="kitchen-head">
        <div>
          <h1>Live orders</h1>
          <div className="kitchen-head__meta">
            <span className="kitchen-head__count">{orders?.length ?? 0} on the board</span>
            <span>{clock.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </header>

      {error && <p className="vz-error-box">{error}</p>}

      {orders === null ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner /></div>
      ) : orders.length === 0 ? (
        <div className="kitchen-empty">
          <h2>All clear.</h2>
          <p>New paid orders appear here instantly.</p>
        </div>
      ) : (
        <div className="kitchen-grid">
          {orders.map((order) => (
            <article className={`kitchen-card kitchen-card--${order.status}`} key={order.orderId}>
              <div className="kitchen-card__top">
                <span className="kitchen-card__num">{order.orderNumber}</span>
                <span className="kitchen-card__status">{order.status}</span>
              </div>
              <div style={{ fontSize: '0.95rem', color: '#c9b9a5' }}>
                {order.fulfilment} · {minutesSince(order.createdAt)} min ago
                {order.itemsCount ? ` · ${order.itemsCount} items` : ''}
              </div>
              <ul className="kitchen-card__items">
                {order.items.length ? (
                  order.items.map((item) => (
                    <li className="kitchen-card__item" key={item.id}>
                      <span>
                        <span className="kitchen-card__qty">{item.quantity}×</span>
                        {item.name}
                      </span>
                      {item.modifiers.length > 0 && (
                        <span className="kitchen-card__mods">{item.modifiers.join(', ')}</span>
                      )}
                      {item.notes && <span className="kitchen-card__note">Note: {item.notes}</span>}
                    </li>
                  ))
                ) : (
                  <li className="kitchen-card__item">
                    {order.itemsCount} item{order.itemsCount === 1 ? '' : 's'} · details unavailable
                  </li>
                )}
              </ul>
              {order.specialInstructions && order.specialInstructions !== order.notes && (
                <p className="kitchen-card__note">{order.specialInstructions}</p>
              )}
              {NEXT[order.status] && (
                <button className="kitchen-card__advance" onClick={() => void advance(order)}>
                  → {NEXT[order.status]}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
