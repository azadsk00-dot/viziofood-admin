// Admin catering service — management data layer for
// Admin → Catering & Bulk Buy. Everything saved here feeds the public page
// and the payment Edge Functions in realtime; the frontend values are never
// authoritative for pricing (the server re-reads catering_settings itself).

import { supabase, supabaseConfigurationError } from '../lib/supabase';
import type { CateringEnquiryStatus, CateringFaq, CateringSettings, CateringStep } from '../lib/catering';
import { cateringTrayPriceFor, defaultCateringSettings, isExcludedFromCatering, looksLikeLasagna } from '../lib/catering';

type Row = Record<string, unknown>;
const client = () => { if (!supabase) throw new Error(supabaseConfigurationError); return supabase; };
const fail = (error: unknown): never => { console.error(error); throw new Error(typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : 'Unexpected error.'); };
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const num = (value: unknown, fallback: number) => (value === null || value === undefined || Number.isNaN(Number(value)) ? fallback : Number(value));
const nullableNum = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value));

const SETTINGS_SELECT = 'id,page_enabled,catering_orders_enabled,raw_pasta_orders_enabled,hero_title,hero_description,hero_image_url,catering_intro,bulk_buy_intro,raw_pasta_intro,how_it_works_title,how_it_works_intro,delivery_info,pickup_info,cta_text,enquiry_intro,contact_phone,contact_email,delivery_enabled,pickup_enabled,delivery_fee,free_delivery_threshold,service_charge_waiver_threshold,delivery_radius_km,raw_pasta_price,raw_pasta_weight_grams,origin_address,origin_lat,origin_lng,seo_title,seo_description,social_title,social_description,social_image_url,seo_canonical';

export const getCateringSettings = async (): Promise<CateringSettings | null> => {
  const { data, error } = await client().from('catering_settings').select(SETTINGS_SELECT).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205') return null;
    fail(error);
  }
  if (!data) return null;
  const row = data as unknown as Row;
  const base = defaultCateringSettings();
  return {
    ...base,
    pageEnabled: row.page_enabled !== false,
    cateringOrdersEnabled: row.catering_orders_enabled !== false,
    rawPastaOrdersEnabled: row.raw_pasta_orders_enabled !== false,
    heroTitle: text(row.hero_title), heroDescription: text(row.hero_description),
    heroImageUrl: typeof row.hero_image_url === 'string' && row.hero_image_url ? row.hero_image_url : null,
    cateringIntro: text(row.catering_intro), bulkBuyIntro: text(row.bulk_buy_intro), rawPastaIntro: text(row.raw_pasta_intro),
    howItWorksTitle: text(row.how_it_works_title), howItWorksIntro: text(row.how_it_works_intro),
    deliveryInfo: text(row.delivery_info), pickupInfo: text(row.pickup_info),
    ctaText: text(row.cta_text), enquiryIntro: text(row.enquiry_intro),
    contactPhone: text(row.contact_phone), contactEmail: text(row.contact_email),
    deliveryEnabled: row.delivery_enabled !== false, pickupEnabled: row.pickup_enabled !== false,
    deliveryFee: num(row.delivery_fee, base.deliveryFee),
    freeDeliveryThreshold: num(row.free_delivery_threshold, base.freeDeliveryThreshold),
    serviceChargeWaiverThreshold: num(row.service_charge_waiver_threshold, base.serviceChargeWaiverThreshold),
    deliveryRadiusKm: num(row.delivery_radius_km, base.deliveryRadiusKm),
    rawPastaPrice: num(row.raw_pasta_price, base.rawPastaPrice),
    rawPastaWeightGrams: num(row.raw_pasta_weight_grams, base.rawPastaWeightGrams),
    originAddress: text(row.origin_address),
    originLat: nullableNum(row.origin_lat), originLng: nullableNum(row.origin_lng),
    seoTitle: text(row.seo_title), seoDescription: text(row.seo_description),
    socialTitle: text(row.social_title), socialDescription: text(row.social_description),
    socialImageUrl: typeof row.social_image_url === 'string' && row.social_image_url ? row.social_image_url : null,
    seoCanonical: typeof row.seo_canonical === 'string' && row.seo_canonical ? row.seo_canonical : null,
  };
};

