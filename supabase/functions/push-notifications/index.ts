// Push notifications for new PAID orders (Expo Push API — FCM under the hood).
//
// Deploy: supabase functions deploy push-notifications
//
// Token storage (two layers, unioned at send time):
//   1. kitchen_devices table — tablets register here (added by migration
//      20260827000000_kitchen_android_support). Always available, no extra
//      secrets required. Kitchen role may register.
//   2. Legacy JSON document in the project's secret store via the public
//      Supabase Management API (web/admin browsers). REQUIRES the optional
//      secret:  supabase secrets set SUPABASE_ACCESS_TOKEN=sbp_xxx
//      Until it is set, that layer is skipped and everything else works.
//
// Actions (POST JSON):
//   { action: 'register',   token, deviceId?, platform?, appVersion?, name? }
//                                                    — Authorization: Bearer <user JWT>,
//                                                      role must be admin/staff/kitchen
//   { action: 'unregister', token }                 — Bearer JWT *or* possession of the token itself (device-initiated)
//   { action: 'notify-new-order', orderId, orderNumber, total }
//                                                    — Authorization must be the internal service-role key
//                                                      (called by the stripe-webhook function only)
//
// The notify action de-duplicates per order (Stripe webhook replays) and
// prunes dead tokens from Expo's send receipts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ACCESS_TOKEN = Deno.env.get('SUPABASE_ACCESS_TOKEN');
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const MANAGEMENT_SECRETS_URL =
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const STORE_KEY = 'push_tokens_v1';
const MAX_TOKENS = 25;
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

interface StoredToken {
  token: string;
  userId: string;
  role: string;
  updatedAt: string;
}

interface StoreDocument {
  tokens: StoredToken[];
  lastNotified?: { orderId: string; at: string };
}

// ── Storage adapter (Management API secrets endpoint) ──
// POST upserts only the named secret. NEVER use PUT — it would delete every
// other secret in the project.

async function readStore(): Promise<StoreDocument> {
  if (!ACCESS_TOKEN) throw new Error('push-storage-not-configured');
  const res = await fetch(MANAGEMENT_SECRETS_URL, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`secret-store-read-${res.status}`);
  const secrets = (await res.json()) as Array<{ name: string; value?: string }>;
  const entry = secrets.find((s) => s.name === STORE_KEY);
  if (!entry?.value) return { tokens: [] };
  const parsed = JSON.parse(entry.value) as StoreDocument;
  return { tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [] };
}

async function writeStore(doc: StoreDocument): Promise<void> {
  if (!ACCESS_TOKEN) throw new Error('push-storage-not-configured');
  const res = await fetch(MANAGEMENT_SECRETS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ name: STORE_KEY, value: JSON.stringify(doc) }]),
  });
  if (!res.ok) throw new Error(`secret-store-write-${res.status}`);
}

// ── Auth helpers ──

async function callerRole(bearer: string): Promise<{ userId: string; role: string } | null> {
  const { data, error } = await db.auth.getUser(bearer);
  if (error || !data.user) return null;
  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  const role = String((profile as { role?: string } | null)?.role ?? '');
  if (role !== 'admin' && role !== 'staff' && role !== 'kitchen') return null;
  return { userId: data.user.id, role };
}

const unauthorized = (message: string) =>
  Response.json({ error: message }, { status: 401 });

// ── kitchen_devices token layer ──

interface DeviceRow {
  device_id: string;
  push_token: string;
  enabled: boolean;
}

async function upsertDeviceToken(input: {
  token: string;
  userId: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
  name?: string;
}): Promise<void> {
  if (!input.deviceId) return; // browsers without a device row
  const { error } = await db.from('kitchen_devices').upsert(
    {
      device_id: input.deviceId,
      user_id: input.userId,
      push_token: input.token,
      enabled: true,
      platform: input.platform || 'android',
      app_version: input.appVersion || '',
      name: input.name || '',
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'device_id' },
  );
  if (error) console.error('kitchen_devices upsert failed:', error.message);
}

async function clearDeviceToken(token: string): Promise<void> {
  const { error } = await db.from('kitchen_devices')
    .update({ push_token: '', enabled: false, updated_at: new Date().toISOString() })
    .eq('push_token', token);
  if (error) console.error('kitchen_devices clear failed:', error.message);
}

async function deviceTokens(): Promise<string[]> {
  const { data, error } = await db
    .from('kitchen_devices')
    .select('device_id,push_token,enabled')
    .eq('enabled', true)
    .neq('push_token', '');
  if (error) {
    console.error('kitchen_devices read failed (migration not applied yet?):', error.message);
    return [];
  }
  return (data as DeviceRow[]).map((d) => d.push_token);
}

// ── Expo push send ──

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Errors that mean the token is permanently dead and should be pruned.
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidToken']);

