# VIZIO FOOD Orders — Android Order Terminal (`orders-android/`)

A separate, orders-only production Android app: **live orders, scheduled
orders, history and printing — nothing else.** Package `com.viziofood.orders`,
installable alongside VIZIO FOOD Admin (`com.viziofood.admin`) and the Kitchen
tablet (`com.viziofood.kitchen`). Neither existing app is modified by this
project.

## Where it fits

```
Customer → Stripe → stripe-webhook (existing) → orders: New + paid
                      │                           │
                      ├─ push-notifications fn ───┤ (existing, unchanged)
                      │        (FCM via Expo)      │
                      ▼                            ▼
              VIZIO FOOD Orders app ◄── Supabase Realtime (orders table)
                      │
                      └─ Star mC-Print3 over LAN (StarXpand SDK, direct)
```

The app is an operational client only; Supabase remains the system of record.
**Zero backend changes**: no schema migration, no Edge Function change, no RLS
change. It signs in with existing admin/staff/kitchen accounts and registers
its Expo push token with the existing `push-notifications` function exactly
like the Admin app does.

## Core guarantees

| Guarantee | How |
|---|---|
| New paid order appears instantly | Supabase Realtime on `orders` (INSERT + UPDATE), keyed on resulting row state (`paid` + `New`), never on `payload.old`. No polling for live updates. |
| No missed orders | Reconciliation on startup, realtime recovery, reconnect, foreground + a 60s safety sweep; orders cached locally and visible offline. |
| Never two notifications / receipts / cards | ONE central `OrderEventProcessor` (`src/services/orderEventProcessor.ts`). Merge keyed by order id; persisted `alertedOrderIds`; print queue keyed by order id. Manual Reprint is the only re-print path. |
| Receipts survive printer downtime | Persistent local `PrinterQueue` (queued/printing/printed/retrying/failed), serialized jobs, backoff 5→60s ×5, manual retry, clear-completed. |
| Background/locked alerts | FCM high-priority push (existing webhook path) on the `orders` channel with the custom VIZIO order sound; foreground realtime path suppresses the FCM echo (no double alert). |
| Future orders ≠ immediate kitchen orders | Scheduled times parsed from the production `Scheduled pickup: …` note convention; beyond the 30-min window orders stay on SCHEDULED (UPCOMING), entering the live board only inside the window (READY TO PROCESS). |

## Printing (reuse of the proven implementation)

The Star recipe is the Admin app's working implementation (`react-native-star-io10`):
`TCP:<ip>` identifier, `autoSwitchInterface=false`, 15s open timeout, MAC
passthrough, identifier validation before the SDK sees it, friendly errors
("Could not reach the printer 192.168.1.116. Check that the printer is powered
on…"). The `plugins/withStarPrinterFlatDir.js` config plugin exposes the SDK's
AAR to Gradle on every prebuild.

Printer settings live on the device (AsyncStorage): IP/identifier, auto-print
toggle, connection test, test print, printer status, retry failed, clear
completed.

## Security

Anon key only (RLS is the authority); staff/kitchen/admin login required;
customer accounts rejected; no service-role keys, no Stripe keys, no new
public endpoints.

## Build

```bash
cd orders-android
npm install
npm run prebuild                    # expo prebuild --platform android
node scripts/configure-signing.cjs  # wires vizio-orders.keystore (gitignored — back it up!)
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

Validations: `npm run typecheck`, `npm run lint`, `npm test`
(74 tests: scheduled parsing, state machine, board columns, payment labels, reconciliation,
identifier validation, queue engine, central dedupe processor).

## Testing checklist (manual, before go-live)

1. Paid test order (Stripe TEST) → card appears instantly + notification + sound + receipt prints.
2. Replay the Stripe webhook → no second notification/print/card.
3. Airplane mode, place an order, reconnect → order appears, alerted once.
4. Kill the app, place an order, reopen → order present, no re-alert of old orders.
5. Printer off → RETRYING with backoff → FAILED after 5 attempts → Retry prints.
6. Two/three orders within seconds → receipts print sequentially, sound never overlaps.
7. Scheduled order (future) → SCHEDULED tab only; inside 30 min → live board too.
8. Advance New → Accepted → Preparing → Ready → Completed (DB trigger enforces).
