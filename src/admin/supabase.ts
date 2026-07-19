import { supabase, supabaseConfigurationError } from '../lib/supabase'; import type { Customer, Order, OrderStatus, Product, RestaurantSettings } from './types';
type Row=Record<string,unknown>;const client=()=>{if(!supabase)throw new Error(supabaseConfigurationError);return supabase};const fail=(error:unknown)=>{console.error(error);throw error};const text=(v:unknown)=>typeof v==='string'?v:'';const number=(v:unknown)=>Number(v??0);const strings=(v:unknown)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'):[];
const product = (r: Row): Product => ({
  id: text(r.id),
  name: text(r.name),
  description: text(r.description),
  price: number(r.price),
  category: text(r.category),
  active: Boolean(r.active),
  available: true,
  featured: false,
  popular: false,
  vegetarian: false,
  vegan: false,
  halal: false,
  glutenFree: false,
  spicyLevel: 0,
  preparationTime: 0,
  calories: null,
  ingredients: [],
  allergens: [],
  displayOrder: 0,
  imageUrl: null,
  galleryImages: [],
  archivedAt: null,
});
const order=(r:Row):Order=>({id:text(r.order_number)||text(r.id),customer:text(r.customer_name),email:text(r.customer_email),total:number(r.total),status:(text(r.status)||'New') as OrderStatus,createdAt:text(r.created_at),items:number(r.items_count),notes:''});const customer=(r:Row):Customer=>({id:text(r.id),name:text(r.name),email:text(r.email),orders:number(r.orders_count),spend:number(r.total_spend),lastOrder:text(r.last_order_at)});const settings=(r:Row):RestaurantSettings=>({name:text(r.name),address:text(r.address),phone:text(r.phone),email:text(r.email),hours:text(r.hours),deliveryFee:number(r.delivery_fee),taxRate:number(r.tax_rate),instagram:text(r.instagram)});
const productColumns='id,name,description,price,category,category_id,active,created_at,updated_at';
export async function getProducts(){const {data,error}=await client().from('products').select(productColumns).order('name');if(error)fail(error);return(data??[]).map(r=>product(r as Row));}
export async function createProduct(value:Omit<Product,'id'>){const {error}=await client().from('products').insert(toProductRow(value));if(error)fail(error)}
export async function updateProduct(id:string,value:Partial<Product>){const {error}=await client().from('products').update(toProductRow(value)).eq('id',id);if(error)fail(error)}
export async function deleteProduct(id:string){const {error}=await client().from('products').delete().eq('id',id);if(error)fail(error)}
export async function archiveProducts(ids:string[],archived=true){const {error}=await client().from('products').update({archived_at:archived?new Date().toISOString():null}).in('id',ids);if(error)fail(error)}
export async function updateProducts(ids:string[],changes:Partial<Product>){const {error}=await client().from('products').update(toProductRow(changes)).in('id',ids);if(error)fail(error)}
export async function uploadProductImage(file:File){const extension=file.name.split('.').pop()||'jpg';const path=`${crypto.randomUUID()}.${extension}`;const {error}=await client().storage.from('product-images').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});if(error)fail(error);return client().storage.from('product-images').getPublicUrl(path).data.publicUrl}
export async function deleteProductImage(url:string){const marker='/product-images/';const path=url.split(marker)[1];if(!path)return;const {error}=await client().storage.from('product-images').remove([path]);if(error)fail(error)}
const toProductRow=(v:Partial<Product>)=>({name:v.name,description:v.description,price:v.price,category:v.category,active:v.active,available:v.available,featured:v.featured,popular:v.popular,vegetarian:v.vegetarian,vegan:v.vegan,halal:v.halal,gluten_free:v.glutenFree,spicy_level:v.spicyLevel,preparation_time:v.preparationTime,calories:v.calories,ingredients:v.ingredients,allergens:v.allergens,display_order:v.displayOrder,image_url:v.imageUrl,gallery_images:v.galleryImages,archived_at:v.archivedAt});
export async function getOrders(limit?:number){let q=client().from('orders').select('id,order_number,customer_name,customer_email,total,status,created_at,items_count').order('created_at',{ascending:false});if(limit)q=q.limit(limit);const {data,error}=await q;if(error)fail(error);return(data??[]).map(r=>order(r as Row))}export async function updateOrderStatus(id:string,status:OrderStatus){const {error}=await client().from('orders').update({status}).eq('id',id);if(error)fail(error)}
export async function getCategories(){const {data,error}=await client().from('categories').select('id,name').order('name');if(error)fail(error);return(data??[]).map(r=>({id:text(r.id),name:text(r.name),count:0}))}export async function getCustomers(){const {data,error}=await client().from('customers').select('id,name,email,orders_count,total_spend,last_order_at').order('last_order_at',{ascending:false});if(error)fail(error);return(data??[]).map(r=>customer(r as Row))}export async function getSettings(){const {data,error}=await client().from('restaurant_settings').select('id,name,address,phone,email,hours,delivery_fee,tax_rate,instagram').limit(1).maybeSingle();if(error)fail(error);return data?settings(data as Row):null}export async function saveSettings(value:RestaurantSettings){const {error}=await client().from('restaurant_settings').upsert({name:value.name,address:value.address,phone:value.phone,email:value.email,hours:value.hours,delivery_fee:value.deliveryFee,tax_rate:value.taxRate,instagram:value.instagram});if(error)fail(error)}
