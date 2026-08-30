// Coupons admin service — extended coupon model with legacy fallback
// (mirrors web src/services/coupons.ts). RLS remains the authority.

import { supabase } from '../../lib/supabase';
import type { AdminCoupon } from '../../lib/adminTypes';

const EXTENDED = 'id,code,kind,value,minimum_order,product_ids,category_names,starts_at,ends_at,usage_limit,times_used,active';
const LEGACY = 'id,code,percentage_off,amount_off,active,expires_at';

export async function getCoupons(): Promise<AdminCoupon[]> {
  let data: unknown[] | null = null;
  let error: { message: string } | null = null;
  const first = await supabase.from('coupons').select(EXTENDED).order('created_at', { ascending: false });
  data = first.data as unknown[] | null;
  error = first.error;
  if (error && /kind|42703|PGRST204/i.test(error.message)) {
    const legacy = await supabase.from('coupons').select(LEGACY).order('created_at', { ascending: false });
    if (legacy.error) throw new Error(legacy.error.message);
    return ((legacy.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
      const percent = Number(r.percentage_off ?? 0);
      const fixed = Number(r.amount_off ?? 0);
      return {
        id: r.id as string,
        code: (r.code as string) ?? '',
        kind: percent > 0 ? 'percent' : 'fixed',
        value: percent > 0 ? percent : fixed,
        minimumOrder: 0,
        productIds: [],
        categoryNames: [],
        startsAt: null,
        endsAt: (r.expires_at as string | null) ?? null,
        usageLimit: null,
        timesUsed: 0,
        active: Boolean(r.active),
      };
    });
  }
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
    return {
      id: r.id as string,
      code: ((r.code as string) ?? '').toUpperCase(),
      kind: ((r.kind as string) ?? 'percent') as AdminCoupon['kind'],
      value: Number(r.value ?? 0),
      minimumOrder: Number(r.minimum_order ?? 0),
      productIds: Array.isArray(r.product_ids) ? (r.product_ids as string[]) : [],
      categoryNames: Array.isArray(r.category_names) ? (r.category_names as string[]) : [],
      startsAt: (r.starts_at as string | null) ?? null,
      endsAt: (r.ends_at as string | null) ?? null,
      usageLimit: r.usage_limit === null || r.usage_limit === undefined ? null : Number(r.usage_limit),
      timesUsed: Number(r.times_used ?? 0),
      active: Boolean(r.active),
    };
  });
}

function toRow(draft: Partial<AdminCoupon>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (draft.code !== undefined) row.code = draft.code.trim().toUpperCase();
  if (draft.kind !== undefined) row.kind = draft.kind;
  if (draft.value !== undefined) row.value = Number(draft.value);
  if (draft.minimumOrder !== undefined) row.minimum_order = Number(draft.minimumOrder);
  if (draft.categoryNames !== undefined) row.category_names = draft.categoryNames;
  if (draft.startsAt !== undefined) row.starts_at = draft.startsAt || null;
  if (draft.endsAt !== undefined) row.ends_at = draft.endsAt || null;
  if (draft.usageLimit !== undefined) row.usage_limit = draft.usageLimit === null ? null : Number(draft.usageLimit);
  if (draft.active !== undefined) row.active = draft.active;
  return row;
}

export function validateCoupon(draft: Partial<AdminCoupon>): string | null {
  const code = (draft.code ?? '').trim();
  if (code.length < 3 || code.length > 40) return 'Code must be 3–40 characters.';
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return 'Code may only contain letters, numbers, dashes and underscores.';
  if (draft.kind !== 'percent' && draft.kind !== 'fixed') return 'Choose a discount kind.';
  const value = Number(draft.value);
  if (!Number.isFinite(value) || value < 0.01 || value > 10000) return 'Value must be between 0.01 and 10,000.';
  if (draft.kind === 'percent' && value > 100) return 'Percent cannot exceed 100.';
  const min = Number(draft.minimumOrder ?? 0);
  if (!Number.isFinite(min) || min < 0 || min > 10000) return 'Minimum order must be 0–10,000.';
  if (draft.usageLimit !== null && draft.usageLimit !== undefined) {
    if (!Number.isInteger(draft.usageLimit) || draft.usageLimit < 1 || draft.usageLimit > 1_000_000) return 'Usage limit must be a whole number ≥ 1.';
  }
  if (draft.startsAt && draft.endsAt && Date.parse(draft.endsAt) < Date.parse(draft.startsAt)) return 'End cannot be before start.';
  return null;
}

export async function saveCoupon(draft: Partial<AdminCoupon> & { id?: string }): Promise<void> {
  const { error } = draft.id
    ? await supabase.from('coupons').update(toRow(draft)).eq('id', draft.id)
    : await supabase.from('coupons').insert(toRow(draft));
  if (error) {
    if (/23505|duplicate/i.test(error.message)) throw new Error('A coupon with this code already exists.');
    throw new Error(error.message);
  }
}

export async function deleteCoupon(id: string): Promise<void> {
  const { error } = await supabase.from('coupons').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
