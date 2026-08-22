# Notifications — Kitchen Tablet (Android)

How the kitchen gets alerted about new PAID orders, and how duplicates and
missed notifications are prevented.

## Two alert paths, one experience

| App state | Mechanism | Result |
|---|---|---|
| Foreground (kitchen display visible) | Supabase realtime on `orders` → in-app **AlertOverlay** + `expo-audio` playback + vibration | full-screen takeover until acknowledged |
| Backgrounded / screen locked / app killed | **FCM high-priority push** (via Expo Push) on channel `orders` | heads-up notification with the custom sound + vibration; tapping opens the order |

Realtime is never the only path: reconciliation (startup, reconnect,
foreground, periodic) also detects alert-worthy orders, so a missed websocket
event still alerts.

## Delivery chain

```
stripe-webhook (Draft→New flip confirmed)
   → POST push-notifications {action: notify-new-order}   (service-role only)
      → tokens = secret-store tokens  ∪  kitchen_devices tokens (enabled, distinct)
      → Expo Push API (FCM) priority=high, channelId='orders'
   → tablet: channel 'orders' = MAX importance, custom sound, vibration,
     public lock-screen, bypass DND
```

## Token registration & lifecycle

1. On sign-in the tablet calls `getExpoPushTokenAsync` and POSTs
   `{action: register, token, deviceId, platform, appVersion, name}` with the
   user's JWT. The function (edge) verifies the profile role is
   admin/staff/**kitchen** and upserts into `kitchen_devices`
   (push_token, enabled=true, last_seen).
2. **Sign-out** marks the device `enabled=false, push_token=''` (and unregisters
   from Expo) — a logged-out tablet never gets notified.
3. Expo send receipts reporting `DeviceNotRegistered`/`InvalidToken` prune the
   token from both storage layers automatically.
4. Settings → RE-REGISTER PUSH re-runs registration (after permission grant,
   EAS project changes, etc.).

Historical note: browsers/admin web register into the legacy secret-store
document (`push_tokens_v1` via the Supabase Management API, needs
`SUPABASE_ACCESS_TOKEN`). Tablets use `kitchen_devices`, which needs no extra
secrets. Notify sends to the union of both.

## The custom Vizio order sound

`kitchen-android/assets/sounds/new-order-alert.wav` — original composition
(see docs/KITCHEN_ANDROID.md §6): rising C6→E6→G6 brass arpeggio ×2 + bell
double-ding, ~2.4 s, peak-normalized. NOT Uber's sound, not a stock Android
sound. It is attached to the `orders` channel via the expo-notifications
config plugin (res/raw resource) and plays through `expo-audio` in-app with
`playsInSilentMode: true`.

Staff-configurable (Settings → Alerts): enable/disable, volume, repeat count
(0 = until acknowledged), repeat interval, vibration — plus **TEST ORDER
SOUND** and **TEST NOTIFICATION** buttons that exercise the exact production
path.

## Duplicate alert protection

- **Per order**: the persisted `alertedOrderIds` set means one order alerts
  once per device no matter how many paths deliver it (realtime INSERT,
  Draft→New UPDATE, FCM echo, reconciliation). Webhook replays and duplicate
  pushes cannot re-alert.
- **Controlled repeats are allowed**: while the order stays unacknowledged,
  the alert repeats per settings — that's a feature, not a duplicate.
- **Across devices**: every tablet has its own device id + token; all kitchen
  tablets alert for the same order, which is correct. No device can mark an
  order "printed" or advance it twice — mutations happen in Postgres.

## Audit trail — kitchen_notification_logs

One row per (order, device):

| field | written when |
|---|---|
| `notified_at`, `source` (`realtime`/`push`/`reconciliation`) | alert fired |
| `opened_at` | staff tapped the push notification |
| `acknowledged_at` | staff pressed ACKNOWLEDGE (also writes `orders.acknowledged_at/by`) |

This is the "did anyone actually see order #1048?" report for managers.
Related: `kitchen_incidents` logs `missed_order` entries when reconciliation
discovers an order that realtime missed, `printer_failure`, `manual_reprint`
and `print_retry`.

## Android honesty section

- Push delivery when the app is killed relies on Google Play Services /
  FCM high-priority messages — the supported, reliable mechanism. It is NOT
  guaranteed on devices with aggressive OEM battery killers; on the dedicated
  kitchen tablet, exempt the app from battery optimization (and prefer kiosk
  mode) — see docs/KITCHEN_TROUBLESHOOTING.md.
- `USE_FULL_SCREEN_INTENT` is declared; where the OEM honours it, a new order
  can full-screen-intent over the lock screen. Where it doesn't, the
  heads-up notification + loud channel is the fallback. We do not claim
  otherwise.
- No indefinite arbitrary background execution is attempted anywhere.
