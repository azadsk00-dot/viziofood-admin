import { supabase, supabaseConfigurationError } from '../lib/supabase';
import type {
  AdminCategory,
  AuditLogEntry,
  Customer,
  DayHours,
  HomepageContent,
  HomepagePromoType,
  ModifierGroup,
  ModifierOption,
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
// featured_order arrives via getProducts only; before the 20260820 migration
// runs the column may not exist, so reads fall back to the base column list.
const productColumnsWithFeatured = productColumns.replace('display_order,', 'display_order,featured_order,');

const product = (row: Row): Product => ({
  id: text(row.id), name: text(row.name), description: text(row.description), price: number(row.price), category: text(row.category), sku: text(row.sku),
  active: Boolean(row.active), available: Boolean(row.available), featured: Boolean(row.featured), popular: Boolean(row.popular), archived: Boolean(row.archived ?? row.archived_at), archivedAt: nullableText(row.archived_at),
  vegetarian: Boolean(row.vegetarian), vegan: Boolean(row.vegan), halal: Boolean(row.halal), glutenFree: Boolean(row.gluten_free), preparationTime: number(row.preparation_time), calories: nullableNumber(row.calories),
  ingredients: strings(row.ingredients), allergens: strings(row.allergens), tags: strings(row.tags), displayOrder: number(row.display_order), featuredOrder: row.featured_order === undefined ? undefined : number(row.featured_order), imageUrl: nullableText(row.image_url), thumbnailUrl: nullableText(row.thumbnail_url),
  gallery: strings(row.gallery).length ? strings(row.gallery) : strings(row.gallery_images), visibility: visibility(row.visibility), internalNotes: text(row.internal_notes), createdBy: nullableText(row.created_by), updatedBy: nullableText(row.updated_by),
});

const defined = <T extends object>(value: T): Partial<T> => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
const toProductRow = (value: Partial<ProductDraft>) => defined({
  name: value.name?.trim(), description: value.description?.trim(), price: value.price, category: value.category?.trim(), sku: value.sku?.trim() || null,
  active: value.active, available: value.available, featured: value.featured, popular: value.popular, archived: value.archived, archived_at: value.archivedAt,
  vegetarian: value.vegetarian, vegan: value.vegan, halal: value.halal, gluten_free: value.glutenFree, preparation_time: value.preparationTime, calories: value.calories,
  ingredients: value.ingredients, allergens: value.allergens, tags: value.tags, display_order: value.displayOrder, featured_order: value.featuredOrder, image_url: value.imageUrl, thumbnail_url: value.thumbnailUrl,
  gallery: value.gallery, gallery_images: value.gallery, visibility: value.visibility, internal_notes: value.internalNotes,
});

export function validateProduct(value: ProductDraft): string | null {
  if (!value.name.trim()) return 'Product name is required.';
  if (!value.category.trim()) return 'Category is required.';
  if (!Number.isFinite(value.price) || value.price < 0) return 'Price must be zero or greater.';
  if (!Number.isInteger(value.preparationTime) || value.preparationTime < 0) return 'Preparation time cannot be negative.';
  return null;
}

export async function getProducts() {
  const primary = await client().from('products').select(productColumnsWithFeatured).order('display_order').order('name');
  const result = primary.error ? await client().from('products').select(productColumns).order('display_order').order('name') : primary;
  if (result.error) fail(result.error);
  return ((result.data ?? []) as unknown as Row[]).map(row => product(row));
}
export async function createProduct(value: ProductDraft) { const message = validateProduct(value); if (message) throw new Error(message); const row = toProductRow(value); // featured_order is owned by the Featured Dishes page; new products enter unfeatured.
  delete row.featured_order; const { data, error } = await client().from('products').insert(row).select(productColumns).single(); if (error) fail(error); return product(data as unknown as Row); }
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

// Site branding assets (logo, homepage promo image) share the existing public
// product-images bucket under a dedicated path so no new bucket policies are
// needed. Public read already covers the whole bucket.
export async function uploadBrandImage(file: File, folder: 'logo' | 'promo') {
  validateImage(file);
  const upload = await compressImage(file);
  const extension = upload.name.split('.').pop() || 'png';
  const path = `branding/${folder}-${crypto.randomUUID()}.${extension}`;
  const { error } = await client().storage.from(PRODUCT_BUCKET).upload(path, upload, { cacheControl: '31536000', upsert: false, contentType: upload.type });
  if (error) fail(error);
  return client().storage.from(PRODUCT_BUCKET).getPublicUrl(path).data.publicUrl;
}

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
  serviceChargeRate: number(row.service_charge),
  cardFeeRate: number(row.card_processing_fee),
  instagram: text(row.instagram),
  facebook: text(row.facebook),
  googleMaps: text(row.google_maps),
  logoUrl: nullableText(row.logo_url),
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

// ── Category queries ──
// Counts are computed from the products table by category text so they stay
// correct even where category_id was never populated, and only count what
// the public menu would show (active, available, unarchived).

export async function getCategories() {
  const { data, error } = await client().from('categories').select('id,name,description,active,display_order').order('display_order').order('name');
  if (error) fail(error);
  const { data: productRows, error: productError } = await client().from('products').select('category,active,available,archived_at');
  if (productError) fail(productError);
  const counts = new Map<string, number>();
  for (const row of (productRows ?? []) as Row[]) {
    if (row.active === false || row.available === false || row.archived_at) continue;
    const key = text(row.category).toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return ((data ?? []) as Row[]).map(row => ({
    id: text(row.id), name: text(row.name), description: text(row.description),
    active: row.active !== false, displayOrder: number(row.display_order),
    count: counts.get(text(row.name).toLowerCase()) ?? 0,
  }));
}

export async function createCategory(name: string, description = '') {
  const { error } = await client().from('categories').insert({ name: name.trim(), description });
  if (error) fail(error);
}

// Renaming a category also relabels its products so the products_sync_category
// trigger never resurrects the old name as a new category.
export async function updateCategory(id: string, value: Partial<AdminCategory>) {
  const c = client();
  const { error } = await c.from('categories').update({
    name: value.name?.trim(), description: value.description, active: value.active, display_order: value.displayOrder,
  }).eq('id', id);
  if (error) fail(error);
  if (value.name) {
    const { data: products, error: syncError } = await c.from('products').select('id').eq('category_id', id).limit(1);
    if (syncError) fail(syncError);
    if (products?.length) {
      const { error: relabelError } = await c.from('products').update({ category: value.name.trim() }).eq('category_id', id);
      if (relabelError) fail(relabelError);
    }
  }
}

export async function deleteCategory(id: string) {
  const { error } = await client().from('categories').delete().eq('id', id);
  if (error) fail(error);
}

// ── Modifier groups + options (product customisation) ──
// A product is assigned modifier GROUPS ("Choose Your Protein", "Extras");
// each group holds the OPTIONS customers pick (Beef, Parmesan…). Tables come
// from the already-applied 20260822/20260823 migrations — no new migration.

const modifierGroup = (r: Row): ModifierGroup => ({ id: text(r.id), name: text(r.name), required: r.required === true, minSelections: number(r.min_selections), maxSelections: number(r.max_selections), active: r.active !== false, displayOrder: number(r.display_order) });
const modifierOption = (r: Row): ModifierOption => ({ id: text(r.id), groupId: text(r.group_id), name: text(r.name), description: text(r.description), price: number(r.price), active: r.active !== false, displayOrder: number(r.display_order) });

export async function getModifierGroups() {
  const { data, error } = await client().from('modifier_groups').select('id,name,required,min_selections,max_selections,active,display_order').order('display_order').order('name');
  if (error) fail(error);
  return ((data ?? []) as Row[]).map(modifierGroup);
}
export async function createModifierGroup(value: Omit<ModifierGroup, 'id'>) {
  const { error } = await client().from('modifier_groups').insert({ name: value.name.trim(), required: value.required, min_selections: value.minSelections, max_selections: value.maxSelections, active: value.active, display_order: value.displayOrder });
  if (error) fail(error);
}
export async function updateModifierGroup(id: string, value: Partial<ModifierGroup>) {
  const { error } = await client().from('modifier_groups').update({ name: value.name?.trim(), required: value.required, min_selections: value.minSelections, max_selections: value.maxSelections, active: value.active, display_order: value.displayOrder }).eq('id', id);
  if (error) fail(error);
}
export async function deleteModifierGroup(id: string) {
  const { error } = await client().from('modifier_groups').delete().eq('id', id);
  if (error) fail(error);
}
export async function getModifierOptions() {
  const { data, error } = await client().from('modifiers').select('id,group_id,name,description,price,active,display_order').order('display_order').order('name');
  if (error) fail(error);
  return ((data ?? []) as Row[]).map(modifierOption);
}
export async function createModifier(value: Omit<ModifierOption, 'id'>) {
  const { error } = await client().from('modifiers').insert({ group_id: value.groupId, name: value.name.trim(), description: value.description, price: value.price, active: value.active, display_order: value.displayOrder });
  if (error) fail(error);
}
export async function updateModifier(id: string, value: Partial<ModifierOption>) {
  const { error } = await client().from('modifiers').update({ group_id: value.groupId, name: value.name?.trim(), description: value.description, price: value.price, active: value.active, display_order: value.displayOrder }).eq('id', id);
  if (error) fail(error);
}
export async function deleteModifier(id: string) {
  const { error } = await client().from('modifiers').delete().eq('id', id);
  if (error) fail(error);
}

export async function getProductModifierGroups(productId: string) {
  const { data, error } = await client().from('product_modifier_groups').select('display_order,modifier_groups(id,name,required,active)').eq('product_id', productId).order('display_order');
  if (error) fail(error);
  return ((data ?? []) as Row[]).map(r => {
    const g = (r.modifier_groups ?? {}) as unknown as Row;
    return { id: text(g.id), name: text(g.name), required: g.required === true, active: g.active !== false, displayOrder: number(r.display_order) };
  });
}

// Full replace: the product's assigned groups become exactly `groupIds`, in
// order. Nothing is assigned implicitly — an empty list means no modifiers.
export async function setProductModifierGroups(productId: string, groupIds: string[]) {
  const c = client();
  const { error: removeError } = await c.from('product_modifier_groups').delete().eq('product_id', productId);
  if (removeError) fail(removeError);
  if (groupIds.length) {
    const rows = groupIds.map((groupId, index) => ({ product_id: productId, group_id: groupId, display_order: index + 1 }));
    const { error } = await c.from('product_modifier_groups').insert(rows);
    if (error) fail(error);
  }
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

const SETTINGS_SELECT = 'id,name,address,suburb,state,postcode,phone,email,hours,opening_hours,delivery_fee,tax_rate,service_charge,card_processing_fee,instagram,facebook,google_maps,logo_url,orders_enabled,order_pause_message';
// Pre-migration fallback: service_charge / card_processing_fee / logo_url may
// not exist as columns yet. Both lists stay in sync with the 20260821 migration.
const SETTINGS_SELECT_LEGACY = SETTINGS_SELECT.replace('service_charge,card_processing_fee,', '').replace('logo_url,', '');

// The table is expected to hold a single row. While duplicates exist, every
// read and write must resolve to the same one: the oldest row (created_at,
// then id as a stable tiebreak) — the row a bare LIMIT 1 already returns and
// the public site displays. Keep this ordering identical everywhere.

export async function getSettings() {
  const read = (columns: string) => client().from('restaurant_settings').select(columns).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle();
  const primary = await read(SETTINGS_SELECT);
  const result = primary.error ? await read(SETTINGS_SELECT_LEGACY) : primary;
  if (result.error) fail(result.error);
  return result.data ? settings(result.data as unknown as Row) : null;
}

// Columns added by the 20260821 migration. Splitting them out lets the save
// fall back to the legacy column set when the migration hasn't been applied,
// so settings/branding saves keep working instead of failing wholesale.
const NEW_SETTING_COLUMNS = ['logo_url', 'service_charge', 'card_processing_fee'] as const;

const isMissingColumn = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === '42703' || error?.code === 'PGRST204';

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
    service_charge: value.serviceChargeRate,
    card_processing_fee: value.cardFeeRate,
    instagram: value.instagram,
    facebook: value.facebook,
    google_maps: value.googleMaps,
    logo_url: value.logoUrl,
    orders_enabled: value.ordersEnabled,
    order_pause_message: value.orderPauseMessage,
  });

  // Pre-migration: the new columns may not exist. Retry without them and, if
  // any were actually part of this save, report clearly (after persisting the
  // rest) instead of silently dropping them.
  let rowToSend = row;
  const attempt = async (payload: Row) => {
    // Update the existing settings row by id; insert only when the table is
    // empty. A blind upsert would insert a duplicate row on every save (the
    // id is random), and a bare update reports success even when RLS filters
    // it to zero rows — .select().single() surfaces both as errors.
    const { data: existing, error: lookupError } = await client().from('restaurant_settings').select('id').order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle();
    if (lookupError) fail(lookupError);
    const existingId = existing ? text((existing as Row).id) : null;

    if (existingId) {
      const { data: updated, error: updateError } = await client()
        .from('restaurant_settings')
        .update(payload)
        .eq('id', existingId)
        .select('id')
        .single();
      if (updateError) return { error: updateError };
      if (!updated) return { error: new Error('Settings were not saved — no settings row was updated.') as Error & { code?: string } };
      return { error: null };
    }
    const { data: inserted, error: insertError } = await client()
      .from('restaurant_settings')
      .insert(payload)
      .select('id')
      .single();
    if (insertError) return { error: insertError };
    if (!inserted) return { error: new Error('Settings could not be created.') as Error & { code?: string } };
    return { error: null };
  };

  let outcome = await attempt(rowToSend);
  let skippedNewColumns: string[] = [];
  if (isMissingColumn(outcome.error)) {
    skippedNewColumns = NEW_SETTING_COLUMNS.filter(column => column in rowToSend);
    rowToSend = Object.fromEntries(Object.entries(rowToSend).filter(([key]) => !(NEW_SETTING_COLUMNS as readonly string[]).includes(key)));
    // A logo/charges-only save has nothing left to persist pre-migration —
    // skip the empty update and let the migration message below explain.
    outcome = Object.keys(rowToSend).length
      ? await attempt(rowToSend)
      : { error: null };
  }
  if (outcome.error) fail(outcome.error.code === 'PGRST116'
    ? new Error('Settings were not saved — no settings row was updated. Your account may not have admin permissions.')
    : outcome.error);
  if (skippedNewColumns.length) {
    throw new Error('Saved, but the database is missing new columns (' + skippedNewColumns.join(', ') + '). Run the 20260821 Supabase migration to enable logo and charge settings.');
  }
  const saved = rowToSend;

  // Audit — a failed audit write must not misreport the save outcome.
  const { data: { session } } = await client().auth.getSession();
  const changedOrdersToggle = 'orders_enabled' in saved;
  const { error: auditError } = await client().from('admin_audit_log').insert({
    user_id: session?.user?.id ?? null,
    action: changedOrdersToggle
      ? (value.ordersEnabled ? 'orders_resumed' : 'orders_paused')
      : 'settings_changed',
    details: Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)),
  });
  if (auditError) console.error('Audit log insert failed', auditError);
}

