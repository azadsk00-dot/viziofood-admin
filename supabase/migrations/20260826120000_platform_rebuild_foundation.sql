-- ═══════════════════════════════════════════════════════════════════════════
-- Vizio Food platform rebuild — foundation migration
--
-- ADDITIVE AND IDEMPOTENT ONLY. Safe to run against the live project:
--   • every CREATE is IF NOT EXISTS
--   • every ALTER TABLE ... ADD COLUMN is guarded by a column-existence check
--   • no table is dropped, truncated or rewritten
--   • existing rows keep working: every new column is nullable or defaulted
--
-- Adds: specials (Special of the Day), printers, print_jobs, coupon
-- extensions, order fulfilment/charge-breakdown columns, settings
-- extensions (min order, special hours, kitchen prefs, favicon), audit log
-- entity columns, and the 'kitchen' role.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Helper: add a column only when missing ────────────────────────────────
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

-- ─── Roles: add 'kitchen' (kitchen display + printer agents) ───────────────
do $$
begin
  if exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where t.typname = 'user_role' and n.nspname = 'public') then
    execute 'alter type public.user_role add value if not exists ''kitchen''';
  end if;
end;
$$;

-- Kitchen staff may read orders + order items (same policy shape as staff).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'orders' and policyname = 'kitchen_read_orders'
  ) then
    execute $policy$
      create policy kitchen_read_orders on public.orders
      for select to authenticated
      using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
        )
      )
    $policy$;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_items' and policyname = 'kitchen_read_order_items'
  ) then
    execute $policy$
      create policy kitchen_read_order_items on public.order_items
      for select to authenticated
      using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
        )
      )
    $policy$;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'orders' and policyname = 'kitchen_update_status'
  ) then
    execute $policy$
      create policy kitchen_update_status on public.orders
      for update to authenticated
      using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
        )
      )
      with check (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
        )
      )
    $policy$;
  end if;
end;
$$;

-- ─── Specials (Special of the Day) ─────────────────────────────────────────
create table if not exists public.specials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  image_url text,
  price numeric(10,2) not null check (price >= 0),
  original_price numeric(10,2) check (original_price is null or original_price >= 0),
  active boolean not null default true,
  archived boolean not null default false,
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  days_of_week smallint[] not null default '{}',
  cta_text text not null default '',
  cta_link text not null default '',
  category text not null default '',
  dietary text[] not null default '{}',
  ingredients text[] not null default '{}',
  allergens text[] not null default '{}',
  badge text not null default '',
  priority integer not null default 100,
  display_location text not null default 'homepage'
    check (display_location in ('homepage', 'menu', 'both')),
  product_id uuid references public.products(id) on delete set null,
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists specials_active_idx on public.specials (active, archived, priority);

alter table public.specials enable row level security;

-- Public may read specials that are active and unarchived; scheduling is
-- re-resolved client-side from the same rows.
drop policy if exists public_read_specials on public.specials;
create policy public_read_specials on public.specials
  for select to anon, authenticated
  using (active = true and archived = false);

drop policy if exists staff_manage_specials on public.specials;
create policy staff_manage_specials on public.specials
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'staff'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'staff'))
  );

-- ─── Printers ──────────────────────────────────────────────────────────────
create table if not exists public.printers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  station text not null default 'kitchen'
    check (station in ('kitchen', 'bar', 'coffee', 'dessert', 'pickup', 'receipt')),
  connection text not null default 'network' check (connection in ('network', 'system')),
  host text not null default '',
  port integer not null default 9100 check (port between 1 and 65535),
  paper_width integer not null default 80 check (paper_width in (32, 48, 80)),
  enabled boolean not null default true,
  auto_print boolean not null default true,
  copies integer not null default 1 check (copies between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.printers enable row level security;

-- Printer configs are operational data: staff only.
drop policy if exists staff_read_printers on public.printers;
create policy staff_read_printers on public.printers
  for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen'))
  );

drop policy if exists admin_manage_printers on public.printers;
create policy admin_manage_printers on public.printers
  for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ─── Print jobs ────────────────────────────────────────────────────────────
-- The printer agent claims a job by updating QUEUED→PRINTING, prints, then
-- marks PRINTED or FAILED. (printer_id, order_id) is unique among
-- non-failed attempts: webhook replays cannot double-print; explicit
-- reprints and retries of FAILED jobs insert fresh rows.
create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_number text not null default '',
  printer_id uuid not null references public.printers(id) on delete cascade,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'PRINTING', 'PRINTED', 'FAILED', 'RETRYING')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  printed_at timestamptz
);

create index if not exists print_jobs_queue_idx
  on public.print_jobs (status, created_at);
create unique index if not exists print_jobs_printer_order_uq
  on public.print_jobs (printer_id, order_id)
  where status <> 'FAILED';

alter table public.print_jobs enable row level security;

drop policy if exists staff_read_print_jobs on public.print_jobs;
create policy staff_read_print_jobs on public.print_jobs
  for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen'))
  );

-- The agent runs with a staff/kitchen JWT; enqueue happens server-side with
-- the service role (bypasses RLS). Status transitions come from the agent.
drop policy if exists agent_update_print_jobs on public.print_jobs;
create policy agent_update_print_jobs on public.print_jobs
  for update to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen'))
  );

drop policy if exists staff_insert_print_jobs on public.print_jobs;
create policy staff_insert_print_jobs on public.print_jobs
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'staff'))
  );

