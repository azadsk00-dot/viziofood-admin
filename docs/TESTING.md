# Testing

## Automated (run locally, no external services)

```bash
npm test                 # vitest — unit + logic suites
npm run typecheck        # tsc strict (the static-analysis gate)
npm run build            # production build
node printer-service/src/smoke-test.js   # ESC/POS renderer (offline)
```

No linter is configured in this project; `tsc` strict mode is the static
gate (unused variables, implicit any, and unreachable paths fail the build).

### What the 51 tests pin down

| Suite | File | Covers |
|---|---|---|
| Cart + checkout math | `src/cart.test.ts` | line merging/keys, quantity ops, the exact integer-cent formula (production-rate example $23 → $32.00), per-cent rounding, no-circular card fee, pickup vs delivery |
| Coupons | `src/cart.test.ts` | percent/fixed discounts, caps, minimum order, date windows, usage limits, charges compound on the discounted subtotal, AUD formatting |
| Special scheduling | `src/specials.test.ts` | live/inactive rules, date window (endDate inclusive), time boundaries (exact start/end, ±1 min), weekday rotation (Mon/Tue example), priority + tie-break determinism, stock, Perth-timezone behaviour |
| Modifier editors | `src/admin/ModifiersPage.test.ts` | price-text parsing, per-group case-insensitive duplicate detection (regression from the Aug-2026 production incident) |
| ESC/POS renderer | `printer-service/src/smoke-test.js` | command bytes, wrapping, two-column layout, ticket content, cut command, test ticket |

## Manual test procedures (need real credentials/hardware)

### Payment end-to-end (Stripe TEST mode)
1. Deploy the Edge Functions (see DEPLOYMENT.md).
2. In Stripe: create a test webhook endpoint pointing at the deployed
   `stripe-webhook` with the four events; set `STRIPE_SECRET_KEY` to a
   `sk_test_` key for this rehearsal.
3. Place an order with card `4242 4242 4242 4242`, any future expiry/CVC.
4. Verify in Supabase: order `status='New'`, `payment_status='paid'`,
   `stripe_session_id` + `payment_intent_id` set, charge breakdown columns
   filled, one `order_status_history` row, `print_jobs` rows queued (if a
   printer is configured), `coupons.times_used` incremented when a code was
   used.
5. Compare `orders.total` with the Stripe session `amount_total` — must be
   equal to the cent.
6. Declined card `4000 0000 0000 0002` → order stays Draft/unpaid, no
   print job, no coupon increment.

### Webhook replay idempotency
In the Stripe dashboard (Developers → Webhooks → your endpoint) click
"Resend" on a `checkout.session.completed` event twice. Verify: still ONE
order, one history row, one print job per printer, `times_used` unchanged
on the second replay.

### Refunds
Admin → Orders → paid test order → Refund (full and partial). Verify the
Stripe dashboard refund, `orders.refund_*` fields, audit-log rows, and that
a repeated refund attempt over the remaining amount is rejected.

### Printer hardware
See [PRINTER_SETUP.md](PRINTER_SETUP.md) — including the offline/reconnect,
service-restart and duplicate-webhook scenarios.

### Settings propagation
Toggle in Admin → Settings (orders pause, pickup/delivery, fees) with the
public site open in a second tab — changes must appear without reload.