export type CateringSettingsDraft = CateringSettings;

/** Audit/safety validation — inconsistent pricing rules are rejected before saving. */
export function validateCateringSettings(value: Partial<CateringSettingsDraft>): string | null {
  if (value.deliveryFee !== undefined && (!Number.isFinite(value.deliveryFee) || value.deliveryFee < 0)) return 'Delivery fee cannot be negative.';
  if (value.freeDeliveryThreshold !== undefined && (!Number.isFinite(value.freeDeliveryThreshold) || value.freeDeliveryThreshold < 0)) return 'Free delivery threshold cannot be negative.';
  if (value.serviceChargeWaiverThreshold !== undefined && (!Number.isFinite(value.serviceChargeWaiverThreshold) || value.serviceChargeWaiverThreshold < 0)) return 'Service charge waiver threshold cannot be negative.';
  if (value.rawPastaPrice !== undefined && (!Number.isFinite(value.rawPastaPrice) || value.rawPastaPrice < 0)) return 'Raw pasta price cannot be negative.';
  if (value.deliveryRadiusKm !== undefined && (!Number.isFinite(value.deliveryRadiusKm) || value.deliveryRadiusKm <= 0)) return 'Delivery radius must be greater than zero.';
  if (value.rawPastaWeightGrams !== undefined && (!Number.isInteger(value.rawPastaWeightGrams) || value.rawPastaWeightGrams <= 0)) return 'Raw pasta weight must be a whole number of grams greater than zero.';
  if (value.originLat !== undefined && value.originLat !== null && (value.originLat < -90 || value.originLat > 90)) return 'Origin latitude must be between -90 and 90.';
  if (value.originLng !== undefined && value.originLng !== null && (value.originLng < -180 || value.originLng > 180)) return 'Origin longitude must be between -180 and 180.';
  if ((value.originLat === null) !== (value.originLng === null)) return 'Set both latitude and longitude — or clear both.';
  return null;
}

export const saveCateringSettings = async (value: Partial<CateringSettingsDraft>): Promise<void> => {
  const problem = validateCateringSettings(value);
  if (problem) throw new Error(problem);
  const c = client();
  const payload = {
    page_enabled: value.pageEnabled, catering_orders_enabled: value.cateringOrdersEnabled, raw_pasta_orders_enabled: value.rawPastaOrdersEnabled,
    delivery_enabled: value.deliveryEnabled, pickup_enabled: value.pickupEnabled,
    delivery_fee: value.deliveryFee, free_delivery_threshold: value.freeDeliveryThreshold,
    service_charge_waiver_threshold: value.serviceChargeWaiverThreshold, delivery_radius_km: value.deliveryRadiusKm,
    raw_pasta_price: value.rawPastaPrice, raw_pasta_weight_grams: value.rawPastaWeightGrams,
    origin_address: value.originAddress, origin_lat: value.originLat, origin_lng: value.originLng,
    seo_title: value.seoTitle, seo_description: value.seoDescription,
    social_title: value.socialTitle, social_description: value.socialDescription,
    social_image_url: value.socialImageUrl, seo_canonical: value.seoCanonical,
    hero_title: value.heroTitle, hero_description: value.heroDescription, hero_image_url: value.heroImageUrl,
    catering_intro: value.cateringIntro, bulk_buy_intro: value.bulkBuyIntro, raw_pasta_intro: value.rawPastaIntro,
    how_it_works_title: value.howItWorksTitle, how_it_works_intro: value.howItWorksIntro,
    delivery_info: value.deliveryInfo, pickup_info: value.pickupInfo,
    cta_text: value.ctaText, enquiry_intro: value.enquiryIntro,
    contact_phone: value.contactPhone, contact_email: value.contactEmail,
  };
  const clean = Object.fromEntries(Object.entries(payload).filter(([, field]) => field !== undefined));
  const { data: existing, error: lookupError } = await c.from('catering_settings').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (lookupError) {
    if (lookupError.code === '42P01' || lookupError.code === '42703' || lookupError.code === 'PGRST204' || lookupError.code === 'PGRST205') {
      throw new Error('The Catering & Bulk Buy tables are not in the database yet — run the 20260917 migration first.');
    }
    fail(lookupError);
  }
  const existingId = existing ? String((existing as Row).id) : null;
  if (existingId) {
    const { error } = await c.from('catering_settings').update(clean as Record<string, unknown>).eq('id', existingId).select('id').single();
    if (error) fail(error);
  } else {
    const { error } = await c.from('catering_settings').insert(clean as Record<string, unknown>).select('id').single();
    if (error) fail(error);
  }
};