-- ─── Coupons: extend the legacy table ──────────────────────────────────────
-- Legacy columns percentage_off/amount_off stay in place; kind/value are
-- backfilled once from them and become authoritative going forward.
do $$
begin
  perform public.add_column_if_missing('coupons', 'kind', 'text not null default ''percent'' check (kind in (''percent'', ''fixed''))');
  perform public.add_column_if_missing('coupons', 'value', 'numeric(10,2) not null default 0');
  perform public.add_column_if_missing('coupons', 'minimum_order', 'numeric(10,2) not null default 0');
  perform public.add_column_if_missing('coupons', 'product_ids', 'uuid[] not null default ''{}''');
  perform public.add_column_if_missing('coupons', 'category_names', 'text[] not null default ''{}''');
  perform public.add_column_if_missing('coupons', 'starts_at', 'timestamptz');
  perform public.add_column_if_missing('coupons', 'usage_limit', 'integer');
  perform public.add_column_if_missing('coupons', 'times_used', 'integer not null default 0');
  perform public.add_column_if_missing('coupons', 'ends_at', 'timestamptz');

  -- One-time backfill from legacy columns when they exist.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons' and column_name = 'percentage_off') then
    update public.coupons
      set kind = case when coalesce(percentage_off, 0) > 0 then 'percent' else 'fixed' end,
          value = case when coalesce(percentage_off, 0) > 0 then percentage_off else coalesce(amount_off, 0) end
      where value = 0;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons' and column_name = 'expires_at') then
    update public.coupons set ends_at = expires_at
    where ends_at is null and expires_at is not null;
  end if;
end;
$$;

create unique index if not exists coupons_code_uq on public.coupons (upper(code));

-- Public may validate a coupon code (read active rows only); staff manage.
drop policy if exists public_read_active_coupons on public.coupons;
create policy public_read_active_coupons on public.coupons
  for select to anon, authenticated
  using (active = true);

-- ─── Orders: fulfilment + persisted charge breakdown ───────────────────────
-- NOTE: subtotal / tax_total / delivery_fee / service_charge /
-- card_processing_fee already exist from the 20260821 migration — only the
-- genuinely new columns are added here (discount, coupon, fulfilment,
-- delivery address parts).
do $$
begin
  perform public.add_column_if_missing('orders', 'fulfilment_method', 'text not null default ''Pickup'' check (fulfilment_method in (''Pickup'', ''Delivery''))');
  perform public.add_column_if_missing('orders', 'delivery_address', 'text not null default ''''');
  perform public.add_column_if_missing('orders', 'delivery_suburb', 'text not null default ''''');
  perform public.add_column_if_missing('orders', 'delivery_postcode', 'text not null default ''''');
  perform public.add_column_if_missing('orders', 'delivery_instructions', 'text not null default ''''');
  perform public.add_column_if_missing('orders', 'discount_total', 'numeric(10,2) not null default 0');
  perform public.add_column_if_missing('orders', 'coupon_code', 'text not null default ''''');
  perform public.add_column_if_missing('orders', 'cancelled_by', 'uuid');
end;
$$;

-- ─── Restaurant settings extensions ────────────────────────────────────────
do $$
begin
  perform public.add_column_if_missing('restaurant_settings', 'minimum_order', 'numeric(10,2) not null default 0');
  perform public.add_column_if_missing('restaurant_settings', 'maximum_order', 'numeric(10,2)');
  perform public.add_column_if_missing('restaurant_settings', 'pickup_time', 'integer not null default 15');
  perform public.add_column_if_missing('restaurant_settings', 'pickup_instructions', 'text not null default ''''');
  perform public.add_column_if_missing('restaurant_settings', 'delivery_minimum_order', 'numeric(10,2) not null default 0');
  perform public.add_column_if_missing('restaurant_settings', 'delivery_time', 'integer not null default 35');
  perform public.add_column_if_missing('restaurant_settings', 'special_hours', 'jsonb not null default ''[]''');
  perform public.add_column_if_missing('restaurant_settings', 'favicon_url', 'text');
  perform public.add_column_if_missing('restaurant_settings', 'tiktok', 'text not null default ''''');
  perform public.add_column_if_missing('restaurant_settings', 'currency', 'text not null default ''AUD''');
  perform public.add_column_if_missing('restaurant_settings', 'kitchen_prep_time', 'integer not null default 15');
  perform public.add_column_if_missing('restaurant_settings', 'order_sound_enabled', 'boolean not null default true');
  perform public.add_column_if_missing('restaurant_settings', 'auto_print_enabled', 'boolean not null default true');
end;
$$;

-- ─── Audit log: entity columns + friendly user names ───────────────────────
do $$
begin
  perform public.add_column_if_missing('admin_audit_log', 'entity', 'text not null default ''''');
  perform public.add_column_if_missing('admin_audit_log', 'entity_id', 'text not null default ''''');
  perform public.add_column_if_missing('admin_audit_log', 'user_name', 'text not null default ''''');
end;
$$;

-- ─── Coupon usage counter (atomic; called by stripe-webhook) ──────────────
create or replace function public.increment_coupon_usage(coupon_code text)
returns void
language plpgsql
security definer
as $$
begin
  update public.coupons
     set times_used = times_used + 1
   where upper(code) = upper(coupon_code);
end;
$$;

-- ─── Realtime publications for the new tables ──────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'specials'
  ) then
    alter publication supabase_realtime add table public.specials;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'print_jobs'
  ) then
    alter publication supabase_realtime add table public.print_jobs;
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Post-migration notes
--   • Existing orders default to Pickup until the next checkout writes the
--     real fulfilment_method; subtotal backfills lazily (total − tax).
--   • coupons backfill: kind/value copied once from percentage_off/amount_off;
--     the first admin edit persists the new columns.
--   • print_jobs unique index excludes FAILED rows so a failed job can be
--     retried as a fresh row; reprints are explicit new rows from admin.
-- ═══════════════════════════════════════════════════════════════════════════
