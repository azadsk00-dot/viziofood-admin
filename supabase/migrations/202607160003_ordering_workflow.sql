-- Run in the Supabase SQL editor or through the Supabase CLI.
create type public.order_status as enum ('New','Accepted','Preparing','Ready','Completed','Cancelled');
alter table public.products add column if not exists inventory_quantity integer not null default 0;
create table if not exists public.product_modifiers (id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade, name text not null, price numeric(10,2) not null default 0, active boolean not null default true);
create table if not exists public.coupons (id uuid primary key default gen_random_uuid(), code text unique not null, percentage_off numeric(5,2), amount_off numeric(10,2), active boolean not null default true, expires_at timestamptz);
create table if not exists public.order_status_history (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade, status public.order_status not null, changed_by uuid references auth.users(id), created_at timestamptz not null default now());
alter table public.orders add column if not exists fulfilment_method text not null default 'pickup', add column if not exists special_instructions text, add column if not exists tax_total numeric(10,2) not null default 0, add column if not exists stripe_session_id text unique;
alter table public.orders alter column status type public.order_status using status::public.order_status;
alter table public.product_modifiers enable row level security; alter table public.coupons enable row level security; alter table public.order_status_history enable row level security;
-- Public menu reads only. Staff writes should be restricted by an is_staff() helper tied to profiles.role.
create policy "public reads active modifiers" on public.product_modifiers for select using (active = true);
create policy "staff manages modifiers" on public.product_modifiers for all using ((select role from public.profiles where id = auth.uid()) in ('admin','staff'));
create policy "staff reads coupons" on public.coupons for select using ((select role from public.profiles where id = auth.uid()) = 'admin');
create policy "staff reads order history" on public.order_status_history for select using ((select role from public.profiles where id = auth.uid()) in ('admin','staff'));
do $$ begin if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then alter publication supabase_realtime add table public.orders; end if; end $$;
