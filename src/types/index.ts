/**
 * Canonical domain model for the Vizio Food platform.
 *
 * These types are the contract between every client — customer web, admin
 * web, kitchen display, the local printer service, and the future mobile
 * apps. UI code may *derive* view types from these, but must not redefine
 * them. Column names map 1:1 to the Postgres schema in supabase/migrations.
 */

// ─── Roles & access ────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'staff' | 'kitchen' | 'customer';

export interface Profile {
  id: string;
  fullName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

// ─── Catalogue ─────────────────────────────────────────────────────────────

export type ProductVisibility = 'public' | 'hidden' | 'private';

export type DietaryFlag = 'vegetarian' | 'vegan' | 'halal' | 'glutenFree';

export interface Product {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  category: string;
  categoryId: string | null;
  price: number;
  salePrice: number | null;
  sku: string;
  active: boolean;
  available: boolean;
  featured: boolean;
  popular: boolean;
  archived: boolean;
  archivedAt: string | null;
  vegetarian: boolean;
  vegan: boolean;
  halal: boolean;
  glutenFree: boolean;
  preparationTime: number;
  calories: number | null;
  ingredients: string[];
  allergens: string[];
  tags: string[];
  displayOrder: number;
  featuredOrder: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  gallery: string[];
  visibility: ProductVisibility;
  internalNotes: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProductDraft = Omit<Product, 'id' | 'createdBy' | 'updatedBy' | 'createdAt' | 'updatedAt'>;

export interface Category {
  id: string;
  name: string;
  description: string;
  active: boolean;
  displayOrder: number;
  productCount: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  active: boolean;
  displayOrder: number;
}

export interface ModifierOption {
  id: string;
  groupId: string;
  name: string;
  description: string;
  price: number;
  active: boolean;
  displayOrder: number;
}

// ─── Specials (Special of the Day) ─────────────────────────────────────────

/** Where on the site a special may surface. */
export type SpecialDisplayLocation = 'homepage' | 'menu' | 'both';

export interface Special {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  /** Current selling price in AUD. */
  price: number;
  /** Struck-through original price in AUD, for "was $X" display. */
  originalPrice: number | null;
  /** Computed discount percent (derived from price/originalPrice). */
  discountPercent: number | null;
  active: boolean;
  archived: boolean;
  startDate: string | null;
  endDate: string | null;
  /** Local-time window, "HH:MM" 24h. Null = all day. */
  startTime: string | null;
  endTime: string | null;
  /** 0=Sunday … 6=Saturday. Empty = every day. */
  daysOfWeek: number[];
  ctaText: string;
  ctaLink: string;
  category: string;
  dietary: string[];
  ingredients: string[];
  allergens: string[];
  badge: string;
  priority: number;
  displayLocation: SpecialDisplayLocation;
  /** Optional link to a real product (ordering uses the product's modifiers). */
  productId: string | null;
  /** Daily stock cap; null = unlimited. */
  stockQuantity: number | null;
  createdAt: string;
  updatedAt: string;
}

export type SpecialDraft = Omit<Special, 'id' | 'createdAt' | 'updatedAt' | 'discountPercent'>;

// ─── Cart & checkout ───────────────────────────────────────────────────────

export type Fulfilment = 'Pickup' | 'Delivery';

export interface CartModifier {
  id: string;
  name: string;
  price: number;
}

export interface CartItem {
  key: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  modifiers: CartModifier[];
  instructions: string;
}

export interface CartState {
  items: CartItem[];
  fulfilment: Fulfilment;
  couponCode?: string;
}

export interface Charges {
  deliveryFee: number;
  taxRate: number;
  serviceChargeRate: number;
  cardFeeRate: number;
}

export interface ChargeBreakdown {
  subtotal: number;
  discount: number;
  service: number;
  tax: number;
  delivery: number;
  cardFee: number;
  total: number;
}

export interface CheckoutCustomer {
  name: string;
  email: string;
  phone: string;
  address?: string;
  suburb?: string;
  postcode?: string;
  deliveryInstructions?: string;
}

// ─── Coupons ───────────────────────────────────────────────────────────────

export type CouponKind = 'percent' | 'fixed';

export interface Coupon {
  id: string;
  code: string;
  kind: CouponKind;
  /** Percent (0–100) for kind='percent'; AUD amount for kind='fixed'. */
  value: number;
  minimumOrder: number;
  /** Empty array = applies to the whole order. */
  productIds: string[];
  categoryNames: string[];
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  timesUsed: number;
  active: boolean;
}

// ─── Orders ────────────────────────────────────────────────────────────────

export type OrderStatus =
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

export type RefundStatus = '' | 'pending' | 'succeeded' | 'partially_refunded' | 'failed';

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: string[];
  notes: string;
}

export interface Order {
  orderId: string;
  orderNumber: string;
  customer: string;
  email: string;
  phone: string;
  fulfilment: Fulfilment;
  address: string;
  suburb: string;
  postcode: string;
  paymentStatus: PaymentStatus;
  refundStatus: RefundStatus;
  refundId: string;
  refundAmount: number;
  refundedAt: string | null;
  refundReason: string;
  paymentIntentId: string;
  stripeSessionId: string;
  cancelledAt: string | null;
  cancellationReason: string;
  specialInstructions: string;
  subtotal: number;
  discountTotal: number;
  couponCode: string;
  taxTotal: number;
  deliveryFeeTotal: number;
  serviceChargeTotal: number;
  cardFeeTotal: number;
  total: number;
  status: OrderStatus;
  createdAt: string;
  items: OrderItem[];
  itemsCount: number;
  notes: string;
}

export interface OrderStatusHistoryEntry {
  id: string;
  orderId: string;
  previousStatus: OrderStatus | null;
  newStatus: OrderStatus;
  changedBy: string | null;
  reason: string;
  createdAt: string;
}

// ─── Settings ──────────────────────────────────────────────────────────────

export interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

export interface OpeningHours {
  [day: string]: DayHours;
}

/** One-off override for a specific date (holidays). */
export interface SpecialHours {
  date: string;
  open: string;
  close: string;
  closed: boolean;
  note: string;
}

export interface RestaurantSettings {
  id: string;
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  phone: string;
  email: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  googleMaps: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  // Ordering
  ordersEnabled: boolean;
  orderPauseMessage: string;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  minimumOrder: number;
  maximumOrder: number;
  // Pickup / delivery
  pickupTime: number;
  pickupInstructions: string;
  deliveryFee: number;
  deliveryMinimumOrder: number;
  deliveryTime: number;
  // Financial
  taxRate: number;
  serviceChargeRate: number;
  cardFeeRate: number;
  currency: string;
  // Hours
  hours: string;
  openingHours: OpeningHours;
  specialHours: SpecialHours[];
  // Kitchen
  kitchenPrepTime: number;
  orderSoundEnabled: boolean;
  autoPrintEnabled: boolean;
}

// ─── Customers ─────────────────────────────────────────────────────────────

export interface CustomerSummary {
  id: string;
  name: string;
  email: string;
  phone: string;
  orders: number;
  spend: number;
  lastOrder: string;
}

// ─── Printers & print jobs ─────────────────────────────────────────────────

export type PrinterConnection = 'network' | 'system';

export type PrinterStation = 'kitchen' | 'bar' | 'coffee' | 'dessert' | 'pickup' | 'receipt';

export interface PrinterConfig {
  id: string;
  name: string;
  station: PrinterStation;
  connection: PrinterConnection;
  host: string;
  port: number;
  paperWidth: 32 | 48 | 80;
  enabled: boolean;
  autoPrint: boolean;
  copies: number;
  createdAt: string;
  updatedAt: string;
}

export type PrintJobStatus = 'QUEUED' | 'PRINTING' | 'PRINTED' | 'FAILED' | 'RETRYING';

export interface PrintJob {
  id: string;
  orderId: string;
  orderNumber: string;
  printerId: string;
  status: PrintJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string;
  createdAt: string;
  printedAt: string | null;
}

// ─── Audit ─────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  orderId: string | null;
  reason: string;
  details: Record<string, unknown>;
  createdAt: string;
}

// ─── Homepage content (legacy promo — superseded by Specials) ─────────────

export type HomepagePromoType = 'daily' | 'weekly';

export interface HomepageContent {
  enabled: boolean;
  promoType: HomepagePromoType;
  title: string;
  description: string;
  price: number | null;
  imageUrl: string | null;
  buttonText: string;
  buttonLink: string;
  startDate: string | null;
  endDate: string | null;
}
