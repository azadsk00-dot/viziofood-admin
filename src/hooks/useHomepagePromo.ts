import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface PublicHomepagePromo {
  promoType: 'daily' | 'weekly';
  title: string;
  description: string;
  price: number | null;
  imageUrl: string | null;
  buttonText: string;
  buttonLink: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Date-window check with date-only comparison so promos run whole days. */
function withinWindow(start: string | null, end: string | null): boolean {
  const now = today();
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

const mapRow = (row: Record<string, unknown>): PublicHomepagePromo => ({
  promoType: row.promo_type === 'weekly' ? 'weekly' : 'daily',
  title: typeof row.title === 'string' ? row.title : '',
  description: typeof row.description === 'string' ? row.description : '',
  price: row.price === null || row.price === undefined ? null : Number(row.price),
  imageUrl: typeof row.image_url === 'string' && row.image_url ? row.image_url : null,
  buttonText: typeof row.button_text === 'string' ? row.button_text : '',
  buttonLink: typeof row.button_link === 'string' ? row.button_link : '',
});

let channelSeq = 0;

/**
 * Reads the homepage special with the public anon client. RLS only exposes
 * enabled rows; the start/end date window is enforced here so admins can
 * schedule a promo in advance. Subscribes to realtime so enabling, editing or
 * disabling the special reaches visitors without a redeploy.
 */
export function useHomepagePromo() {
  const [promo, setPromo] = useState<PublicHomepagePromo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client) { setLoading(false); return; }

    const load = async () => {
      const { data } = await client
        .from('homepage_content')
        .select('promo_type,title,description,price,image_url,button_text,button_link,start_date,end_date')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();
      const row = data as Record<string, unknown> | null;
      if (!row) { setPromo(null); setLoading(false); return; }
      const start = typeof row.start_date === 'string' ? row.start_date : null;
      const end = typeof row.end_date === 'string' ? row.end_date : null;
      const mapped = mapRow(row);
      setPromo(mapped.title && withinWindow(start, end) ? mapped : null);
      setLoading(false);
    };
    void load();

    const channel = client
      .channel(`homepage-content-live-${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homepage_content' }, () => { void load(); })
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, []);

  return { promo, loading };
}
