import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface FeaturedDish {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
}

const FEATURED_COLUMNS = 'id,name,description,price,image_url,thumbnail_url';
const FEATURED_LIMIT = 6;

const mapRow = (row: Record<string, unknown>): FeaturedDish => ({
  id: String(row.id ?? ''),
  name: typeof row.name === 'string' ? row.name : '',
  description: typeof row.description === 'string' ? row.description : '',
  price: Number(row.price ?? 0),
  imageUrl: (typeof row.image_url === 'string' && row.image_url) || (typeof row.thumbnail_url === 'string' && row.thumbnail_url) || null,
});

let channelSeq = 0;

/**
 * Featured dishes for the homepage, read with the public anon client. RLS
 * already restricts products to what visitors may order (active, available,
 * unarchived, public); the featured filter and ordering come from admin's
 * Featured Dishes page. Realtime keeps the grid fresh without a redeploy.
 */
export function useFeaturedDishes() {
  const [dishes, setDishes] = useState<FeaturedDish[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client) { setLoading(false); return; }

    const load = async () => {
      const { data } = await client
        .from('products')
        .select(FEATURED_COLUMNS)
        .eq('featured', true)
        .order('featured_order')
        .order('display_order')
        .order('name')
        .limit(FEATURED_LIMIT);
      setDishes((data ?? []).map(row => mapRow(row as Record<string, unknown>)));
      setLoading(false);
    };
    void load();

    const channel = client
      .channel(`featured-products-live-${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => { void load(); })
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, []);

  return { dishes, loading };
}
