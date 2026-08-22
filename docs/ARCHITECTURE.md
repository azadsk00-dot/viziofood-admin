# Architecture

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│ Clients (same backend, no duplicated business logic)         │
│  • Customer web  /          (src/pages)                      │
│  • Admin web     /admin     (src/admin)                      │
│  • Kitchen web   /kitchen   (src/pages/Kitchen.tsx)          │
│  • Printer agent (printer-service, Node)                     │
│  • Future Android/iOS app                                    │
├──────────────────────────────────────────────────────────────┤
│ Service / domain layer — framework-free, portable            │
│  src/lib/money.ts        integer-cent checkout math          │
│  src/lib/specials.ts     special-of-the-day scheduling       │
│  src/lib/validation.ts   Zod schemas (mirrored server-side)  │
│  src/services/*          typed Supabase data access          │
│  src/types/index.ts      canonical domain model              │
├──────────────────────────────────────────────────────────────┤
│ Backend — Supabase                                           │
│  Postgres + RLS · Auth (admin/staff/kitchen/customer)        │
│  Realtime (orders, settings, specials, products, print_jobs) │
│  Storage (product-images bucket: products/, branding/)       │
│  Edge Functions (Deno): create-checkout, verify-checkout-    │
│    session, stripe-webhook, process-refund, push-notifications│
└──────────────────────────────────────────────────────────────┘
```

## The money contract (the most important invariant)

One formula, three implementations that must stay identical:

1. `src/lib/money.ts` — browser display + tests
2. `supabase/functions/create-checkout/index.ts` — what Stripe charges
3. `src/cart.test.ts` — pins the exact numbers

```
subtotal  = Σ round((unit price + modifier prices) × 100) × quantity
discount  = coupon (percent or fixed, capped at subtotal)
service   = round((subtotal − discount) × service%)
tax       = round((subtotal − discount) × tax%)
delivery  = fixed fee, Delivery only
card fee  = round((net + service + tax + delivery) × cardFee%)   — no circular math
total     = subtotal − discount + service + tax + delivery + card fee
```

Stripe cannot take negative line items, so coupons are allocated greedily
across product lines (reduced lines are sent as quantity 1 with the reduced
total). The Stripe total therefore equals the displayed total exactly.

## Order lifecycle

```
Cart → create-checkout ──► orders row (status=Draft, payment_status=pending)
      └─ Stripe Checkout Session (metadata: order_id only, idempotency per order)
Customer pays ──► stripe-webhook (checkout.session.completed)
      ├─ orders: Draft→New + payment_status=paid (single atomic update)
      ├─ order_status_history += New            (once; replays skip)
      ├─ print_jobs += QUEUED per auto-print printer (unique per printer+order)
      ├─ coupons.times_used += 1                (RPC, once)
      └─ push notification (Expo)               (fire-and-forget)
Admin/Kitchen: New→Accepted→Preparing→Ready→Completed (every change audited)
Cancel → status=Cancelled + reason (full server-side refund when paid)
Refund → process-refund Edge Function (admin/staff JWT) → Stripe refund
         → webhook refund events reconcile totals from the PaymentIntent
```

Paid orders can never be lost: the order row exists before payment, the
webhook is idempotent, and the printer queue survives printer downtime
(QUEUED/RETRYING jobs persist; the agent retries with backoff).

## Roles & authorization

| Role | Can do | Enforced |
|---|---|---|
| anon (public) | read active products/categories/specials/settings/coupons | RLS |
| customer | own profile, own orders, favourites | RLS (auth.uid) |
| kitchen | read orders/items, advance status, read print_jobs | RLS |
| staff | kitchen + manage products/specials/print jobs | RLS |
| admin | everything + settings + refunds + printers | RLS + Edge Function JWT checks |

Frontend route guards (`ProtectedRoute`) are UX only — RLS is the authority.
Refunds and the Draft→New flip exist ONLY server-side.

## Specials scheduling (resolveActiveSpecial)

A special is live when: active ∧ ¬archived ∧ stock>0 ∧ date window (endDate
inclusive) ∧ time window ∧ (daysOfWeek empty ∨ today ∈ daysOfWeek). Highest
priority wins; ties break by createdAt — deterministic across web, mobile,
and tests. The same pure function drives the homepage and admin preview.

## Realtime propagation

Every admin-controlled surface is realtime: product price/availability/
image, categories, modifiers, specials, homepage promo, ordering pause,
pickup/delivery toggles, opening hours — the public site updates without a
redeploy. Kitchen/admin get live order streams; the printer agent subscribes
to `print_jobs` INSERTs (plus a 15s poll sweep for resilience).

## Known trade-offs / follow-ups

- `20260822`/`20260823` migrations are comment-only placeholders (objects
  exist only in the live DB) — documented in MIGRATIONS.md; a clean-room
  rebuild of the schema is a follow-up.
- The legacy `homepage_content` promo remains as a homepage fallback when
  no Special is scheduled; create Specials and it becomes redundant.
- Push notifications target Expo (mobile app); web push (VAPID) is not
  implemented — the browser side uses the Notifications API.
