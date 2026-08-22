// Heartbeat — periodic kitchen_devices upsert so the admin dashboard can see
// "Kitchen Tablet: ONLINE, last seen 10s ago, printer ONLINE".

import { supabase } from '../lib/supabase';
import { appVersion, getDeviceId, getDeviceName } from '../lib/device';
import { useOrdersStore } from '../state/ordersStore';
import { usePrintStore } from '../state/printStore';
import { notificationStatus } from './notifications';
import { printerAgentHealth } from './printerAgent';

const HEARTBEAT_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function beat(): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    const orders = useOrdersStore.getState();
    const print = usePrintStore.getState();

    const printers = Object.values(print.printers);
    const printerStatus = printers.length
      ? printers.some((p) => p.health === 'error')
        ? 'error'
        : printers.every((p) => p.health === 'online' || p.health === 'printing')
          ? 'online'
          : printers.some((p) => p.health === 'online' || p.health === 'printing') ? 'degraded' : 'offline'
      : '';

    await supabase.from('kitchen_devices').upsert(
      {
        device_id: deviceId,
        name: await getDeviceName(),
        platform: 'android',
        app_version: appVersion(),
        enabled: true,
        last_seen: new Date().toISOString(),
        connectivity: orders.internetOnline ? 'online' : 'offline',
        realtime_status: orders.realtimeConnected ? 'connected' : 'disconnected',
        printer_status: printerStatus,
        notification_status: await notificationStatus(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'device_id' },
    );
  } catch {
    // Heartbeat is best-effort; the next tick retries.
  }
}

export function startHeartbeat(): void {
  if (timer) return;
  void beat();
  timer = setInterval(() => {
    void beat();
    void printerAgentHealth(true);
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Sign-out: mark the device disabled so it never receives notifications. */
export async function disableDevice(): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    await supabase
      .from('kitchen_devices')
      .update({ enabled: false, push_token: '', updated_at: new Date().toISOString() })
      .eq('device_id', deviceId);
  } catch {
    // best effort
  }
}
