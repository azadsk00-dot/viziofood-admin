import type { ExpoConfig } from 'expo/config';

// Node-only file, evaluated by the Expo CLI at build time (never bundled
// into the app); the local declarations keep tsc happy without @types/node.
declare const require: (id: string) => unknown;
declare const __dirname: string;
const fs = require('fs') as { existsSync(path: string): boolean };
const path = require('path') as { join(...parts: string[]): string };

// Read from .env / CI environment at config time (EAS injects these).
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const supabaseFunctionsUrl = process.env.EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL ?? `${supabaseUrl}/functions/v1`;

// FCM credentials for Expo push (terminated-app delivery). Create the
// Android app in the Firebase console for com.viziofood.kitchen, download
// google-services.json and drop it next to this file (gitignored) — the
// build picks it up automatically. Without it, registerForPush() reports
// "Default FirebaseApp is not initialized" and the tablet relies on
// realtime + reconciliation only. Conditionally wired: a missing file must
// never break the build (prebuild throws on a configured-but-absent path).
const googleServicesJson = path.join(__dirname, 'google-services.json');
const googleServicesFile = fs.existsSync(googleServicesJson) ? './google-services.json' : undefined;

const config: ExpoConfig = {
  name: 'Vizio Kitchen',
  slug: 'vizio-kitchen',
  version: '1.3.0',
  // Full management app: both orientations must work and reflow.
  orientation: 'default',
  scheme: 'viziokitchen',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0B0E13',
  primaryColor: '#E7C54A',
  description: 'Vizio Food kitchen tablet — live orders, alerts and printing for the restaurant kitchen.',
  platforms: ['android'],
  assetBundlePatterns: ['**/*'],
  icon: './assets/icon.png',
  ios: {
    supportsTablet: true,
  },
  android: {
    package: 'com.viziofood.kitchen',
    versionCode: 11,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0B0E13',
    },
    permissions: [
      'VIBRATE',
      'WAKE_LOCK',
      'RECEIVE_BOOT_COMPLETED',
      // New-order alerts are normal heads-up notifications — no full-screen
      // intent, no lock-screen takeover.
      'POST_NOTIFICATIONS',
      // Direct printing from the background (modules/print-service).
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_CONNECTED_DEVICE',
    ],
  },
  plugins: [
    'expo-dev-client',
    // HTTPS-only platform HTTP policy; LAN printer agent goes over raw TCP
    // (src/services/agentHttp.ts), so no cleartext exceptions are granted.
    './plugins/withNetworkSecurityConfig',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 300,
        resizeMode: 'contain',
        backgroundColor: '#0B0E13',
        dark: { image: './assets/splash-icon.png', imageWidth: 300, resizeMode: 'contain', backgroundColor: '#0B0E13' },
      },
    ],
    [
      'expo-notifications',
      {
        color: '#E7C54A',
        // Channel 'orders_v5' carries the custom Vizio order sound (the
        // runtime ensureChannels() in src/services/notifications.ts is the
        // authoritative creator — channel sounds are immutable on Android,
        // hence the fresh id when the custom WAV was attached).
        channels: [
          {
            id: 'orders_v5',
            name: 'New orders',
            importance: 'max',
            sound: 'assets/sounds/new-order-alert.wav',
            vibrationPattern: [0, 500, 200, 500, 200, 800],
            lockscreenVisibility: 'public',
            bypassDnd: true,
            showBadge: true,
          },
          {
            id: 'print-errors',
            name: 'Printer problems',
            importance: 'high',
            sound: 'default',
            vibrationPattern: [0, 300, 150, 300],
            lockscreenVisibility: 'public',
            showBadge: true,
          },
        ],
      },
    ],
  ],
  extra: {
    supabaseUrl,
    supabaseAnonKey,
    supabaseFunctionsUrl,
  },
};

export default config;