// ── Product catering flags ──────────────────────────────────────────────────

export interface AdminCateringProduct {
  id: string; name: string; category: string; price: number; active: boolean; archived: boolean; isCombo: boolean; isLasagna: boolean;
  /** Excluded from catering by the business name rules (kept on the normal menu). */
  isExcluded: boolean;
  /** Catering category assignment (20260917140000 migration; null = unassigned). */
  categoryId: string | null;
  flags: {
    cateringAvailable: boolean; bulkAvailable: boolean; rawPastaAvailable: boolean;
    cateringPrice: number | null; rawPastaPriceOverride: number | null; rawPastaWeightGramsOverride: number | null;
    cateringMinQty: number; cateringMaxQty: number | null;
  };
}

const PRODUCT_FLAGS_SELECT = 'id,name,category,price,active,archived_at,is_combo,catering_category_id,catering_available,bulk_available,raw_pasta_available,catering_price,raw_pasta_price,raw_pasta_weight_grams,catering_min_qty,catering_max_qty';

export const getCateringProducts = async (): Promise<AdminCateringProduct[]> => {
  const primary = await client().from('products').select(PRODUCT_FLAGS_SELECT).order('display_order').order('name');
  let rows: Row[];
  let derived = false;
  if (primary.error && (primary.error.code === '42703' || primary.error.code === 'PGRST204' || primary.error.code === 'PGRST205')) {
    // Pre-migration database: derive the catering flags from the business
    // name rules so the admin panel shows the live rules ($75/$85 trays,
    // excluded products OFF, Lasagna OFF) exactly as the storefront does.
    const legacy = await client().from('products').select('id,name,category,price,active,archived_at,is_combo').order('display_order').order('name');
    if (legacy.error) fail(legacy.error);
    rows = (legacy.data ?? []) as unknown as Row[];
    derived = true;
  } else {
    if (primary.error) fail(primary.error);
    rows = (primary.data ?? []) as unknown as Row[];
  }
  return rows.map((row) => {
    const name = String(row.name ?? '');
    // Cooked-catering exclusions (the three removed pastas + Lasagna +
    // combos). Raw pasta keeps every pasta except Lasagna.
    const excluded = isExcludedFromCatering(name) || looksLikeLasagna(name) || row.is_combo === true;
    const rawExcluded = looksLikeLasagna(name) || row.is_combo === true;
    return {
      id: String(row.id), name, category: String(row.category ?? ''), price: Number(row.price ?? 0),
      active: row.active !== false, archived: Boolean(row.archived_at), isCombo: row.is_combo === true,
      isLasagna: /(^|\s|-)lasagna/i.test(name.trim()),
      isExcluded: excluded,
      categoryId: typeof row.catering_category_id === 'string' ? row.catering_category_id : null,
      flags: {
        cateringAvailable: derived ? !excluded : row.catering_available === true,
        bulkAvailable: derived ? !excluded : row.bulk_available === true,
        rawPastaAvailable: derived ? !rawExcluded : row.raw_pasta_available === true,
        // Tray pricing: admin flag first, else the name rule ($85 Campanelle
        // with Prawns, $75 every other tray). The menu price is never used.
        cateringPrice: nullableNum(row.catering_price) ?? (derived && !excluded ? cateringTrayPriceFor(name) : null),
        rawPastaPriceOverride: nullableNum(row.raw_pasta_price),
        rawPastaWeightGramsOverride: nullableNum(row.raw_pasta_weight_grams),
        cateringMinQty: num(row.catering_min_qty, 1), cateringMaxQty: nullableNum(row.catering_max_qty),
      },
    };
  });
};

export interface ProductFlagPatch {
  cateringAvailable?: boolean; bulkAvailable?: boolean; rawPastaAvailable?: boolean;
  cateringPrice?: number | null; rawPastaPriceOverride?: number | null; rawPastaWeightGramsOverride?: number | null;
  cateringMinQty?: number; cateringMaxQty?: number | null;
}

