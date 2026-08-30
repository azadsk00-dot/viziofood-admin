// Print engine pure logic — retry policy and database-row → ticket mapping.
// Kept free of React Native imports so it is unit-testable in node.

import type { TicketItem, TicketOrder } from './starline';
import { extractScheduledPickup } from './scheduledNote';

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/** Backoff before retry attempt n (1-based), capped at 60s. */
export const retryDelayMs = (attempt: number): number =>
  Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), RETRY_MAX_MS);

export interface EngineJobRow {
  id: string;
  order_id: string;
  order_number: string;
  printer_id: string;
  status: string;
  attempts: number | null;
  max_attempts: number | null;
}

/** Map an orders row + order_items rows to the ticket renderer's input. */
export function toTicketPayload(
  order: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
): { order: TicketOrder; items: TicketItem[] } {
  return extractScheduledPickup({
    orderNumber: String(order.order_number ?? ''),
    status: String(order.status ?? ''),
    paymentStatus: String(order.payment_status ?? ''),
    fulfilment: String(order.fulfilment_method ?? 'Pickup'),
    createdAt: String(order.created_at ?? ''),
    total: Number.isFinite(Number(order.total)) ? Number(order.total) : null,
    customerName: (order.customer_name as string) ?? null,
    address: (order.delivery_address as string) ?? null,
    suburb: (order.delivery_suburb as string) ?? null,
    postcode: (order.delivery_postcode as string) ?? null,
    notes: (order.special_instructions as string) ?? null,
  }, items.map((item) => ({
      name: String(item.product_name ?? 'Item'),
      quantity: Number(item.quantity ?? 1),
      modifiers: Array.isArray(item.modifiers)
        ? item.modifiers.map((m: unknown) => (typeof m === 'object' && m !== null ? String((m as { name?: unknown }).name ?? '') : String(m)))
        : [],
      notes: (item.special_instructions as string) ?? null,
    })));
}
