-- Printer management roles — fixes "Could not save the printer."
--
-- Symptom: adding/editing a printer in the web admin or on the kitchen
-- tablet failed with the real error hidden behind the generic message
-- (fixed client-side too). The printers write policy allowed admin ONLY.
-- The tablet now prints directly and its simple Printer screen (IP/port
-- edit + test) is the primary management surface, so printer management
-- is open to admin, staff AND kitchen (the tablet is typically signed in
-- with a kitchen account).
--
-- If saves still fail with "row-level security", the signed-in account's
-- profiles.role is not admin/staff/kitchen. Check and fix (SQL editor):
--   select id, role from public.profiles;
--   update public.profiles set role = 'admin'
--     where id = (select id from auth.users where email = 'owner@viziofood.com');

drop policy if exists admin_manage_printers on public.printers;
create policy admin_manage_printers on public.printers
  for all to authenticated
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
  );
