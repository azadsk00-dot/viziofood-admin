# Vizio Kitchen — Android Tablet App

Production kitchen tablet app for Vizio Food: live order board, loud new-order
alerts, print monitoring, offline recovery and device health. A real native
Android application (Expo / React Native) — **not** a WebView wrapper.

**Full documentation lives in the main repo:**

- `docs/KITCHEN_ANDROID.md` — architecture, setup, build, test matrix
- `docs/PRINTER_ARCHITECTURE.md` — print pipeline & guarantees
- `docs/NOTIFICATIONS.md` — push/alert architecture & audit trail
- `docs/KITCHEN_TROUBLESHOOTING.md` — staff-facing troubleshooting

## Quick start

```bash
cp .env.example .env     # fill EXPO_PUBLIC_SUPABASE_URL / ANON_KEY
npm install
npx expo start           # develop (Expo Go or a dev build)
npm run typecheck && npm test
```

Build an installable APK (cloud, no local Android SDK needed):

```bash
npm i -g eas-cli && eas login
eas build -p android --profile preview    # release APK
eas build -p android --profile production # AAB for Play Store
```

## Requirements checklist (what's where)

- Paid orders never lost → backend is the source of truth; app is a client (`src/services/syncService.ts`)
- Background notifications → FCM high-priority on the `orders` channel (`src/services/notifications.ts`, `app.config.ts`)
- Custom loud alert, configurable volume/repeat/vibration + tests (`assets/sounds/`, `src/services/alertPlayer.ts`)
- Missed-order protection → realtime + reconciliation on startup/reconnect/foreground/periodic (`src/lib/reconcile.ts`)
- Offline mode → persisted order store + OFFLINE banner (`src/state/ordersStore.ts`)
- Order acknowledgement + escalation + kitchen timers (`src/lib/orderLogic.ts`, OrderCard)
- Print queue / retry / reprint / test print (`src/screens/PrintQueueScreen.tsx`, `src/services/printActions.ts`)
- Device health + heartbeat (`src/screens/HealthScreen.tsx`, `src/services/heartbeat.ts`)
- Shift handover, daily summary, incident log (`src/screens/ShiftScreen.tsx`)
- Keep screen awake (`expo-keep-awake`, Settings)
- Roles: kitchen/staff/admin enforced by Supabase RLS + the DB state machine — the app never bypasses server-side validation

## Regenerating assets

```bash
npm run gen:sound   # original Vizio new-order alert (edit scripts/gen-alert-sound.cjs to restyle)
npm run gen:icons   # placeholder icons — replace with brand art before store submission
```

## Secrets policy

Only public values are bundled (`EXPO_PUBLIC_SUPABASE_*`, anon key). The
service-role key, Stripe secrets and webhook secrets must NEVER appear here —
RLS is the authorization layer. `.env` and keystores are gitignored.
