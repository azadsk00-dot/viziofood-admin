// Restaurant settings service — single oldest row, dynamic column fallback,
// audit-logged saves (mirrors web src/admin/supabase.ts settings layer).
// Saving pauses/resumes propagate to the public site via realtime.

import { supabase } from '../../lib/supabase';
import type { OpeningHours, RestaurantSettings } from '../../lib/adminTypes';

const SELECT =
  'id,name,address,suburb,state,postcode,phone,email,hours,opening_hours,delivery_fee,tax_rate,service_charge,card_processing_fee,instagram,facebook,google_maps,logo_url,pickup_enabled,delivery_enabled,orders_enabled,order_pause_message,minimum_order,delivery_minimum_order,pickup_time,delivery_time,pickup_instructions,order_sound_enabled,auto_print_enabled';

const DEFAULT_HOURS: OpeningHours = {
  mon: { open: '11:00', close: '21:00', closed: false },
  tue: { open: '11:00', close: '21:00', closed: false },
  wed: { open: '11:00', close: '21:00', closed: false },
  thu: { open: '11:00', close: '21:00', closed: false },
  fri: { open: '11:00', close: '21:00', closed: false },
  sat: { open: '11:00', close: '21:00', closed: false },
  sun: { open: '11:00', close: '21:00', closed: false },
};

export async function getRestaurantSettings(): Promise<RestaurantSettings | null> {
  let columns = SELECT;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from('restaurant_settings').select(columns).order('created_at').order('id').limit(1).maybeSingle();
    if (error && /42703|PGRST204/i.test(error.message)) {
      // Strip the first unknown column and retry (web parity).
      const missing = /column "?([\w.]+)"?/.exec(error.message)?.[1]?.split('.').pop();
      columns = columns
        .split(',')
        .filter((c) => c.trim() !== missing)
        .join(',');
      continue;
    }
    if (error) throw new Error(error.message);
    if (!data) return null;
    const r = data as unknown as Record<string, unknown>;
    const hours = (r.opening_hours as OpeningHours | null) ?? DEFAULT_HOURS;
    return {
      id: r.id as string,
      name: (r.name as string) ?? '',
      address: (r.address as string) ?? '',
      suburb: (r.suburb as string) ?? '',
      state: (r.state as string) ?? '',
      postcode: (r.postcode as string) ?? '',
      phone: (r.phone as string) ?? '',
      email: (r.email as string) ?? '',
      openingHours: { ...DEFAULT_HOURS, ...hours },
      deliveryFee: Number(r.delivery_fee ?? 0),
      taxRate: Number(r.tax_rate ?? 0),
      serviceChargeRate: Number(r.service_charge ?? 0),
      cardFeeRate: Number(r.card_processing_fee ?? 0),
      instagram: (r.instagram as string) ?? '',
      facebook: (r.facebook as string) ?? '',
      googleMaps: (r.google_maps as string) ?? '',
      logoUrl: (r.logo_url as string | null) ?? null,
      pickupEnabled: r.pickup_enabled === undefined ? true : Boolean(r.pickup_enabled),
      deliveryEnabled: r.delivery_enabled === undefined ? true : Boolean(r.delivery_enabled),
      ordersEnabled: r.orders_enabled === undefined ? true : Boolean(r.orders_enabled),
      orderPauseMessage: (r.order_pause_message as string) ?? '',
      minimumOrder: Number(r.minimum_order ?? 0),
      deliveryMinimumOrder: Number(r.delivery_minimum_order ?? 0),
      pickupTime: Number(r.pickup_time ?? 15),
      deliveryTime: Number(r.delivery_time ?? 35),
      pickupInstructions: (r.pickup_instructions as string) ?? '',
      orderSoundEnabled: r.order_sound_enabled === undefined ? true : Boolean(r.order_sound_enabled),
      autoPrintEnabled: r.auto_print_enabled === undefined ? true : Boolean(r.auto_print_enabled),
    };
  }
  throw new Error('Could not read restaurant settings.');
}

