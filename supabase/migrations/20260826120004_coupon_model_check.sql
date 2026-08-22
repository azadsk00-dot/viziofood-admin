-- ═══════════════════════════════════════════════════════════════════════════
-- Coupon model check — fixes 23514 "violates check constraint couponscheck"
--
-- ROOT CAUSE: 202607160002 created the coupons table with a legacy table
-- CHECK: (percentage_off IS NOT NULL OR amount_off IS NOT NULL) — "a coupon
-- must carry a legacy discount column". The rebuilt coupon model stores
-- discounts in kind/value (20260826120000) and leaves the legacy columns
-- NULL, so EVERY coupon insert from the new Admin → Coupons page violates
-- the outdated constraint:
--     23514: new row for relation "coupons" violates check constraint
-- This is not a weakening: the legacy rule is replaced by a STRICTER,
-- named constraint that validates the new model (and more).
--
-- The legacy constraint is identified BY DEFINITION (not name), so this
-- works whether production named it couponscheck / coupons_check / other.
--
-- Idempotent: safe to re-run. The repair pass only touches rows whose
-- kind/value disagree with their legacy columns (none expected).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Drop the outdated legacy table-level check (by definition) ─────────
-- pg_get_constraintdef adds parentheses around operands, so match on the
-- signature ingredients (both legacy columns + NOT NULL + OR), not the exact
-- literal text — a table-level CHECK naming BOTH columns is unambiguous.
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.coupons'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'percentage_off'
      and pg_get_constraintdef(oid) ~* 'amount_off'
      and pg_get_constraintdef(oid) ~* 'not null'
      and pg_get_constraintdef(oid) ~* 'or'
  loop
    execute format('alter table public.coupons drop constraint %I', r.conname);
    raise notice 'dropped legacy coupon check: %', r.conname;
  end loop;
end;
$$;

-- The per-column checks (percentage_off between 0 and 100 / amount_off >= 0)
-- are KEPT — they remain correct for any legacy-shaped value and pass when
-- the columns are NULL.

-- ── 2. Repair pass: reconcile kind/value with legacy columns ──────────────
-- Only rows where the backfill left value = 0 while a legacy column actually
-- carries the discount (e.g. percentage_off = 0 with amount_off NULL).
update public.coupons
   set kind  = case
          when coalesce(percentage_off, 0) > 0 then 'percent'
          when coalesce(amount_off, 0) > 0 then 'fixed'
          else kind
        end,
       value = case
          when coalesce(percentage_off, 0) > 0 then percentage_off
          when coalesce(amount_off, 0) > 0 then amount_off
          else value
        end
 where value = 0
   and (coalesce(percentage_off, 0) > 0 or coalesce(amount_off, 0) > 0);

-- ── 3. The modern, stricter validation ─────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.coupons'::regclass
      and conname = 'coupons_model_check'
  ) then
    execute $c$
      alter table public.coupons
      add constraint coupons_model_check check (
        kind in ('percent', 'fixed')
        and value > 0
        and value <= 100000
        and (kind <> 'percent' or value <= 100)
        and minimum_order >= 0
        and (usage_limit is null or usage_limit >= 1)
        and (starts_at is null or ends_at is null or starts_at <= ends_at)
      )
    $c$;
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Resulting validation (stronger than the legacy rule):
--   • discount type must be percent|fixed (mirrors the column check)
--   • value > 0 (zero/negative discounts impossible — the legacy rule
--     allowed percentage_off = 0!)
--   • percent coupons capped at 100 (legacy column check allowed 0–100 only
--     on the old column; now enforced on the live column)
--   • minimum order never negative
--   • usage limit null or ≥ 1
--   • date window never inverted
-- New writes must use kind/value (the app's only path); pure legacy-shaped
-- inserts are no longer accepted.
-- ═══════════════════════════════════════════════════════════════════════════
