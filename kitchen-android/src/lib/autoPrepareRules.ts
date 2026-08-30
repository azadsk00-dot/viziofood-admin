// Auto-prepare eligibility rules — pure, RN-free (unit-tested directly).
// The service wrapper (services/autoPrepare.ts) adds persistence, Supabase
// transitions and logging on top of these gates.

import { canTransition } from './orderLogic';
import type { KitchenOrder } from './types';

/** Only fresh orders are auto-prepared — never historical discoveries. */
export const MAX_ORDER_AGE_MS = 2 * 3600_000;

/** Pure eligibility check. */
export function isAutoPrepareEligible(
  order: Pick<KitchenOrder, 'id' | 'status' | 'createdAt'>,
  preparedIds: ReadonlySet<string>,
  now: number = Date.now(),
): boolean {
  if (order.status !== 'New') return false;
  if (preparedIds.has(order.id)) return false;
  if (!canTransition('New', 'Accepted') || !canTransition('Accepted', 'Preparing')) return false;
  const created = Date.parse(order.createdAt);
  if (Number.isNaN(created)) return false;
  return now - created <= MAX_ORDER_AGE_MS;
}
