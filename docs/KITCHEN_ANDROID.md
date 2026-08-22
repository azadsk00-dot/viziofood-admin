# Kitchen Android Tablet — Architecture & Operations

Production Android app for the restaurant kitchen: live order board, loud new-order
alerts, print monitoring, offline recovery and device health.

- **Project**: `kitchen-android/` (Expo / React Native — a real native Android app, NOT a WebView wrapper)
- **Package**: `com.viziofood.kitchen`
- **Backend**: the SAME Supabase project as customer/admin/kitchen web and the printer service. No separate database.
- **Priority order** (from the requirements): ① never lose a paid order ② never lose a print job ③ always alert staff ④ printing works without the app open ⑤ recover from internet/printer/tablet failure ⑥ correct order status ⑦ security ⑧ performance ⑨ UI/UX.

---

## 1. No single point of failure — where the tablet fits

```
Customer → Stripe → verified webhook → Supabase order → print_jobs
                                    ↓                        ↓
                             push-notifications      Local Printer Service (PC)
                                    ↓                        ↓
                        Kitchen tablet (this app)     Physical kitchen printer
```

The tablet is an **operational client**, never the system of record:

| Failure | What happens |
|---|---|
| Tablet off / killed / rebooted | Orders + print jobs live in Supabase; the printer service keeps printing; pushes queue at FCM and alert on next device wake. |
| Printer offline | Print jobs stay QUEUED/RETRYING in `print_jobs` with backoff (5s→60s, 5 attempts); the tablet shows PRINTER ERROR + Retry. |
| Internet down | Tablet shows OFFLINE and keeps showing already-received orders from its persistent local store. |
| Internet returns | Reconciliation query fetches everything missed; missed orders alert and are logged (`kitchen_incidents: missed_order`). |
| Duplicate webhook | DB idempotency: Draft→New flip guard + `print_jobs (printer_id, order_id) WHERE status <> 'FAILED'` unique index. The tablet dedupes alerts by order id. |

---

## 2. App architecture

```
kitchen-android/
  app.config.ts          Expo config: package id, permissions, notification channels
  eas.json               build profiles: development / preview (APK) / production (AAB)
  assets/sounds/         new-order-alert.wav (original Vizio alert, see §6)
  scripts/               gen-alert-sound.cjs, gen-icons.cjs (regenerate assets)
  src/
    lib/                 pure logic: types, orderLogic (state-machine mirror),
                         reconcile (merge/missed-order detection), settings,
                         format, config, supabase client, device identity
    state/               zustand stores: auth, orders (persisted), print, settings
    services/            syncService (realtime + reconciliation), notifications
                         (Expo/FCM), alertPlayer, heartbeat, incidents,
                         printActions, printerAgent, orderActions, mappers
    navigation/          tab + stack navigator
    screens/             Login, Dashboard, OrderDetail, PrintQueue, Health,
                         Shift (handover/daily summary/incidents), Settings
    components/          OrderCard, AlertOverlay, ConnectionBanner, ui kit
  __tests__/             vitest suite for the pure logic
```

### Sync = realtime + reconciliation (never realtime alone)

`syncService` (src/services/syncService.ts):

1. **Startup**: full reconcile of today's non-Draft orders → merge → subscribe.
2. **Realtime**: `orders` (`*`) and `print_jobs` (`*`) postgres_changes channels.
3. **Reconnect / foreground**: reconcile again — this is the missed-order net.
4. **Periodic**: reconcile every N seconds (default 60, configurable 30–120) even when realtime is connected.
5. **Merging** is keyed by order id (duplicates impossible); alert-worthiness is checked against the persisted `alertedOrderIds` set (duplicate alerts impossible, controlled repeats for unacknowledged orders allowed).

The webhook flips Draft→New as an **UPDATE**, so the alert logic keys on the resulting row state (`paid && New && unacknowledged && not alerted`) rather than on INSERT events — both realtime and reconciliation paths discover new orders.

### Order status authority

