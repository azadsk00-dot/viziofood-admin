# Printer Architecture — Vizio Food

How a paid order becomes a physical kitchen ticket, and why no single device
can lose a print job.

## Pipeline

```
Stripe checkout
   │ checkout.session.completed (signed webhook)
   ▼
stripe-webhook (Edge Function, service role)
   │ 1. flips orders: Draft → New + payment_status=paid   (atomic, idempotent*)
   │ 2. appends order_status_history
   │ 3. enqueuePrintJobs(): one print_jobs row per enabled+auto_print printer
   │      └─ duplicate rows blocked by unique partial index (see below)
   │ 4. fires Expo push (push-notifications fn)
   ▼
print_jobs (Supabase/PostgreSQL — durable queue, source of truth)
   ▲ realtime INSERT + 15s polling sweep
   │
Local Printer Service (Node, restaurant PC, kitchen/staff account)
   │ claim: UPDATE ... SET status='PRINTING' WHERE id=? AND status='QUEUED'  (race-safe)
   │ render: hand-rolled ESC/POS (printer-service/src/escpos.js)
   │ print:  raw TCP :9100 to the printer's LAN IP, 10s timeout, `copies` ×
   ▼
Thermal kitchen printer(s)
```

`*` Idempotency of the Draft→New flip: the update is filtered
`.in('status', ['Draft'])` — a webhook replay finds an already-operational
order and only re-applies harmless payment fields.

## print_jobs — the durability contract

| Column | Meaning |
|---|---|
| `id` | unique job id |
| `order_id`, `printer_id` | what to print, where |
| `status` | `QUEUED → PRINTING → PRINTED` or `→ RETRYING → FAILED` |
| `attempts`, `max_attempts` | backoff retry counter (default max 5) |
| `last_error` | last failure reason (≤300 chars) |
| `printed_at` | only set when the printer service confirms success |
| `origin` | `auto` (webhook) · `reprint` (manual) · `retry` |

**Exactly-once guarantee** — unique partial index:

```sql
CREATE UNIQUE INDEX print_jobs_printer_order_uq
  ON print_jobs (printer_id, order_id)
  WHERE status <> 'FAILED';
```

A webhook replay cannot insert a second live job for the same printer+order
(duplicate insert violates the index → swallowed). "Printed" is displayed only
when the printer service itself wrote `PRINTED` — an order being received
never shows as printed.

**Manual reprint** therefore REQUEUES the existing row (status→QUEUED,
attempts→0, origin→'reprint') instead of inserting a duplicate; the agent's
realtime UPDATE listener picks up any transition to QUEUED. The
`kitchen-actions` Edge Function does this for the tablet/admin and writes an
audit row into `kitchen_incidents`. If a printer was disabled at payment time
(no row exists), the function may insert a fresh job (service role; the
insert is still guarded by the unique index).

## Failure modes and behaviour

| Failure | Behaviour |
|---|---|
| Printer offline / powered off | TCP connect fails → `RETRYING` + exponential backoff 5s→10s→20s→40s→60s (cap 60s) |
| Printer comes back | queued jobs print automatically (retry loop + 15s sweep) |
| 5 attempts exhausted | job = `FAILED` with `last_error`; stays forever until a human retries (tablet Retry button, admin UI, or kitchen-actions). Never auto-deleted. |
| Agent PC offline / crashed | jobs stay `QUEUED` in Postgres; sweep prints them when the agent restarts |
| Webhook replay | Draft-flip guard + unique index → no duplicate order, no duplicate print |
| Kitchen tablet off | irrelevant to printing — the tablet never prints orders |

Known sharp edges (deliberate trade-offs, documented):
- A job left `RETRYING` in Postgres when the agent dies is not swept (sweep
  selects QUEUED only) — it needs the Retry button.
- The agent loads printers once at start; adding/editing a printer requires an
  agent restart.
- In multi-agent deployments (one per station), an agent can claim a job for a
  printer it doesn't serve and burn one attempt marking it RETRYING. Single
  agent (blank `VIZIO_STATION`) is the recommended deployment.

## Stations and future routing

`printers.station` ∈ kitchen | bar | coffee | dessert | pickup | receipt.
Today the webhook fans the FULL order out to every enabled auto-print printer;
`station` filters which printers a given agent serves (`VIZIO_STATION`). Per-
item routing (Pasta→kitchen, Coffee→coffee) can be added in the webhook +
`products.station` without schema changes and without touching the agents.

## Agent operations (restaurant PC)

See docs/PRINTER_SETUP.md for full setup (Task Scheduler on Windows / systemd
on Linux). Additions for the kitchen tablet era:

```env
# printer-service/.env — optional LAN endpoint for the tablet app
VIZIO_AGENT_HTTP_PORT=3777
VIZIO_AGENT_HTTP_TOKEN=long-random-shared-secret
```

- `GET /health` — agent liveness, printer list, local retry-queue depth
  (powers the tablet's printer status + HEALTH screen)
- `POST /test-print {printerId?}` — real ESC/POS test ticket (TEST PRINT)
- `GET /probe?host=&port=` — raw TCP reachability check

Security: LAN-only (bind 0.0.0.0 but never port-forward); token required via
`x-vizio-token` header when configured. Off unless the port is set, so
existing deployments are untouched.

## Who can do what (RLS)

| Role | printers | print_jobs |
|---|---|---|
| kitchen | read | read + update (claim/retry/requeue) |
| staff | read | read + update + insert |
| admin | full manage | full |
| customer | none | none |

The kitchen **cannot** insert print jobs directly — manual reprints that need
an insert go through the `kitchen-actions` Edge Function, which verifies the
caller's profile role before using the service role.