function toRow(changes: Partial<RestaurantSettings>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (changes.name !== undefined) row.name = changes.name;
  if (changes.address !== undefined) row.address = changes.address;
  if (changes.suburb !== undefined) row.suburb = changes.suburb;
  if (changes.state !== undefined) row.state = changes.state;
  if (changes.postcode !== undefined) row.postcode = changes.postcode;
  if (changes.phone !== undefined) row.phone = changes.phone;
  if (changes.email !== undefined) row.email = changes.email;
  if (changes.openingHours !== undefined) row.opening_hours = changes.openingHours;
  if (changes.deliveryFee !== undefined) row.delivery_fee = Number(changes.deliveryFee);
  if (changes.taxRate !== undefined) row.tax_rate = Number(changes.taxRate);
  if (changes.serviceChargeRate !== undefined) row.service_charge = Number(changes.serviceChargeRate);
  if (changes.cardFeeRate !== undefined) row.card_processing_fee = Number(changes.cardFeeRate);
  if (changes.instagram !== undefined) row.instagram = changes.instagram;
  if (changes.facebook !== undefined) row.facebook = changes.facebook;
  if (changes.googleMaps !== undefined) row.google_maps = changes.googleMaps;
  if (changes.logoUrl !== undefined) row.logo_url = changes.logoUrl;
  if (changes.pickupEnabled !== undefined) row.pickup_enabled = changes.pickupEnabled;
  if (changes.deliveryEnabled !== undefined) row.delivery_enabled = changes.deliveryEnabled;
  if (changes.ordersEnabled !== undefined) row.orders_enabled = changes.ordersEnabled;
  if (changes.orderPauseMessage !== undefined) row.order_pause_message = changes.orderPauseMessage;
  if (changes.minimumOrder !== undefined) row.minimum_order = Number(changes.minimumOrder);
  if (changes.deliveryMinimumOrder !== undefined) row.delivery_minimum_order = Number(changes.deliveryMinimumOrder);
  if (changes.pickupTime !== undefined) row.pickup_time = Math.max(5, Math.round(changes.pickupTime));
  if (changes.deliveryTime !== undefined) row.delivery_time = Math.max(10, Math.round(changes.deliveryTime));
  if (changes.pickupInstructions !== undefined) row.pickup_instructions = changes.pickupInstructions;
  if (changes.orderSoundEnabled !== undefined) row.order_sound_enabled = changes.orderSoundEnabled;
  if (changes.autoPrintEnabled !== undefined) row.auto_print_enabled = changes.autoPrintEnabled;
  return row;
}

export async function saveRestaurantSettings(changes: Partial<RestaurantSettings>): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const row = toRow(changes);
  const { data: existing } = await supabase
    .from('restaurant_settings')
    .select('id')
    .order('created_at')
    .order('id')
    .limit(1)
    .maybeSingle();

  const payload = existing ? row : { ...row, name: (changes.name ?? 'Vizio Food') as string };
  let result = existing
    ? await supabase.from('restaurant_settings').update(payload).eq('id', (existing as { id: string }).id).select('id').single()
    : await supabase.from('restaurant_settings').insert(payload).select('id').single();
  if (result.error && /42703|PGRST204/i.test(result.error.message)) {
    // Retry without newer columns (pre-migration parity).
    const NEW = [
      'suburb', 'state', 'postcode', 'opening_hours', 'service_charge', 'card_processing_fee',
      'orders_enabled', 'order_pause_message', 'pickup_enabled', 'delivery_enabled',
      'minimum_order', 'delivery_minimum_order', 'pickup_instructions', 'pickup_time',
      'delivery_time', 'order_sound_enabled', 'auto_print_enabled', 'logo_url',
    ];
    const reduced = Object.fromEntries(Object.entries(payload).filter(([k]) => !NEW.includes(k)));
    result = existing
      ? await supabase.from('restaurant_settings').update(reduced).eq('id', (existing as { id: string }).id).select('id').single()
      : await supabase.from('restaurant_settings').insert(reduced).select('id').single();
  }
  if (result.error) throw new Error(result.error.message);

  try {
    await supabase.from('admin_audit_log').insert({
      user_id: userData.user?.id ?? null,
      action: changes.ordersEnabled === false ? 'orders_paused' : changes.ordersEnabled === true ? 'orders_resumed' : 'settings_changed',
      details: { fields: Object.keys(row) },
    });
  } catch {
    // audit best-effort
  }
}
