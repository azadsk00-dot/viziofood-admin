/**
 * Specials service — CRUD against the `specials` table plus the public
 * read used by the homepage/menu. Before the 20260826 migration has been
 * applied the table does not exist; every public read degrades to an empty
 * list so the site keeps rendering (the legacy homepage_content promo is
 * used as fallback by the Home page).
 */

import { supabase, supabaseConfigurationError } from '../lib/supabase';
import type { Special, SpecialDraft } from '../types';
import { discountPercent } from '../lib/specials';

type Row = Record<string, unknown>;

const COLUMNS = 'id,title,description,image_url,price,original_price,active,archived,start_date,end_date,start_time,end_time,days_of_week,cta_text,cta_link,category,dietary,ingredients,allergens,badge,priority,display_location,product_id,stock_quantity,created_at,updated_at';

const client = () => {
  if (!supabase) throw new Error(supabaseConfigurationError);
  return supabase;
};

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const nullableText = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => Number(v ?? 0);
const nullableNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => v === true;
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export const mapSpecial = (row: Row): Special => {
  const price = num(row.price);
  const originalPrice = nullableNum(row.original_price);
  return {
    id: text(row.id),
    title: text(row.title),
    description: text(row.description),
    imageUrl: nullableText(row.image_url),
    price,
    originalPrice,
    discountPercent: discountPercent(price, originalPrice),
    active: bool(row.active),
    archived: bool(row.archived),
    startDate: nullableText(row.start_date),
    endDate: nullableText(row.end_date),
    startTime: nullableText(row.start_time),
    endTime: nullableText(row.end_time),
    daysOfWeek: nums(row.days_of_week),
    ctaText: text(row.cta_text),
    ctaLink: text(row.cta_link),
    category: text(row.category),
    dietary: strings(row.dietary),
    ingredients: strings(row.ingredients),
    allergens: strings(row.allergens),
    badge: text(row.badge),
    priority: num(row.priority),
    displayLocation: row.display_location === 'menu' || row.display_location === 'both' ? row.display_location : 'homepage',
    productId: nullableText(row.product_id),
    stockQuantity: nullableNum(row.stock_quantity),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
};

const toRow = (value: Partial<SpecialDraft>) => {
  const out: Record<string, unknown> = {};
  const assign = <T>(key: string, v: T | undefined) => { if (v !== undefined) out[key] = v; };
  assign('title', value.title?.trim());
  assign('description', value.description?.trim());
  assign('image_url', value.imageUrl);
  assign('price', value.price);
  assign('original_price', value.originalPrice);
  assign('active', value.active);
  assign('archived', value.archived);
  assign('start_date', value.startDate || null);
  assign('end_date', value.endDate || null);
  assign('start_time', value.startTime || null);
  assign('end_time', value.endTime || null);
  assign('days_of_week', value.daysOfWeek);
  assign('cta_text', value.ctaText?.trim());
  assign('cta_link', value.ctaLink?.trim());
  assign('category', value.category?.trim());
  assign('dietary', value.dietary);
  assign('ingredients', value.ingredients);
  assign('allergens', value.allergens);
  assign('badge', value.badge?.trim());
  assign('priority', value.priority);
  assign('display_location', value.displayLocation);
  assign('product_id', value.productId);
  assign('stock_quantity', value.stockQuantity);
  return out;
};

const isTableMissing = (error: { code?: string; message?: string } | null) =>
  error?.code === '42P01' || error?.code === 'PGRST205' || /relation .* does not exist/i.test(error?.message ?? '');

/** Public + admin read of all specials. Empty array before the migration runs. */
export async function getSpecials(): Promise<Special[]> {
  const { data, error } = await client().from('specials').select(COLUMNS).order('priority').order('created_at');
  if (error) {
    if (isTableMissing(error)) return [];
    console.error('[specials] read failed', error);
    throw error;
  }
  return ((data ?? []) as Row[]).map(mapSpecial);
}

export async function createSpecial(value: SpecialDraft): Promise<Special> {
  const { data, error } = await client().from('specials').insert(toRow(value)).select(COLUMNS).single();
  if (error) throw error;
  return mapSpecial(data as Row);
}

export async function updateSpecial(id: string, value: Partial<SpecialDraft>): Promise<Special> {
  const { data, error } = await client().from('specials').update(toRow(value)).eq('id', id).select(COLUMNS).single();
  if (error) throw error;
  return mapSpecial(data as Row);
}

export async function duplicateSpecial(id: string): Promise<Special> {
  const source = (await getSpecials()).find((s) => s.id === id);
  if (!source) throw new Error('Special not found.');
  const { id: _omit, createdAt: _c, updatedAt: _u, discountPercent: _d, ...draft } = source;
  const copy: SpecialDraft = { ...draft, title: `${source.title} (copy)`, active: false };
  return createSpecial(copy);
}

export async function archiveSpecial(id: string, archived = true): Promise<void> {
  const { error } = await client().from('specials').update({ archived }).eq('id', id);
  if (error) throw error;
}

export async function deleteSpecial(id: string): Promise<void> {
  const { error } = await client().from('specials').delete().eq('id', id);
  if (error) throw error;
}
