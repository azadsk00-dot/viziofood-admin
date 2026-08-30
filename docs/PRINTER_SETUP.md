# Printer Service Setup (LEGACY / OPTIONAL)

> **The kitchen tablet has printed DIRECTLY to the printer since APK 1.2.0**
> (Star Line over TCP — see docs/PRINTER_ARCHITECTURE.md). The Node
> printer-service on this page is an optional standalone fallback; it does
> NOT need to run for the tablet to print. Its most useful remaining
> feature is the direct CLI test print:
> `npm run test-print -- 192.168.1.103 9100 80 star-line`.

The local print agent for Vizio Food: runs on a PC inside the restaurant,
watches Supabase for paid orders, and prints kitchen tickets on network
thermal printers over raw TCP port 9100 (no drivers needed). The command
protocol depends on the printer — see "Printer protocols" below.

```
Stripe payment ──► webhook ──► order New + print_jobs QUEUED
                                        │ (realtime + 15s poll)
                    restaurant PC ──► printer agent
                                        │ claims job, renders ticket
                                        ▼
                              kitchen printer (IP:9100)
```

## Printer protocols (`VIZIO_PROTOCOL`)

- **`escpos`** (default) — Epson-style ESC/POS. Most thermal printers.
- **`star-line`** — Star Line / StarPRNT. **Required for Star mC-Print
  models (mC-Print3 / MCP30, mC-Print2 / MCP20)**: the mC-Print family has
  NO ESC/POS emulation (Star's emulation switch covers TSP/desktop models
  only), so ESC/POS bytes print as unformatted text with no cut.

Set it once in `printer-service/.env` (`VIZIO_PROTOCOL=star-line`); the
renderer, `/test-print` and `npm run test-print` all follow it (the HTTP
test-print can override per request with `{"protocol": "…"}`).

The restaurant's kitchen printer is a **Star mC-Print3 (MCP30) at
192.168.1.103:9100, 80mm, station kitchen** — use `star-line`.

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
npm run test-print -- 192.168.1.103 9100 80 star-line   :: sanity check the MCP30
npm start
```

Keep it running at boot: Task Scheduler → run
`node C:\path\to\printer-service\src\index.js` at startup.

Kitchen tablet reachability (VIZIO_AGENT_HTTP_PORT): the endpoint binds
0.0.0.0, but Windows Firewall must allow inbound TCP on the port from the
LAN — otherwise the tablet gets "unreachable / ECONNREFUSED":

```bat
netsh advfirewall firewall add rule name="Vizio Printer Agent 3777" dir=in action=allow protocol=TCP localport=3777
```

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
