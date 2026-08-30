/**
 * Coupons service. The `coupons` table has existed since the initial
 * schema (percentage_off/amount_off); the 20260826 migration extends it
 * with minimum_order, scoping, windows, and usage limits. Reads fall back
 * to legacy columns when the extension columns are missing.
 */

import { supabase, supabaseConfigurationError } from '../lib/supabase';
import type { Coupon } from '../types';

type Row = Record<string, unknown>;

const client = () => {
  if (!supabase) throw new Error(supabaseConfigurationError);
  return supabase;
};

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const nullableText = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => Number(v ?? 0);
const nullableNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => v === true;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const EXTENDED = 'id,code,kind,value,minimum_order,product_ids,category_names,starts_at,ends_at,usage_limit,times_used,active';
const LEGACY = 'id,code,percentage_off,amount_off,active,expires_at';

export const mapCoupon = (row: Row, legacy = false): Coupon => {
  if (legacy) {
    const percent = nullableNum(row.percentage_off);
    return {
      id: text(row.id),
      code: text(row.code).toUpperCase(),
      kind: percent !== null && percent > 0 ? 'percent' : 'fixed',
      value: percent !== null && percent > 0 ? percent : num(row.amount_off),
      minimumOrder: 0,
      productIds: [],
      categoryNames: [],
      startsAt: null,
      endsAt: nullableText(row.expires_at),
      usageLimit: null,
      timesUsed: 0,
      active: bool(row.active),
    };
  }
  return {
    id: text(row.id),
    code: text(row.code).toUpperCase(),
    kind: row.kind === 'fixed' ? 'fixed' : 'percent',
    value: num(row.value),
    minimumOrder: num(row.minimum_order),
    productIds: (Array.isArray(row.product_ids) ? row.product_ids : []).map(String),
    categoryNames: strings(row.category_names),
    startsAt: nullableText(row.starts_at),
    endsAt: nullableText(row.ends_at),
    usageLimit: nullableNum(row.usage_limit),
    timesUsed: num(row.times_used),
    active: bool(row.active),
  };
};

export async function getCoupons(): Promise<Coupon[]> {
  const primary = await client().from('coupons').select(EXTENDED).order('created_at', { ascending: false });
  if (!primary.error) return ((primary.data ?? []) as Row[]).map((r) => mapCoupon(r));
  // Extension columns missing → legacy shape.
  const legacy = await client().from('coupons').select(LEGACY).order('created_at', { ascending: false });
  if (legacy.error) throw legacy.error;
  return ((legacy.data ?? []) as Row[]).map((r) => mapCoupon(r, true));
}

/**
 * Look up one coupon by code for checkout. Returns null when the code is
 * unknown. NOTE: this read is only for DISPLAY pricing — the Edge Function
 * re-validates the coupon server-side before charging, and increments
 * times_used only after payment succeeds.
 */
export async function findCoupon(code: string): Promise<Coupon | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const primary = await client().from('coupons').select(EXTENDED).eq('code', normalized).maybeSingle();
  if (!primary.error && primary.data) return mapCoupon(primary.data as Row);
  const legacy = await client().from('coupons').select(LEGACY).eq('code', normalized).maybeSingle();
  if (legacy.error) throw legacy.error;
  return legacy.data ? mapCoupon(legacy.data as Row, true) : null;
}

const toRow = (value: Partial<Coupon>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (value.code !== undefined) out.code = value.code.trim().toUpperCase();
  if (value.kind !== undefined) out.kind = value.kind;
  if (value.value !== undefined) out.value = value.value;
  if (value.minimumOrder !== undefined) out.minimum_order = value.minimumOrder;
  if (value.productIds !== undefined) out.product_ids = value.productIds;
  if (value.categoryNames !== undefined) out.category_names = value.categoryNames;
  if (value.startsAt !== undefined) out.starts_at = value.startsAt || null;
  if (value.endsAt !== undefined) out.ends_at = value.endsAt || null;
  if (value.usageLimit !== undefined) out.usage_limit = value.usageLimit;
  if (value.active !== undefined) out.active = value.active;
  return out;
};

export async function saveCoupon(value: Coupon): Promise<void> {
  const row = toRow(value);
  if (value.id) {
    const { error } = await client().from('coupons').update(row).eq('id', value.id);
    if (error) throw error;
  } else {
    const { id: _skip, timesUsed: _used, ...insert } = value;
    const { error } = await client().from('coupons').insert(toRow({ ...insert, ...value }));
    if (error) throw error;
  }
}

export async function deleteCoupon(id: string): Promise<void> {
  const { error } = await client().from('coupons').delete().eq('id', id);
  if (error) throw error;
}
