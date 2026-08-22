-- Checkout charges + admin fixes — 2026-08-21
--
-- Self-sufficient and idempotent: safe to run on its own OR after
-- 20260820_dynamic_homepage.sql (which was committed but never applied to
-- production at the time this was written — verified 2026-08-21 that
-- homepage_content, products.featured_order and restaurant_settings.logo_url
-- were all still missing, and restaurant_settings still held 8 duplicate
-- rows). Everything below uses IF NOT EXISTS / guarded blocks so a re-run,
-- or running both files, is harmless.
--
-- 1. homepage_content table + RLS + realtime (public homepage special).
-- 2. products.featured_order (homepage showcase ordering).
-- 3. restaurant_settings: logo_url + service_charge + card_processing_fee.
-- 4. restaurant_settings singleton: dedupe to the oldest row, then a unique
--    index on a constant so a second row can never be inserted again. Admin
--    and the public site both resolve rows with ORDER BY created_at, id —
--    with exactly one row existing, both always agree.
-- 5. orders: store the actual charge breakdown used at checkout so later
--    settings changes never rewrite history (subtotal / delivery_fee /
--    service_charge / card_processing_fee; tax_total already existed).

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

drop trigger if exists homepage_content_updated_at on public.homepage_content;
create trigger homepage_content_updated_at
  before update on public.homepage_content
  for each row execute procedure public.set_updated_at();

alter table public.homepage_content enable row level security;

drop policy if exists "public reads enabled homepage content" on public.homepage_content;
create policy "public reads enabled homepage content"
  on public.homepage_content for select
  using (enabled = true);

drop policy if exists "staff reads homepage content" on public.homepage_content;
create policy "staff reads homepage content"
  on public.homepage_content for select
  using (public.is_admin());

drop policy if exists "staff inserts homepage content" on public.homepage_content;
create policy "staff inserts homepage content"
  on public.homepage_content for insert
  with check (public.is_admin());

drop policy if exists "staff updates homepage content" on public.homepage_content;
create policy "staff updates homepage content"
  on public.homepage_content for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff deletes homepage content" on public.homepage_content;
create policy "staff deletes homepage content"
  on public.homepage_content for delete
  using (public.is_admin());

-- ── 2. products.featured_order ──

alter table public.products
  add column if not exists featured_order integer not null default 0;

create index if not exists products_homepage_featured_idx
  on public.products (featured_order, display_order, name)
  where featured = true and archived = false;

-- ── 3. restaurant_settings new columns ──
-- logo_url was declared in 20260718 but never applied here. tax_rate and
-- delivery_fee already exist; service_charge and card_processing_fee are the
-- new configurable checkout charges (percentages, 0 = disabled).

alter table public.restaurant_settings
  add column if not exists logo_url text,
  add column if not exists service_charge numeric(5,2) not null default 0 check (service_charge >= 0),
  add column if not exists card_processing_fee numeric(5,2) not null default 0 check (card_processing_fee >= 0);

-- ── 4. restaurant_settings singleton ──

delete from public.restaurant_settings
where id not in (
  select id from public.restaurant_settings
  order by created_at asc, id asc
  limit 1
);

-- Hard guarantee: the constant-expression unique index allows exactly one row.
create unique index if not exists restaurant_settings_singleton_idx
  on public.restaurant_settings ((true));

-- ── 5. orders charge breakdown ──
-- Historical rows keep their existing values (defaults backfill to 0); new
-- orders get the exact amounts charged at checkout time.

alter table public.orders
  add column if not exists subtotal numeric(10,2) not null default 0,
  add column if not exists delivery_fee numeric(10,2) not null default 0,
  add column if not exists service_charge numeric(10,2) not null default 0,
  add column if not exists card_processing_fee numeric(10,2) not null default 0;

-- ── 6. Realtime publications ──

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
