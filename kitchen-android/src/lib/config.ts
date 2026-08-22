// App configuration — values come from app.config.ts `extra`, which pulls
// EXPO_PUBLIC_* env vars at build time. Public values only: anon key + URLs.
// The service-role key must NEVER appear in this app (RLS is the guard).

import Constants from 'expo-constants';

interface Extra {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseFunctionsUrl: string;
  printerAgentUrl: string;
  printerAgentToken: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

export const config = {
  supabaseUrl: extra.supabaseUrl ?? '',
  supabaseAnonKey: extra.supabaseAnonKey ?? '',
  functionsUrl: extra.supabaseFunctionsUrl ?? '',
  printerAgentUrl: extra.printerAgentUrl ?? '',
  printerAgentToken: extra.printerAgentToken ?? '',
};

export function assertConfig(): void {
  const missing = Object.entries({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey })
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `Missing configuration: ${missing.join(', ')}. Copy .env.example to .env and rebuild (EXPO_PUBLIC_* values are inlined at build time).`,
    );
  }
  if (!config.functionsUrl && config.supabaseUrl) {
    config.functionsUrl = `${config.supabaseUrl}/functions/v1`;
  }
}
