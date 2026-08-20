export type ProductVisibility = 'public' | 'hidden' | 'private';

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
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
  /** Homepage showcase order — present once the 20260820 migration has run. */
  featuredOrder?: number;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  gallery: string[];
  visibility: ProductVisibility;
  internalNotes: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export type ProductDraft = Omit<Product, 'id' | 'createdBy' | 'updatedBy'>;
export type OrderStatus = 'New' | 'Accepted' | 'Preparing' | 'Ready' | 'Completed' | 'Rejected' | 'Cancelled';
export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'refunded' | 'partially_refunded' | 'unknown';
export type RefundStatus = '' | 'pending' | 'succeeded' | 'partially_refunded' | 'failed';

export interface OrderItem { id: string; name: string; quantity: number; unitPrice: number; modifiers: string[]; notes: string }

export interface Order {
  orderId: string;
  orderNumber: string;
  customer: string;
  email: string;
  phone: string;
  fulfilment: 'Pickup' | 'Delivery';
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
  taxTotal: number;
  total: number;
  status: OrderStatus;
  createdAt: string;
  items: OrderItem[];
  itemsCount: number;
  notes: string;
}

export interface Customer { id: string; name: string; email: string; orders: number; spend: number; lastOrder: string }

export interface AdminCategory { id: string; name: string; description: string; active: boolean; displayOrder: number; count: number }

export interface ModifierGroup { id: string; name: string; required: boolean; minSelections: number; maxSelections: number; active: boolean; displayOrder: number }
export interface ModifierOption { id: string; groupId: string; name: string; description: string; price: number; active: boolean; displayOrder: number }

export interface DayHours { open: string; close: string; closed: boolean }
export interface OpeningHours { [key: string]: DayHours }

export interface RestaurantSettings {
  id: string;
  name: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  phone: string;
  email: string;
  hours: string;
  openingHours: OpeningHours;
  deliveryFee: number;
  taxRate: number;
  serviceChargeRate: number;
  cardFeeRate: number;
  instagram: string;
  facebook: string;
  googleMaps: string;
  logoUrl: string | null;
  ordersEnabled: boolean;
  orderPauseMessage: string;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
}

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

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  details: Record<string, unknown>;
  orderId: string | null;
  reason: string;
  createdAt: string;
}
