import type { ExpoConfig } from 'expo/config';

// Read from .env / CI environment at config time (EAS injects these).
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const supabaseFunctionsUrl = process.env.EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL ?? `${supabaseUrl}/functions/v1`;

const config: ExpoConfig = {
  name: 'Vizio Kitchen',
  slug: 'vizio-kitchen',
  version: '1.1.0',
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
    versionCode: 2,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0B0E13',
    },
    permissions: [
      'VIBRATE',
      'WAKE_LOCK',
      'RECEIVE_BOOT_COMPLETED',
      'USE_FULL_SCREEN_INTENT',
      'POST_NOTIFICATIONS',
    ],
  },
  plugins: [
    'expo-dev-client',
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
        // Channel 'orders' is created at first launch with the custom Vizio
        // order sound, max importance, vibration and public lock-screen
        // visibility. FCM high-priority pushes arrive on this channel.
        channels: [
          {
            id: 'orders',
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
    // Optional: LAN printer-agent base URL (e.g. http://192.168.1.20:3777)
    printerAgentUrl: process.env.EXPO_PUBLIC_PRINTER_AGENT_URL ?? '',
    printerAgentToken: process.env.EXPO_PUBLIC_PRINTER_AGENT_TOKEN ?? '',
  },
};

export default config;
