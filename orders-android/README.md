# VIZIO FOOD Orders (`com.viziofood.orders`)

A dedicated Android order terminal for the restaurant: **LIVE ORDERS**, **SCHEDULED**,
**HISTORY** and **PRINTER** — nothing else. It installs alongside the existing
VIZIO FOOD Admin app (`com.viziofood.admin`) and the Kitchen tablet app
(`com.viziofood.kitchen`); neither is modified.

## Notifications & sound (v1.1.0 architecture)

- The alert sound is a **property of the Android notification channel** — one
  mechanism covers all four app states (open, background, locked, closed).
  The wav is packaged into `res/raw` by the expo-notifications plugin
  `sounds` option (v1.0.0 never packaged it and created the channel without
  a sound — that was the root cause of silent alerts).
- Channels use the **v2 ids** (`orders_v2`, `print_errors_v2`): Android
  channels are immutable, so the corrected sound ships on new ids and the
  dead v1 channels are deleted at startup.
- Notification permission is requested immediately after sign-in (and its
  state is visible in Settings with an "open system settings" escape hatch —
  after one denial Android blocks re-prompting forever).
- **Background/locked/closed delivery requires Firebase credentials in the
  APK**: drop a `google-services.json` at `orders-android/` (then prebuild +
  rebuild), or use `eas build -p android --profile preview` (EAS injects
  Expo's default FCM credentials). Local Gradle builds without it still get
  full in-app realtime alerts — only FCM push is unavailable, and the app
  re-attempts registration on every foreground.

## What it does

- **Live orders, instantly.** Supabase Realtime on the `orders` table is the primary
  path — no polling. A paid Stripe order (webhook → `New + paid` → realtime event)
  appears immediately, fires an Android heads-up notification with a custom loud
  order sound, and starts printing. INSERT *and* UPDATE are handled, keyed on the
  resulting row state (`payment_status = paid` AND `status = New`), never on
  `payload.old`. Reconciliation (startup, reconnect, foreground, 60s safety sweep)
  catches anything realtime missed — without re-alerting old orders.
- **Never twice.** One central `OrderEventProcessor` funnels every arrival path
  (realtime, reconciliation, push echo). Duplicate cards, duplicate notifications
  and duplicate receipts are structurally impossible (order-id keyed merge +
  persisted alerted set + order-id keyed print queue). Manual **Reprint** is the
  only way a receipt prints twice.
- **Printing.** The proven Star implementation from the VIZIO FOOD Admin app:
  StarXpand SDK (`react-native-star-io10`), `TCP:<ip>` LAN identifier,
  `autoSwitchInterface=false`, 15 s open timeout. A persistent local queue
  serializes jobs (A then B, never overlapping), retries with exponential backoff
  (5→60 s, 5 attempts), keeps failures until retried, and shows clear errors.
- **Scheduled orders.** Future pickup/dine-in times are read from the production
  `Scheduled pickup: …` note convention — no schema change. Future orders stay off
  the live board until the 30-minute preparation window (SCHEDULED tab shows
  UPCOMING / READY TO PROCESS with countdowns).
- **Resilience.** Offline banner + auto-reconnect, channel health checks on
  foreground, orders cached locally (visible offline), friendly errors everywhere.

## Setup

```bash
cd orders-android
cp .env.example .env        # fill EXPO_PUBLIC_SUPABASE_URL / ANON_KEY
npm install
npx expo start              # development
```

Sign in with an existing **admin / staff / kitchen** account (Supabase Auth +
RLS — the app holds only the public anon key; no service-role or Stripe secrets).

## Build the APK

Local Gradle builds must run from a **short path** — the Star/cmake object
files exceed Windows' 260-character path limit when built from the long repo
path (the same constraint the other VIZIO FOOD Android projects hit). The
whole flow is scripted:

```bash
npm run prebuild                        # expo prebuild --platform android
node scripts/configure-signing.cjs      # wires vizio-orders.keystore into android/app/build.gradle
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/copy-for-build.ps1   # copies to C:\vo
cd /c/vo/android && ./gradlew assembleRelease --no-daemon -x lint
# → C:\vo\android\app\build\outputs\apk\release\app-release.apk
```

`app.config.ts` sets `compileSdkVersion 37` (the StarXpand AAR requires it —
same as the Admin app). Signing: `vizio-orders.keystore` at the project root
(generate once with keytool; gitignored — **back it up**, every update of
`com.viziofood.orders` must be signed with the same key). Without it the
build falls back to the debug keystore.

EAS cloud builds (`eas build -p android --profile preview`) work from the
repo path directly — the short-path dance is only needed for local builds.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest (scheduled parsing, state machine, board routing,
                    #   reconciliation, printer identifier, queue engine,
                    #   central dedupe processor)
npm run gen:sound   # regenerate assets/sounds/new-order-alert.wav
npm run gen:icons   # regenerate app icons
```

## Backend

**Zero changes.** Same Supabase project, existing `orders`/`order_items` tables,
existing RLS, existing Edge Functions (`push-notifications` registers this app's
Expo push token exactly like the Admin app; `stripe-webhook` already fires the
background push). No database migration is needed or performed.
