-- Dynamic homepage content, featured dishes and branding — 2026-08-20
--
-- 1. homepage_content: single-row table (same semantics as restaurant_settings)
--    driving the public homepage promotional section. Admins edit it in the
--    admin panel; the public site reads it live (realtime) with no redeploy.
-- 2. products.featured_order: homepage display order for featured dishes,
--    kept separate from display_order so reordering the homepage showcase
--    never disturbs the menu manager's product ordering.
-- 3. restaurant_settings dedupe: two rows exist in production. Admin reads
--    and writes the oldest row (created_at, then id) but the public hook
--    selects with a bare limit(1) — when Postgres returned the other row,
--    admin opening-hours edits never reached the public site. Keeping only
--    the oldest row makes every reader agree. The oldest row is exactly what
--    the public site has been displaying, so no visible data changes.
-- 4. Realtime for homepage_content and products so the public homepage
--    refreshes without a redeploy.

-- ── 1. homepage_content ──

create table if not exists public.homepage_content (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,
  promo_type text not null default 'daily' check (promo_type in ('daily', 'weekly')),
  title text not null default '',
  description text not null default '',
  price numeric(10,2),
  image_url text,
  button_text text not null default '',
  button_link text not null default '',
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger homepage_content_updated_at
  before update on public.homepage_content
  for each row execute procedure public.set_updated_at();

alter table public.homepage_content enable row level security;

-- Public visitors may only read the published (enabled) row. Date-window
-- enforcement happens client-side so admins can preview scheduled promos.
create policy "public reads enabled homepage content"
  on public.homepage_content for select
  using (enabled = true);

create policy "staff reads homepage content"
  on public.homepage_content for select
  using (public.is_admin());

create policy "staff inserts homepage content"
  on public.homepage_content for insert
  with check (public.is_admin());

create policy "staff updates homepage content"
  on public.homepage_content for update
  using (public.is_admin()) with check (public.is_admin());

create policy "staff deletes homepage content"
  on public.homepage_content for delete
  using (public.is_admin());

-- ── 2. products.featured_order + restaurant_settings.logo_url ──

alter table public.products
  add column if not exists featured_order integer not null default 0;

create index if not exists products_homepage_featured_idx
  on public.products (featured_order, display_order, name)
  where featured = true and archived = false;

-- logo_url was declared in the 20260718 migration but never applied to this
-- project — the public/admin selects reference it, so guarantee it exists.
alter table public.restaurant_settings
  add column if not exists logo_url text;

-- ── 3. restaurant_settings dedupe ──
-- Keep the oldest row (created_at, then id) — the row admin writes to and the
-- public site displays — and remove any duplicates.

delete from public.restaurant_settings
where id not in (
  select id from public.restaurant_settings
  order by created_at asc, id asc
  limit 1
);

-- ── 4. Realtime publications ──

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'homepage_content'
  ) then
    alter publication supabase_realtime add table public.homepage_content;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;
end $$;
