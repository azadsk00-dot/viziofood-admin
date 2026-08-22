// Domain types — mirrors the shared Supabase schema (web: src/types/index.ts).
// Keep in sync with migrations; the database remains the authority.

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

export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'refunded' | 'partially_refunded' | 'unknown';

export type Fulfilment = 'Pickup' | 'Delivery';

export type OrderModifier = { name: string; price: number };

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: OrderModifier[];
  notes: string;
}

export interface KitchenOrder {
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
  specialInstructions: string;
  total: number;
  itemsCount: number;
  couponCode: string;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  cancelledAt: string | null;
  cancellationReason: string;
  refundStatus: string;
  items: OrderItem[];
}

export type PrintJobStatus = 'QUEUED' | 'PRINTING' | 'PRINTED' | 'FAILED' | 'RETRYING';
export type PrintJobOrigin = 'auto' | 'reprint' | 'retry';

export interface PrintJob {
  id: string;
  orderId: string;
  orderNumber: string;
  printerId: string;
  status: PrintJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string;
  origin: PrintJobOrigin;
  createdAt: string;
  printedAt: string | null;
}

export type PrinterStation = 'kitchen' | 'bar' | 'coffee' | 'dessert' | 'pickup' | 'receipt';

export interface Printer {
  id: string;
  name: string;
  station: PrinterStation;
  host: string;
  port: number;
  paperWidth: number;
  enabled: boolean;
  autoPrint: boolean;
  copies: number;
}

export type IncidentKind =
  | 'printer_failure'
  | 'network_outage'
  | 'missed_order'
  | 'manual_reprint'
  | 'print_retry'
  | 'app_recovery'
  | 'other';

export type IncidentSeverity = 'info' | 'warning' | 'critical';

export interface KitchenIncident {
  id: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  orderId: string | null;
  deviceId: string;
  message: string;
  createdAt: string;
}

/** Raw DB row shapes (snake_case) → mapped in syncService before entering the store. */

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
  items_count: number;
  coupon_code: string;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string;
  refund_status: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  modifiers: unknown;
  special_instructions: string | null;
}

export interface PrintJobRow {
  id: string;
  order_id: string;
  order_number: string;
  printer_id: string;
  status: PrintJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string;
  origin: PrintJobOrigin | null;
  created_at: string;
  printed_at: string | null;
}

export interface PrinterRow {
  id: string;
  name: string;
  station: PrinterStation;
  host: string;
  port: number;
  paper_width: number;
  enabled: boolean;
  auto_print: boolean;
  copies: number;
}
