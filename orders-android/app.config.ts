import type { ExpoConfig } from 'expo/config';

// Read from .env / CI environment at config time (EAS injects these).
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// The alert sound as an Android raw resource name (no extension). The plugin
// `sounds` option packages assets/sounds/new_order_alert.wav into res/raw;
// the runtime channel creation (notificationService) references it by this
// name. Underscores only — Android resource names reject hyphens.
export const ORDER_ALERT_SOUND_RESOURCE = 'new_order_alert';

const config: ExpoConfig = {
  name: 'VIZIO FOOD Orders',
  slug: 'vizio-orders',
  version: '1.1.3',
  // A dedicated order terminal: landscape and portrait both work.
  orientation: 'default',
  scheme: 'vizioorders',
  userInterfaceStyle: 'light',
  backgroundColor: '#FFFFFF',
  primaryColor: '#059669',
  description:
    'VIZIO FOOD order terminal — live orders, scheduled orders, history and kitchen printing.',
  platforms: ['android'],
  assetBundlePatterns: ['**/*'],
  icon: './assets/icon.png',
  android: {
    package: 'com.viziofood.orders',
    versionCode: 5,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0D0B',
    },
    permissions: [
      'POST_NOTIFICATIONS',
      'VIBRATE',
      'WAKE_LOCK',
    ],
  },
  plugins: [
    // Expose the StarXpand SDK's bundled AAR to Gradle — required for
    // react-native-star-io10 to build (same fix as the Admin app).
    './plugins/withStarPrinterFlatDir',
    // Wires google-services.json (when present) into local Gradle builds so
    // FCM/background push works without an EAS build. No-op without the file.
    './plugins/withGoogleServices',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 300,
        resizeMode: 'contain',
        backgroundColor: '#0A0D0B',
        dark: {
          image: './assets/splash-icon.png',
          imageWidth: 300,
          resizeMode: 'contain',
          backgroundColor: '#0A0D0B',
        },
      },
    ],
    [
      'expo-notifications',
      {
        color: '#059669',
        // Packages the alert sound into android res/raw so the runtime
        // notification channel can use it. THIS is what makes the sound play
        // in standalone builds (the per-channel `sound` config below only
        // applies inside Expo Go).
        sounds: ['assets/sounds/new_order_alert.wav'],
        // Channel declarations for Expo Go only — the real channels are
        // created at runtime by notificationService (channels array config
        // does not reach standalone Android builds).
        channels: [
          {
            id: 'orders_v2',
            name: 'New orders',
            importance: 'max',
            sound: 'assets/sounds/new_order_alert.wav',
            vibrationPattern: [0, 400, 150, 400, 150, 700],
            lockscreenVisibility: 'public',
            bypassDnd: true,
            showBadge: true,
          },
          {
            id: 'print_errors_v2',
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
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          // The StarXpand SDK AAR (stario10) requires compileSdk 37 — same
          // override as the VIZIO FOOD Admin app.
          compileSdkVersion: 37,
        },
      },
    ],
  ],
  extra: {
    supabaseUrl,
    supabaseAnonKey,
    // This app's own EAS project (account: vizio) — EAS builds inject
    // Expo-managed FCM credentials for background push, exactly like the
    // other VIZIO FOOD apps.
    eas: {
      projectId: '095f4d6e-b862-46d5-b4ce-63015555cf15',
    },
  },
};

export default config;
