// Deploy with: supabase functions deploy create-checkout
// Required secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Order-first checkout: the order and its items are persisted to Supabase
// BEFORE the Stripe session is created, so the session metadata only needs
// to carry the order UUID. Stripe caps metadata values at 500 characters —
// the previous flow stored the whole cart JSON in metadata and failed on
// large carts. Items, modifiers and instructions live in order_items, never
// in Stripe metadata.
import Stripe from 'https://esm.sh/stripe@15.12.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

// ── Server-authoritative cart pricing ──
// The browser's prices are NEVER trusted for the charged amount. Products,
// modifier prices AND pricing modes, combo definitions and combo upgrade
// prices all come from the database, mirroring src/lib/money.ts exactly:
//   unit = product.price + Σ combo upgrades + modifiers (override replaces)
// A combo choice is valid only when the child product is EXPLICITLY
// configured as an eligible option of that group (price 0 = included,
// >0 = one-off upgrade) — the child's standalone price is never added.
// Inherited extras are validated against the selected child product: each
// modifier must belong to an active modifier group actually assigned to the
// product the customer selected. Anything else rejects the order.
interface PricedModifier { id: string; name: string; price: number; priceMode: 'adjustment' | 'override' }
interface PricedComboSelection { groupId: string; groupName: string; productId: string; productName: string; upgrade: number }
interface PricedLine {
  unitCents: number;
  name: string;
  isCombo: boolean;
  comboSelections: PricedComboSelection[];
  modifiers: PricedModifier[];
}

