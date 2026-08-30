// Row mappers — snake_case database rows → camelCase domain objects.

import type {
  Fulfilment,
  KitchenOrder,
  OrderItem,
  OrderItemRow,
  OrderRow,
  PrintJob,
  PrintJobRow,
  Printer,
  PrinterStation,
} from '../lib/types';

export interface PrinterRow {
  id: string;
  name: string;
  station: string;
  host: string;
  port: number;
  paper_width: number | null;
  enabled: boolean;
  auto_print: boolean;
  copies: number | null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function rowToOrder(row: OrderRow): KitchenOrder {
  return {
    id: str(row.id),
    orderNumber: str(row.order_number),
    status: str(row.status, 'New') as KitchenOrder['status'],
    paymentStatus: str(row.payment_status, 'unknown') as KitchenOrder['paymentStatus'],
    fulfilment: (['delivery', 'dine-in'].includes(str(row.fulfilment_method, 'Pickup').toLowerCase())
      ? (str(row.fulfilment_method).toLowerCase() === 'delivery' ? 'Delivery' : 'Dine-in')
      : 'Pickup') as Fulfilment,
    customerName: str(row.customer_name),
    customerPhone: str(row.customer_phone),
    customerEmail: str(row.customer_email),
    address: str(row.delivery_address),
    suburb: str(row.delivery_suburb),
    postcode: str(row.delivery_postcode),
    deliveryInstructions: str(row.delivery_instructions),
    specialInstructions: str(row.special_instructions),
    total: num(row.total),
    itemsCount: num(row.items_count),
    couponCode: str(row.coupon_code),
    createdAt: str(row.created_at, new Date().toISOString()),
    updatedAt: str(row.updated_at, str(row.created_at)),
    acknowledgedAt: row.acknowledged_at ?? null,
    acknowledgedBy: row.acknowledged_by ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancellationReason: str(row.cancellation_reason),
    refundStatus: str(row.refund_status),
    items: [],
  };
}

export function itemRowToItem(row: OrderItemRow): OrderItem {
  const modifiers = Array.isArray(row.modifiers)
    ? row.modifiers.map((m) => {
        if (typeof m === 'object' && m !== null) {
          const mo = m as { name?: unknown; label?: unknown; price?: unknown };
          return { name: str(mo.name ?? mo.label), price: num(mo.price) };
        }
        return { name: String(m), price: 0 };
      })
    : [];
  return {
    id: str(row.id),
    orderId: str(row.order_id),
    productId: row.product_id ?? null,
    name: str(row.product_name, 'Item'),
    quantity: Math.max(1, num(row.quantity, 1)),
    unitPrice: num(row.unit_price),
    modifiers,
    notes: str(row.special_instructions),
  };
}

const JOB_STATUSES = ['QUEUED', 'PRINTING', 'PRINTED', 'FAILED', 'RETRYING'] as const;

/**
 * print_jobs row → PrintJob. Every field defensive: a malformed row must
 * never crash a rendering screen (orderNumber.replace, printerId.slice …).
 */
export function rowToPrintJob(row: PrintJobRow | Record<string, unknown>): PrintJob {
  const raw = row as Record<string, unknown>;
  const status = str(raw.status, 'QUEUED').toUpperCase();
  return {
    id: str(raw.id),
    orderId: str(raw.order_id),
    orderNumber: str(raw.order_number, 'ORDER'),
    printerId: str(raw.printer_id),
    status: (JOB_STATUSES as readonly string[]).includes(status) ? (status as PrintJob['status']) : 'QUEUED',
    attempts: num(raw.attempts),
    maxAttempts: num(raw.max_attempts, 5) || 5,
    lastError: str(raw.last_error),
    origin: (str(raw.origin, 'auto') || 'auto') as PrintJob['origin'],
    createdAt: str(raw.created_at, new Date().toISOString()),
    printedAt: typeof raw.printed_at === 'string' ? raw.printed_at : null,
  };
}

const STATIONS = ['kitchen', 'bar', 'coffee', 'dessert', 'pickup', 'receipt'] as const;

/** printers row → Printer (same defensiveness). */
export function rowToPrinter(row: PrinterRow | Record<string, unknown>): Printer {
  const raw = row as Record<string, unknown>;
  const station = str(raw.station, 'kitchen').toLowerCase();
  return {
    id: str(raw.id),
    name: str(raw.name, 'Printer'),
    station: (STATIONS as readonly string[]).includes(station) ? (station as PrinterStation) : 'kitchen',
    host: str(raw.host),
    port: num(raw.port, 9100) || 9100,
    paperWidth: num(raw.paper_width, 80) || 80,
    enabled: raw.enabled !== false,
    autoPrint: raw.auto_print !== false,
    copies: Math.min(5, Math.max(1, num(raw.copies, 1) || 1)),
  };
}
