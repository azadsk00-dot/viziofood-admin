-- ═══════════════════════════════════════════════════════════════════════════
-- Add the 'kitchen' role to public.user_role
--
-- STANDALONE BY DESIGN — do not merge this into a larger migration.
--
-- PostgreSQL (error 55P04) forbids USING a newly added enum value until the
-- transaction that added it has committed. Every later piece that references
-- 'kitchen' (RLS policies in 20260826120000, the state-machine trigger in
-- 20260826120002) therefore requires THIS file to have been applied and
-- committed first.
--
--   • supabase db push / the migration engine: each file is its own
--     transaction — ordering below guarantees correctness automatically.
--   • Supabase SQL Editor: run each migration file as a SEPARATE "Run"
--     click. Run THIS file, let it commit, then run the later files.
--
-- Idempotent: ADD VALUE IF NOT EXISTS makes re-runs safe; no data changes;
-- existing roles (admin, staff, customer) are untouched.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'user_role' and n.nspname = 'public'
  ) then
    -- Guarded + IF NOT EXISTS: safe on databases that already have the value
    -- (e.g. a re-run, or an environment where it was added manually).
    execute 'alter type public.user_role add value if not exists ''kitchen''';
  else
    raise notice 'public.user_role does not exist — nothing to add (fresh databases create it in 202607160001 first).';
  end if;
end;
$$;
