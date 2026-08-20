-- Fulfilment method toggles for online ordering.
--
-- Adds independent Pickup/Delivery switches to restaurant_settings so the
-- admin can disable one fulfilment method without pausing all ordering.
-- Defaults preserve current behaviour (both enabled).
--
-- REVIEW: run manually when ready — no other objects depend on these columns.
-- RLS: the existing staff insert/update policies on restaurant_settings cover
-- the new columns automatically; no policy changes required.

alter table public.restaurant_settings
  add column if not exists pickup_enabled boolean not null default true,
  add column if not exists delivery_enabled boolean not null default true;
