// Deploy with: supabase functions deploy create-cash-order
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   (no Stripe secrets — no payment is taken for cash orders)
//
// Cash-on-pickup ordering for the on-page checkout. The customer places the
// order on viziofood.com and pays in person when collecting; no PaymentIntent
// is created and the Stripe flow is untouched.
//
// The order row is byte-for-byte the shape the stripe-webhook writes
// (same columns, same charge math as create-payment-intent, same pause gate),
// with payment_status = 'cash_on_pickup' so admin and the kitchen display can
// show that the customer pays cash. Orders RLS has no public insert policy,
// which is why this runs server-side with the service role key.
//
// PRICING IS AUTHORITATIVE: every item and modifier is re-priced from the
// products/modifiers tables — client-sent prices are never trusted, so a
// tampered cart cannot create an underpriced cash order. Items that cannot be
// verified (unknown product, or a product that was archived/sold out after it
// was added) reject the whole order with a customer-safe message.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface ClientModifier { id: string; name: string; price: number; priceMode?: 'adjustment' | 'override' }
interface CartItem {
  productId: string; name: string; price: number; quantity: number;
  modifiers: ClientModifier[]; instructions: string;
  combo?: { groupId: string; groupName?: string; productId: string; upgrade?: number }[] | null;
}
interface Cart { items: CartItem[]; fulfilment: string; orderMode?: string; pickupAt?: string | null; coupon?: string | null }
interface Customer { name: string; email: string; phone: string; notes?: string }

// A cart line after server-side re-pricing: only trusted values remain.
interface PricedItem {
  productId: string; name: string; price: number; quantity: number; category: string;
  modifiers: ClientModifier[]; instructions: string;
  comboSelections: { groupId: string; groupName: string; productId: string; productName: string; upgrade: number }[];
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[0-89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const clip = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

// ── Coupons: identical resolution to create-payment-intent (copied — Edge
// functions cannot share modules), mirroring the ADMIN system's semantics
// (kind/value with legacy fallback, window, usage_limit vs times_used,
// minimum_order, product/category scoping). Same table, same rules, so a
// coupon can never produce different totals for card vs cash. ──
interface CouponLine { productId: string; category: string; amountCents: number }
interface ResolvedCoupon { code: string; discountCents: number }
interface CouponResolution { coupon?: ResolvedCoupon; reason?: 'invalid' | 'expired' | 'inactive' | 'minimum' | 'not_available' }
const resolveCoupon = async (rawCode: unknown, lines: CouponLine[], subtotalCents: number): Promise<CouponResolution> => {
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!code) return {};
  const { data } = await db.from('coupons')
    .select('code,kind,value,minimum_order,product_ids,category_names,starts_at,ends_at,usage_limit,times_used,active,percentage_off,amount_off,expires_at')
    .in('code', [code, code.toUpperCase()])
    .limit(1);
  const row = data && data[0];
  if (!row) return { reason: 'invalid' };
  if (row.active === false) return { reason: 'inactive' };
  const now = Date.now();
  if (row.starts_at && now < Date.parse(String(row.starts_at))) return { reason: 'inactive' };
  const endsAt = row.ends_at ?? row.expires_at;
  if (endsAt && now > Date.parse(String(endsAt))) return { reason: 'expired' };
  if (row.usage_limit != null && Number(row.times_used ?? 0) >= Number(row.usage_limit)) return { reason: 'inactive' };
  if (subtotalCents < Math.round(Number(row.minimum_order ?? 0) * 100)) return { reason: 'minimum' };
  let kind = row.kind == null ? null : String(row.kind);
  let value = row.value == null ? null : Number(row.value);
  if (kind == null || value == null || !(value > 0)) {
    const pct = row.percentage_off == null ? null : Number(row.percentage_off);
    kind = pct != null && pct > 0 ? 'percent' : 'fixed';
    value = pct != null && pct > 0 ? pct : Number(row.amount_off ?? 0);
  }
  if (!(value > 0)) return { reason: 'invalid' };
  const productIds: string[] = Array.isArray(row.product_ids) ? row.product_ids.map(String) : [];
  const categoryNames: string[] = Array.isArray(row.category_names) ? row.category_names.map(String) : [];
  let basisCents = subtotalCents;
  if (productIds.length || categoryNames.length) {
    basisCents = lines
      .filter(line =>
        (productIds.length === 0 || (line.productId && productIds.includes(line.productId))) &&
        (categoryNames.length === 0 || categoryNames.some(name => name.toLowerCase() === line.category.toLowerCase())))
      .reduce((sum, line) => sum + line.amountCents, 0);
    if (basisCents <= 0) return { reason: 'not_available' };
  }
  const raw = kind === 'percent'
    ? Math.round(basisCents * value / 100)
    : Math.min(Math.round(value * 100), basisCents);
  const discountCents = Math.max(0, Math.min(raw, subtotalCents));
  if (discountCents <= 0) return { reason: 'invalid' };
  return { coupon: { code: String(row.code), discountCents } };
};
const time12 = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // String concatenation throughout this file: the platform bundler's
  // parser is unreliable with template literals here.
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    + ', '
    + date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
};

