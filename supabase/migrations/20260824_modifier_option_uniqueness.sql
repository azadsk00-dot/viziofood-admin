-- Modifier option uniqueness: per-group + case-insensitive — 2026-08-24
--
-- 20260822 created modifiers with `name text not null unique`, making option
-- names GLOBALLY unique. That blocks the intended architecture: the same
-- option name ("Extra Pasta", "Truffle") must be allowed in MANY groups
-- (one per product's extras group); only duplicates WITHIN one group are
-- invalid.
--
-- This migration replaces the global rule with a database-level
-- group-scoped, case-insensitive unique index:
--     unique (group_id, lower(trim(name)))
--
-- No modifier data is modified. Verified against production data before
-- writing: every existing case-insensitive duplicate name lives in a
-- DIFFERENT group, so the index builds cleanly. Cross-group duplicates —
-- previously impossible — become valid.
--
-- Idempotent: safe to re-run.

-- ── 1. Remove the global uniqueness ──
-- `name text not null unique` (20260822) produces the default constraint
-- name {table}_{column}_key. NOT NULL stays; only uniqueness is dropped.
alter table public.modifiers
  drop constraint if exists modifiers_name_key;

-- Defensive sweep: drop any stray UNIQUE single-column index on modifiers(name)
-- that is not owned by a constraint (covers indexes created by other names).
do $$ declare r record; begin
  for r in
    select i.relname as index_name
    from pg_class i
    join pg_namespace n on n.oid = i.relnamespace
    join pg_am am on am.oid = i.relam
    left join pg_constraint c on c.conindid = i.oid
    where n.nspname = 'public'
      and i.relkind = 'i'
      and am.amname = 'btree'
      and c.oid is null
      and pg_get_indexdef(i.oid) ilike 'create unique index% using btree (name)'
  loop
    execute format('drop index if exists public.%I', r.index_name);
  end loop;
end $$;

-- ── 2. Guard: same-group case-insensitive duplicates must not exist ──
-- If future data ever violates the rule, fail loudly with the offending
-- rows instead of silently succeeding without the index.
do $$ declare conflicts text; begin
  select string_agg(format('[%s] %s', g.name, d.names), ', ')
  into conflicts
  from (
    select m.group_id,
           lower(trim(m.name)) as key,
           string_agg(m.name, ' / ' order by m.name) as names
    from public.modifiers m
    where m.group_id is not null
    group by m.group_id, lower(trim(m.name))
    having count(*) > 1
  ) d
  join public.modifier_groups g on g.id = d.group_id;
  if conflicts is not null then
    raise exception 'Same-group duplicate option names must be resolved (delete or rename one of each) before the per-group unique index can be created: %', conflicts;
  end if;
end $$;

-- ── 3. The correct rule: unique per group, case-insensitive ──
create unique index if not exists modifiers_group_name_ci_unique_idx
  on public.modifiers (group_id, lower(trim(name)));