export const updateCateringProduct = async (id: string, patch: ProductFlagPatch): Promise<void> => {
  if (patch.cateringPrice != null && patch.cateringPrice < 0) throw new Error('Catering price cannot be negative.');
  if (patch.rawPastaPriceOverride != null && patch.rawPastaPriceOverride < 0) throw new Error('Raw pasta price cannot be negative.');
  if (patch.rawPastaWeightGramsOverride != null && (!Number.isInteger(patch.rawPastaWeightGramsOverride) || patch.rawPastaWeightGramsOverride <= 0)) throw new Error('Raw pasta weight must be whole grams greater than zero.');
  const { error } = await client().from('products').update({
    ...(patch.cateringAvailable !== undefined ? { catering_available: patch.cateringAvailable } : {}),
    ...(patch.bulkAvailable !== undefined ? { bulk_available: patch.bulkAvailable } : {}),
    ...(patch.rawPastaAvailable !== undefined ? { raw_pasta_available: patch.rawPastaAvailable } : {}),
    ...(patch.cateringPrice !== undefined ? { catering_price: patch.cateringPrice } : {}),
    ...(patch.rawPastaPriceOverride !== undefined ? { raw_pasta_price: patch.rawPastaPriceOverride } : {}),
    ...(patch.rawPastaWeightGramsOverride !== undefined ? { raw_pasta_weight_grams: patch.rawPastaWeightGramsOverride } : {}),
    ...(patch.cateringMinQty !== undefined ? { catering_min_qty: Math.max(1, Math.round(patch.cateringMinQty)) } : {}),
    ...(patch.cateringMaxQty !== undefined ? { catering_max_qty: patch.cateringMaxQty } : {}),
  }).eq('id', id);
  if (error) fail(error);
};

// ── FAQ CRUD ─────────────────────────────────────────────────────────────────

