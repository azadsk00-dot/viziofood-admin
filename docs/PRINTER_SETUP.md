# Printer Service Setup

The local print agent for Vizio Food: runs on a PC inside the restaurant,
watches Supabase for paid orders, and prints kitchen tickets on network
thermal printers (ESC/POS over raw TCP — the universal thermal-printer
interface; no drivers needed).

```
Stripe payment ──► webhook ──► order New + print_jobs QUEUED
                                        │ (realtime + 15s poll)
                    restaurant PC ──► printer agent
                                        │ claims job, renders ESC/POS
                                        ▼
                              kitchen printer (IP:9100)
```

## 1. Database + admin config

1. Apply the migrations (see MIGRATIONS.md) — creates `printers` +
   `print_jobs` tables and the `kitchen` role.
2. Admin → Printers → add your printer:
   - **Name**: e.g. "Kitchen thermal"
   - **Station**: kitchen (future: bar/coffee/dessert/pickup)
   - **IP address**: the printer's LAN IP (print its self-test page to find it)
   - **Port**: 9100 (raw TCP standard)
   - **Paper width**: 80 / 48 / 32 mm
   - **Auto-print**: on

## 2. Agent account

Create a dedicated account in Supabase Auth (e.g. `kitchen@viziofood.com`),
then set its role:

```sql
update public.profiles set role = 'kitchen', full_name = 'Kitchen Printer'
where id = (select id from auth.users where email = 'kitchen@viziofood.com');
```

## 3. Install on the restaurant PC (Windows)

```bat
cd printer-service
copy .env.example .env     :: fill in SUPABASE_URL, ANON_KEY, VIZIO_EMAIL, VIZIO_PASSWORD
npm install
npm run test-print -- 192.168.1.50 9100 48   :: sanity check the printer
npm start
```

Keep it running at boot: Task Scheduler → run
`node C:\path\to\printer-service\src\index.js` at startup.

Linux alternative: systemd unit
`ExecStart=/usr/bin/node /opt/vizio-printer-service/src/index.js`, `Restart=always`.

## 4. How failures are handled

| Situation | Behaviour |
|---|---|
| Printer offline / power cut | Job marked RETRYING; local queue retries with backoff (5s → 60s); prints automatically when the printer returns |
| Agent PC offline | Jobs stay QUEUED in Supabase; the poll sweep prints them when the agent restarts |
| Repeated failure | After 5 attempts the job is FAILED with the last error; Admin → Printers shows a Retry button |
| Webhook replay / duplicate | Unique index `(printer_id, order_id)` — a paid order can never double-print |
| Manual reprint | Admin → Orders → order detail → "Reprint ticket", or Printers → queue → Reprint |

No order is ever lost to a printer problem — printing is decoupled from
ordering; the order lives in Supabase regardless.

## 5. Verifying

- `npm run test-print` prints a TEST ticket directly to the printer.
- Place a test order (or use Stripe test mode) → ticket prints within
  seconds of payment.
- Admin → Printers shows the job as PRINTED with a timestamp.

## Troubleshooting

- **Nothing prints, job stays QUEUED** → agent not running or sign-in
  failed; check its console.
- **"connection refused"** → wrong IP/port, or the printer is on a
  different subnet; `ping` the printer first.
- **Garbled text** → wrong paper width setting (32/48/80).
- **Missing items** → the agent reads order_items with the kitchen RLS
  policy; confirm the agent account's profile role is `kitchen` or `staff`.
