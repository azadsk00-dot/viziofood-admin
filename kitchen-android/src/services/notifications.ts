// Notifications — Android push architecture for the kitchen tablet.
//
// - Channel 'orders' (max importance, custom Vizio sound, vibration, public
//   lock-screen, bypass DND) is declared in app.config.ts via the
//   expo-notifications config plugin and defensively re-asserted at runtime.
// - Pushes arrive through Expo Push (FCM underneath) with priority=high from
//   the push-notifications Edge Function — this works when the app is
//   backgrounded, the screen is locked or the app was killed.
// - In the foreground the received listener drives the in-app alert overlay
//   + custom sound (alertPlayer), so the experience is identical.
// - Every alert/open/ack is written to kitchen_notification_logs (audit).

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import type { KitchenOrder } from '../lib/types';
import { supabase } from '../lib/supabase';
import { config } from '../lib/config';
import { getDeviceId } from '../lib/device';
import { useOrdersStore } from '../state/ordersStore';
import { getSettings } from '../state/settingsStore';
import { playNewOrderAlert } from './alertPlayer';

type NotificationHandler = (orderId: string) => void;
let responseHandler: NotificationHandler | null = null;

/** Set by the navigator: deep-link a tapped push notification to the order. */
export function onNotificationResponse(handler: NotificationHandler): void {
  responseHandler = handler;
}

// Foreground behaviour: show banner + list (sound comes from the channel).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // The config plugin already creates these with the custom sound at first
  // launch; this runtime pass guarantees the importance/vibration settings
  // even after an OTA update or a channel reset.
  await Notifications.setNotificationChannelAsync('orders', {
    name: 'New orders',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 200, 500, 200, 800],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    showBadge: true,
  }).catch(() => undefined);
  await Notifications.setNotificationChannelAsync('print-errors', {
    name: 'Printer problems',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 150, 300],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  }).catch(() => undefined);
}

export async function ensurePermissions(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted && current.ios?.status !== Notifications.IosAuthorizationStatus.DENIED) return true;
  const asked = await Notifications.requestPermissionsAsync({
    android: ['POST_NOTIFICATIONS'],
  });
  return Boolean(asked.granted);
}

export async function registerForPush(): Promise<{ ok: boolean; token?: string; error?: string }> {
  try {
    const granted = await ensurePermissions();
    if (!granted) return { ok: false, error: 'Notification permission denied — enable it in Android settings.' };

    const projectId = Constants.easConfig?.projectId ?? (Constants.expoConfig?.extra as { easProjectId?: string } | undefined)?.easProjectId;
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResult.data;
    if (!token) return { ok: false, error: 'No push token returned.' };

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) return { ok: false, error: 'Not signed in.' };

    const { getDeviceName, appVersion } = await import('../lib/device');
    const response = await fetch(`${config.functionsUrl}/push-notifications`, {
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
      const body = await response.text();
      return { ok: false, error: `Registration failed (${response.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true, token };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function unregisterPush(token: string): Promise<void> {
  try {
    await fetch(`${config.functionsUrl}/push-notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unregister', token }),
    });
  } catch {
    // best effort — the server also prunes dead tokens from receipts
  }
}

/**
 * Fire the full new-order alert experience for a paid order:
 * audit-log it, play sound/vibration, raise the overlay.
 * Idempotent per order via the persisted alertedOrderIds set.
 */
export async function notifyNewOrder(order: KitchenOrder, source: 'realtime' | 'push' | 'reconciliation'): Promise<void> {
  const store = useOrdersStore.getState();
  if (store.alertedOrderIds.includes(order.id)) return;
  store.markAlerted(order.id);
  store.setActiveAlert(order.id);

  await playNewOrderAlert(order);
  void logNotified(order, source);
}

/** kitchen_notification_logs upsert — one row per (order, device). */
export async function logNotified(order: KitchenOrder, source: string): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    await supabase.from('kitchen_notification_logs').upsert(
      {
        order_id: order.id,
        order_number: order.orderNumber,
        device_id: deviceId,
        notified_at: new Date().toISOString(),
        source,
      },
      { onConflict: 'order_id,device_id' },
    );
  } catch {
    // audit is best-effort; migration may not be applied yet
  }
}

export async function markNotificationOpened(orderId: string): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    await supabase.from('kitchen_notification_logs').upsert(
      {
        order_id: orderId,
        device_id: deviceId,
        opened_at: new Date().toISOString(),
      },
      { onConflict: 'order_id,device_id' },
    );
  } catch {
    // best effort
  }
}

export async function markNotificationAcknowledged(orderId: string): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    await supabase.from('kitchen_notification_logs').upsert(
      {
        order_id: orderId,
        device_id: deviceId,
        acknowledged_at: new Date().toISOString(),
      },
      { onConflict: 'order_id,device_id' },
    );
  } catch {
    // best effort
  }
}

/** TEST NOTIFICATION — presented on the real 'orders' channel, exact UX. */
export async function sendTestNotification(): Promise<void> {
  await ensurePermissions();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'TEST — New VIZIO FOOD Order',
      body: 'This is exactly how a real order alert looks and sounds.',
      sound: 'default',
      data: { test: true },
    },
    trigger: Platform.OS === 'android' ? ({ channelId: 'orders' } as never) : null,
  });
}

let listenersRegistered = false;

/** Wire push listeners once at app start. */
export function registerListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  Notifications.addNotificationReceivedListener((event) => {
    // Foreground: FCM echo — trigger the in-app alert path (deduped by order id).
    const data = event.request.content.data as { orderId?: string; test?: boolean } | undefined;
    if (!data?.orderId || data.test) return;
    const order = useOrdersStore.getState().orders[data.orderId];
    if (order) void notifyNewOrder(order, 'push');
  });

  Notifications.addNotificationResponseReceivedListener((event) => {
    const data = event.notification.request.content.data as { orderId?: string; test?: boolean } | undefined;
    if (!data?.orderId) return;
    void markNotificationOpened(data.orderId);
    responseHandler?.(data.orderId);
  });
}

/** Notification settings snapshot for the health screen. */
export async function notificationStatus(): Promise<'enabled' | 'disabled' | 'unknown'> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    return settings.granted ? 'enabled' : 'disabled';
  } catch {
    return 'unknown';
  }
}

export function soundEnabled(): boolean {
  return getSettings().soundEnabled;
}
