# Database Migrations

All migrations live in `supabase/migrations/` and run in filename order.

## Applying

```bash
supabase link --project-ref wxqrapnsowhnmvwmocxc
supabase db push
```

Or copy each file into Supabase Dashboard → SQL Editor and run it. Every
migration from `20260826120000` onward is **idempotent** (IF NOT EXISTS /
add_column_if_missing / drop policy if exists) — safe to re-run.

⚠️ **Never run `supabase db reset` against the production project** — see
the caveat below.

## History

| Migration | Adds |
|---|---|
| `202607160001_auth_profiles` | profiles + roles + RLS, signup trigger |
| `202607160002_initial_schema` | categories, products, orders, order_items, coupons, settings, RLS, realtime |
| `202607160003_ordering_workflow` | order_status enum, modifier tables, fulfilment/instructions |
| `20260718_management_platform` | product media/flags, modifier_groups/options, storage bucket, favourites |
| `20260719_product_management_complete` | SKU, visibility, audit trigger, storage policies |
| `20260722_live_order_management` | status-history trigger, staff RLS |
| `20260816_admin_control_centre` | orders_enabled, pause message, refunds fields, admin_audit_log |
| `20260817_add_missing_admin_columns` | live-DB patch (review-only) |
| `20260820/21 dynamic homepage + charges` | homepage_content, service_charge, card_processing_fee, order breakdown columns |
| `20260822/23 remote_applied` | **comment-only placeholders** — reconstructed below |
| `20260824_modifier_option_uniqueness` | per-group modifier name uniqueness (fresh-DB guarded) |
| `20260825_fulfilment_toggles` | pickup_enabled / delivery_enabled |
| **`20260826120000_platform_rebuild_foundation`** | **the rebuild migration — see below** |
| **`20260826120001_reconstruct_remote_applied`** | re-creates the lost Aug-22/23 objects (modifiers table final form, categories.display_order/active, products.spice_level/featured_order) — no-op on the live DB |
| **`20260826120002_order_state_machine`** | DB trigger: forward-only status transitions, terminal states frozen, kitchen accounts restricted to status-only updates |

> **Timestamp note:** the rebuild migration was briefly checked in as
> `202609010001_platform_rebuild_foundation.sql` — a future-dated stamp used
> as a "rebuild era" marker, not an environment mismatch. It had never been
> applied anywhere (all migrations deploy manually), so it was renamed to the
> correct August sequence (`20260826120000_…`) before deployment with zero
> impact.

## The 20260826 rebuild migration

Additive and idempotent; safe on the live project (nothing dropped or
rewritten; every new column nullable or defaulted):

- **`specials`** — dedicated Special of the Day entity (scheduling: dates,
  time window, days of week, stock, priority, display location, optional
  product link) + public/staff RLS + realtime
- **`printers`** and **`print_jobs`** — printer configs and the
  duplicate-proof print queue (unique non-failed `(printer_id, order_id)`)
  + kitchen/staff RLS + realtime
- **`coupons` extension** — kind/value (backfilled from the legacy
  percentage_off/amount_off columns), minimum order, product/category
  scope, date window, usage limit + `times_used`
- **`orders` extension** — fulfilment_method, delivery address/suburb/
  postcode/instructions, discount_total, coupon_code, cancelled_by
  (reuses the existing subtotal/tax/delivery/service/card columns from
  20260821 — no duplicates)
- **`restaurant_settings` extension** — minimum orders, pickup/delivery
  times + instructions, special (holiday) hours, favicon, tiktok,
  currency, kitchen prefs (prep time, order sound, auto-print)
- **`admin_audit_log` extension** — entity, entity_id, user_name
- **`kitchen` role** + RLS policies (read orders/items, advance status)
- **`increment_coupon_usage()`** RPC (atomic, called by the webhook)

## ⚠️ Production-only schema caveat — RESOLVED by reconstruction

`20260822/20260823_remote_applied.sql` were comment-only placeholders: the
live database contained objects whose SQL files were lost. The migration
**`20260826120001_reconstruct_remote_applied.sql`** now re-creates them
idempotently, so a fresh database built from the repository reaches feature
parity:

- `public.modifiers` (per-product modifier options) in its **final** form —
  the per-group case-insensitive unique index, with the legacy global
  name-unique constraint absent
- `categories.display_order` + `categories.active`
- `products.spice_level` + `products.featured_order`
- Public-read/staff-manage RLS for `modifiers`

On the live database the reconstruction is a complete no-op (every object
exists; `IF NOT EXISTS` everywhere). `20260824` is guarded so it skips
gracefully on fresh databases where the table doesn't exist yet.

**Verification step after applying on production:** the run should report
no-ops. To double-check nothing was missed, dump the live schema
(`supabase db dump --schema public -f live.sql`) and compare against a
scratch project built fresh from the migrations.

## Verifying after applying

1. Admin → Printers loads (no "table missing" notice)
2. Admin → Specials → create a special → appears on the homepage per its schedule
3. Checkout with a coupon → discount line in the order breakdown
4. A paid order queues print jobs (visible in Admin → Printers → queue)
