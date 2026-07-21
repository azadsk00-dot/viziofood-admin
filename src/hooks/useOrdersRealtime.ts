import { useEffect } from 'react'; import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'; import { supabase } from '../lib/supabase';
type OrderEvent = RealtimePostgresChangesPayload<Record<string, unknown>>;
export function useOrdersRealtime(onChange:(event:OrderEvent)=>void){useEffect(()=>{const client=supabase;if(!client)return;const channel=client.channel('orders-live').on('postgres_changes',{event:'*',schema:'public',table:'orders'},onChange).subscribe();return()=>{void client.removeChannel(channel)}},[onChange])}
