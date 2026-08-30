// Push registration — background/killed-app notifications.
//
// The device obtains an Expo push token (Expo's push service routes to FCM on
// Android — no Firebase SDK or FCM key lives in the app) and registers it
// with the EXISTING push-notifications Edge Function using the signed-in
// user's JWT (kitchen_devices token layer). The stripe-webhook already fires
// notify-new-order for every paid order; registered devices receive it when
// the app is backgrounded, the screen is locked or the app was killed.
//
// Every failure here is non-fatal: foreground realtime alerts keep working.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { config } from '../lib/config';
import { supabase } from '../lib/supabase';
import { appVersion, getDeviceId, getDeviceName } from '../storage/device';
import { ensureChannels, requestPermission } from './notificationService';

let registeredToken: string | null = null;

function endpoint(): string {
  return `${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/push-notifications`;
}

export function currentPushToken(): string | null {
  return registeredToken;
}

/** Last registration outcome — shown on the Settings screen for diagnosis. */
let lastPushResult: { ok: boolean; detail: string } | null = null;

export function lastPushRegistrationResult(): { ok: boolean; detail: string } | null {
  return lastPushResult;
}

/**
 * Get (or refresh) the Expo push token and register it with the server for
 * the signed-in user. Returns the token, or null when push is unavailable —
 * never throws.
 *
 * NOTE (local builds): obtaining an FCM token requires Firebase credentials
 * in the APK (google-services.json — EAS builds inject Expo's default FCM
 * credentials; local Gradle builds do not). Without it this returns null and
 * background/locked/closed delivery is unavailable; foreground realtime
 * alerts are unaffected. Re-register is attempted on every app foreground,
 * so the moment credentials exist the device picks push up.
 */
export async function registerPushToken(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    await ensureChannels();
    const granted = await requestPermission();
    if (!granted) {
      lastPushResult = { ok: false, detail: 'Notification permission not granted — push token not requested.' };
      console.warn('[push] result: NOT REGISTERED — notification permission not granted');
      return null;
    }

    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;
    // Throws on failure (e.g. no FCM credentials in a local build) — caught
    // below, logged, and shown on the Settings screen.
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token) {
      lastPushResult = { ok: false, detail: 'getExpoPushTokenAsync returned no token (no FCM credentials in this build?).' };
      console.warn('[push] getExpoPushTokenAsync result: NO TOKEN');
      return null;
    }
    console.log('[push] getExpoPushTokenAsync result:', token);

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session?.access_token) {
      lastPushResult = { ok: false, detail: `Token obtained (${token.slice(0, 24)}…) but registration skipped — not signed in.` };
      console.warn('[push] result: NOT REGISTERED — no session');
      return null;
    }

    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'register',
        token,
        deviceId: await getDeviceId(),
        platform: 'android',
        appVersion: appVersion(),
        name: await getDeviceName(),
      }),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      lastPushResult = { ok: false, detail: `Registration HTTP ${response.status}: ${body}` };
      console.warn('[push] registration skipped:', response.status, body);
      return null;
    }
    registeredToken = token;
    lastPushResult = { ok: true, detail: token };
    console.log('[push] REGISTERED with push-notifications:', token);
    return token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastPushResult = { ok: false, detail: `Registration threw: ${message}` };
    console.warn('[push] registration failed:', message);
    return null;
  }
}

/** Re-attempt registration when the app returns to the foreground. */
export async function reRegisterIfMissing(): Promise<void> {
  if (registeredToken) return;
  void registerPushToken();
}

/** Remove this device's token from the server (sign-out). Best effort. */
export async function unregisterPushToken(token: string): Promise<void> {
  if (!token) return;
  try {
    await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unregister', token }),
    });
  } catch {
    // best effort — the server also prunes dead tokens from receipts
  }
}