export const getCateringFaqs = async (): Promise<CateringFaq[]> => {
  const { data, error } = await client().from('catering_faqs').select('id,question,answer,active,display_order').order('display_order').order('created_at');
  if (error) {
    if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205') return [];
    fail(error);
  }
  return ((data ?? []) as unknown as Row[]).map((row) => ({ id: String(row.id), question: String(row.question), answer: String(row.answer), active: row.active !== false, displayOrder: Number(row.display_order ?? 0) }));
};
export const createCateringFaq = async (question: string, answer: string): Promise<void> => {
  const { error } = await client().from('catering_faqs').insert({ question: question.trim(), answer: answer.trim(), active: true, display_order: 999 });
  if (error) fail(error);
};
export const updateCateringFaq = async (id: string, patch: Partial<Pick<CateringFaq, 'question' | 'answer' | 'active' | 'displayOrder'>>): Promise<void> => {
  const { error } = await client().from('catering_faqs').update({
    ...(patch.question !== undefined ? { question: patch.question.trim() } : {}),
    ...(patch.answer !== undefined ? { answer: patch.answer.trim() } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
    ...(patch.displayOrder !== undefined ? { display_order: patch.displayOrder } : {}),
  }).eq('id', id);
  if (error) fail(error);
};
export const deleteCateringFaq = async (id: string): Promise<void> => {
  const { error } = await client().from('catering_faqs').delete().eq('id', id);
  if (error) fail(error);
};

// ── How It Works CRUD ────────────────────────────────────────────────────────

export const getCateringSteps = async (): Promise<CateringStep[]> => {
  const { data, error } = await client().from('catering_steps').select('id,step_title,step_description,active,display_order').order('display_order').order('created_at');
  if (error) {
    if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205') return [];
    fail(error);
  }
  return ((data ?? []) as unknown as Row[]).map((row) => ({ id: String(row.id), stepTitle: String(row.step_title), stepDescription: String(row.step_description ?? ''), active: row.active !== false, displayOrder: Number(row.display_order ?? 0) }));
};
export const createCateringStep = async (stepTitle: string, stepDescription: string): Promise<void> => {
  const { error } = await client().from('catering_steps').insert({ step_title: stepTitle.trim(), step_description: stepDescription.trim(), active: true, display_order: 999 });
  if (error) fail(error);
};
export const updateCateringStep = async (id: string, patch: Partial<Pick<CateringStep, 'stepTitle' | 'stepDescription' | 'active' | 'displayOrder'>>): Promise<void> => {
  const { error } = await client().from('catering_steps').update({
    ...(patch.stepTitle !== undefined ? { step_title: patch.stepTitle.trim() } : {}),
    ...(patch.stepDescription !== undefined ? { step_description: patch.stepDescription.trim() } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
    ...(patch.displayOrder !== undefined ? { display_order: patch.displayOrder } : {}),
  }).eq('id', id);
  if (error) fail(error);
};
export const deleteCateringStep = async (id: string): Promise<void> => {
  const { error } = await client().from('catering_steps').delete().eq('id', id);
  if (error) fail(error);
};

// ── Enquiries ────────────────────────────────────────────────────────────────

export interface AdminCateringEnquiry {
  id: string; name: string; phone: string; email: string; eventDate: string | null; guests: number | null;
  estimatedOrderSize: string; preferredFulfilment: 'Pickup' | 'Delivery' | 'Unsure'; deliveryAddress: string;
  dietaryNotes: string; message: string; status: CateringEnquiryStatus; adminNotes: string; createdAt: string;
  /** Internal notification email outcome (null = columns not in the database yet). */
  notificationSent: boolean | null; notificationError: string | null;
}

export type { CateringEnquiryStatus };

const ENQUIRY_STATUSES: CateringEnquiryStatus[] = ['New', 'Contacted', 'Quoted', 'Confirmed', 'Completed', 'Cancelled'];

const ENQUIRY_SELECT = 'id,name,phone,email,event_date,guests,estimated_order_size,preferred_fulfilment,delivery_address,dietary_notes,message,status,admin_notes,created_at,notification_sent,notification_error';
const ENQUIRY_SELECT_LEGACY = 'id,name,phone,email,event_date,guests,estimated_order_size,preferred_fulfilment,delivery_address,dietary_notes,message,status,admin_notes,created_at';

export const getCateringEnquiries = async (): Promise<AdminCateringEnquiry[]> => {
  const run = (columns: string) =>
    client().from('catering_enquiries').select(columns).order('created_at', { ascending: false }).limit(200);
  let query = await run(ENQUIRY_SELECT);
  // 42703/PGRST204 = the notification columns are not in the database yet
  // (pre-20260917160000) — read without them; null means "outcome unknown".
  if (query.error && (query.error.code === '42703' || query.error.code === 'PGRST204')) {
    query = await run(ENQUIRY_SELECT_LEGACY) as typeof query;
  }
  const { data, error } = query;
  if (error) {
    if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205') return [];
    fail(error);
  }
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const status = String(row.status ?? 'New') as CateringEnquiryStatus;
    const fulfilment = String(row.preferred_fulfilment ?? 'Unsure');
    return {
      id: String(row.id), name: String(row.name), phone: String(row.phone ?? ''), email: String(row.email ?? ''),
      eventDate: typeof row.event_date === 'string' ? row.event_date : null,
      guests: row.guests === null || row.guests === undefined ? null : Number(row.guests),
      estimatedOrderSize: String(row.estimated_order_size ?? ''),
      preferredFulfilment: (['Pickup', 'Delivery', 'Unsure'] as const).includes(fulfilment as 'Pickup') ? fulfilment as AdminCateringEnquiry['preferredFulfilment'] : 'Unsure',
      deliveryAddress: String(row.delivery_address ?? ''), dietaryNotes: String(row.dietary_notes ?? ''),
      message: String(row.message ?? ''), status: ENQUIRY_STATUSES.includes(status) ? status : 'New',
      adminNotes: String(row.admin_notes ?? ''), createdAt: String(row.created_at ?? ''),
      notificationSent: row.notification_sent === undefined ? null : row.notification_sent === true,
      notificationError: typeof row.notification_error === 'string' && row.notification_error ? row.notification_error : null,
    };
  });
};

export const updateCateringEnquiry = async (id: string, patch: { status?: CateringEnquiryStatus; adminNotes?: string }): Promise<void> => {
  const { error } = await client().from('catering_enquiries').update({
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.adminNotes !== undefined ? { admin_notes: patch.adminNotes.slice(0, 2000) } : {}),
  }).eq('id', id);
  if (error) fail(error);
};

