import { useEffect } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type OrderEvent = RealtimePostgresChangesPayload<Record<string, unknown>>;

let channelSeq = 0;

/**
 * Live order stream. Each hook instance creates its OWN uniquely-named
 * channel — several components subscribe simultaneously (admin orders,
 * dashboard, kitchen, account) and a shared channel name means one
 * component's cleanup removes the channel for everyone. Cleanup always
 * removes exactly the channel this instance created.
 */
export function useOrdersRealtime(onChange: (event: OrderEvent) => void) {
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client
      .channel(`orders-live-${++channelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [onChange]);
}
