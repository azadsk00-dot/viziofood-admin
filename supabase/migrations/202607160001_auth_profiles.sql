create type public.user_role as enum ('admin','staff','customer');
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, role public.user_role not null default 'customer', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.profiles enable row level security;
create or replace function public.is_admin() returns boolean language sql security definer stable set search_path=public as $$ select exists (select 1 from public.profiles where id=auth.uid() and role='admin') $$;
create policy "users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "admins read profiles" on public.profiles for select using (public.is_admin());
create policy "users update own display name" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id and role = (select role from public.profiles where id=auth.uid()));
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles (id,full_name,role) values (new.id,coalesce(new.raw_user_meta_data->>'full_name',''),'customer'); return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users; create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
-- Seed after creating admin@viziofood.com in Supabase Auth. Password is deliberately not stored here.
-- update public.profiles set role='admin', full_name='Vizio Food Admin' where id=(select id from auth.users where email='admin@viziofood.com');
