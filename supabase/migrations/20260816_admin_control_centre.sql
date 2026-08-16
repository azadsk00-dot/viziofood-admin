-- Idempotent migration: Admin Control Centre
-- Adds restaurant settings fields, order refund/cancellation fields, audit log, and RLS policies.

-- ============================================================================
-- 1. Restaurant settings — add orders_enabled, order_pause_message, suburb,
--    state, postcode, and structured opening hours.
-- ============================================================================
alter table public.restaurant_settings
  add column if not exists orders_enabled boolean not null default true,
  add column if not exists order_pause_message text not null default '',
  add column if not exists suburb text not null default '',
  add column if not exists state text not null default '',
  add column if not exists postcode text not null default '',
  add column if not exists opening_hours jsonb not null default '{}'::jsonb;
-- opening_hours structure:
-- {"mon":{"open":"11:00","close":"15:30","closed":false},"tue":{...},...}

-- ============================================================================
-- 2. Orders — add refund and cancellation fields.
-- ============================================================================
alter table public.orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text not null default '',
  add column if not exists refund_status text not null default '' check (refund_status in ('','pending','succeeded','partially_refunded','failed')),
  add column if not exists refund_id text not null default '',
  add column if not exists refund_amount numeric(10,2) not null default 0 check (refund_amount >= 0),
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reason text not null default '',
  add column if not exists payment_intent_id text not null default '',
  add column if not exists stripe_charge_id text not null default '';

-- Add payment_status column if not present (added by ordering_workflow but be safe)
alter table public.orders
  add column if not exists payment_status text not null default 'pending',
  add column if not exists stripe_session_id text unique,
  add column if not exists stripe_payment_intent text not null default '';

-- Index for refund lookups
create index if not exists orders_refund_status_idx on public.orders (refund_status) where refund_status <> '';
create index if not exists orders_payment_intent_idx on public.orders (payment_intent_id) where payment_intent_id <> '';

-- ============================================================================
-- 3. Admin audit log table.
-- ============================================================================
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null, -- nullable: webhook-generated entries have no admin user
  action text not null,
  details jsonb not null default '{}'::jsonb,
  order_id uuid references public.orders(id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_user_idx on public.admin_audit_log (user_id, created_at desc);
create index if not exists admin_audit_log_action_idx on public.admin_audit_log (action, created_at desc);
create index if not exists admin_audit_log_order_idx on public.admin_audit_log (order_id, created_at desc);

-- ============================================================================
-- 4. RLS — audit log
-- ============================================================================
alter table public.admin_audit_log enable row level security;

create policy "admin reads audit log" on public.admin_audit_log
  for select using (exists (select 1 from public.profiles where id = auth.uid() and role::text in ('admin', 'staff')));

create policy "admin inserts audit log" on public.admin_audit_log
  for insert with check (exists (select 1 from public.profiles where id = auth.uid() and role::text in ('admin', 'staff')));

-- ============================================================================
-- 5. RLS — restaurant settings updates (staff/admin only; public read already exists)
-- ============================================================================
-- The existing "public reads restaurant settings" policy already allows anon reads.
-- Add update/insert policies for staff.

create policy "staff updates restaurant settings" on public.restaurant_settings
  for update using (exists (select 1 from public.profiles where id = auth.uid() and role::text in ('admin', 'staff')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role::text in ('admin', 'staff')));

create policy "staff inserts restaurant settings" on public.restaurant_settings
  for insert with check (exists (select 1 from public.profiles where id = auth.uid() and role::text in ('admin', 'staff')));

-- ============================================================================
-- 6. Add restaurant_settings to realtime publication so the public site can
--    react to pause/resume and setting changes without redeployment.
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
