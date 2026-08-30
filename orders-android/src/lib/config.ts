// Build-time environment. EXPO_PUBLIC_* variables are inlined by Expo at
// bundle time — only PUBLIC values may live here (anon key only; the
// service-role key must never enter the app).

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

export function assertConfig(): void {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error(
      'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to orders-android/.env (see .env.example).',
    );
  }
}

export function isConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}
