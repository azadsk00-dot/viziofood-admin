-- Dine-in order type.
--
-- The website checkout now offers ORDER TYPE: Pickup / Dine-in (Delivery
-- stays as configured). fulfilment_method is constrained to
-- ('Pickup','Delivery') by the platform-rebuild migration — widen it to
-- include 'Dine-in'. Order type stays INDEPENDENT of payment method
-- (card/cash combine freely with pickup/dine-in/delivery).
--
-- NOTE: production is also missing 20260827000000_kitchen_android_support.sql
-- (acknowledged_at/acknowledged_by columns, print_jobs.origin,
-- kitchen_devices, kitchen_notification_logs, kitchen_incidents) — verified
-- by live schema probes on 2026-08-23. Apply it together with this file;
-- both are idempotent and additive.
--
-- Do NOT execute against production unless explicitly instructed.

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.orders'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%fulfilment_method%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.orders drop constraint %I', constraint_name);
  end if;

  alter table public.orders
    add constraint orders_fulfilment_method_check
    check (fulfilment_method in ('Pickup', 'Delivery', 'Dine-in'));
end;
$$;
