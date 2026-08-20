// Push notifications for new PAID orders (Expo Push API — FCM under the hood).
//
// Deploy: supabase functions deploy push-notifications
//
// Token storage (no database/schema change): tokens are kept as a JSON
// document in the project's secret store via the public Supabase Management
// API. This REQUIRES one optional secret to be configured once:
//
//   supabase secrets set SUPABASE_ACCESS_TOKEN=sbp_xxx
//
// Use a fine-grained access token restricted to secrets management for this
// project. Until it is set, register/notify return a clear "not configured"
// response and everything else keeps working (the mobile app logs and moves on).
//
// Actions (POST JSON):
//   { action: 'register',   token }                 — Authorization: Bearer <user JWT>, role must be admin/staff
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
  if (role !== 'admin' && role !== 'staff') return null;
  return { userId: data.user.id, role };
}

const unauthorized = (message: string) =>
  Response.json({ error: message }, { status: 401 });

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
    data: { orderId },
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

// ── Handler ──

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: { action?: string; token?: string; orderId?: string; orderNumber?: string; total?: number };
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
        if (!identity) return unauthorized('Admin or staff account required.');
      } else if (body.action === 'register') {
        return unauthorized('Authentication required.');
      }

      let store: StoreDocument;
      try {
        store = await readStore();
      } catch (err) {
        if (err instanceof Error && err.message === 'push-storage-not-configured') {
          return Response.json({ error: 'Push storage not configured. Set SUPABASE_ACCESS_TOKEN as a function secret.' }, { status: 503 });
        }
        throw err;
      }

      if (body.action === 'register' && identity) {
        store.tokens = store.tokens.filter((t) => t.token !== token);
        store.tokens.push({ token, userId: identity.userId, role: identity.role, updatedAt: new Date().toISOString() });
        store.tokens.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        store.tokens = store.tokens.slice(0, MAX_TOKENS);
        await writeStore(store);
        return Response.json({ ok: true, registered: true });
      }

      // unregister
      const before = store.tokens.length;
      store.tokens = store.tokens.filter((t) => t.token !== token);
      if (store.tokens.length !== before) await writeStore(store);
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

      let store: StoreDocument;
      try {
        store = await readStore();
      } catch (err) {
        if (err instanceof Error && err.message === 'push-storage-not-configured') {
          return Response.json({ ok: true, sent: 0, skipped: 'storage-not-configured' });
        }
        throw err;
      }

      // De-duplicate: Stripe can replay checkout.session.completed.
      if (
        store.lastNotified?.orderId === orderId &&
        Date.now() - new Date(store.lastNotified.at).getTime() < DEDUPE_WINDOW_MS
      ) {
        return Response.json({ ok: true, sent: 0, deduped: true });
      }

      if (!store.tokens.length) {
        await writeStore({ ...store, lastNotified: { orderId, at: new Date().toISOString() } });
        return Response.json({ ok: true, sent: 0 });
      }

      const { sent, deadTokens } = await sendToAll(
        store.tokens.map((t) => t.token),
        orderId,
        orderNumber,
        total,
      );
      if (deadTokens.length) {
        store.tokens = store.tokens.filter((t) => !deadTokens.includes(t.token));
      }
      store.lastNotified = { orderId, at: new Date().toISOString() };
      await writeStore(store);
      return Response.json({ ok: true, sent, pruned: deadTokens.length });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('push-notifications error:', error);
    return Response.json({ error: 'Push notification failure' }, { status: 500 });
  }
});
