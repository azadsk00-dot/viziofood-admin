import { useEffect } from 'react'; import { supabase } from '../lib/supabase';
export function useOrdersRealtime(onChange:()=>void){useEffect(()=>{const client=supabase;if(!client)return;const channel=client.channel('orders-live').on('postgres_changes',{event:'*',schema:'public',table:'orders'},onChange).subscribe();return()=>{void client.removeChannel(channel)}},[onChange])}
