import { supabase, supabaseConfigurationError } from '../lib/supabase';
import type {
  AuditLogEntry,
  Customer,
  DayHours,
  OpeningHours,
  Order,
  OrderItem,
  OrderStatus,
  PaymentStatus,
  Product,
  ProductDraft,
  ProductVisibility,
  RefundStatus,
  RestaurantSettings,
} from './types';

type Row = Record<string, unknown>;
const PRODUCT_BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const client = () => { if (!supabase) throw new Error(supabaseConfigurationError); return supabase; };
const fail = (error: unknown): never => { console.error(error); throw error; };
const text = (value: unknown) => typeof value === 'string' ? value : '';
const nullableText = (value: unknown) => typeof value === 'string' ? value : null;
const number = (value: unknown) => Number(value ?? 0);
const nullableNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const visibility = (value: unknown): ProductVisibility => value === 'hidden' || value === 'private' ? value : 'public';
const bool = (value: unknown) => value === true;

export const productColumns = 'id,name,description,price,category,active,available,featured,popular,archived,archived_at,vegetarian,vegan,halal,gluten_free,preparation_time,calories,ingredients,allergens,tags,display_order,sku,internal_notes,image_url,thumbnail_url,gallery,gallery_images,visibility,created_by,updated_by';

const product = (row: Row): Product => ({
  id: text(row.id), name: text(row.name), description: text(row.description), price: number(row.price), category: text(row.category), sku: text(row.sku),
  active: Boolean(row.active), available: Boolean(row.available), featured: Boolean(row.featured), popular: Boolean(row.popular), archived: Boolean(row.archived ?? row.archived_at), archivedAt: nullableText(row.archived_at),
  vegetarian: Boolean(row.vegetarian), vegan: Boolean(row.vegan), halal: Boolean(row.halal), glutenFree: Boolean(row.gluten_free), preparationTime: number(row.preparation_time), calories: nullableNumber(row.calories),
  ingredients: strings(row.ingredients), allergens: strings(row.allergens), tags: strings(row.tags), displayOrder: number(row.display_order), imageUrl: nullableText(row.image_url), thumbnailUrl: nullableText(row.thumbnail_url),
  gallery: strings(row.gallery).length ? strings(row.gallery) : strings(row.gallery_images), visibility: visibility(row.visibility), internalNotes: text(row.internal_notes), createdBy: nullableText(row.created_by), updatedBy: nullableText(row.updated_by),
});

const defined = <T extends object>(value: T): Partial<T> => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
const toProductRow = (value: Partial<ProductDraft>) => defined({
  name: value.name?.trim(), description: value.description?.trim(), price: value.price, category: value.category?.trim(), sku: value.sku?.trim() || null,
  active: value.active, available: value.available, featured: value.featured, popular: value.popular, archived: value.archived, archived_at: value.archivedAt,
  vegetarian: value.vegetarian, vegan: value.vegan, halal: value.halal, gluten_free: value.glutenFree, preparation_time: value.preparationTime, calories: value.calories,
  ingredients: value.ingredients, allergens: value.allergens, tags: value.tags, display_order: value.displayOrder, image_url: value.imageUrl, thumbnail_url: value.thumbnailUrl,
  gallery: value.gallery, gallery_images: value.gallery, visibility: value.visibility, internal_notes: value.internalNotes,
});

export function validateProduct(value: ProductDraft): string | null {
  if (!value.name.trim()) return 'Product name is required.';
  if (!value.category.trim()) return 'Category is required.';
  if (!Number.isFinite(value.price) || value.price < 0) return 'Price must be zero or greater.';
  if (!Number.isInteger(value.preparationTime) || value.preparationTime < 0) return 'Preparation time cannot be negative.';
  return null;
}

export async function getProducts() { const { data, error } = await client().from('products').select(productColumns).order('display_order').order('name'); if (error) fail(error); return (data ?? []).map(row => product(row as Row)); }
export async function createProduct(value: ProductDraft) { const message = validateProduct(value); if (message) throw new Error(message); const { data, error } = await client().from('products').insert(toProductRow(value)).select(productColumns).single(); if (error) fail(error); return product(data as Row); }
export async function updateProduct(id: string, value: Partial<ProductDraft>) { const { data, error } = await client().from('products').update(toProductRow(value)).eq('id', id).select(productColumns).single(); if (error) fail(error); return product(data as Row); }
export async function deleteProduct(id: string) { const { error } = await client().from('products').delete().eq('id', id); if (error) fail(error); }
export async function archiveProducts(ids: string[], archived = true) { const { error } = await client().from('products').update({ archived, archived_at: archived ? new Date().toISOString() : null }).in('id', ids); if (error) fail(error); }
export async function updateProducts(ids: string[], changes: Partial<ProductDraft>) { const { error } = await client().from('products').update(toProductRow(changes)).in('id', ids); if (error) fail(error); }

