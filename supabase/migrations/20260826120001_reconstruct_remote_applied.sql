-- ═══════════════════════════════════════════════════════════════════════════
-- Reconstruction of the remote-applied objects (20260822 / 20260823)
--
-- The original migration files for Aug 22/23 2026 were lost; their changes
-- exist only in the live database (documented in the placeholder files
-- 20260822/20260823_remote_applied.sql). This migration re-creates those
-- objects idempotently so a FRESH database built from the repository reaches
-- feature parity with production:
--
--   • public.modifiers — per-product modifier OPTIONS (name, price, group)
--     in their FINAL form: the global name-unique constraint was already
--     replaced by the per-group case-insensitive index (see 20260824), so
--     this reconstruction creates the final state directly.
--   • categories.display_order / categories.active
--   • products.spice_level / products.featured_order (featured_order is also
--     created by 20260821 — guarded here with add_column_if_missing)
--
-- On the LIVE database this is a complete no-op (every object exists).
-- Nothing is dropped or rewritten; existing data is untouched.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── modifiers table (final form) ──────────────────────────────────────────
create table if not exists public.modifiers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.modifier_groups(id) on delete cascade,
  name text not null,
  description text not null default '',
  price numeric(10,2) not null default 0 check (price >= 0),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists modifiers_group_idx on public.modifiers (group_id);
create index if not exists modifiers_active_idx on public.modifiers (active, display_order);

-- Per-group case-insensitive uniqueness (final state; on the live DB this
-- index already exists from 20260824).
create unique index if not exists modifiers_group_name_ci_unique_idx
  on public.modifiers (group_id, lower(trim(name)));

-- A legacy GLOBAL unique constraint may exist on fresh-DB replays of
-- 20260824-era logic — drop it if present (it was removed in production).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.modifiers'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%(name)%'
  ) then
    execute 'alter table public.modifiers drop constraint '
      || (select conname from pg_constraint
          where conrelid = 'public.modifiers'::regclass
            and contype = 'u'
            and pg_get_constraintdef(oid) like '%(name)%'
          limit 1);
  end if;
end;
$$;

alter table public.modifiers enable row level security;

-- Public may read ACTIVE options (the menu customizer); staff manage them.
drop policy if exists public_read_active_modifiers on public.modifiers;
create policy public_read_active_modifiers on public.modifiers
  for select to anon, authenticated
  using (active = true);

drop policy if exists staff_manage_modifiers on public.modifiers;
create policy staff_manage_modifiers on public.modifiers
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'staff'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'staff'))
  );

-- ─── categories.display_order / active (20260823, remote-applied) ─────────
create or replace function public.add_column_if_missing(
  _table text, _column text, _definition text
) returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = _table and column_name = _column
  ) then
    execute format('alter table public.%I add column %I %s', _table, _column, _definition);
  end if;
end;
$$;

do $$
begin
  perform public.add_column_if_missing('categories', 'display_order', 'integer not null default 0');
  perform public.add_column_if_missing('categories', 'active', 'boolean not null default true');
  perform public.add_column_if_missing('products', 'spice_level', 'text not null default ''none''');
  perform public.add_column_if_missing('products', 'featured_order', 'integer');
end;
$$;

create index if not exists categories_display_order_idx on public.categories (display_order);

-- ═══════════════════════════════════════════════════════════════════════════
-- Verification notes
--   • Live DB: no-op (all objects exist; IF NOT EXISTS everywhere).
--   • Fresh DB: 20260824 runs before this file in sequence but is guarded
--     (see its updated DO block) — it skips when public.modifiers is absent,
--     and THIS migration creates the table in its final state.
-- ═══════════════════════════════════════════════════════════════════════════