The kitchen advances orders with one tap (`New → Accepted → Preparing → Ready → Completed`).
Every write is a plain Supabase `UPDATE orders SET status=…` guarded by:

- **RLS** (`kitchen_update_status`: admin/staff/kitchen only), and
- the **DB trigger** `enforce_order_status_transition` (forward-only, terminal states locked, kitchen accounts may only touch workflow fields — payment/customer columns are read-only for kitchen).

The app mirrors those rules client-side (`orderLogic.canTransition`) so invalid requests are never attempted, and surfaces the DB error message when another client raced it.

### Acknowledgement

`ACKNOWLEDGE` writes `orders.acknowledged_at/acknowledged_by` (additive columns) and
`kitchen_notification_logs.acknowledged_at`. Unacknowledged orders keep alerting
according to settings (repeat count/interval). Accepting an order auto-acknowledges
(configurable).

---

## 3. Backend changes (ALL ADDITIVE — review before deploying)

| Change | File | Notes |
|---|---|---|
| `kitchen_devices` table (heartbeat/presence), `orders.acknowledged_at/by`, `kitchen_notification_logs`, `kitchen_incidents`, `print_jobs.origin` | `supabase/migrations/20260827000000_kitchen_android_support.sql` | RLS: kitchen can read orders/printers/jobs/devices/logs and write workflow + audit fields only. Realtime publication additions guarded. |
| Kitchen role can register push tokens; tokens also stored in `kitchen_devices`; notify sends to both token layers | `supabase/functions/push-notifications/index.ts` | Redeploy the function. Backward compatible; web/admin flow unchanged. |
| `reprint` / `retry-job` actions with audit | `supabase/functions/kitchen-actions/index.ts` (new) | Deploy once: `supabase functions deploy kitchen-actions`. The app falls back to a direct requeue if it isn't deployed. |
| Optional LAN HTTP endpoint for the agent | `printer-service/src/http.js` (new) + `src/index.js` | Off by default; enable with `VIZIO_AGENT_HTTP_PORT=3777` (+ optional token). Powers live printer status + TEST PRINT. |

**Deploy sequence (manual, after review):**
```
supabase db push                                            # migration
supabase functions deploy push-notifications
supabase functions deploy kitchen-actions
# restart printer-service after adding VIZIO_AGENT_HTTP_PORT to its .env
```

Nothing in the customer website, admin website, Stripe settings, refunds, RLS
policies or existing tables is modified. Do not apply changes to production
without announcing them first.

---

## 4. Device setup (restaurant tablet)

1. Install the APK (below). Android 8+ recommended.
2. Sign in with a **kitchen account** (`profiles.role = 'kitchen'`) — create it in Supabase Auth and set the role (snippet in docs/PRINTER_SETUP.md §2).
3. Grant notifications. Press **TEST ORDER SOUND** in Settings and confirm it's audible from the prep area; raise volume if needed.
4. Settings worth enabling on a dedicated device:
   - **Keep screen awake** (uses `expo-keep-awake`, only while the app is displayed — it does not block sleep globally).
   - Battery optimization exemption: Settings → Apps → Vizio Kitchen → Battery → *Unrestricted*. This is required for reliable background push on many Android skins (Xiaomi/Samsung/Huawei are the strictest).
   - For true kiosk operation, use Android's **guided-access / kiosk mode** (Settings → Digital Wellbeing → pin, or a dedicated-device MDM) so the app relaunches at boot and staff can't leave it.

### Honest Android limitations (by design)

No Android app can run arbitrary background work indefinitely. This app therefore
relies on the *supported* mechanisms only: FCM high-priority push (delivered by
Google Play Services even when the app is killed), notification channels with the
custom sound/vibration, keep-awake while displayed, and backend reconciliation
whenever the app wakes. Printing never depended on the tablet in the first place —
the printer service owns it.

---

## 5. Building the APK / AAB

Prereqs: Node 20+, an Expo account (`npx expo login`), and either EAS Build (cloud, no local Android SDK) or a local JDK 17 + Android SDK for `expo prebuild` + Gradle.

