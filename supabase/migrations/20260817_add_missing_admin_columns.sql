-- ============================================================================
-- REVIEW-ONLY PATCH — DO NOT RUN until approved.
--
-- Purpose: add the columns the deployed Admin code requests that are missing
-- from the live database (project wxqrapnsowhnmvwmocxc), verified by direct
-- read-only queries on 2026-08-16.
--
-- Safety properties:
--   * Every statement is idempotent (ADD COLUMN IF NOT EXISTS / existence-
--     checked DO block) — re-running is harmless.
--   * No tables, rows, columns, or policies are dropped or recreated.
--   * No existing policy is re-created; no RLS statements at all.
--   * No existing column value changes. Existing rows simply report the new
--     columns' defaults (Postgres 11+ fast default — no table rewrite).
--   * The two existing restaurant_settings rows are not modified.
--
-- Live columns verified MISSING (each returned HTTP 400 / 42703):
--   restaurant_settings: suburb, state, postcode, opening_hours
--   orders:              special_instructions, tax_total, payment_intent_id,
--                        refund_id, refund_amount
--   admin_audit_log:     user_id, order_id, reason
-- ============================================================================

-- ============================================================================
-- 1. restaurant_settings — address parts and structured opening hours used by
--    the Admin Settings page (SETTINGS_SELECT / saveSettings payload) and the
--    public site's useRestaurantSettings hook.
-- ============================================================================
alter table public.restaurant_settings
  add column if not exists suburb text not null default '',
  add column if not exists state text not null default '',
  add column if not exists postcode text not null default '',
  add column if not exists opening_hours jsonb not null default '{}'::jsonb;
-- opening_hours structure expected by the code:
-- {"mon":{"open":"11:00","close":"15:30","closed":false},"tue":{...},...}
-- Code tolerates the empty-object default: parseOpeningHours({}) -> {} and the
-- Settings form falls back to its default 11:00–21:00 grid.

-- ============================================================================
-- 2. orders — fields read by the Admin Orders query (ORDER_SELECT) and written
--    by cancel-order handling.
-- ============================================================================
alter table public.orders
  add column if not exists special_instructions text not null default '',
  add column if not exists tax_total numeric(10,2) not null default 0,
  add column if not exists payment_intent_id text not null default '',
  add column if not exists refund_id text not null default '',
  add column if not exists refund_amount numeric(10,2) not null default 0 check (refund_amount >= 0);
-- Types mirror the definitions the TypeScript mappers were written against:
--   specialInstructions/paymentIntentId/refundId -> text, mapped via text()
--   taxTotal/refundAmount -> numeric(10,2), mapped via number()

-- ============================================================================
-- 3. admin_audit_log — the table exists live but predates the current
--    definition: user_id, order_id and reason are missing. saveSettings()
--    inserts user_id/action/details and cancelOrder() inserts order_id/reason
--    on every action, so without these columns audit writes fail.
-- ============================================================================
alter table public.admin_audit_log
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists reason text not null default '';

-- ============================================================================
-- 4. Realtime — the public site subscribes to restaurant_settings changes
--    (pause/resume and settings updates without redeployment). Idempotent:
--    the table is only added if not already in the publication.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'restaurant_settings'
  ) then
    alter publication supabase_realtime add table public.restaurant_settings;
  end if;
end;
$$;