// ── Homepage content queries ──

const HOMEPAGE_SELECT = 'id,enabled,promo_type,title,description,price,image_url,button_text,button_link,start_date,end_date';

const homepageContent = (row: Row): HomepageContent => ({
  enabled: bool(row.enabled),
  promoType: row.promo_type === 'weekly' ? 'weekly' : 'daily',
  title: text(row.title),
  description: text(row.description),
  price: nullableNumber(row.price),
  imageUrl: nullableText(row.image_url),
  buttonText: text(row.button_text),
  buttonLink: text(row.button_link),
  startDate: nullableText(row.start_date),
  endDate: nullableText(row.end_date),
});

const emptyHomepageContent = (): HomepageContent => ({
  enabled: false, promoType: 'daily', title: '', description: '', price: null,
  imageUrl: null, buttonText: '', buttonLink: '', startDate: null, endDate: null,
});

// Staff reads bypass the enabled-only public policy, so the admin form can
// load a disabled row too.
export async function getHomepageContent() {
  const { data, error } = await client().from('homepage_content').select(HOMEPAGE_SELECT).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle();
  if (error) fail(error);
  return data ? homepageContent(data as Row) : emptyHomepageContent();
}

export async function saveHomepageContent(value: HomepageContent) {
  if (value.enabled && !value.title.trim()) throw new Error('Add a title before enabling the homepage special.');

  const row = {
    enabled: value.enabled,
    promo_type: value.promoType,
    title: value.title.trim(),
    description: value.description.trim(),
    price: value.price,
    image_url: value.imageUrl,
    button_text: value.buttonText.trim(),
    button_link: value.buttonLink.trim(),
    start_date: value.startDate || null,
    end_date: value.endDate || null,
  };

  // Same single-row discipline as restaurant_settings: update the oldest row,
  // insert only when the table is empty. See saveSettings for why a blind
  // upsert is unsafe here.
  const { data: existing, error: lookupError } = await client().from('homepage_content').select('id').order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle();
  if (lookupError) fail(lookupError);
  const existingId = existing ? text((existing as Row).id) : null;

  if (existingId) {
    const { error: updateError } = await client().from('homepage_content').update(row).eq('id', existingId).select('id').single();
    if (updateError) fail(updateError);
  } else {
    const { error: insertError } = await client().from('homepage_content').insert(row).select('id').single();
    if (insertError) fail(insertError);
  }

  const { data: { session } } = await client().auth.getSession();
  const { error: auditError } = await client().from('admin_audit_log').insert({
    user_id: session?.user?.id ?? null,
    action: 'homepage_content_changed',
    details: { enabled: row.enabled, title: row.title, promo_type: row.promo_type },
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
