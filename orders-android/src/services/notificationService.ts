// NotificationService — Android notification pipeline for new paid orders.
//
// CHANNELS:
//   • orders_v2 / print_errors_v2 — used by LOCAL notifications (foreground
//     realtime path). v2 ids because Android channels are immutable and the
//     v1 'orders' channel was created WITHOUT a sound (that was the v1.0.0
//     root cause of silent alerts).
//   • 'orders' — ALSO created, correctly this time, because the existing
//     push-notifications Edge Function hardcodes `channelId: 'orders'` in
//     its FCM payload. The broken legacy channel is DELETED first, then
//     recreated with the packaged sound + MAX importance, so background /
//     locked / closed pushes land on a channel that actually rings. (App-side
//     fix — the Edge Function is untouched.)
//
// SOUND: a property of the channels — the wav is packaged into res/raw via
// the expo-notifications plugin `sounds` option and referenced by resource
// name. One mechanism covers all four app states (open, background, locked,
// closed); there is deliberately no separate in-app alert audio path.
//
// DEDUPE: the OrderEventProcessor marks orders alerted BEFORE notifying; the
// persisted alertedOrderIds set makes restart/replay double alerts
// impossible. Foreground FCM echoes of orders realtime already alerted are
// suppressed by the handler below.

import { Platform } from 'react-native';
import { AppState, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Order } from '../types';
import { ORDER_ALERT_SOUND_RESOURCE } from '../../app.config';

export const ORDERS_CHANNEL = 'orders_v2';
export const PRINT_ERRORS_CHANNEL = 'print_errors_v2';
/** The Edge Function's FCM payload targets this channel id — it must exist
 *  and carry the sound, or background pushes arrive silently. */
export const PUSH_CHANNEL_ALIAS = 'orders';

type NotificationHandler = (orderId: string) => void;
let responseHandler: NotificationHandler | null = null;

/** Set by the navigator: deep-link a tapped notification to the order. */
export function onNotificationResponse(handler: NotificationHandler): void {
  responseHandler = handler;
}

// Foreground behaviour for REMOTE pushes: while the app is active the
// realtime pipeline already alerted (notification + channel sound within
// ~1s), so the FCM echo is suppressed — no double alert. Backgrounded,
// locked or closed: Android shows the push without consulting this handler.
// LOCAL notifications (our own new-order banners) always show + sound.
Notifications.setNotificationHandler({
  handleNotification: (notification) => {
    const trigger = notification.request.trigger as { type?: string } | null | undefined;
    const isRemotePush = trigger?.type === 'push';
    const appActive = AppState.currentState === 'active';
    if (isRemotePush && appActive) {
      return Promise.resolve({
        shouldShowAlert: false,
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      });
    }
    return Promise.resolve({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true, // never mute the channel sound
      shouldSetBadge: false,
    });
  },
});

async function createOrdersChannel(id: string): Promise<void> {
  await Notifications.setNotificationChannelAsync(id, {
    name: 'New orders',
    importance: Notifications.AndroidImportance.MAX,
    sound: ORDER_ALERT_SOUND_RESOURCE, // res/raw resource name, no extension
    vibrationPattern: [0, 400, 150, 400, 150, 700],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    showBadge: true,
  }).catch(() => undefined);
}

/**
 * Create the notification channels. MUST run before any notification is
 * posted. Safe to call repeatedly.
 *
 * Channel correction strategy: the v1.0.0 'orders' channel (created without
 * a sound — immutable once created) is DELETED and recreated correctly, so
 * the Edge Function's hardcoded `channelId: 'orders'` FCM payloads ring.
 * Local notifications use the fresh orders_v2 id.
 */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.deleteNotificationChannelAsync('orders').catch(() => undefined);
  await Notifications.deleteNotificationChannelAsync('print-errors').catch(() => undefined);
  await createOrdersChannel(PUSH_CHANNEL_ALIAS); // FCM payload target
  await createOrdersChannel(ORDERS_CHANNEL); // local notification target
  await Notifications.setNotificationChannelAsync(PRINT_ERRORS_CHANNEL, {
    name: 'Printer problems',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 300, 150, 300],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  }).catch(() => undefined);
}

