// Supabase client — one instance, session persisted to AsyncStorage so the
// terminal survives restarts without re-login. Auth runs through the same
// backend as the websites; RLS is the authorization layer. Only the anon key
// is ever used here.

import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
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

// Keep the access token fresh while the app is in the foreground and pause
// automatic refresh in the background (Supabase's React Native pattern).
AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
