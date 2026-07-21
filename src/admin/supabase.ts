import { supabase, supabaseConfigurationError } from '../lib/supabase';
import type { Customer, Order, OrderItem, OrderStatus, PaymentStatus, Product, ProductDraft, ProductVisibility, RestaurantSettings } from './types';

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

const orderStatus = (value: unknown): OrderStatus => {
  const status = text(value);
  return status === 'Cancelled' ? 'Rejected' : status === 'Accepted' || status === 'Preparing' || status === 'Ready' || status === 'Completed' || status === 'Rejected' ? status : 'New';
};
const paymentStatus = (value: unknown): PaymentStatus => {
  const status = text(value).toLowerCase();
  return status === 'paid' || status === 'pending' || status === 'failed' || status === 'refunded' ? status : 'unknown';
};
const modifiers = (value: unknown): string[] => Array.isArray(value) ? value.map(item => typeof item === 'object' && item !== null && 'name' in item ? text(item.name) : text(item)).filter(Boolean) : [];
const orderItem = (row: Row): OrderItem => ({ id:text(row.id), name:text(row.product_name), quantity:number(row.quantity), unitPrice:number(row.unit_price), modifiers:modifiers(row.modifiers), notes:text(row.special_instructions) });
const order = (row:Row):Order => ({ id:text(row.id), orderNumber:text(row.order_number) || text(row.id), customer:text(row.customer_name), email:text(row.customer_email), phone:text(row.customer_phone), fulfilment:text(row.fulfilment_method).toLowerCase() === 'delivery' ? 'Delivery' : 'Pickup', paymentStatus:paymentStatus(row.payment_status), total:number(row.total), status:orderStatus(row.status), createdAt:text(row.created_at), items:[], itemsCount:number(row.items_count), notes:text(row.special_instructions) });
const customer = (row:Row):Customer => ({ id:text(row.id), name:text(row.name), email:text(row.email), orders:number(row.orders_count), spend:number(row.total_spend), lastOrder:text(row.last_order_at) });
const settings = (row:Row):RestaurantSettings => ({ name:text(row.name), address:text(row.address), phone:text(row.phone), email:text(row.email), hours:text(row.hours), deliveryFee:number(row.delivery_fee), taxRate:number(row.tax_rate), instagram:text(row.instagram) });
export async function getOrders(limit?:number) {
  let query=client().from('orders').select('id,order_number,customer_name,customer_email,customer_phone,fulfilment_method,special_instructions,payment_status,total,status,created_at,items_count').order('created_at',{ascending:false});
  if(limit) query=query.limit(limit);
  const {data:orderRows,error:orderError}=await query;
  if(orderError) fail(orderError);
  const rows=(orderRows??[]) as Row[]; const ids=rows.map(row=>text(row.id)).filter(Boolean);
  if(!ids.length) return [];
  const {data:itemRows,error:itemError}=await client().from('order_items').select('id,order_id,product_name,unit_price,quantity,modifiers,special_instructions').in('order_id',ids).order('created_at');
  if(itemError) fail(itemError);
  const itemsByOrder=new Map<string,OrderItem[]>();
  for(const row of (itemRows??[]) as Row[]){const orderId=text(row.order_id);itemsByOrder.set(orderId,[...(itemsByOrder.get(orderId)??[]),orderItem(row)]);}
  return rows.map(row=>{const value=order(row);return {...value,items:itemsByOrder.get(value.id)??[]};});
}
export async function updateOrderStatus(id:string,status:OrderStatus){
  const {data,error}=await client().from('orders').update({status}).eq('id',id).select('id,status').single();
  if(error){console.error('Unable to update order status',{orderId:id,status,error});throw new Error(`Unable to update order status: ${error.message}${error.code?` (${error.code})`:''}`);}
  return {id:text((data as Row).id),status:orderStatus((data as Row).status)};
}
export async function getCategories(){const {data,error}=await client().from('categories').select('id,name').order('name');if(error)fail(error);return(data??[]).map(row=>({id:text(row.id),name:text(row.name),count:0}))}
export async function getCustomers(){const {data,error}=await client().from('customers').select('id,name,email,orders_count,total_spend,last_order_at').order('last_order_at',{ascending:false});if(error)fail(error);return(data??[]).map(row=>customer(row as Row))}
export async function getSettings(){const {data,error}=await client().from('restaurant_settings').select('id,name,address,phone,email,hours,delivery_fee,tax_rate,instagram').limit(1).maybeSingle();if(error)fail(error);return data?settings(data as Row):null}
export async function saveSettings(value:RestaurantSettings){const {error}=await client().from('restaurant_settings').upsert({name:value.name,address:value.address,phone:value.phone,email:value.email,hours:value.hours,delivery_fee:value.deliveryFee,tax_rate:value.taxRate,instagram:value.instagram});if(error)fail(error)}