// ── Origin verification (admin JWT → check-delivery originLookup) ───────────

export async function verifyOriginLocation(address: string, suburb = ''): Promise<{ lat: number; lng: number; formattedAddress: string }> {
  const { data: { session } } = await client().auth.getSession();
  const functionsUrl = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')}/functions/v1`;
  const response = await fetch(`${functionsUrl}/check-delivery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ originLookup: true, address, suburb }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error || 'Address lookup failed.');
  return payload as { lat: number; lng: number; formattedAddress: string };
}

// ── Catering categories (admin-managed) ──
export interface CateringCategory { id: string; name: string; description: string; active: boolean; displayOrder: number }

export const getCateringCategories = async (): Promise<CateringCategory[]> => {
  const { data, error } = await client().from('catering_categories').select('id,name,description,active,display_order').order('display_order').order('name');
  if (error) {
    if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205') return [];
    fail(error);
  }
  return ((data ?? []) as unknown as Row[]).map(row => ({ id: String(row.id), name: String(row.name), description: String(row.description ?? ''), active: row.active !== false, displayOrder: Number(row.display_order ?? 0) }));
};
export const createCateringCategory = async (name: string, description = '') => {
  const { error } = await client().from('catering_categories').insert({ name: name.trim(), description: description.trim(), active: true, display_order: 999 });
  if (error) fail(error);
};
export const updateCateringCategory = async (id: string, patch: Partial<Pick<CateringCategory, 'name' | 'description' | 'active' | 'displayOrder'>>) => {
  const { error } = await client().from('catering_categories').update({
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
    ...(patch.displayOrder !== undefined ? { display_order: patch.displayOrder } : {}),
  }).eq('id', id);
  if (error) fail(error);
};
export const deleteCateringCategory = async (id: string) => {
  const { error } = await client().from('catering_categories').delete().eq('id', id);
  if (error) fail(error);
};

// ── Full catering product editing (fields beyond the flags) ──
// The products table already carries description/image/dietary/ingredients/
// internal notes/display order — these expose them for catering management.
export interface CateringProductFields {
  name?: string;
  description?: string;
  imageUrl?: string | null;
  categoryId?: string | null;
  unit?: string | null;
  servesMin?: number | null;
  servesMax?: number | null;
  displayOrder?: number;
  vegetarian?: boolean;
  vegan?: boolean;
  halal?: boolean;
  glutenFree?: boolean;
  ingredients?: string[];
  allergens?: string[];
  gallery?: string[];
  internalNotes?: string;
}

export const updateCateringProductFields = async (id: string, fields: CateringProductFields): Promise<void> => {
  if (fields.name !== undefined && fields.name.trim().length < 2) throw new Error('Product name is required.');
  const { error } = await client().from('products').update({
    ...(fields.name !== undefined ? { name: fields.name.trim() } : {}),
    ...(fields.description !== undefined ? { description: fields.description.trim() } : {}),
    ...(fields.imageUrl !== undefined ? { image_url: fields.imageUrl } : {}),
    ...(fields.categoryId !== undefined ? { catering_category_id: fields.categoryId } : {}),
    ...(fields.unit !== undefined ? { catering_unit: fields.unit } : {}),
    ...(fields.servesMin !== undefined ? { catering_serves_min: fields.servesMin } : {}),
    ...(fields.servesMax !== undefined ? { catering_serves_max: fields.servesMax } : {}),
    ...(fields.displayOrder !== undefined ? { display_order: fields.displayOrder } : {}),
    ...(fields.vegetarian !== undefined ? { vegetarian: fields.vegetarian } : {}),
    ...(fields.vegan !== undefined ? { vegan: fields.vegan } : {}),
    ...(fields.halal !== undefined ? { halal: fields.halal } : {}),
    ...(fields.glutenFree !== undefined ? { gluten_free: fields.glutenFree } : {}),
    ...(fields.ingredients !== undefined ? { ingredients: fields.ingredients } : {}),
    ...(fields.allergens !== undefined ? { allergens: fields.allergens } : {}),
    ...(fields.gallery !== undefined ? { gallery: fields.gallery } : {}),
    ...(fields.internalNotes !== undefined ? { internal_notes: fields.internalNotes } : {}),
  }).eq('id', id);
  if (error) fail(error);
};

// Create a NEW catering-only product. Created rows are active/available but
// visibility 'hidden' keeps them off the normal restaurant menu; they appear
// on /catering immediately via the catering flags.
export const createCateringOnlyProduct = async (args: { name: string; description: string; price: number; imageUrl?: string | null; categoryId?: string | null; unit?: string | null; servesMin?: number | null; servesMax?: number | null; rawPasta?: boolean }): Promise<string> => {
  if (args.name.trim().length < 2) throw new Error('Product name is required.');
  if (!Number.isFinite(args.price) || args.price < 0) throw new Error('Price must be zero or greater.');
  const { data, error } = await client().from('products').insert({
    name: args.name.trim(),
    description: args.description.trim(),
    price: args.price,
    category: 'Catering',
    image_url: args.imageUrl ?? null,
    catering_category_id: args.categoryId ?? null,
    catering_unit: args.unit ?? null,
    catering_serves_min: args.servesMin ?? null,
    catering_serves_max: args.servesMax ?? null,
    catering_available: !args.rawPasta,
    bulk_available: !args.rawPasta,
    raw_pasta_available: Boolean(args.rawPasta),
    catering_price: args.rawPasta ? null : args.price,
    active: true,
    available: true,
    visibility: 'hidden',
  }).select('id').single();
  if (error) fail(error);
  return String((data as Row).id);
};

// Duplicate an existing product into a catering copy (hidden from the normal
// menu until the owner chooses otherwise).
export const duplicateCateringProduct = async (id: string): Promise<string | null> => {
  const { data, error } = await client().from('products').select('*').eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  const row = data as Row;
  const insert: Row = { ...row, id: undefined, created_at: undefined, updated_at: undefined, name: String(row.name) + ' (copy)', sku: null, visibility: 'hidden' };
  const { data: created, error: insertError } = await client().from('products').insert(insert).select('id').single();
  if (insertError) fail(insertError);
  return String((created as Row).id);
};

// ── Catering orders view (read-only slice of the shared orders model) ──
export interface CateringOrderRow {
  id: string; orderNumber: string; createdAt: string; customer: string; phone: string; email: string;
  status: string; total: number; subtotal: number; deliveryFee: number; serviceCharge: number;
  fulfilment: string; address: string; distanceKm: number | null; eventDate: string | null; guestCount: number | null;
  notes: string; items: string;
}

export const getCateringOrders = async (limit = 100): Promise<CateringOrderRow[]> => {
  const { data, error } = await client()
    .from('orders')
    .select('id,order_number,created_at,customer_name,customer_phone,customer_email,status,total,subtotal,delivery_fee,service_charge,fulfilment_method,delivery_address,delivery_suburb,delivery_postcode,delivery_distance_km,event_date,guest_count,special_instructions,order_items(product_name,quantity,line_type)')
    .eq('order_type', 'Catering')
    .neq('status', 'Draft')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204') return [];
    fail(error);
  }
  return ((data ?? []) as unknown as Row[]).map(row => {
    const items = (Array.isArray(row.order_items) ? row.order_items : []) as Row[];
    return {
      id: String(row.id), orderNumber: String(row.order_number), createdAt: String(row.created_at),
      customer: String(row.customer_name), phone: String(row.customer_phone ?? ''), email: String(row.customer_email ?? ''),
      status: String(row.status ?? 'New'), total: Number(row.total ?? 0), subtotal: Number(row.subtotal ?? 0),
      deliveryFee: Number(row.delivery_fee ?? 0), serviceCharge: Number(row.service_charge ?? 0),
      fulfilment: String(row.fulfilment_method ?? 'Pickup'),
      address: [row.delivery_address, row.delivery_suburb, row.delivery_postcode].filter(Boolean).join(', '),
      distanceKm: row.delivery_distance_km == null ? null : Number(row.delivery_distance_km),
      eventDate: row.event_date ? String(row.event_date) : null,
      guestCount: row.guest_count == null ? null : Number(row.guest_count),
      notes: String(row.special_instructions ?? ''),
      items: items.map(item => `${item.quantity}x ${item.product_name}${item.line_type === 'raw_pasta' ? ' (raw)' : ''}`).join('; '),
    };
  });
};