const repriceCart = async (
  items: {
    productId?: unknown;
    name?: unknown;
    quantity?: unknown;
    modifiers?: { id?: unknown }[];
    combo?: { groupId?: unknown; productId?: unknown }[] | null;
  }[],
): Promise<{ lines?: PricedLine[]; error?: string }> => {
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || Number(item.quantity) < 1) {
      return { error: 'Invalid item quantity in the cart.' };
    }
  }

  const uuids = items.map((item) => String(item.productId ?? '')).filter(isUuid);
  const productsResult = await db
    .from('products')
    .select('id,name,price,is_combo,active,available,archived_at,visibility')
    .in('id', uuids);
  if (productsResult.error) throw productsResult.error;
  const products = new Map(
    (productsResult.data ?? []).map((row) => [String(row.id), row]),
  );

  const modifierIds = [...new Set(
    items.flatMap((item) => (Array.isArray(item.modifiers) ? item.modifiers : []).map((m) => String(m?.id ?? ''))).filter(isUuid),
  )];
  const modifiersResult = modifierIds.length
    ? await db.from('modifiers').select('id,group_id,name,price,pricing_mode,active').in('id', modifierIds)
    : { data: [] as Record<string, unknown>[], error: null as unknown };
  if (modifiersResult.error) throw modifiersResult.error;
  const modifiers = new Map(
    (modifiersResult.data ?? []).map((row) => [String(row.id), row]),
  );

  // Combo definitions for every combo product in the cart.
  const comboIds = items.map((item) => String(item.productId ?? '')).filter((id) => products.get(id)?.is_combo === true);
  const comboGroupsByProduct = new Map<string, { id: string; name: string; minSelections: number; maxSelections: number }[]>();
  const comboOptionsByGroup = new Map<string, Map<string, number>>(); // groupId → childId → upgrade price
  const comboChildNames = new Map<string, string>();
  const comboInheritExtras = new Set<string>();
  if (comboIds.length) {
    const [groupsResult, optionsResult] = await Promise.all([
      db.from('combo_groups').select('id,product_id,name,min_selections,max_selections,inherit_extras,active').in('product_id', comboIds).eq('active', true).order('display_order'),
      db.from('combo_options').select('id,group_id,product_id,price,products!inner(id,name,active,available,archived_at)').order('display_order'),
    ]);
    if (groupsResult.error) throw groupsResult.error;
    if (optionsResult.error) throw optionsResult.error;
    for (const row of groupsResult.data ?? []) {
      const list = comboGroupsByProduct.get(String(row.product_id)) ?? [];
      list.push({ id: String(row.id), name: String(row.name), minSelections: Number(row.min_selections ?? 1), maxSelections: Number(row.max_selections ?? 1) });
      comboGroupsByProduct.set(String(row.product_id), list);
      if (row.inherit_extras === true) comboInheritExtras.add(String(row.id));
    }
    for (const row of optionsResult.data ?? []) {
      const child = (row.products ?? null) as unknown as { id: string; name: string; active: boolean; available: boolean; archived_at: string | null } | null;
      if (!row.group_id || !child?.id || child.active === false || child.available === false || child.archived_at) continue;
      const group = comboOptionsByGroup.get(String(row.group_id)) ?? new Map<string, number>();
      group.set(String(child.id), Number(row.price ?? 0));
      comboOptionsByGroup.set(String(row.group_id), group);
      comboChildNames.set(String(child.id), String(child.name));
    }
  }

  // Modifier-group assignments for the products (and selected combo
  // children) whose extras are allowed — a modifier is chargeable only via
  // an active group assigned to the product the customer actually chose.
  const extraHostIds = new Set<string>();
  for (const item of items) {
    const id = String(item.productId ?? '');
    const product = products.get(id);
    if (!product) continue;
    if (product.is_combo === true) {
      for (const group of comboGroupsByProduct.get(id) ?? []) {
        if (!comboInheritExtras.has(group.id)) continue;
        const claimed = (Array.isArray(item.combo) ? item.combo : []).filter((selection) => String(selection?.groupId ?? '') === group.id);
        for (const selection of claimed) extraHostIds.add(String(selection?.productId ?? ''));
      }
    } else {
      extraHostIds.add(id);
    }
  }
  const linksResult = extraHostIds.size
    ? await db.from('product_modifier_groups').select('product_id,group_id,modifier_groups!inner(id,active)').in('product_id', [...extraHostIds])
    : { data: [] as Record<string, unknown>[], error: null as unknown };
  if (linksResult.error) throw linksResult.error;
  const groupsByProduct = new Map<string, Set<string>>();
  for (const row of linksResult.data ?? []) {
    const group = (row.modifier_groups ?? null) as unknown as { id: string; active: boolean } | null;
    if (!row.product_id || !group?.id || group.active === false) continue;
    const set = groupsByProduct.get(String(row.product_id)) ?? new Set<string>();
    set.add(String(group.id));
    groupsByProduct.set(String(row.product_id), set);
  }

  const lines: PricedLine[] = [];
  for (const item of items) {
    const id = String(item.productId ?? '');
    const product = products.get(id);
    const label = String(item.name ?? 'An item in your cart');
    if (!product || product.active === false || product.available === false || product.archived_at || product.visibility !== 'public') {
      return { error: `${label} is no longer available. Please refresh your cart and try again.` };
    }
    let unit = Number(product.price);
    const resolved: PricedModifier[] = [];
    const comboSelections: PricedComboSelection[] = [];

    if (product.is_combo === true) {
      const groups = comboGroupsByProduct.get(id) ?? [];
      const claimed = Array.isArray(item.combo) ? item.combo : [];
      for (const selection of claimed) {
        const groupId = String(selection?.groupId ?? '');
        const childId = String(selection?.productId ?? '');
        const group = groups.find((candidate) => candidate.id === groupId);
        const upgrade = group ? comboOptionsByGroup.get(groupId)?.get(childId) : undefined;
        if (!group || upgrade === undefined) {
          return { error: `${label} includes a choice that is not available in this combo. Please rebuild your combo.` };
        }
        comboSelections.push({
          groupId,
          groupName: group.name,
          productId: childId,
          productName: comboChildNames.get(childId) ?? String(products.get(childId)?.name ?? childId),
          upgrade: Math.round(upgrade * 100) / 100,
        });
        unit += upgrade;
      }
      for (const group of groups) {
        const chosen = comboSelections.filter((selection) => selection.groupId === group.id).length;
        if (group.minSelections > 0 && chosen < group.minSelections) {
          return { error: `Please complete all required choices in ${String(product.name ?? label)}.` };
        }
        if (group.maxSelections > 0 && chosen > group.maxSelections) {
          return { error: `${label} allows up to ${group.maxSelections} choice${group.maxSelections === 1 ? '' : 's'} in ${group.name}.` };
        }
      }
    }

    // Extras: for a combo, only children selected in inheritExtras groups
    // expose their modifiers; for a normal product, the product itself.
    const hosts = new Set<string>();
    if (product.is_combo === true) {
      for (const group of comboGroupsByProduct.get(id) ?? []) {
        if (!comboInheritExtras.has(group.id)) continue;
        for (const selection of comboSelections) {
          if (selection.groupId === group.id) hosts.add(selection.productId);
        }
      }
    } else {
      hosts.add(id);
    }
    const hostGroups = new Set<string>();
    for (const host of hosts) {
      for (const groupId of groupsByProduct.get(host) ?? []) hostGroups.add(groupId);
    }

    for (const modifier of Array.isArray(item.modifiers) ? item.modifiers : []) {
      const modifierId = String(modifier?.id ?? '');
      const row = isUuid(modifierId) ? modifiers.get(modifierId) : undefined;
      if (!row || row.active === false) {
        return { error: `${label} includes an option that is no longer available. Please remove it and try again.` };
      }
      if (!hostGroups.has(String(row.group_id))) {
        return { error: `${label} includes an option that is not available for this selection. Please rebuild the item.` };
      }
      const priceMode = row.pricing_mode === 'override' ? 'override' as const : 'adjustment' as const;
      const price = Number(row.price);
      if (priceMode === 'override') { if (price > 0) unit = price; } else unit += price;
      resolved.push({ id: modifierId, name: String(row.name), price, priceMode });
    }

    // Combo selections render as flat zero/upgrade-price modifier lines for
    // kitchen and receipts, and stay queryable in combo_selections.
    lines.push({
      unitCents: Math.round(Math.max(0, unit) * 100),
      name: String(product.name ?? label),
      isCombo: product.is_combo === true,
      comboSelections,
      modifiers: [
        ...comboSelections.map((selection) => ({ id: selection.groupId, name: `${selection.groupName}: ${selection.productName}`, price: selection.upgrade, priceMode: 'adjustment' as const })),
        ...resolved,
      ],
    });
  }
  return { lines };
};

