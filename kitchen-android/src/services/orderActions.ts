// Order actions — every mutation goes through Supabase; the database state
// machine trigger + RLS are the authority. The UI only *predicts* validity
// (orderLogic.canTransition) so invalid requests are never attempted.

import { supabase } from '../lib/supabase';
import { canTransition } from '../lib/orderLogic';
import type { KitchenOrder, OrderStatus } from '../lib/types';
import { useOrdersStore } from '../state/ordersStore';
import { markNotificationAcknowledged } from './notifications';
import { stopAlert } from './alertPlayer';
import { getSettings } from '../state/settingsStore';

export async function updateOrderStatus(
  order: KitchenOrder,
  to: OrderStatus,
): Promise<{ ok: boolean; error?: string }> {
  if (!canTransition(order.status, to)) {
    return { ok: false, error: `Cannot move ${order.status} → ${to} (the kitchen display only moves orders forward).` };
  }
  const { data, error } = await supabase
    .from('orders')
    .update({ status: to })
    .eq('id', order.id)
    .select('id,status,updated_at')
    .maybeSingle();
  if (error) {
    // The DB trigger message is user-meaningful — surface it.
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: 'Order not found (it may have been completed elsewhere).' };

  const store = useOrdersStore.getState();
  store.upsertOrders([{ ...order, status: to, updatedAt: (data as { updated_at?: string }).updated_at ?? new Date().toISOString() }]);

  // Moving out of New resolves the alert experience.
  if (to !== 'New') {
    const settings = getSettings();
    if (settings.autoAckOnAdvance && !order.acknowledgedAt) {
      await acknowledgeOrder(order.id, { silent: true });
    }
    if (store.activeAlertOrderId === order.id) {
      store.setActiveAlert(null);
      stopAlert();
    }
  }
  return { ok: true };
}

/** ACKNOWLEDGE ORDER — records who saw it and when. */
export async function acknowledgeOrder(
  orderId: string,
  options: { silent?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('orders')
    .update({ acknowledged_at: now, acknowledged_by: userData.user?.id ?? null })
    .eq('id', orderId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Order not found.' };

  const store = useOrdersStore.getState();
  const order = store.orders[orderId];
  if (order) store.upsertOrders([{ ...order, acknowledgedAt: now }]);
  if (store.activeAlertOrderId === orderId) {
    store.setActiveAlert(null);
    stopAlert();
  }
  if (!options.silent) void markNotificationAcknowledged(orderId);
  return { ok: true };
}

/** Cancel — allowed by the state machine from any active status. */
export async function cancelOrder(
  orderId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('orders')
    .update({
      status: 'Cancelled',
      cancelled_at: now,
      cancelled_by: userData.user?.id ?? null,
      cancellation_reason: reason.slice(0, 300),
    })
    .eq('id', orderId);
  if (error) return { ok: false, error: error.message };
  const store = useOrdersStore.getState();
  const order = store.orders[orderId];
  if (order) {
    store.upsertOrders([{ ...order, status: 'Cancelled', cancelledAt: now, cancellationReason: reason.slice(0, 300) }]);
  }
  if (store.activeAlertOrderId === orderId) {
    store.setActiveAlert(null);
    stopAlert();
  }
  return { ok: true };
}
