// Admin domain types — mirrors the web admin model (src/types/index.ts and
// src/admin/types.ts). Database stays the single source of truth.

import type { OrderStatus, PaymentStatus } from './types';

export type Visibility = 'public' | 'hidden' | 'private';

export interface AdminProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
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
  /** undefined = featured_order column not present (pre-migration fallback). */
  featuredOrder: number | undefined;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  gallery: string[];
  visibility: Visibility;
  internalNotes: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminCategory {
  id: string;
  name: string;
  description: string;
  active: boolean;
  displayOrder: number;
  count: number; // client-computed count of live products
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

export type SpecialDisplayLocation = 'homepage' | 'menu' | 'both';

export interface AdminSpecial {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  price: number;
  originalPrice: number | null;
  active: boolean;
  archived: boolean;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  startTime: string | null; // HH:MM
  endTime: string | null;
  daysOfWeek: number[]; // 0=Sun..6=Sat, [] = every day
  ctaText: string;
  ctaLink: string;
  category: string;
  dietary: string[];
  ingredients: string[];
  allergens: string[];
  badge: string;
  priority: number;
  displayLocation: SpecialDisplayLocation;
  productId: string | null;
  stockQuantity: number | null;
  createdAt: string;
  updatedAt: string;
}

export type CouponKind = 'percent' | 'fixed';

export interface AdminCoupon {
  id: string;
  code: string;
  kind: CouponKind;
  value: number;
  minimumOrder: number;
  productIds: string[];
  categoryNames: string[];
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  timesUsed: number;
  active: boolean;
}

export interface CustomerSummary {
  id: string; // email/phone key
  name: string;
  email: string;
  phone: string;
  orders: number;
  spend: number;
  lastOrder: string;
}

/** Extended order for the admin Orders screen (web src/services/orders.ts). */
export interface AdminOrderItemLine {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: string[];
  notes: string;
}

export interface AdminOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  paymentStatus: PaymentStatus;
  total: number;
  status: OrderStatus;
  createdAt: string;
  itemsCount: number;
  specialInstructions: string;
  taxTotal: number;
  stripeSessionId: string;
  paymentIntentId: string;
  refundStatus: string;
  refundId: string;
  refundAmount: number;
  refundedAt: string | null;
  refundReason: string;
  cancelledAt: string | null;
  cancellationReason: string;
  fulfilment: 'Pickup' | 'Delivery';
  address: string;
  suburb: string;
  postcode: string;
  deliveryInstructions: string;
  subtotal: number;
  discountTotal: number;
  couponCode: string;
  deliveryFee: number;
  serviceCharge: number;
  cardProcessingFee: number;
  items: AdminOrderItemLine[];
}

export interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

export type OpeningHours = Record<string, DayHours>;

export interface RestaurantSettings {
  id: string;
  name: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  phone: string;
  email: string;
  openingHours: OpeningHours;
  deliveryFee: number;
  taxRate: number;
  serviceChargeRate: number;
  cardFeeRate: number;
  instagram: string;
  facebook: string;
  googleMaps: string;
  logoUrl: string | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  ordersEnabled: boolean;
  orderPauseMessage: string;
  minimumOrder: number;
  deliveryMinimumOrder: number;
  pickupTime: number;
  deliveryTime: number;
  pickupInstructions: string;
  orderSoundEnabled: boolean;
  autoPrintEnabled: boolean;
}

export interface HomepageContent {
  id: string;
  enabled: boolean;
  promoType: 'daily' | 'weekly';
  title: string;
  description: string;
  price: number | null;
  imageUrl: string | null;
  buttonText: string;
  buttonLink: string;
  startDate: string | null;
  endDate: string | null;
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  details: Record<string, unknown>;
  orderId: string | null;
  reason: string;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'staff' | 'kitchen' | 'customer' | string;
  createdAt: string;
}

export interface AdminPrinter {
  id: string;
  name: string;
  station: string;
  connection: string;
  host: string;
  port: number;
  paperWidth: number;
  enabled: boolean;
  autoPrint: boolean;
  copies: number;
}

export interface NotificationLogEntry {
  id: string;
  orderId: string;
  orderNumber: string;
  deviceId: string;
  source: string;
  notifiedAt: string;
  openedAt: string | null;
  acknowledgedAt: string | null;
}
