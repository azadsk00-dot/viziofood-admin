-- Print jobs for EVERY operational order — cash orders included.
--
-- Problem: print_jobs were only created by the stripe-webhook Edge Function,
-- so cash/pickup orders (and any order created outside Stripe) never queued a
-- kitchen ticket. Printing must not depend on the payment path.
--
-- Fix: a database trigger creates print_jobs the moment an order becomes
-- status 'New' (the only path into operations — Drafts never trigger).
-- Server-authoritative (SECURITY DEFINER), idempotent via the existing
-- unique partial index print_jobs_printer_order_uq (printer_id, order_id)
-- WHERE status <> 'FAILED' — the webhook's own enqueue simply no-ops.
--
-- Do NOT execute against production unless explicitly instructed.

create or replace function public.vizio_enqueue_print_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fire only on the transition INTO 'New' (inserted as New, or updated to
  -- New from any other status). Never for Drafts or later status changes.
  if tg_op = 'INSERT' then
    if new.status is distinct from 'New' then return new; end if;
  else
    if new.status is distinct from 'New' or old.status = 'New' then return new; end if;
  end if;

  insert into public.print_jobs (order_id, order_number, printer_id, status, attempts, max_attempts)
  select new.id, new.order_number, p.id, 'QUEUED', 0, 5
  from public.printers p
  where p.enabled and p.auto_print
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists orders_enqueue_print_jobs on public.orders;
create trigger orders_enqueue_print_jobs
  after insert or update of status on public.orders
  for each row execute function public.vizio_enqueue_print_jobs();
