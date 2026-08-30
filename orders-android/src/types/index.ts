// Domain types — mirrors the existing shared Supabase schema.
// The database remains the authority; keep these in sync with migrations.

export type UserRole = 'admin' | 'staff' | 'kitchen' | 'customer';

export type OrderStatus =
  | 'Draft'
  | 'New'
  | 'Accepted'
  | 'Preparing'
  | 'Ready'
  | 'Completed'
  | 'Rejected'
  | 'Cancelled';

export type PaymentStatus =
  | 'paid'
  | 'pending'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'unknown';

export type Fulfilment = 'Pickup' | 'Delivery' | 'Dine-in';

export interface OrderModifier {
  name: string;
  price: number;
}

export interface OrderItem {
  id: string;
  orderId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: OrderModifier[];
  notes: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfilment: Fulfilment;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  address: string;
  suburb: string;
  postcode: string;
  deliveryInstructions: string;
  /** Customer notes with auto-generated scheduled sentences removed. */
  specialInstructions: string;
  /** The authoritative "Scheduled pickup/dine-in: …" sentence, when present. */
  scheduledText: string | null;
  /** scheduledText parsed to an epoch-ms timestamp; null when unparseable. */
  scheduledAt: number | null;
  total: number;
  taxTotal: number;
  itemsCount: number;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancellationReason: string;
  refundStatus: string;
  items: OrderItem[];
}

// ── Local printer queue ─────────────────────────────────────────────────────

export type PrintJobState = 'queued' | 'printing' | 'printed' | 'failed' | 'retrying';
export type PrintJobOrigin = 'auto' | 'reprint' | 'retry' | 'test';

export interface PrintJob {
  /** Keyed by order id — one auto receipt per order. */
  id: string;
  orderNumber: string;
  state: PrintJobState;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  /** When the next retry becomes due (retrying state), ISO — else null. */
  nextAttemptAt: string | null;
  origin: PrintJobOrigin;
  createdAt: string;
  printedAt: string | null;
  /** Snapshot of the order at enqueue time so reprints survive refetches. */
  receipt: ReceiptSnapshot;
}

/** Everything the receipt renderer needs, captured when the job is queued. */
export interface ReceiptSnapshot {
  orderNumber: string;
  customer: string;
  fulfilment: string;
  createdAt: string;
  scheduledText: string | null;
  notes: string;
  lines: Array<{ quantity: number; name: string; modifiers: string[]; notes: string }>;
  total: number;
}

// ── Printer settings ────────────────────────────────────────────────────────

export interface PrinterSettings {
  /** Master switch for automatic kitchen printing. */
  autoPrint: boolean;
  /** Printer IP (192.168.1.116) or Star MAC address (00:11:62:…). */
  address: string;
}

// ── Raw DB row shapes (snake_case) — mapped before entering the store ───────

export interface OrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  fulfilment_method: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  delivery_address: string;
  delivery_suburb: string;
  delivery_postcode: string;
  delivery_instructions: string;
  special_instructions: string;
  total: number;
  tax_total: number;
  items_count: number;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancellation_reason: string;
  refund_status: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  modifiers: unknown;
  special_instructions: string | null;
}