export function validateImage(file: File) { if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPEG, PNG, WebP, or GIF).'); if (file.size > MAX_IMAGE_BYTES) throw new Error('Images must be smaller than 8 MB.'); }
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 500 * 1024 || !('createImageBitmap' in window)) return file;
  try {
    const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d'); if (!context) return file; context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.84));
    return blob ? new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' }) : file;
  } catch { return file; }
}
export async function uploadProductImage(file: File, onProgress?: (progress: number) => void) {
  validateImage(file); onProgress?.(5); const upload = await compressImage(file); onProgress?.(25);
  const extension = upload.name.split('.').pop() || 'jpg'; const path = `products/${crypto.randomUUID()}.${extension}`;
  const { error } = await client().storage.from(PRODUCT_BUCKET).upload(path, upload, { cacheControl: '31536000', upsert: false, contentType: upload.type }); if (error) fail(error);
  onProgress?.(100); return client().storage.from(PRODUCT_BUCKET).getPublicUrl(path).data.publicUrl;
}
export async function deleteProductImage(url: string) { const marker = `/storage/v1/object/public/${PRODUCT_BUCKET}/`; const path = url.includes(marker) ? decodeURIComponent(url.split(marker)[1] ?? '') : ''; if (!path) return; const { error } = await client().storage.from(PRODUCT_BUCKET).remove([path]); if (error) fail(error); }

// ── Order mappers ──

const orderStatus = (value: unknown): OrderStatus => {
  const status = text(value);
  return status === 'Cancelled' || status === 'Rejected' || status === 'Accepted' || status === 'Preparing' || status === 'Ready' || status === 'Completed' ? status : 'New';
};
const paymentStatus = (value: unknown): PaymentStatus => {
  const status = text(value).toLowerCase();
  return status === 'paid' || status === 'pending' || status === 'failed' || status === 'refunded' || status === 'partially_refunded' ? status : 'unknown';
};
const refundStatus = (value: unknown): RefundStatus => {
  const status = text(value).toLowerCase();
  return status === 'pending' || status === 'succeeded' || status === 'partially_refunded' || status === 'failed' ? status : '';
};
const modifiers = (value: unknown): string[] => Array.isArray(value) ? value.map(item => typeof item === 'object' && item !== null && 'name' in item ? text(item.name) : text(item)).filter(Boolean) : [];
const orderItem = (row: Row): OrderItem => ({ id: text(row.id), name: text(row.product_name), quantity: number(row.quantity), unitPrice: number(row.unit_price), modifiers: modifiers(row.modifiers), notes: text(row.special_instructions) });

const ORDER_SELECT = 'id,order_number,customer_name,customer_email,customer_phone,payment_status,total,status,created_at,items_count,special_instructions,tax_total,stripe_session_id,payment_intent_id,refund_status,refund_id,refund_amount,refunded_at,refund_reason,cancelled_at,cancellation_reason';

const order = (row: Row): Order => ({
  orderId: text(row.id),
  orderNumber: text(row.order_number) || text(row.id),
  customer: text(row.customer_name),
  email: text(row.customer_email),
  phone: text(row.customer_phone),
  fulfilment: 'Pickup',
  paymentStatus: paymentStatus(row.payment_status),
  refundStatus: refundStatus(row.refund_status),
  refundId: text(row.refund_id),
  refundAmount: number(row.refund_amount),
  refundedAt: nullableText(row.refunded_at),
  refundReason: text(row.refund_reason),
  paymentIntentId: text(row.payment_intent_id || row.stripe_payment_intent),
  stripeSessionId: text(row.stripe_session_id),
  cancelledAt: nullableText(row.cancelled_at),
  cancellationReason: text(row.cancellation_reason),
  specialInstructions: text(row.special_instructions),
  taxTotal: number(row.tax_total),
  total: number(row.total),
  status: orderStatus(row.status),
  createdAt: text(row.created_at),
  items: [],
  itemsCount: number(row.items_count),
  notes: text(row.special_instructions),
});

const customer = (row: Row): Customer => ({ id: text(row.id), name: text(row.name), email: text(row.email), orders: number(row.orders_count), spend: number(row.total_spend), lastOrder: text(row.last_order_at) });

// ── Settings mapper ──

function parseOpeningHours(raw: unknown): OpeningHours {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as OpeningHours;
  return {};
}

function formatHoursForDisplay(hours: OpeningHours): string {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const labels: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const parts: string[] = [];
  for (const day of days) {
    const h = hours[day];
    if (!h) continue;
    if (h.closed) {
      parts.push(`${labels[day]}: Closed`);
    } else {
      parts.push(`${labels[day]}: ${h.open} - ${h.close}`);
    }
  }
  return parts.join('\n');
}