```bash
cd kitchen-android
cp .env.example .env        # fill in EXPO_PUBLIC_SUPABASE_URL / ANON_KEY (+ printer agent URL)
npm install
npx expo install --check    # pins Expo-managed native dep versions

# Cloud builds (recommended; handles signing):
eas build -p android --profile development   # debug APK + dev client
eas build -p android --profile preview       # release APK for sideloading on tablets
eas build -p android --profile production    # release AAB for Play Store

# Local native build instead:
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease      # APK  (assembleDebug for debug)
```

- **Signing**: EAS manages keystores (`eas credentials`). For local builds generate one (`keytool -genkeypair -v -keystore vizio-kitchen.keystore -alias vizio -keyalg RSA -keysize 2048 -validity 10000`) and wire it in `android/app/build.gradle`. **Never commit keystores or credentials** — `.gitignore` already excludes `*.jks/*.keystore` (except debug).
- **FCM**: pushes ride Expo's FCM credentials by default — nothing to configure. To use your own Firebase project, `eas credentials` → Android → FCM key.
- **Permissions** (app.config.ts): `POST_NOTIFICATIONS`, `VIBRATE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `USE_FULL_SCREEN_INTENT` (full-screen alert on lock screens where the OEM honours it).
- **Notification channels**: `orders` (max importance, custom sound, vibration `[0,500,200,500,200,800]`, public lock screen, bypass DND) and `print-errors` (high importance).

### Local development

```bash
npx expo start                       # Expo Go (UI work)
npx expo start --dev-client          # with a development build (push, sound, keep-awake)
npm run typecheck && npm test        # TS + vitest pure-logic suite
```

---

## 6. The Vizio order alert (original sound)

`assets/sounds/new-order-alert.wav` — generated by `npm run gen:sound`
(scripts/gen-alert-sound.cjs). ~2.4 s, 44.1 kHz mono, peak-normalized 0.95:
a rising C6→E6→G6 brass-toned arpeggio played twice, finished with a high
bell double-ding. It is an **original** composition for Vizio Food — inspired
only by the functional need (loud + long + urgent + unmistakably an order),
not copied from Uber or any system sound. To restyle it, edit the script's
score constants and regenerate; the notification channel picks up the new file
on next build/install.

Alert behaviour (all configurable in Settings → Alerts): enable/disable, volume
(20–100%), repeat count (0 = repeat until acknowledged), repeat interval,
vibration, **TEST ORDER SOUND** and **TEST NOTIFICATION** buttons.

---

## 7. Testing matrix

Automated: `npm test` in `kitchen-android/` (state machine, escalation, filters/search, reconcile/missed-order, settings normalization, formatting) and the web repo's `npm test` still passes.

Manual acceptance (run before go-live):

- Paid order end-to-end: checkout (Stripe TEST) → webhook → order New+paid → print job → physical print → tablet alert (sound + overlay) → acknowledge → accept → preparing → ready → completed.
- Tablet closed/killed → printer still prints; reopen tablet → order present (reconcile).
- Airplane mode 5 min with a paid order placed meanwhile → reconnect → order appears as NEW + alert + `missed_order` incident.
- Printer off → PRINTER ERROR, job RETRYING; printer on → auto-print; 5 failures → FAILED → Retry from tablet prints it.
- Duplicate webhook (Stripe dashboard replay) → no second order, no second print, no second alert.
- Screen locked → push arrives with sound/vibration on the lock screen.
- Two kitchen tablets signed in → both alert, both can advance (race-safe: DB trigger + last-write wins on the same forward-only path).

---

## 8. Future work hooks already in place

- Multiple tablets: every device registers its own `kitchen_devices` row/token; alerts fan out to all; no duplicate order processing (orders are only ever mutated in Supabase).
- Station routing: `printers.station` (kitchen/bar/coffee/dessert/pickup/receipt) already exists; the webhook fans out per printer; per-item routing can be added in the webhook + a `station` filter in the app without schema changes.
- Manager tablet: same app, `staff`/`admin` role unlocks cancel + more (permission split is enforced server-side by RLS).