export interface NotificationDiagnostics {
  permission: 'granted' | 'undetermined' | 'denied';
  ordersChannelSound: string | null;
  pushAliasChannelSound: string | null;
}

/** Runtime channel/permission snapshot for the Settings diagnostics block. */
export async function notificationDiagnostics(): Promise<NotificationDiagnostics> {
  const { status } = await Notifications.getPermissionsAsync();
  const read = async (id: string) => {
    try {
      const channel = await Notifications.getNotificationChannelAsync(id);
      // expo returns null for missing channels; sound may be null/undefined.
      return channel ? ((channel as { sound?: string | null }).sound ?? null) : null;
    } catch {
      return null;
    }
  };
  return {
    permission: status,
    ordersChannelSound: await read(ORDERS_CHANNEL),
    pushAliasChannelSound: await read(PUSH_CHANNEL_ALIAS),
  };
}

export async function getPermissionState(): Promise<'granted' | 'undetermined' | 'denied'> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Request the Android 13+ notification permission. After a single denial
 * Android blocks re-prompting — callers must then send the user to the
 * system settings (openNotificationSettings).
 */
export async function requestPermission(): Promise<boolean> {
  if (Platform.OS === 'android' && (Platform.Version as number) < 33) {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  }
  const { status } = await Notifications.requestPermissionsAsync({
    android: ['POST_NOTIFICATIONS'],
  });
  return status === 'granted';
}

/** Open this app's page in Android system settings (notification toggle). */
export function openNotificationSettings(): void {
  Linking.openSettings().catch(() => undefined);
}

/**
 * Fire the new-order notification for a genuinely new paid order: ONE
 * heads-up notification on the orders_v2 channel — title/body per spec, the
 * channel carries the custom sound in every app state. Never throws: a
 * notification failure must never affect the order pipeline (the order is on
 * the board and the print job is queued).
 */
export async function notifyNewOrder(order: Order): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'New VIZIO FOOD Order',
        body: `Order #${order.orderNumber} — ${order.customerName}`,
        data: { orderId: order.id },
      },
      trigger: Platform.OS === 'android' ? ({ channelId: ORDERS_CHANNEL } as never) : null,
    });
  } catch (error) {
    console.warn(
      '[notifications] local notification failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Notify about a print failure that needs a human (job FAILED after all
 * retries). One notification per job id — repeated failures don't spam.
 */
export async function notifyPrintFailure(orderNumber: string, jobId: string): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Receipt failed to print',
        body: `Order #${orderNumber.replace('VF-', '')} — open Settings and tap Retry failed prints.`,
        data: { jobId, printerError: true },
      },
      trigger: Platform.OS === 'android' ? ({ channelId: PRINT_ERRORS_CHANNEL } as never) : null,
    });
  } catch {
    // best effort
  }
}

/** TEST NOTIFICATION — presented on the real orders_v2 channel, exact UX. */
export async function sendTestNotification(): Promise<void> {
  await ensureChannels();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'TEST — New VIZIO FOOD Order',
      body: 'This is exactly how a real order alert looks and sounds.',
      data: { test: true },
    },
    trigger: Platform.OS === 'android' ? ({ channelId: ORDERS_CHANNEL } as never) : null,
  });
}

let listenersRegistered = false;

/** Wire push listeners once at app start. */
export function registerListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  Notifications.addNotificationResponseReceivedListener((event) => {
    const data = event.notification.request.content.data as
      | { orderId?: string; test?: boolean }
      | undefined;
    if (!data?.orderId || data.test) return;
    responseHandler?.(data.orderId);
  });
}

/** Dismiss the persistent new-order notifications once staff saw them. */
export async function dismissAllNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    // best effort
  }
}