const settings = (row: Row): RestaurantSettings => ({
  id: text(row.id),
  name: text(row.name),
  address: text(row.address),
  suburb: text(row.suburb),
  state: text(row.state),
  postcode: text(row.postcode),
  phone: text(row.phone),
  email: text(row.email),
  hours: formatHoursForDisplay(parseOpeningHours(row.opening_hours)),
  openingHours: parseOpeningHours(row.opening_hours),
  deliveryFee: number(row.delivery_fee),
  taxRate: number(row.tax_rate),
  instagram: text(row.instagram),
  facebook: text(row.facebook),
  googleMaps: text(row.google_maps),
  ordersEnabled: bool(row.orders_enabled),
  orderPauseMessage: text(row.order_pause_message),
});

// ── Order queries ──

export async function getOrders(limit?: number) {
  let query = client().from('orders').select(ORDER_SELECT).order('created_at', { ascending: false });
  if (limit) query = query.limit(limit);
  const { data: orderRows, error: orderError } = await query;
  if (orderError) fail(orderError);
  const rows = (orderRows ?? []) as Row[];
  const ids = rows.map(row => text(row.id)).filter(Boolean);
  if (!ids.length) return [];
  const { data: itemRows, error: itemError } = await client().from('order_items').select('id,order_id,product_name,unit_price,quantity,modifiers,special_instructions').in('order_id', ids).order('created_at');
  if (itemError) fail(itemError);
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const row of (itemRows ?? []) as Row[]) {
    const orderId = text(row.order_id);
    itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) ?? []), orderItem(row)]);
  }
  return rows.map(row => { const value = order(row); return { ...value, items: itemsByOrder.get(value.orderId) ?? [] }; });
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  if (!uuid.test(orderId)) throw new Error(`Order update blocked: expected a UUID, received "${orderId}".`);
  const { data, error } = await client().from('orders').update({ status }).eq('id', orderId).select('id,status').single();
  if (error) { console.error('Unable to update order status', { orderId, status, error }); throw new Error(`Unable to update order status: ${error.message}${error.code ? ` (${error.code})` : ''}`); }
  return { orderId: text((data as Row).id), status: orderStatus((data as Row).status) };
}

// ── Cancel order ──

export async function cancelOrder(orderId: string, reason: string) {
  if (!uuid.test(orderId)) throw new Error('Invalid order ID.');
  const { data: order, error: fetchError } = await client().from('orders')
    .select('id,status')
    .eq('id', orderId).single();
  if (fetchError || !order) throw new Error('Order not found.');

  const currentStatus = orderStatus(order.status);
  if (currentStatus === 'Cancelled' || currentStatus === 'Rejected') {
    throw new Error('This order has already been cancelled.');
  }

  const { data: { session } } = await client().auth.getSession();
  const userId = session?.user?.id ?? null;

  const { data, error } = await client().from('orders')
    .update({
      status: 'Cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: userId,
      cancellation_reason: reason,
    })
    .eq('id', orderId)
    .select('id,status,cancelled_at')
    .single();
  if (error) throw new Error(`Unable to cancel order: ${error.message}`);

  // Audit log
  await client().from('admin_audit_log').insert({
    user_id: userId,
    action: 'order_cancelled',
    details: { order_id: orderId, previous_status: currentStatus },
    order_id: orderId,
    reason,
  });

  return { orderId: text((data as Row).id), status: orderStatus((data as Row).status) };
}

// ── Refund via Edge Function ──

export async function processRefund(orderId: string, amount?: number, reason?: string) {
  if (!uuid.test(orderId)) throw new Error('Invalid order ID.');

  const { data: { session } } = await supabase!.auth.getSession();
  if (!session?.access_token) throw new Error('Authentication required for refund.');

  const endpoint = import.meta.env.VITE_REFUND_ENDPOINT;
  if (!endpoint) throw new Error('Refund endpoint is not configured. Set VITE_REFUND_ENDPOINT.');

  const body: Record<string, unknown> = { orderId };
  if (amount != null) body.amount = amount;
  if (reason) body.reason = reason;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json() as { ok?: boolean; error?: string; refund_id?: string; refund_amount?: number; refund_status?: string; order_refund_status?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Refund could not be completed.');
  }

  return payload;
}

// ── Category / Customer queries ──

export async function getCategories() {
  const { data, error } = await client().from('categories').select('id,name').order('name');
  if (error) fail(error);
  return (data ?? []).map(row => ({ id: text(row.id), name: text(row.name), count: 0 }));
}

