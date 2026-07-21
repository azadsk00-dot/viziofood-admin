-- Idempotent live-order management support for the current Vizio Food schema.
-- public.orders.status is TEXT. No enum is created or altered by this migration.

-- The current database already has payment_status, stripe_session_id, and
-- stripe_payment_intent. Only create the index when it is absent.
do $$
begin
  if to_regclass('public.orders') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_status')
     and not exists (
       select 1 from pg_indexes
       where schemaname = 'public' and tablename = 'orders'
         and indexname = 'orders_live_management_idx'
     ) then
    execute 'create index orders_live_management_idx on public.orders (status, payment_status, created_at desc)';
  end if;
end;
$$;

-- Add status history only when the existing history table has the required
-- columns. Existing functions and triggers are left untouched.
do $$
begin
  if to_regclass('public.orders') is not null
     and to_regclass('public.order_status_history') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_status_history' and column_name = 'order_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_status_history' and column_name = 'status') then
    if to_regprocedure('public.record_order_status_change()') is null then
      execute $function$
        create function public.record_order_status_change()
        returns trigger language plpgsql security definer set search_path = public as $body$
        begin
          if new.status is distinct from old.status then
            insert into public.order_status_history (order_id, status) values (new.id, new.status);
          end if;
          return new;
        end;
        $body$;
      $function$;
    end if;

    if not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.orders'::regclass
        and tgname = 'orders_record_status_change'
        and not tgisinternal
    ) then
      execute 'create trigger orders_record_status_change after update of status on public.orders for each row execute procedure public.record_order_status_change()';
    end if;
  end if;
end;
$$;

-- Add only missing staff policies. All references to profiles are guarded by
-- checks for the table and the columns required by the policy expression.
do $$
declare
  has_profiles boolean;
begin
  select to_regclass('public.profiles') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'role')
    into has_profiles;

  if has_profiles and to_regclass('public.orders') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'staff reads orders') then
      execute 'create policy "staff reads orders" on public.orders for select using (exists (select 1 from public.profiles where id = auth.uid() and role::text in (''admin'', ''staff'')))';
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'staff updates orders') then
      execute 'create policy "staff updates orders" on public.orders for update using (exists (select 1 from public.profiles where id = auth.uid() and role::text in (''admin'', ''staff''))) with check (exists (select 1 from public.profiles where id = auth.uid() and role::text in (''admin'', ''staff'')))';
    end if;
  end if;

  if has_profiles and to_regclass('public.order_items') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_items' and policyname = 'staff reads order items') then
    execute 'create policy "staff reads order items" on public.order_items for select using (exists (select 1 from public.profiles where id = auth.uid() and role::text in (''admin'', ''staff'')))';
  end if;

  if has_profiles and to_regclass('public.order_status_history') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_status_history' and policyname = 'staff reads order history') then
    execute 'create policy "staff reads order history" on public.order_status_history for select using (exists (select 1 from public.profiles where id = auth.uid() and role::text in (''admin'', ''staff'')))';
  end if;
end;
$$;
