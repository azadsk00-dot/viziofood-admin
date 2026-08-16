import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DayHours, OpeningHours } from '../admin/types';

export interface PublicRestaurantSettings {
  name: string;
  phone: string;
  email: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  googleMapsUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  openingHours: OpeningHours;
  deliveryFee: number;
  ordersEnabled: boolean;
  orderPauseMessage: string;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const emptyHours = (): OpeningHours =>
  Object.fromEntries(DAY_KEYS.map(d => [d, { open: '', close: '', closed: true }])) as OpeningHours;

const parseHours = (raw: unknown): OpeningHours =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as OpeningHours : emptyHours();

export function formatOpeningHours(hours: OpeningHours): string[] {
  return DAY_KEYS
    .filter(day => hours[day])
    .map(day => {
      const h: DayHours = hours[day];
      return h.closed
        ? `${DAY_LABELS[day]}: Closed`
        : `${DAY_LABELS[day]}: ${h.open} – ${h.close}`;
    });
}

const select = 'name,phone,email,address,suburb,state,postcode,google_maps,instagram,facebook,opening_hours,delivery_fee,orders_enabled,order_pause_message';

/** Keeps document metadata + Restaurant JSON-LD in sync with DB settings. */
function applyMetadata(s: PublicRestaurantSettings) {
  if (s.name) document.title = `${s.name} — Fresh Italian Pasta`;
  const description = document.querySelector('meta[name="description"]');
  if (description && s.address) {
    description.setAttribute('content', `Fresh Italian pasta, premium coffee and a warm table in ${s.suburb || 'Leederville'}.`);
  }
  const ld = document.getElementById('restaurant-jsonld');
  if (ld) {
    const hours = DAY_KEYS
      .filter(day => s.openingHours[day] && !s.openingHours[day].closed)
      .map(day => `${DAY_LABELS[day].slice(0, 2)} ${s.openingHours[day].open}-${s.openingHours[day].close}`);
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: s.name || 'Vizio Food',
      servesCuisine: 'Italian',
      telephone: s.phone || undefined,
      email: s.email || undefined,
      address: {
        '@type': 'PostalAddress',
        streetAddress: s.address || undefined,
        addressLocality: s.suburb || undefined,
        addressRegion: s.state || undefined,
        postalCode: s.postcode || undefined,
        addressCountry: 'AU',
      },
      ...(s.openingHours ? { openingHours: hours.join(', ') || undefined } : {}),
      ...(s.googleMapsUrl ? { hasMap: s.googleMapsUrl } : {}),
      ...(s.instagramUrl || s.facebookUrl ? { sameAs: [s.instagramUrl, s.facebookUrl].filter(Boolean) } : {}),
    });
  }
}

const mapRow = (row: Record<string, unknown>): PublicRestaurantSettings => ({
  name: typeof row.name === 'string' ? row.name : '',
  phone: typeof row.phone === 'string' ? row.phone : '',
  email: typeof row.email === 'string' ? row.email : '',
  address: typeof row.address === 'string' ? row.address : '',
  suburb: typeof row.suburb === 'string' ? row.suburb : '',
  state: typeof row.state === 'string' ? row.state : '',
  postcode: typeof row.postcode === 'string' ? row.postcode : '',
  googleMapsUrl: typeof row.google_maps === 'string' ? row.google_maps : '',
  instagramUrl: typeof row.instagram === 'string' ? row.instagram : '',
  facebookUrl: typeof row.facebook === 'string' ? row.facebook : '',
  openingHours: parseHours(row.opening_hours),
  deliveryFee: Number(row.delivery_fee ?? 0),
  ordersEnabled: row.orders_enabled !== false,
  orderPauseMessage: typeof row.order_pause_message === 'string' ? row.order_pause_message : '',
});

let channelSeq = 0;

/**
 * Reads restaurant settings with the public anon client (RLS allows public
 * reads) and subscribes to realtime updates so pause/resume and contact
 * changes reach the public site without a redeployment.
 */
export function useRestaurantSettings() {
  const [settings, setSettings] = useState<PublicRestaurantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) { setError('Supabase is not configured.'); setLoading(false); return; }

    const load = async () => {
      const { data, error: queryError } = await client
        .from('restaurant_settings')
        .select(select)
        .limit(1)
        .maybeSingle();
      if (queryError) setError(queryError.message);
      else {
        const mapped = data ? mapRow(data as Record<string, unknown>) : null;
        setSettings(mapped);
        if (mapped) applyMetadata(mapped);
      }
      setLoading(false);
    };
    void load();

    // Unique channel name per hook instance — several components on one page
    // (banner, footer, page) subscribe simultaneously and duplicate topics
    // conflict in supabase-js realtime.
    const channel = client
      .channel(`restaurant-settings-live-${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_settings' }, () => { void load(); })
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, []);

  return { settings, loading, error };
}
