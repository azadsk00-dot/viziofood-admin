-- Admin profile management — ADDITIVE ONLY (not deployed; reviewed first).
--
-- Allows admins to update profiles.full_name / role (the Users screen in the
-- management APK). Everyone else keeps the existing rules (own display name
-- only, role unchanged). RLS remains the enforcement layer — the app only
-- surfaces errors.

create policy "admin_update_profiles"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