export async function getCustomers() {
  const { data, error } = await client().from('orders').select('customer_name,customer_email,customer_phone,total,created_at').order('created_at', { ascending: false });
  if (error) fail(error);
  const rows = (data ?? []) as Row[];
  const map = new Map<string, { email: string; name: string; phone: string; orders: number; spend: number; lastOrder: string }>();
  for (const row of rows) {
    const email = (text(row.customer_email) || text(row.customer_phone) || '').trim().toLowerCase() || '_';
    const entry = map.get(email);
    const name = text(row.customer_name) || 'Unknown';
    const phone = text(row.customer_phone);
    const total = number(row.total);
    const createdAt = text(row.created_at);
    if (entry) {
      entry.orders++; entry.spend += total;
      if (createdAt > entry.lastOrder) entry.lastOrder = createdAt;
      if (!entry.name || entry.name === 'Unknown') entry.name = name;
      if (!entry.phone) entry.phone = phone;
    } else {
      map.set(email, { email: text(row.customer_email) || '', name, phone, orders: 1, spend: total, lastOrder: createdAt });
    }
  }
  return Array.from(map.entries()).map(([email, c]) => ({ id: email, name: c.name, email: c.email || email, orders: c.orders, spend: c.spend, lastOrder: c.lastOrder })).sort((a, b) => b.lastOrder.localeCompare(a.lastOrder));
}

// ── Settings queries ──

const SETTINGS_SELECT = 'id,name,address,suburb,state,postcode,phone,email,hours,opening_hours,delivery_fee,tax_rate,instagram,facebook,google_maps,orders_enabled,order_pause_message';

// The table is expected to hold a single row. While duplicates exist, every
// read and write must resolve to the same one: the oldest row (created_at,
// then id as a stable tiebreak) — the row a bare LIMIT 1 already returns and
// the public site displays. Keep this ordering identical everywhere.

export async function getSettings() {
  const { data, error } = await client().from('restaurant_settings').select(SETTINGS_SELECT).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle();
  if (error) fail(error);
  return data ? settings(data as Row) : null;
}

export async function saveSettings(value: Partial<RestaurantSettings>) {
  const row = defined({
    name: value.name,
    address: value.address,
    suburb: value.suburb,
    state: value.state,
    postcode: value.postcode,
    phone: value.phone,
    email: value.email,
    hours: value.hours,
    opening_hours: value.openingHours,
    delivery_fee: value.deliveryFee,
    tax_rate: value.taxRate,
    instagram: value.instagram,
    facebook: value.facebook,
    google_maps: value.googleMaps,
    orders_enabled: value.ordersEnabled,
    order_pause_message: value.orderPauseMessage,
  });

  // Update the existing settings row by id; insert only when the table is
  // empty. A blind upsert would insert a duplicate row on every save (the id
  // is random), and a bare update reports success even when RLS filters it
  // to zero rows — .select().single() surfaces both as errors.
  const { data: existing, error: lookupError } = await client().from('restaurant_settings').select('id').order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle();
  if (lookupError) fail(lookupError);
  const existingId = existing ? text((existing as Row).id) : null;

  if (existingId) {
    const { data: updated, error: updateError } = await client()
      .from('restaurant_settings')
      .update(row)
      .eq('id', existingId)
      .select('id')
      .single();
    if (updateError) fail(updateError.code === 'PGRST116'
      ? new Error('Settings were not saved — no settings row was updated. Your account may not have admin permissions.')
      : updateError);
    if (!updated) fail(new Error('Settings were not saved — no settings row was updated.'));
  } else {
    const { data: inserted, error: insertError } = await client()
      .from('restaurant_settings')
      .insert(row)
      .select('id')
      .single();
    if (insertError) fail(insertError);
    if (!inserted) fail(new Error('Settings could not be created.'));
  }

  // Audit — a failed audit write must not misreport the save outcome.
  const { data: { session } } = await client().auth.getSession();
  const changedOrdersToggle = 'orders_enabled' in row;
  const { error: auditError } = await client().from('admin_audit_log').insert({
    user_id: session?.user?.id ?? null,
    action: changedOrdersToggle
      ? (value.ordersEnabled ? 'orders_resumed' : 'orders_paused')
      : 'settings_changed',
    details: Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)),
  });
  if (auditError) console.error('Audit log insert failed', auditError);
}

// ── Audit log ──

export async function getAuditLog(limit = 50) {
  const { data, error } = await client()
    .from('admin_audit_log')
    .select('id,user_id,action,details,order_id,reason,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail(error);
  return (data ?? []).map((row: Row): AuditLogEntry => ({
    id: text(row.id),
    userId: text(row.user_id),
    action: text(row.action),
    details: (row.details ?? {}) as Record<string, unknown>,
    orderId: nullableText(row.order_id),
    reason: text(row.reason),
    createdAt: text(row.created_at),
  }));
}
