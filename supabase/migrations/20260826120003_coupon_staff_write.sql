-- ═══════════════════════════════════════════════════════════════════════════
-- Coupon write policy — fixes "Could not save the coupon" in Admin → Coupons
--
-- ROOT CAUSE: the coupons table (created 202607160002/3) shipped with a
-- SELECT-only policy ("staff reads coupons") and 20260826120000 added only
-- the public read-active policy. With RLS enabled and NO INSERT/UPDATE
-- policy, every write is rejected:
--     42501: new row violates row-level security policy for table "coupons"
-- and UPDATEs silently match zero rows.
--
-- FIX: one policy granting admin/staff full row management — the same shape
-- as every other staff_manage_* policy in this schema. Not a weakening:
-- anon keeps read-active-only; writes still require an authenticated
-- admin/staff profile.
--
-- Idempotent: safe to re-run. No data changes.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'coupons' and policyname = 'staff_manage_coupons'
  ) then
    execute $policy$
      create policy staff_manage_coupons on public.coupons
      for all to authenticated
      using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'staff')
        )
      )
      with check (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('admin', 'staff')
        )
      )
    $policy$;
  end if;
end;
$$;
