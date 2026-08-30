// OrderEventProcessor — THE single central pipeline for incoming orders.
//
// Every arrival path — realtime INSERT, realtime UPDATE (the webhook's
// Draft→New paid transition), reconciliation queries (startup, reconnect,
// foreground, periodic safety sweep) — funnels through processIncomingOrder().
// There is no other path into the store, the notification system, or the
// printer queue, which is what makes the duplicate guarantees hold:
//
//   * duplicate cards: impossible — merge is keyed by order id
//   * duplicate notifications: impossible — persisted alertedOrderIds,
//     marked BEFORE the alert fires (a crash may lose one alert but can
//     never duplicate one)
//   * duplicate receipts: impossible — the print queue is keyed by order id
//     and only manual Reprint requeues
//
// AUTO-ACCEPT: a genuinely new paid order is automatically advanced
// New → Preparing (a valid forward transition in the existing DB state
// machine — no new status, no backend change) so it lands straight in the
// kitchen's PREPARING column with no manual Accept step. The write goes
// through the normal RLS-guarded status update; failure is retried on the
// next reconciliation for paid orders still stuck in New.

import type { Order } from '../types';
import { useOrdersStore } from '../state/ordersStore';
import { getPrinterSettings } from '../state/settingsStore';
import { canTransition, isNewPaidOrder } from '../orders/orderStatus';
import { isRecentOrder } from '../orders/reconcile';
import { printerQueue } from './printerQueue';
import * as notificationService from './notificationService';
import { fetchOrderItems, updateOrderStatus } from './orderService';

export type OrderSource = 'realtime' | 'reconcile';

export async function processIncomingOrder(order: Order, source: OrderSource): Promise<void> {
  const store = useOrdersStore.getState();
  store.upsertOrders([order]);

  // Item detail enriches the board; the alert decision needs only the row.
  if (!order.items.length) void enrichItems(order.id);

  if (!isNewPaidOrder(order)) {
    // Already alerted earlier (auto-accept may have failed) but still New →
    // retry the auto-accept; never re-alert.
    if (order.status === 'New' && order.paymentStatus === 'paid' && store.hasAlerted(order.id)) {
      void autoAccept(order);
    }
    return;
  }
  if (store.hasAlerted(order.id)) {
    void autoAccept(order);
    return;
  }

  // A reconciliation-discovered order only alerts when it is recent — a
  // fresh install (or cleared storage) must not ring through this morning's
  // already-handled orders. Realtime events are fresh by nature.
  if (source === 'reconcile' && !isRecentOrder(order)) {
    store.markAlerted(order.id);
    return;
  }

  // Mark FIRST (see file header), then fire every alert channel once.
  store.markAlerted(order.id);
  await notificationService.notifyNewOrder(order);

  const printer = getPrinterSettings();
  if (printer.autoPrint && printer.address.trim()) {
    printerQueue.enqueueAuto(order);
  }

  // New paid order → PREPARING immediately (optimistic; the DB write and the
  // realtime echo confirm moments later).
  void autoAccept(order);
}

/** Advance a paid New order to Preparing via the existing status mechanism. */
async function autoAccept(order: Order): Promise<void> {
  if (order.status !== 'New' || !canTransition('New', 'Preparing')) return;
  // Optimistic local flip so the card lands in PREPARING without waiting
  // for the DB round-trip; a failed write is corrected by reconciliation.
  const current = useOrdersStore.getState().orders[order.id] ?? order;
  if (current.status === 'New') {
    useOrdersStore.getState().upsertOrders([
      { ...current, status: 'Preparing', updatedAt: new Date().toISOString() },
    ]);
  }
  try {
    await updateOrderStatus(order.id, 'Preparing');
  } catch (error) {
    console.warn('[processor] auto-accept failed (will retry on reconcile)', error);
    // Restore the prior local state so the board shows the truth until retry.
    const now = useOrdersStore.getState().orders[order.id];
    if (now && now.status === 'Preparing') {
      useOrdersStore.getState().upsertOrders([
        { ...now, status: order.status, updatedAt: order.updatedAt },
      ]);
    }
  }
}

/** Fetch item rows for an order and merge them into the stored order. */
async function enrichItems(orderId: string): Promise<void> {
  const items = await fetchOrderItems(orderId).catch(() => null);
  if (!items) return;
  const current = useOrdersStore.getState().orders[orderId];
  if (!current || current.items.length) return;
  useOrdersStore.getState().upsertOrders([{ ...current, items }]);
}