// Re-prices the cart from the database. Returns either { items } with
// authoritative prices/names, or { error } when a line can't be verified.
const priceCart = async (cartItems: CartItem[]): Promise<{ items: PricedItem[] } | { error: string }> => {
  // Junk filter first: shape, finite quantity (1–99), capped free text.
  const candidates = cartItems
    .filter((item) => item && typeof item.productId === 'string' && Number.isFinite(item.quantity) && item.quantity > 0)
    .map((item) => ({
      productId: item.productId,
      name: clip(item.name, 160),
      price: Number(item.price) || 0, // display fallback only — replaced below
      quantity: Math.min(Math.round(item.quantity), 99),
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      instructions: clip(item.instructions, 500),
      combo: Array.isArray(item.combo) ? item.combo : null,
    }));
  if (!candidates.length) return { error: 'Your cart is empty.' };
  if (candidates.some((item) => !isUuid(item.productId))) {
    return { error: 'Your cart contains an item we can\u2019t verify. Please refresh the page and try again.' };
  }

  const productIds = [...new Set(candidates.map((item) => item.productId))];
  const modifierIds = [...new Set(candidates.flatMap((item) => item.modifiers.map((m) => String(m?.id ?? '')).filter(isUuid)))];
  const [productsResult, modifiersResult] = await Promise.all([
    db.from('products').select('id,name,price,category,is_combo,active,available,archived_at').in('id', productIds),
    modifierIds.length
      ? db.from('modifiers').select('id,name,price,pricing_mode,active').in('id', modifierIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (modifiersResult.error) throw modifiersResult.error;

  const products = new Map((productsResult.data ?? []).map((row) => [String(row.id), row]));
  const modifiers = new Map((modifiersResult.data ?? []).map((row) => [String(row.id), row]));

  const priced: PricedItem[] = [];
  for (const item of candidates) {
    const product = products.get(item.productId);
    // The product must still be on the saleable menu — price, name and
    // availability all come from the database, never the browser.
    if (!product || product.active === false || product.available === false || product.archived_at) {
      const label = item.name || 'An item in your cart';
      return { error: label + ' is no longer available. Please refresh your cart and try again.' };
    }
    // Modifiers the admin has since deactivated are dropped; known ones are
    // re-priced from the database with their current names.
    const resolvedModifiers = item.modifiers
      .map((modifier) => (isUuid(String(modifier?.id ?? '')) ? modifiers.get(String(modifier.id)) : null))
      .filter((row): row is { id: string; name: string; price: number; pricing_mode?: string; active: boolean } =>
        Boolean(row && row.active !== false))
      .map((row) => ({ id: String(row.id), name: String(row.name), price: Number(row.price), priceMode: row.pricing_mode === 'override' ? 'override' as const : 'adjustment' as const }));
    let comboUnit = Number(product.price);
    const comboSelections: { groupId: string; groupName: string; productId: string; productName: string; upgrade: number }[] = [];
    if (product.is_combo === true) {
      // Identical rule to create-payment-intent: every claimed choice must
      // match a DB combo_option; price 0 = included, >0 = upgrade; the
      // child's standalone price is never added.
      const [groupsResult, optionsResult] = await Promise.all([
        db.from('combo_groups').select('id,name,min_selections,max_selections').eq('product_id', item.productId).eq('active', true).order('display_order'),
        db.from('combo_options').select('group_id,product_id,price,products!inner(id,name,active,available,archived_at)').order('display_order'),
      ]);
      if (groupsResult.error) throw groupsResult.error;
      if (optionsResult.error) throw optionsResult.error;
      const optionPrice = new Map<string, Map<string, number>>();
      const optionName = new Map<string, string>();
      for (const row of optionsResult.data ?? []) {
        const child = (row.products ?? null) as unknown as { id: string; name: string; active: boolean; available: boolean; archived_at: string | null } | null;
        if (!row.group_id || !child?.id || child.active === false || child.available === false || child.archived_at) continue;
        const groupId = String(row.group_id);
        const childId = String(child.id);
        const group = optionPrice.get(groupId) ?? new Map<string, number>();
        group.set(childId, Number(row.price ?? 0));
        optionPrice.set(groupId, group);
        optionName.set(groupId + ':' + childId, String(child.name ?? childId));
      }
      const claimed = Array.isArray(item.combo) ? item.combo : [];
      for (const selection of claimed) {
        const groupId = String(selection?.groupId ?? '');
        const childId = String(selection?.productId ?? '');
        const group = (groupsResult.data ?? []).find(g => String(g.id) === groupId);
        const upgrade = group ? (optionPrice.get(groupId)?.get(childId)) : undefined;
        if (!group || upgrade === undefined) throw new Error('Invalid combo selection.');
        comboUnit += upgrade;
        comboSelections.push({ groupId, groupName: String(group.name), productId: childId, productName: optionName.get(groupId + ':' + childId) ?? childId, upgrade });
      }
      for (const group of groupsResult.data ?? []) {
        const chosen = comboSelections.filter(sel => sel.groupId === String(group.id)).length;
        if (Number(group.min_selections ?? 1) > 0 && chosen < Number(group.min_selections ?? 1)) {
          throw new Error('Please complete all required combo choices.');
        }
        const maxSelections = Number((group as { max_selections?: number }).max_selections ?? 1);
        if (maxSelections > 0 && chosen > maxSelections) {
          throw new Error('Too many choices in ' + String(group.name) + '.');
        }
      }
    }
    priced.push({
      productId: item.productId,
      name: String(product.name ?? item.name),
      price: comboUnit,
      quantity: item.quantity,
      category: String(product.category ?? ''),
      modifiers: [...comboSelections.map(sel => ({ id: sel.groupId, name: sel.groupName + ': ' + sel.productName, price: sel.upgrade, priceMode: 'adjustment' as const })), ...resolvedModifiers],
      instructions: item.instructions,
      comboSelections,
    });
  }
  return { items: priced };
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { cart, customer } = await request.json() as { cart?: Cart; customer?: Customer };
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      return json({ error: 'A cart with items is required.' }, 400);
    }
    const name = clip(customer?.name, 120);
    const phone = clip(customer?.phone, 40);
    const email = clip(customer?.email, 254);
    if (!name || !phone || !email) {
      return json({ error: 'Your name, phone and email are required to place the order.' }, 400);
    }

    // Pause gate + charge rates, identical to create-payment-intent. Before
    // the 20260821 migration runs, service_charge/card_processing_fee may not
    // exist as columns — fall back with those rates at 0.
    const settingsQuery = (columns: string) =>
      db.from('restaurant_settings').select(columns).order('created_at').limit(1).maybeSingle();
    let { data: settings, error: settingsError } = await settingsQuery(
      'orders_enabled, order_pause_message, delivery_fee, tax_rate, service_charge, card_processing_fee',
    );
    if (settingsError) {
      const legacy = await settingsQuery('orders_enabled, order_pause_message, delivery_fee, tax_rate');
      settings = { ...legacy.data, service_charge: 0, card_processing_fee: 0 };
    }
    if (settings && settings.orders_enabled === false) {
      return json({
        error: 'Online orders are currently paused.',
        paused: true,
        pauseMessage: settings.order_pause_message || 'Online ordering is temporarily paused. Please check back soon.',
      }, 409);
    }

    const priced = await priceCart(cart.items);
    if ('error' in priced) return json({ error: priced.error }, 400);
    const items = priced.items;

    // Integer-cent arithmetic mirrors src/cart.ts totals() and
    // create-payment-intent exactly, now on database-verified prices. The
    // coupon resolves identically to the Stripe path (discount off the
    // goods subtotal first; service/tax on the discounted base). Cash
    // orders never carry the card processing fee — nobody is paying by
    // card.
    const itemUnitCents = items.map((item) => {
      // Effective unit price — mirrors effectiveUnitPrice in src/cart.ts:
      // adjustments add to the DB product base; an override replaces it.
      let unit = item.price;
      for (const modifier of item.modifiers) {
        // Selection lines are informational (their upgrade already sits in
        // item.price); extras add as adjustments.
        if (modifier.priceMode === 'override') { if (modifier.price > 0) unit = modifier.price; }
        else unit += modifier.price;
      }
      return Math.round(Math.max(0, unit) * 100);
    });
    const subtotalCents = itemUnitCents.reduce((sum, cents, index) => sum + cents * items[index].quantity, 0);
    const couponLines: CouponLine[] = items.map((item, index) => ({
      productId: item.productId,
      category: item.category,
      amountCents: itemUnitCents[index] * item.quantity,
    }));
    const resolvedCoupon = await resolveCoupon(cart.coupon, couponLines, subtotalCents);
    const coupon = resolvedCoupon.coupon;
    const discountCents = coupon ? coupon.discountCents : 0;
    const baseCents = subtotalCents - discountCents;
    const deliveryCents = cart.fulfilment === 'Delivery' ? Math.round(Number(settings?.delivery_fee ?? 0) * 100) : 0;
    const serviceCents = Math.round(baseCents * Number(settings?.service_charge ?? 0) / 100);
    const taxCents = Math.round(baseCents * Number(settings?.tax_rate ?? 0) / 100);
    const totalCents = baseCents + serviceCents + taxCents + deliveryCents;
    if (totalCents <= 0) return json({ error: 'Your cart total must be greater than zero.' }, 400);
    const couponNote = coupon && discountCents > 0
      ? 'Coupon ' + coupon.code + ' — discount $' + (discountCents / 100).toFixed(2)
      : '';

    // Duplicate-submit guard: the browser disables the button while busy, but
    // a timeout-then-retry could otherwise land the same cash order twice.
    // If an identical cash order (same phone, total and item count) was
    // created within the last 90 seconds, return it instead of inserting
    // again — idempotent from the customer's point of view. The webhook gets
    // this for free via its stripe_payment_intent idempotency lookup; this
    // is the cash equivalent, using only existing columns. A genuinely
    // identical repeat order inside 90s is indistinguishable from a retry;
    // cash settles at the counter either way.
    const duplicateWindowStart = new Date(Date.now() - 90_000).toISOString();
    const itemsCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const { data: existing } = await db.from('orders')
      .select('id, order_number')
      .eq('payment_status', 'cash_on_pickup')
      .eq('customer_phone', phone)
      .eq('total', totalCents / 100)
      .eq('items_count', itemsCount)
      .gte('created_at', duplicateWindowStart)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return json({ orderId: existing.id, orderNumber: existing.order_number, duplicate: true });

    // Pickup timing is recorded on the order note, exactly where the Stripe
    // flow records it — the kitchen sees one consistent format either way.
    const dineIn = cart.fulfilment === 'Dine-in';
    const pickupNote = cart.pickupAt
      ? 'Scheduled ' + (dineIn ? 'dine-in: ' : 'pickup: ') + time12(cart.pickupAt)
      : dineIn ? 'Dine-in order' : 'Pickup: as soon as it\u2019s ready';
    const trimmedNotes = clip(customer?.notes, 1000);
    const orderNote = trimmedNotes ? 'Order note: ' + trimmedNotes : '';

    // Historical databases before the 20260821 charge-breakdown columns
    // retry without them, exactly like the webhook does.
    const insertOrder = (breakdown: boolean) =>
      db.from('orders').insert({
        payment_status: 'cash_on_pickup',
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        total: totalCents / 100,
        ...(breakdown
          ? {
              subtotal: baseCents / 100,
              tax_total: taxCents / 100,
              delivery_fee: deliveryCents / 100,
              service_charge: serviceCents / 100,
              card_processing_fee: 0,
            }
          : { tax_total: taxCents / 100 }),
        // fulfilment_method now exists on the live table (re-added by the
        // admin platform migration, default 'Pickup'); the 42703 retry below
        // still covers databases without it. 'Dine-in' requires the
        // 20260829 CHECK migration to be applied first.
        fulfilment_method: cart.fulfilment === 'Dine-in' ? 'Dine-in' : cart.fulfilment === 'Delivery' ? 'Delivery' : 'Pickup',
        special_instructions: [
          pickupNote,
          couponNote,
          orderNote,
          ...items.map((item) => (item.instructions ? item.name + ': ' + item.instructions : '')).filter(Boolean),
        ].filter(Boolean).join('\n'),
        items_count: itemsCount,
        status: 'New',
      }).select('id, order_number').single();
    let result = await insertOrder(true);
    if (result.error?.code === '42703') result = await insertOrder(false);
    if (result.error) throw result.error;
    const row = result.data;

    const itemRows = items.map((item) => ({
      order_id: row.id,
      product_id: item.productId,
      product_name: item.name,
      unit_price: item.price,
      quantity: item.quantity,
      modifiers: item.modifiers,
      combo_selections: item.comboSelections?.length ? item.comboSelections : null,
      special_instructions: item.instructions,
    }));
    const { error: itemError } = await db.from('order_items').insert(itemRows);
    if (itemError) throw itemError;
    await db.from('order_status_history').insert({ order_id: row.id, status: 'New' });

    // Redemption counting expected by the admin model: times_used advances
    // only once an order actually exists (this path is reached solely after
    // a successful insert; duplicate submissions return early above).
    if (coupon && discountCents > 0) {
      try {
        const { data: used } = await db.from('coupons').select('times_used').eq('code', coupon.code).limit(1).maybeSingle();
        if (used) await db.from('coupons').update({ times_used: Number(used.times_used ?? 0) + 1 }).eq('code', coupon.code);
      } catch (error) { console.error('coupon times_used increment failed:', error); }
    }

    return json({ orderId: row.id, orderNumber: row.order_number });
  } catch (error) {
    console.error('create-cash-order failed:', error);
    return json({ error: 'We couldn\u2019t place your order. Please try again.' }, 500);
  }
});
