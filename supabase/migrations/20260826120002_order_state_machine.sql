-- ═══════════════════════════════════════════════════════════════════════════
-- Order state machine — database-level enforcement
--
-- The application only ever requests valid transitions, but the database is
-- the authority: this trigger blocks every INVALID status change at the
-- source, for any client (admin UI, kitchen display, future mobile app,
-- direct API calls).
--
-- Rules:
--   • Terminal states (Completed, Cancelled, Rejected) can never change.
--   • Draft may only become New (webhook payment confirmation) or Cancelled.
--   • Active states move FORWARD only:
--       New → Accepted → Preparing → Ready → Completed
--     (skipping ahead is allowed; moving backwards is not)
--   • Cancelled / Rejected are reachable from any active state.
--
-- Additionally, KITCHEN-role actors may only change the status workflow
-- fields — any attempt to mutate payment, refund, charge or contact fields
-- is rejected. The service role (Edge Functions) is exempt: it performs the
-- authoritative payment/refund writes.
--
-- Idempotent: safe to re-run. Runs AFTER 20260826120000 (its columns exist).
-- ═══════════════════════════════════════════════════════════════════════════

-- Rank helper (New→1 … Completed→5; terminal/unknown = 99).
create or replace function public.order_status_rank(status text)
returns integer
language sql
immutable
as $$
  select case status
    when 'New' then 1
    when 'Accepted' then 2
    when 'Preparing' then 3
    when 'Ready' then 4
    when 'Completed' then 5
    else 99
  end;
$$;

create or replace function public.enforce_order_status_transition()
returns trigger
language plpgsql
security definer
as $$
declare
  jwt_claims text;
  actor_role text;
  is_kitchen boolean;
  protected_columns_changed boolean;
begin
  -- ── Kitchen column protection (applies to every update) ──
  -- Kitchen accounts may advance the workflow but never touch money or
  -- customer data. The service role (Edge Functions) is exempt.
  jwt_claims := coalesce(current_setting('request.jwt.claims', true), '');
  actor_role := case
    when jwt_claims = '' then null
    else (jwt_claims::jsonb ->> 'role')
  end;

  if coalesce(actor_role, '') = 'service_role' then
    null; -- authoritative server-side write (webhook / refund function)
  else
    select p.role into actor_role
    from public.profiles p
    where p.id = auth.uid();

    is_kitchen := actor_role = 'kitchen';

    protected_columns_changed :=
      new.payment_status   is distinct from old.payment_status
      or new.total         is distinct from old.total
      or new.subtotal      is distinct from old.subtotal
      or new.tax_total     is distinct from old.tax_total
      or new.discount_total is distinct from old.discount_total
      or new.coupon_code   is distinct from old.coupon_code
      or new.delivery_fee  is distinct from old.delivery_fee
      or new.service_charge is distinct from old.service_charge
      or new.card_processing_fee is distinct from old.card_processing_fee
      or new.payment_intent_id is distinct from old.payment_intent_id
      or new.stripe_session_id  is distinct from old.stripe_session_id
      or new.stripe_payment_intent is distinct from old.stripe_payment_intent
      or new.refund_status is distinct from old.refund_status
      or new.refund_id     is distinct from old.refund_id
      or new.refund_amount is distinct from old.refund_amount
      or new.refunded_at   is distinct from old.refunded_at
      or new.refund_reason is distinct from old.refund_reason
      or new.customer_name  is distinct from old.customer_name
      or new.customer_email is distinct from old.customer_email
      or new.customer_phone is distinct from old.customer_phone;

    if is_kitchen and protected_columns_changed then
      raise exception 'Kitchen accounts may update order status only — payment, charge and customer fields are read-only.';
    end if;
  end if;

  -- ── Status transition rules ──
  if new.status is distinct from old.status then
    -- Terminal states are frozen.
    if old.status in ('Completed', 'Cancelled', 'Rejected') then
      raise exception 'Order % is % (terminal) — status can no longer change.', old.order_number, old.status;
    end if;

    if old.status = 'Draft' and new.status not in ('New', 'Cancelled') then
      raise exception 'Draft orders can only become New (payment confirmed) or Cancelled — not %.', new.status;
    end if;

    if old.status in ('New', 'Accepted', 'Preparing', 'Ready') then
      if new.status in ('Cancelled', 'Rejected') then
        null; -- terminal move from an active state is always allowed
      elsif public.order_status_rank(new.status) < public.order_status_rank(old.status) then
        raise exception 'Invalid transition % → %: order status only moves forward.', old.status, new.status;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists order_status_transition_guard on public.orders;
create trigger order_status_transition_guard
  before update on public.orders
  for each row
  execute function public.enforce_order_status_transition();
