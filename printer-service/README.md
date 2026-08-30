# Vizio Printer Service

Local print agent for Vizio Food. Subscribes to `print_jobs` in Supabase
and prints kitchen tickets on network thermal printers via raw TCP (port
9100). Full setup guide: [`docs/PRINTER_SETUP.md`](../docs/PRINTER_SETUP.md).

```bash
cp .env.example .env   # fill in
npm install
npm run test-print -- <printer-ip> [port] [width-mm] [protocol]   # direct printer test
npm start                                                        # run the agent
node src/smoke-test.js                                           # offline renderer check
```

## Modules

| File | Role |
|---|---|
| `src/index.js` | entry: env load, signals, HTTP endpoint first, agent with sign-in retry |
| `src/agent.js` | Supabase auth + realtime + poll sweep, job claiming, retry queue |
| `src/ticket.js` | protocol dispatch (`escpos` / `star-line`) for rendering |
| `src/layout.js` | pure ticket layout shared by every protocol |
| `src/escpos.js` | ESC/POS command set (Epson-style printers) |
| `src/starline.js` | Star Line / StarPRNT command set — **required for Star mC-Print3 (MCP30)**, which has no ESC/POS emulation |
| `src/printer.js` | raw TCP printing with timeouts + reachability probe |
| `src/test-print.js` | direct-to-printer test ticket (no Supabase needed) |
| `src/smoke-test.js` | offline renderer verification (both protocols) |

## Guarantees

- **No double prints** — jobs are claimed via a race-safe status flip
  (`QUEUED→PRINTING` guarded by `status='QUEUED'`), backed by a unique
  `(printer_id, order_id)` index in the database.
- **No lost tickets** — offline printers move jobs to RETRYING with
  exponential backoff (5s→60s, 5 attempts); jobs live in Postgres, so even
  an agent restart picks them up.
- **Payment-safe** — the agent can only read orders and update print jobs
  (RLS); it can never touch payment data.
