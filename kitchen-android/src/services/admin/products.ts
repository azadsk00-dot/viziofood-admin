// Products admin service — mirrors web src/admin/supabase.ts product layer:
// same columns, same row mapping, same fallback when featured_order missing.

import { supabase } from '../../lib/supabase';
import type { AdminProduct, Visibility } from '../../lib/adminTypes';

const BASE_COLUMNS =
  'id,name,description,price,category,active,available,featured,popular,archived,archived_at,vegetarian,vegan,halal,gluten_free,preparation_time,calories,ingredients,allergens,tags,display_order,sku,internal_notes,image_url,thumbnail_url,gallery,gallery_images,visibility,created_by,updated_by,created_at,updated_at';
const COLUMNS = BASE_COLUMNS.replace('display_order,', 'display_order,featured_order,');

interface ProductRow {
  [key: string]: unknown;
  id: string;
  name: string;
  price: number;
  category: string;
  featured_order?: number | null;
}

function toProduct(row: Record<string, unknown>): AdminProduct {
  const r = row as ProductRow;
  const gallery = Array.isArray(r.gallery) ? (r.gallery as string[]) : Array.isArray(r.gallery_images) ? (r.gallery_images as string[]) : [];
  return {
    id: r.id,
    name: r.name ?? '',
    description: (r.description as string) ?? '',
    price: Number(r.price ?? 0),
    category: (r.category as string) ?? '',
    sku: (r.sku as string) ?? '',
    active: Boolean(r.active),
    available: Boolean(r.available),
    featured: Boolean(r.featured),
    popular: Boolean(r.popular),
    archived: Boolean(r.archived),
    archivedAt: (r.archived_at as string | null) ?? null,
    vegetarian: Boolean(r.vegetarian),
    vegan: Boolean(r.vegan),
    halal: Boolean(r.halal),
    glutenFree: Boolean(r.gluten_free),
    preparationTime: Number(r.preparation_time ?? 0),
    calories: r.calories === null || r.calories === undefined ? null : Number(r.calories),
    ingredients: Array.isArray(r.ingredients) ? (r.ingredients as string[]) : [],
    allergens: Array.isArray(r.allergens) ? (r.allergens as string[]) : [],
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    displayOrder: Number(r.display_order ?? 0),
    featuredOrder: r.featured_order === undefined ? undefined : Number(r.featured_order ?? 0) as number | undefined,
    imageUrl: (r.image_url as string | null) ?? null,
    thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
    gallery,
    visibility: ((r.visibility as string) ?? 'public') as Visibility,
    internalNotes: (r.internal_notes as string) ?? '',
  };
}

function toRow(draft: Partial<AdminProduct>, opts: { includeFeaturedOrder?: boolean } = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (draft.name !== undefined) row.name = draft.name.trim();
  if (draft.description !== undefined) row.description = draft.description;
  if (draft.price !== undefined) row.price = Number(draft.price);
  if (draft.category !== undefined) row.category = draft.category.trim();
  if (draft.sku !== undefined) row.sku = draft.sku.trim();
  if (draft.active !== undefined) row.active = draft.active;
  if (draft.available !== undefined) row.available = draft.available;
  if (draft.featured !== undefined) row.featured = draft.featured;
  if (draft.popular !== undefined) row.popular = draft.popular;
  if (draft.archived !== undefined) {
    row.archived = draft.archived;
    row.archived_at = draft.archived ? new Date().toISOString() : null;
  }
  if (draft.vegetarian !== undefined) row.vegetarian = draft.vegetarian;
  if (draft.vegan !== undefined) row.vegan = draft.vegan;
  if (draft.halal !== undefined) row.halal = draft.halal;
  if (draft.glutenFree !== undefined) row.gluten_free = draft.glutenFree;
  if (draft.preparationTime !== undefined) row.preparation_time = Math.max(0, Math.round(draft.preparationTime));
  if (draft.calories !== undefined) row.calories = draft.calories;
  if (draft.ingredients !== undefined) row.ingredients = draft.ingredients;
  if (draft.allergens !== undefined) row.allergens = draft.allergens;
  if (draft.tags !== undefined) row.tags = draft.tags;
  if (draft.displayOrder !== undefined) row.display_order = draft.displayOrder;
  if (draft.imageUrl !== undefined) {
    row.image_url = draft.imageUrl;
    row.thumbnail_url = draft.imageUrl; // web parity: cover doubles as thumb
  }
  if (draft.gallery !== undefined) {
    row.gallery = draft.gallery;
    row.gallery_images = draft.gallery;
  }
  if (draft.visibility !== undefined) row.visibility = draft.visibility;
  if (draft.internalNotes !== undefined) row.internal_notes = draft.internalNotes;
  if (opts.includeFeaturedOrder && draft.featuredOrder !== undefined) row.featured_order = draft.featuredOrder;
  return row;
}

export async function getProducts(): Promise<AdminProduct[]> {
  const first = await supabase.from('products').select(COLUMNS).order('display_order').order('name');
  let rows: unknown[] | null = null;
  if (first.error && /featured_order|42703|PGRST204/i.test(first.error.message)) {
    const fallback = await supabase.from('products').select(BASE_COLUMNS).order('display_order').order('name');
    if (fallback.error) throw new Error(fallback.error.message);
    rows = fallback.data as unknown[];
  } else if (first.error) {
    throw new Error(first.error.message);
  } else {
    rows = first.data as unknown[];
  }
  return (rows ?? []).map((row) => toProduct(row as Record<string, unknown>));
}

export function validateProduct(draft: Partial<AdminProduct>): string | null {
  if (!draft.name || !draft.name.trim()) return 'Name is required.';
  if (!draft.category || !draft.category.trim()) return 'Category is required.';
  if (!Number.isFinite(Number(draft.price)) || Number(draft.price) < 0) return 'Price must be 0 or more.';
  if (!Number.isInteger(Number(draft.preparationTime)) || Number(draft.preparationTime) < 0) return 'Preparation time must be a whole number of minutes.';
  return null;
}

export async function createProduct(draft: Partial<AdminProduct>): Promise<void> {
  const { error } = await supabase.from('products').insert(toRow(draft));
  if (error) throw new Error(error.message);
}

export async function updateProduct(id: string, changes: Partial<AdminProduct>): Promise<void> {
  const { error } = await supabase.from('products').update(toRow(changes, { includeFeaturedOrder: true })).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateProducts(ids: string[], changes: Partial<AdminProduct>): Promise<void> {
  const { error } = await supabase.from('products').update(toRow(changes)).in('id', ids);
  if (error) throw new Error(error.message);
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function archiveProducts(ids: string[], archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ archived, archived_at: archived ? new Date().toISOString() : null })
    .in('id', ids);
  if (error) throw new Error(error.message);
}

export async function duplicateProduct(product: AdminProduct): Promise<void> {
  await createProduct({ ...product, name: `${product.name} copy`, sku: '', archived: false, featured: false, featuredOrder: 0 });
}