// CORS: the live site plus the Vite dev server (local development calls
// this deployed function via VITE_STRIPE_CHECKOUT_ENDPOINT). The caller's
// origin is echoed only when allow-listed; otherwise the site origin is
// returned, so access is never broadened to arbitrary origins.
const ALLOWED_ORIGINS = new Set([
  'https://viziofood.com',
  'http://localhost:5173',
]);
const corsHeaders = (request: Request): Record<string, string> => {
  const origin = request.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin)
      ? origin
      : 'https://viziofood.com',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
};

Deno.serve(async (request: Request) => {
  // Preflight is answered before any business logic runs.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  try {
    // ── Check if ordering is enabled (server-side enforcement) ──
    // Deterministic ordering (created_at, id) resolves the singleton row the
    // same way the admin panel and the public site do. Before the 20260821
    // migration runs, service_charge/card_processing_fee may not exist as
    // columns — fall back to the legacy list with those rates at 0 so
    // checkout keeps working.
    const settingsQuery = (columns: string) =>
      db
        .from('restaurant_settings')
        .select(columns)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

    let { data: settings, error: settingsError } = await settingsQuery(
      'orders_enabled, order_pause_message, delivery_fee, tax_rate, service_charge, card_processing_fee, pickup_enabled, delivery_enabled',
    );
    if (settingsError?.code === '42703') {
      const legacy = await settingsQuery(
        'orders_enabled, order_pause_message, delivery_fee, tax_rate',
      );
      settings = { ...legacy.data, service_charge: 0, card_processing_fee: 0, pickup_enabled: true, delivery_enabled: true };
      settingsError = legacy.error;
    }

    if (settingsError) {
      console.error('Settings fetch error:', settingsError);
      return Response.json(
        { error: 'Unable to verify order settings.' },
        { status: 500, headers: corsHeaders(request) },
      );
    }

    if (!settings || !settings.orders_enabled) {
      const message =
        settings?.order_pause_message?.trim() ||
        'Online ordering is currently paused.';
      return Response.json(
        { error: message },
        { status: 409, headers: corsHeaders(request) },
      );
    }

    // ── Validate the payload ──
    const { cart, customer, successUrl, cancelUrl } = await request.json();
    if (
      !cart || !Array.isArray(cart.items) || cart.items.length === 0 ||
      !customer?.name || !customer?.email
    ) {
      return Response.json(
        { error: 'A cart with items and customer details is required.' },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    // ── Server-authoritative item pricing ──
    // Every line is re-priced from the database (products, modifiers with
    // pricing modes, combo definitions and upgrades); the client's prices
    // are never trusted for the charged amount or the stored order rows.
    // Integer-cent arithmetic mirrors src/lib/money.ts totals() exactly, so
    // the Stripe charge, the stored order total and the checkout page total
    // are identical by construction. All rates come from restaurant_settings
    // (Admin → Settings → Delivery & Charges) — nothing is hardcoded here.
    // Formula (each component rounded to cents independently):
    //   service  = round(subtotal × serviceCharge%)
    //   tax      = round(subtotal × tax%)           (tax basis: subtotal)
    //   delivery = fixed fee, Delivery orders only
    //   card fee = round((subtotal + service + tax + delivery) × cardFee%)
    //              — base excludes the fee itself, so there is no circular
    //              calculation
    //   total    = subtotal + service + tax + delivery + card fee
    const repriced = await repriceCart(cart.items);
    if (repriced.error) {
      return Response.json(
        { error: repriced.error },
        { status: 400, headers: corsHeaders(request) },
      );
    }
    const lines = repriced.lines ?? [];
    const itemUnitCents = lines.map((line) => line.unitCents);
    const subtotalCents = itemUnitCents.reduce(
      (sum: number, cents: number, index: number) =>
        sum + cents * cart.items[index].quantity,
      0,
    );
    const isDelivery = cart.fulfilment === 'Delivery';
    if (!['Pickup', 'Delivery', 'Dine-in'].includes(String(cart.fulfilment ?? 'Pickup'))) {
      return Response.json(
        { error: 'Invalid order type.' },
        { status: 400 },
      );
    }
    if (isDelivery && (!customer.address || String(customer.address).trim().length < 5)) {
      return Response.json(
        { error: 'A delivery address is required for delivery orders.' },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    // ── Coupon validation — ALWAYS server-side. The browser's coupon math is
    //      display-only; this is the authority. Extended columns (kind/value/
    //      minimum_order/windows/usage) arrive with the 20260826 migration;
    //      legacy percentage_off/amount_off columns are the fallback. ──
    let discountCents = 0;
    let couponCode = '';
    if (typeof cart.couponCode === 'string' && cart.couponCode.trim()) {
      const code = cart.couponCode.trim().toUpperCase();
      const { data: coupon, error: couponError } = await db
        .from('coupons')
        .select('id,code,active,kind,value,minimum_order,usage_limit,times_used,starts_at,ends_at,percentage_off,amount_off,expires_at')
        .eq('code', code)
        .maybeSingle();
      if (couponError) {
        console.error('Coupon lookup failed:', couponError);
        return Response.json(
          { error: 'Could not verify the promo code. Please try again.' },
          { status: 500, headers: corsHeaders(request) },
        );
      }
      if (!coupon || coupon.active !== true) {
        return Response.json(
          { error: 'That promo code is not valid.' },
          { status: 400, headers: corsHeaders(request) },
        );
      }
      const now = Date.now();
      const startsAt = coupon.starts_at ?? null;
      const endsAt = coupon.ends_at ?? coupon.expires_at ?? null;
      if (startsAt && now < new Date(startsAt).getTime()) {
        return Response.json({ error: 'That promo code is not active yet.' }, { status: 400, headers: corsHeaders(request) });
      }
      if (endsAt && now > new Date(endsAt).getTime()) {
        return Response.json({ error: 'That promo code has expired.' }, { status: 400, headers: corsHeaders(request) });
      }
      if (typeof coupon.usage_limit === 'number' && (coupon.times_used ?? 0) >= coupon.usage_limit) {
        return Response.json({ error: 'That promo code has reached its usage limit.' }, { status: 400, headers: corsHeaders(request) });
      }
      const minimumCents = Math.round(Number(coupon.minimum_order ?? 0) * 100);
      if (subtotalCents < minimumCents) {
        return Response.json(
          { error: `That code needs a minimum order of $${(minimumCents / 100).toFixed(2)}.` },
          { status: 400, headers: corsHeaders(request) },
        );
      }
      // Same integer-cent discount math as src/lib/money.ts.
      const kind = coupon.kind ?? (Number(coupon.percentage_off) > 0 ? 'percent' : 'fixed');
      const value = Number(coupon.value ?? (kind === 'percent' ? coupon.percentage_off : coupon.amount_off) ?? 0);
      const basis = kind === 'percent' ? subtotalCents : subtotalCents;
      discountCents = kind === 'percent'
        ? Math.round((basis * value) / 100)
        : Math.min(Math.round(value * 100), basis);
      discountCents = Math.min(discountCents, subtotalCents);
      couponCode = code;
    }
    const netSubtotalCents = subtotalCents - discountCents;

    // ── Fulfilment method enforcement (server-side) ──
    // Toggles default to enabled until the migration adds the columns.
    const pickupEnabled = (settings as Record<string, unknown> | null)?.pickup_enabled !== false;
    const deliveryEnabled = (settings as Record<string, unknown> | null)?.delivery_enabled !== false;
    if (!pickupEnabled && !deliveryEnabled) {
      return Response.json(
        { error: 'Online ordering is currently unavailable.' },
        { status: 409, headers: corsHeaders(request) },
      );
    }
    if (isDelivery && !deliveryEnabled) {
      return Response.json(
        { error: 'Delivery is currently unavailable. Please choose pickup.' },
        { status: 409, headers: corsHeaders(request) },
      );
    }
    if (!isDelivery && !pickupEnabled) {
      return Response.json(
        { error: 'Pickup is currently unavailable. Please choose delivery.' },
        { status: 409, headers: corsHeaders(request) },
      );
    }

    const deliveryCents = isDelivery
      ? Math.round(Number(settings?.delivery_fee ?? 0) * 100)
      : 0;
    const taxRatePct = Number(settings?.tax_rate ?? 0);
    const serviceRatePct = Number(settings?.service_charge ?? 0);
    const cardFeeRatePct = Number(settings?.card_processing_fee ?? 0);
    // Charges compound on the DISCOUNTED subtotal (mirrors lib/money.ts).
    const serviceCents = Math.round(netSubtotalCents * serviceRatePct / 100);
    const taxCents = Math.round(netSubtotalCents * taxRatePct / 100);
    const cardFeeCents = Math.round(
      (netSubtotalCents + serviceCents + taxCents + deliveryCents) *
        cardFeeRatePct / 100,
    );
    const totalCents =
      netSubtotalCents + serviceCents + taxCents + deliveryCents + cardFeeCents;
    const itemsCount = cart.items.reduce(
      (sum: number, item: { quantity: number }) => sum + item.quantity,
      0,
    );

    // ── 1. Stage the order as a NON-OPERATIONAL Draft. Draft orders are
    //      excluded from every operational surface (admin lists, kitchen,
    //      alerts, printing); the webhook flips the order to status 'New'
    //      the moment Stripe confirms payment — that is the only path into
    //      operations. payment_status stays pending until then. The charge
    //      breakdown is persisted here so later settings changes never
    //      rewrite historical orders. Before the 20260821 migration, the
    //      breakdown columns may not exist — the legacy insert stores the
    //      total only. ──
    const insertOrder = (breakdown: boolean) =>
      db
        .from('orders')
        .insert({
          customer_name: customer.name,
          customer_email: customer.email,
          customer_phone: customer.phone ?? '',
          ...(breakdown
            ? {
                fulfilment_method: isDelivery ? 'Delivery' : (['Pickup', 'Dine-in'].includes(String(cart.fulfilment)) ? String(cart.fulfilment) : 'Pickup'),
                delivery_address: isDelivery ? String(customer.address ?? '') : '',
                delivery_suburb: isDelivery ? String(customer.suburb ?? '') : '',
                delivery_postcode: isDelivery ? String(customer.postcode ?? '') : '',
                delivery_instructions: isDelivery ? String(customer.deliveryInstructions ?? '') : '',
                subtotal: subtotalCents / 100,
                discount_total: discountCents / 100,
                coupon_code: couponCode,
                tax_total: taxCents / 100,
                delivery_fee: deliveryCents / 100,
                service_charge: serviceCents / 100,
                card_processing_fee: cardFeeCents / 100,
              }
            : {}),
          total: totalCents / 100,
          items_count: itemsCount,
          status: 'Draft',
          payment_status: 'pending',
        })
        .select('id')
        .single();

    let { data: order, error: orderError } = await insertOrder(true);
    if (orderError?.code === '42703') {
      const legacy = await insertOrder(false);
      order = legacy.data;
      orderError = legacy.error;
    }
    if (orderError) throw orderError;

    // ── 2. Persist items + initial status history, then create the session.
    //      Anything failing here is rolled back while NO payable session
    //      exists, so a customer can never pay for a deleted order. ──
    let sessionUrl: string | null = null;
    try {
      const itemRows = cart.items.map(
        (item: {
          productId: string;
          quantity: number;
          instructions: string;
        },
        index: number,
      ) => ({
        order_id: order.id,
        product_id: isUuid(item.productId ?? '') ? item.productId : null,
        product_name: lines[index].name,
        unit_price: lines[index].unitCents / 100,
        quantity: item.quantity,
        // Combo selections render as flat zero/upgrade-price lines for the
        // kitchen and receipts, and persist structurally in combo_selections.
        modifiers: lines[index].modifiers,
        combo_selections: lines[index].isCombo ? lines[index].comboSelections : null,
        special_instructions: item.instructions,
      }),
      );
      const { error: itemError } = await db
        .from('order_items')
        .insert(itemRows);
      if (itemError) throw itemError;

      const { error: historyError } = await db
        .from('order_status_history')
        .insert({ order_id: order.id, status: 'Draft' });
      if (historyError) throw historyError;

      // Stripe does not allow negative line items, so the discount is
      // allocated greedily across the product LINES. A reduced line is sent
      // as quantity 1 with the reduced total (unit_amount × qty would
      // re-multiply the discount); untouched lines keep unit × qty. The
      // Stripe total therefore equals totalCents exactly.
      let remainingDiscount = discountCents;
      const discountedLineCents = cart.items.map(
        (item: { quantity: number }, index: number) => {
          const lineCents = itemUnitCents[index] * item.quantity;
          const reduction = Math.min(remainingDiscount, lineCents);
          remainingDiscount -= reduction;
          return lineCents - reduction;
        },
      );

      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          success_url: successUrl,
          cancel_url: cancelUrl,
          customer_email: customer.email,
          // Identifiers only — Stripe metadata values are capped at 500
          // characters. The webhook loads the order by this id.
          metadata: { order_id: order.id },
          line_items: [
            ...cart.items.map(
              (item: { name: string; quantity: number }, index: number) => {
                const originalLine = itemUnitCents[index] * item.quantity;
                const discounted = discountedLineCents[index];
                return discounted === originalLine
                  ? {
                      quantity: item.quantity,
                      price_data: {
                        currency: 'aud',
                        unit_amount: itemUnitCents[index],
                        product_data: { name: lines[index].name },
                      },
                    }
                  : {
                      // Discount-allocated line: quantity 1 + reduced total.
                      quantity: 1,
                      price_data: {
                        currency: 'aud',
                        unit_amount: discounted,
                        product_data: { name: lines[index].name },
                      },
                    };
              },
            ),
            // Charges are explicit lines so the Stripe page total equals the
            // checkout page total exactly. Rates come from settings, so the
            // labels state the applied rate rather than a hardcoded "10%".
            ...(serviceCents > 0
              ? [{
                  quantity: 1,
                  price_data: {
                    currency: 'aud',
                    unit_amount: serviceCents,
                    product_data: { name: `Service charge (${serviceRatePct}%)` },
                  },
                }]
              : []),
            ...(taxCents > 0
              ? [{
                  quantity: 1,
                  price_data: {
                    currency: 'aud',
                    unit_amount: taxCents,
                    product_data: { name: `Tax (${taxRatePct}%)` },
                  },
                }]
              : []),
            ...(deliveryCents > 0
              ? [{
                  quantity: 1,
                  price_data: {
                    currency: 'aud',
                    unit_amount: deliveryCents,
                    product_data: { name: 'Delivery' },
                  },
                }]
              : []),
            ...(cardFeeCents > 0
              ? [{
                  quantity: 1,
                  price_data: {
                    currency: 'aud',
                    unit_amount: cardFeeCents,
                    product_data: {
                      name: `Card processing fee (${cardFeeRatePct}%)`,
                    },
                  },
                }]
              : []),
          ],
        },
        // Idempotent per order: a double-click or network retry can never
        // create two payable sessions for the same order.
        { idempotencyKey: `checkout-${order.id}` },
      );

      // Traceability link — non-fatal: the webhook re-asserts it on
      // completion.
      const { error: linkError } = await db
        .from('orders')
        .update({ stripe_session_id: session.id })
        .eq('id', order.id);
      if (linkError) {
        console.error('Session link failed for', order.id, linkError);
      }

      sessionUrl = session.url;
    } catch (error) {
      const { error: deleteError } = await db
        .from('orders')
        .delete()
        .eq('id', order.id); // cascades to order_items and history
      if (deleteError) {
        console.error('Rollback of unpaid order failed:', order.id, deleteError);
      }
      throw error;
    }

    return Response.json(
      { url: sessionUrl },
      { headers: corsHeaders(request) },
    );
  } catch (error) {
    console.error('Checkout error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 400, headers: corsHeaders(request) },
    );
  }
});
