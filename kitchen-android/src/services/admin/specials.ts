// Specials admin service — INDEPENDENT entity (own title/price/image/schedule;
// optional product link never overwrites special fields). Mirrors web
// src/services/specials.ts row mapping.

import { supabase } from '../../lib/supabase';
import type { AdminSpecial } from '../../lib/adminTypes';

const COLUMNS =
  'id,title,description,image_url,price,original_price,active,archived,start_date,end_date,start_time,end_time,days_of_week,cta_text,cta_link,category,dietary,ingredients,allergens,badge,priority,display_location,product_id,stock_quantity,created_at,updated_at';

function toSpecial(row: Record<string, unknown>): AdminSpecial {
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    description: (row.description as string) ?? '',
    imageUrl: (row.image_url as string | null) ?? null,
    price: Number(row.price ?? 0),
    originalPrice: row.original_price === null || row.original_price === undefined ? null : Number(row.original_price),
    active: Boolean(row.active),
    archived: Boolean(row.archived),
    startDate: (row.start_date as string | null) ?? null,
    endDate: (row.end_date as string | null) ?? null,
    startTime: (row.start_time as string | null) ?? null,
    endTime: (row.end_time as string | null) ?? null,
    daysOfWeek: Array.isArray(row.days_of_week) ? (row.days_of_week as number[]) : [],
    ctaText: (row.cta_text as string) ?? 'Order now',
    ctaLink: (row.cta_link as string) ?? '/menu',
    category: (row.category as string) ?? '',
    dietary: Array.isArray(row.dietary) ? (row.dietary as string[]) : [],
    ingredients: Array.isArray(row.ingredients) ? (row.ingredients as string[]) : [],
    allergens: Array.isArray(row.allergens) ? (row.allergens as string[]) : [],
    badge: (row.badge as string) ?? 'Special',
    priority: Number(row.priority ?? 100),
    displayLocation: ((row.display_location as string) ?? 'both') as AdminSpecial['displayLocation'],
    productId: (row.product_id as string | null) ?? null,
    stockQuantity: row.stock_quantity === null || row.stock_quantity === undefined ? null : Number(row.stock_quantity),
    createdAt: (row.created_at as string) ?? '',
    updatedAt: (row.updated_at as string) ?? '',
  };
}

function toRow(draft: Partial<AdminSpecial>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (draft.title !== undefined) row.title = draft.title.trim();
  if (draft.description !== undefined) row.description = draft.description;
  if (draft.imageUrl !== undefined) row.image_url = draft.imageUrl;
  if (draft.price !== undefined) row.price = Number(draft.price);
  if (draft.originalPrice !== undefined) row.original_price = draft.originalPrice;
  if (draft.active !== undefined) row.active = draft.active;
  if (draft.archived !== undefined) row.archived = draft.archived;
  if (draft.startDate !== undefined) row.start_date = draft.startDate || null;
  if (draft.endDate !== undefined) row.end_date = draft.endDate || null;
  if (draft.startTime !== undefined) row.start_time = draft.startTime || null;
  if (draft.endTime !== undefined) row.end_time = draft.endTime || null;
  if (draft.daysOfWeek !== undefined) row.days_of_week = draft.daysOfWeek;
  if (draft.ctaText !== undefined) row.cta_text = draft.ctaText;
  if (draft.ctaLink !== undefined) row.cta_link = draft.ctaLink;
  if (draft.category !== undefined) row.category = draft.category;
  if (draft.dietary !== undefined) row.dietary = draft.dietary;
  if (draft.ingredients !== undefined) row.ingredients = draft.ingredients;
  if (draft.allergens !== undefined) row.allergens = draft.allergens;
  if (draft.badge !== undefined) row.badge = draft.badge;
  if (draft.priority !== undefined) row.priority = draft.priority;
  if (draft.displayLocation !== undefined) row.display_location = draft.displayLocation;
  if (draft.productId !== undefined) row.product_id = draft.productId || null;
  if (draft.stockQuantity !== undefined) row.stock_quantity = draft.stockQuantity;
  return row;
}

export async function getSpecials(): Promise<AdminSpecial[]> {
  const { data, error } = await supabase.from('specials').select(COLUMNS).order('priority').order('created_at');
  if (error) {
    if (/42P01|PGRST205/i.test(error.message)) return []; // pre-migration
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => toSpecial(row as Record<string, unknown>));
}

export async function saveSpecial(draft: Partial<AdminSpecial> & { id?: string }): Promise<void> {
  const { error } = draft.id
    ? await supabase.from('specials').update(toRow(draft)).eq('id', draft.id)
    : await supabase.from('specials').insert(toRow(draft));
  if (error) throw new Error(error.message);
}

export async function duplicateSpecial(special: AdminSpecial): Promise<void> {
  const { id: _omit, createdAt: _c, updatedAt: _u, ...rest } = special;
  await saveSpecial({ ...rest, title: `${special.title} (copy)`, active: false });
}

export async function deleteSpecial(id: string): Promise<void> {
  const { error } = await supabase.from('specials').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export function validateSpecial(draft: Partial<AdminSpecial>): string | null {
  if (!draft.title || draft.title.trim().length < 2) return 'Title must be at least 2 characters.';
  if (draft.title.length > 140) return 'Title must be 140 characters or fewer.';
  if (!Number.isFinite(Number(draft.price)) || Number(draft.price) < 0 || Number(draft.price) > 10000) return 'Price must be between 0 and 10,000.';
  if (draft.originalPrice !== null && draft.originalPrice !== undefined) {
    if (!Number.isFinite(draft.originalPrice) || draft.originalPrice < 0 || draft.originalPrice > 10000) return 'Original price must be between 0 and 10,000.';
  }
  if (draft.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) return 'Start date must be YYYY-MM-DD.';
  if (draft.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate)) return 'End date must be YYYY-MM-DD.';
  if (draft.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime)) return 'Start time must be HH:MM (24h).';
  if (draft.endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.endTime)) return 'End time must be HH:MM (24h).';
  if ((draft.daysOfWeek?.length ?? 0) > 7) return 'Too many days selected.';
  return null;
}
