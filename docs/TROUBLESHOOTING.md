# Troubleshooting

## Customer site

| Symptom | Cause / fix |
|---|---|
| "Orders paused" banner everywhere | Admin → Settings → resume ordering (realtime — the banner clears instantly) |
| Menu empty | Products RLS hides everything inactive/unavailable/archived; check Admin → Products filters |
| Checkout button says ordering paused but Settings shows open | Cache — reload; settings stream via realtime but a dropped socket needs the 15s reconnect |
| Payment stuck on "Confirming your payment…" | verify-checkout-session unreachable — check Edge Function deploy + `VITE_CHECKOUT_VERIFY_ENDPOINT` |
| "Payment not confirmed yet" after paying | Webhook not delivered — check the Stripe endpoint URL/signing secret, then resend the event from the Stripe dashboard; the cart is kept intentionally |

## Admin

| Symptom | Cause / fix |
|---|---|
| "Unable to load data" | Supabase unreachable or session expired — sign in again; check the browser console for the PostgREST error code |
| Printers page says tables missing | Apply the 20260826 migrations (docs/MIGRATIONS.md) |
| Coupon fields missing / read-only | Same — the coupon extension columns arrive with 20260826120000 |
| Refund button disabled | Order is unpaid, already fully refunded, or a refund is pending |
| Cannot move an order back a status | Intentional: the state-machine trigger allows forward transitions and terminal moves only (20260826120002) |
| Kitchen account blocked from updating | Kitchen may change status ONLY; payment/customer fields are rejected by the database trigger |

## Kitchen / printing

| Symptom | Cause / fix |
|---|---|
| New order doesn't appear | Realtime socket dropped — the board reloads on any next event; check network |
| No sound | Browser autoplay policy — click anywhere once; also check Settings → new-order sound and OS volume |
| Job stuck QUEUED | Printer agent not running or sign-in failed — check its console; agents pick up QUEUED jobs on restart |
| Job RETRYING forever | Printer offline — fix power/network; the agent retries 5× with backoff then marks FAILED (retry from Admin → Printers) |
| Garbled ticket text | Wrong paper width in the printer config (32/48/80 mm) |
| Double print | Should be impossible (unique printer+order index) — if seen, check whether two agents share one printer config |

## Backend / deploy

| Symptom | Cause / fix |
|---|---|
| create-checkout returns 409 | Ordering paused, or pickup/delivery disabled server-side |
| Webhook 400 | Signature mismatch — `STRIPE_WEBHOOK_SECRET` wrong or the endpoint changed |
| RLS errors after migration | Re-run the migration (idempotent); check the failed statement's table in the SQL editor |
| `supabase db reset` breaks modifiers | Use the full migration sequence; 20260824 skips safely and 20260826120001 creates the table |

## Logs

- Browser: Supabase/PostgREST errors are logged to the console by the data
  layer (`useResource`); order-alert diagnostics use the `[vizio-sound]`
  prefix.
- Edge Functions: Supabase dashboard → Functions → logs.
- Printer agent: its own stdout (`[vizio-print:*]`), one line per event.
