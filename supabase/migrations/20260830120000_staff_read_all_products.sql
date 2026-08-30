-- Staff must see the whole products catalogue.
--
-- The only SELECT policy on products was "public reads active products"
-- (active ∧ available ∧ ¬archived ∧ visibility = public). Authenticated staff
-- therefore could not see inactive, unavailable, hidden or archived rows, and
-- because UPDATE/DELETE row visibility follows SELECT visibility, they also
-- could not edit, re-activate or restore them — bulk actions silently
-- matched zero rows while PostgREST reported success.
--
-- Staff-adjacent roles (admin, staff, kitchen) authenticate through Supabase
-- Auth and have a profiles row; customers keep the public-menu view only.

drop policy if exists "staff reads all products" on public.products;
create policy "staff reads all products" on public.products
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
    )
  );