async function sendToAll(
  tokens: string[],
  orderId: string,
  orderNumber: string,
  total: number,
): Promise<{ sent: number; deadTokens: string[] }> {
  const messages = tokens.map((to) => ({
    to,
    title: 'New VIZIO FOOD Order',
    body: `Order #${orderNumber} — $${total.toFixed(2)}`,
    data: { orderId, orderNumber, navigate: 'order' },
    sound: 'default',
    priority: 'high',
    channelId: 'orders',
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`expo-push-${res.status}`);

  const receipts = (await res.json()) as Array<{
    status: 'ok' | 'error';
    message?: string;
    details?: { error?: string };
  }>;

  const deadTokens: string[] = [];
  receipts.forEach((receipt, i) => {
    if (receipt.status === 'error' && receipt.details?.error &&
        DEAD_TOKEN_ERRORS.has(receipt.details.error)) {
      deadTokens.push(messages[i].to);
    }
  });
  return { sent: messages.length - deadTokens.length, deadTokens };
}

async function pruneDead(deadTokens: string[], store: StoreDocument | null): Promise<void> {
  if (!deadTokens.length) return;
  await Promise.allSettled(deadTokens.map((token) => clearDeviceToken(token)));
  if (store) {
    const before = store.tokens.length;
    store.tokens = store.tokens.filter((t) => !deadTokens.includes(t.token));
    if (store.tokens.length !== before && ACCESS_TOKEN) {
      try {
        await writeStore(store);
      } catch (err) {
        console.error('prune write failed:', err);
      }
    }
  }
}

// ── Handler ──

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: {
    action?: string;
    token?: string;
    deviceId?: string;
    platform?: string;
    appVersion?: string;
    name?: string;
    orderId?: string;
    orderNumber?: string;
    total?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';

  try {
    // ── Device/admin registration ──
    if (body.action === 'register' || body.action === 'unregister') {
      const token = String(body.token ?? '');
      if (!token.startsWith('ExpoPushToken[')) {
        return Response.json({ error: 'Invalid push token' }, { status: 400 });
      }

      // unregister may be device-initiated after sign-out (no JWT): possession
      // of the token itself is proof of device ownership and can only silence
      // that one device, so it is safe to accept without auth.
      let identity: { userId: string; role: string } | null = null;
      if (bearer && bearer !== SERVICE_ROLE_KEY) {
        identity = await callerRole(bearer);
        if (!identity) return unauthorized('Admin, staff or kitchen account required.');
      } else if (body.action === 'register') {
        return unauthorized('Authentication required.');
      }

      if (body.action === 'register' && identity) {
        // Layer 1 (always): kitchen_devices row for the tablet.
        await upsertDeviceToken({
          token,
          userId: identity.userId,
          deviceId: body.deviceId,
          platform: body.platform,
          appVersion: body.appVersion,
          name: body.name,
        });
        // Layer 2 (optional): legacy secret-store document for browsers.
        let storedInSecrets = false;
        if (identity.role !== 'kitchen' && ACCESS_TOKEN) {
          try {
            const store = await readStore();
            store.tokens = store.tokens.filter((t) => t.token !== token);
            store.tokens.push({ token, userId: identity.userId, role: identity.role, updatedAt: new Date().toISOString() });
            store.tokens.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            store.tokens = store.tokens.slice(0, MAX_TOKENS);
            await writeStore(store);
            storedInSecrets = true;
          } catch (err) {
            console.error('secret store register failed:', err);
          }
        }
        return Response.json({ ok: true, registered: true, secretsStore: storedInSecrets });
      }

      // unregister
      await clearDeviceToken(token);
      if (ACCESS_TOKEN) {
        try {
          const store = await readStore();
          const before = store.tokens.length;
          store.tokens = store.tokens.filter((t) => t.token !== token);
          if (store.tokens.length !== before) await writeStore(store);
        } catch (err) {
          console.error('secret store unregister failed:', err);
        }
      }
      return Response.json({ ok: true, registered: false });
    }

    // ── Internal: new paid order notification (called by stripe-webhook) ──
    if (body.action === 'notify-new-order') {
      if (!bearer || bearer !== SERVICE_ROLE_KEY) {
        return unauthorized('Internal call only.');
      }
      const orderId = String(body.orderId ?? '');
      const orderNumber = String(body.orderNumber ?? '');
      const total = Number(body.total ?? 0);
      if (!orderId || !orderNumber) {
        return Response.json({ error: 'orderId and orderNumber are required' }, { status: 400 });
      }

      let store: StoreDocument | null = null;
      if (ACCESS_TOKEN) {
        try {
          store = await readStore();
        } catch (err) {
          console.error('secret store read failed:', err);
        }
      }

      // De-duplicate: Stripe can replay checkout.session.completed.
      if (
        store?.lastNotified?.orderId === orderId &&
        Date.now() - new Date(store.lastNotified.at).getTime() < DEDUPE_WINDOW_MS
      ) {
        return Response.json({ ok: true, sent: 0, deduped: true });
      }

      // Union of both token layers, distinct by token string.
      const secretTokens = store?.tokens.map((t) => t.token) ?? [];
      const deviceLayerTokens = await deviceTokens();
      const tokens = [...new Set([...secretTokens, ...deviceLayerTokens])];

      if (!tokens.length) {
        if (store && ACCESS_TOKEN) {
          store.lastNotified = { orderId, at: new Date().toISOString() };
          try {
            await writeStore(store);
          } catch (err) {
            console.error('secret store write failed:', err);
          }
        }
        return Response.json({ ok: true, sent: 0 });
      }

      const { sent, deadTokens } = await sendToAll(tokens, orderId, orderNumber, total);
      await pruneDead(deadTokens, store);
      if (store && ACCESS_TOKEN) {
        store.lastNotified = { orderId, at: new Date().toISOString() };
        try {
          await writeStore(store);
        } catch (err) {
          console.error('secret store write failed:', err);
        }
      }
      return Response.json({ ok: true, sent, pruned: deadTokens.length });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('push-notifications error:', error);
    return Response.json({ error: 'Push notification failure' }, { status: 500 });
  }
});
