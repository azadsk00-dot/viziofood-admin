# Kitchen Troubleshooting — Staff Guide

For tablet setup/architecture see docs/KITCHEN_ANDROID.md. This page is for
"it's Friday night and something is wrong".

## First: the HEALTH tab

Tap **HEALTH** on the bottom bar. Everything below starts from what it shows.

| Health shows | Meaning | Fix |
|---|---|---|
| Internet OFFLINE | Wi-Fi dropped | Check the tablet's Wi-Fi. Orders received earlier stay visible; SYNC NOW after reconnecting. |
| Supabase ERROR | Backend unreachable (internet OK) | Wait 1–2 min; press SYNC NOW. If it persists, check status.supabase.com. |
| Realtime RECONNECTING | Live updates paused | Not fatal — reconciliation still runs every ~60s. SYNC NOW forces a catch-up. |
| Printer OFFLINE / ERROR | Printer or agent unreachable | See printer section below. |
| Print queue high (4+) | Jobs backing up | Usually the printer is offline or out of paper — fix the printer; the queue drains itself. |
| Notifications DISABLED | Android blocked notifications | Android Settings → Apps → Vizio Kitchen → Notifications → allow. |
| Sound DISABLED | Turned off in Settings | Settings → Alerts → enable, then TEST ORDER SOUND. |
| Printer agent NOT REACHABLE | The PC running printer-service isn't answering | Check the PC is on and printer-service is running with VIZIO_AGENT_HTTP_PORT set. |

**SYNC NOW** is always safe: it re-downloads today's orders from the backend
and catches anything the tablet missed. It never duplicates orders.

## "We never heard the order"

1. HEALTH → Notifications ENABLED? Sound ENABLED?
2. Settings → Alerts → **TEST ORDER SOUND** — stand where food is prepared;
   if it's not clearly audible, raise the volume and repeat.
3. Battery optimization kills background push on many tablets:
   Android Settings → Apps → Vizio Kitchen → Battery → **Unrestricted**
   (exact wording varies by brand — Samsung/Xiaomi are strictest).
4. Check SHIFT → Incident log: reconciliation- discovered orders appear as
   `missed order` entries (with how long the tablet was offline).
5. Was the tablet signed out? Logged-out devices never receive push
   (by design). Sign back in.

## Printer problems

**Order shows "PRINTED" nowhere and queue has entries:**

- Printer powered on? Paper in? LAN cable/Wi-Fi up?
- On the PRINT tab: printer shows its IP — is that IP still correct?
  (Printer IPs can change; fix it in Admin → Printers.)
- **TEST PRINT** on the PRINT tab prints a real test ticket. If it errors
  with "No printer agent URL configured", the PC endpoint isn't set up
  (docs/PRINTER_ARCHITECTURE.md).

**Job FAILED (after 5 automatic attempts):**

- Open the order → Printing section shows the exact error.
- Press **RETRY** (tablet, admin, or kitchen-actions all work) — the job
  requeues and prints once the printer is reachable. Failed jobs are never
  deleted automatically.

**Reprint an order:** open the order → **REPRINT** (per printer or all).
This requeues the existing job (audited in `kitchen_incidents`) — the payment
and order are untouched.

**Nothing prints at all but the tablet looks fine:** printing does NOT depend
on the tablet. Check the restaurant PC: is the printer-service window/console
running? `[vizio-print:info] agent ready` should be in its log. Follow
docs/PRINTER_SETUP.md to restart it (Task Scheduler / systemd).

## Tablet won't stay on / app closed itself

- Settings → **Keep screen awake** ON (only keeps THIS app's screen awake).
- Android Settings → Display → Sleep → 30 min (or use kiosk mode so the
  launcher can't be left).
- After a reboot: open the app once; it reconciles everything it missed
  automatically (that's also why notifications being enabled matters — the
  alert arrives even before you reopen the app).

## Wrong or stuck order status

- Statuses only move forward (New → Accepted → Preparing → Ready →
  Completed). Completed/Cancelled orders can never change — this is enforced
  by the database, not the app.
- "Cannot move X → Y" errors come from the database state machine — another
  terminal (admin web, another tablet) probably already advanced it. SYNC
  NOW to refresh.
- Kitchen accounts cannot cancel paid orders (admin/staff only) and can
  never touch payment fields — by database policy.

## Escalation colours (what they mean)

- **Amber border/timer** — NEW order approaching the warning threshold.
- **Orange** — urgent (older still). **Red** — manager attention (default 10
  min, configurable in Settings → Escalation thresholds).
- **Purple** — Accepted/Preparing order past the overdue threshold.

## Still stuck?

1. SYNC NOW, then screenshot the HEALTH screen.
2. SHIFT tab → Incident log — send the last few entries to the admin.
3. Admin checks: Supabase → `kitchen_devices` (last_seen / printer_status),
   `print_jobs` (statuses/attempts), `kitchen_incidents`.
4. Last resort on the tablet: sign out and back in (re-registers push) —
   orders are never lost by doing this; everything lives in the backend.
