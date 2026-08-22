// Supabase client — one instance, session persisted to AsyncStorage so the
// tablet survives restarts without re-login. Auth runs through the same
// backend as the websites; RLS is the authorization layer.

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertConfig, config } from './config';

assertConfig();

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

export type SupabaseClient = typeof supabase;
