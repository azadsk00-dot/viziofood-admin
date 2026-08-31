-- Configurable combo selection ranges -- 2026-09-03
--
-- The combo builder now exposes per-group minimum AND maximum selections
-- (0–6 in the admin dropdowns). combo_groups already carried both columns;
-- the only schema change needed is relaxing the max_selections check so a
-- group may be configured to allow ZERO selections (e.g. a fully optional
-- "Choose your sides" set to 0/0). Existing rows (max = 1) are untouched and
-- remain valid under the wider constraint.

do $$
begin
  alter table public.combo_groups
    drop constraint if exists combo_groups_max_selections_check;
  alter table public.combo_groups
    add constraint combo_groups_max_selections_check
    check (max_selections >= 0) not valid;
exception
  when duplicate_object then null; -- constraint already exists in this shape
end $$;

-- Backfill safety: nothing to backfill — existing data already satisfies
-- the relaxed constraint. Server-side enforcement of the ranges lives in
-- create-checkout (unchanged): chosen < min → 400, chosen > max → 400.
