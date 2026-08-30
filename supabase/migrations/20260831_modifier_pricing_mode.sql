-- Modifier pricing modes -- 2026-08-31
--
-- PREPARED, NOT APPLIED. Adds a per-option pricing mode to `modifiers`:
--
--   'adjustment' (default) — the option's price ADDS to the product base
--                             price (extra cheese +$2). Every existing
--                             modifier keeps exactly its current behaviour.
--   'override'             — the option's price REPLACES the product base
--                             price (pizza size: Small $0 → base, Large $19
--                             → $19 total, never base + $19).
--
-- Single minimal column; no tables, no data changes, idempotent. Apply
-- before deploying the updated Edge Functions and website.

alter table public.modifiers
  add column if not exists pricing_mode text not null default 'adjustment';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.modifiers'::regclass
      and conname = 'modifiers_pricing_mode_check'
  ) then
    alter table public.modifiers
      add constraint modifiers_pricing_mode_check
      check (pricing_mode in ('adjustment', 'override'));
  end if;
end $$;
