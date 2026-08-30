# Deployment

Three deployable pieces: the web app (Hostinger), the database/edge
functions (Supabase), and the printer service (a PC at the restaurant).

## 1. Database (Supabase)

Apply migrations in order — see [MIGRATIONS.md](MIGRATIONS.md). Quick path:

```bash
supabase link --project-ref wxqrapnsowhnmvwmocxc
supabase db push
```

Or paste each migration file into Dashboard → SQL Editor (they are all
idempotent — safe to re-run).

## 2. Edge Functions

```bash
supabase functions deploy create-checkout
supabase functions deploy verify-checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy process-refund
supabase functions deploy push-notifications
```

Secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):

| Secret | Used by |
|---|---|
| `STRIPE_SECRET_KEY` | checkout, verify, refund, webhook |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook only |
| `SUPABASE_URL` | checkout, refund, push, webhook |
| `SUPABASE_SERVICE_ROLE_KEY` | checkout, refund, push, webhook |
| `SUPABASE_ACCESS_TOKEN` | push-notifications (optional) |

## 3. Stripe webhook

Dashboard → Developers → Webhooks → add endpoint:

```
https://wxqrapnsowhnmvwmocxc.supabase.co/functions/v1/stripe-webhook
```

Events: `checkout.session.completed`, `refund.created`, `refund.updated`,
`charge.refunded`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## 4. Web app (Hostinger Node.js)

```bash
npm ci
npm run build        # tsc + vite → dist/
npm start            # node server/index.js (Express, serves dist/, PORT env)
```

`server/index.js` handles SPA fallback for `/admin`, `/kitchen` deep links
and exposes `/api/health`. For Hostinger shared hosting (no Node), upload
`dist/` + `public/.htaccess` instead — the `.htaccess` provides the same
fallback.

Environment: the build inlines `VITE_*` variables — set them in the Hostinger
env (or build locally after exporting) from `.env.example`.

Domains:
- `viziofood.com` → public site
- `admin.viziofood.com` → same build; `/` auto-redirects into `/admin`
  (hostname-scoped in `src/App.tsx`)

## 5. Printer service (restaurant PC)

See [PRINTER_SETUP.md](PRINTER_SETUP.md).

## 6. Post-deploy checklist

- [ ] Migrations applied (Admin → Printers loads without "table missing")
- [ ] `admin@viziofood.com` (or staff/kitchen accounts) can sign in
- [ ] Test order end-to-end: menu → cart → Stripe test payment → order
      appears as New in Admin/Kitchen → print job queued
- [ ] Pause ordering in Settings → public site shows the banner instantly
- [ ] Refund a test order → Stripe dashboard shows the refund
- [ ] `curl https://your-host/api/health` → 200
