// Auto-prepare — every genuinely-new valid order moves NEW → ACCEPTED →
// PREPARING automatically, no matter where the tablet discovered it:
// realtime event, reconciliation after a disconnect/screen-lock, or an app
// restart. Previously this only happened when a human tapped ACCEPT in the
// foreground, so backgrounded/locked tablets left orders sitting in NEW.
//
// Safety rails:
//   - Persisted dedupe: preparedOrderIds (one transition set per order, per
//     device, EVER) — no duplicate transitions, no duplicate card churn.
//   - Eligibility window: orders older than MAX_ORDER_AGE are never touched
//     (reconciliation must not bulk-advance yesterday's stragglers).
//   - Race guards: each step updates WHERE status = <expected>, so another
//     device/staff member moving the order first simply cancels our step.
//   - The database state-machine trigger + RLS remain the authority; a
//     rejection here is logged and never retried for that order.

import { supabase } from '../lib/supabase';
import type { KitchenOrder, OrderStatus } from '../lib/types';
import { useOrdersStore } from '../state/ordersStore';
import { getSettings } from '../state/settingsStore';
import { acknowledgeOrder } from './orderActions';
import { isAutoPrepareEligible, MAX_ORDER_AGE_MS } from '../lib/autoPrepareRules';

export { isAutoPrepareEligible, MAX_ORDER_AGE_MS };

const inFlight = new Set<string>();

export type AutoPrepareResult = 'prepared' | 'skipped' | 'failed';

/** One guarded forward step: UPDATE … WHERE id = ? AND status = <from>. */
async function stepTo(
  order: KitchenOrder,
  from: OrderStatus,
  to: OrderStatus,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('orders')
    .update({ status: to })
    .eq('id', order.id)
    .eq('status', from)
    .select('id,updated_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) return false; // someone else moved it first — fine
  const updatedAt = (data as { updated_at?: string }).updated_at ?? new Date().toISOString();
  useOrdersStore.getState().upsertOrders([{ ...order, status: to, updatedAt }]);
  return true;
}

/**
 * Advance a fresh NEW order to PREPARING. Idempotent per (device, order) via
 * the persisted preparedOrderIds set; concurrent invocations via inFlight.
 */
export async function autoPrepareOrder(order: KitchenOrder): Promise<AutoPrepareResult> {
  if (!getSettings().autoPrepareNewOrders) return 'skipped';
  const store = useOrdersStore.getState();
  if (!isAutoPrepareEligible(order, new Set(store.preparedOrderIds))) return 'skipped';
  if (inFlight.has(order.id)) return 'skipped';
  inFlight.add(order.id);
  // Mark BEFORE the transitions: even a partial failure must not re-trigger
  // (the race guards + staff workflow cover the rest).
  store.markPrepared(order.id);
  try {
    const accepted = await stepTo(order, 'New', 'Accepted');
    if (!accepted) return 'skipped';
    const preparing = await stepTo({ ...order, status: 'Accepted' }, 'Accepted', 'Preparing');
    if (preparing) {
      console.log('[auto-prepare] ' + order.orderNumber + ' → Preparing');
      // Same audit behaviour as a human tapping ACCEPT.
      if (getSettings().autoAckOnAdvance && !order.acknowledgedAt) {
        void acknowledgeOrder(order.id, { silent: true }).catch(() => undefined);
      }
      return 'prepared';
    }
    return 'prepared'; // reached Accepted; another device is driving it forward
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[auto-prepare] failed for ' + order.orderNumber + ': ' + message);
    return 'failed';
  } finally {
    inFlight.delete(order.id);
  }
}
