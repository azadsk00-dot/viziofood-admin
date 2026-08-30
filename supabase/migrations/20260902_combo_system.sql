-- Vizio Combos — bundle/choice model -- 2026-09-02
--
-- A combo is a normal product (fixed base price, category, image) flagged
-- is_combo. Its required choice groups ("Choose your pasta", "Choose your
-- drink") live in combo_groups; each group's eligible products live in
-- combo_options with price 0 = included (default) or a positive upgrade
-- price that REPLACES inclusion (never adds to the child's standalone
-- price). The child pasta's optional add-on modifiers (adjustment mode
-- only) are offered as inherited extras at order time via
-- combo_groups.inherit_extras.
--
-- order_items gains combo_selections jsonb so the full bundle structure is
-- queryable on the order row (the flat modifiers array keeps rendering
-- identical for kitchen/receipts: selections are zero/upgrade-price lines).
--
-- Seeded example: "Pasta Lunch Combo" $21 in the existing Vizio Combos
-- category — any pasta + any drink, pasta group inherits extras.

-- 1) Combo flag on products
alter table public.products
  add column if not exists is_combo boolean not null default false;

-- 2) Choice groups (slots)
create table if not exists public.combo_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  display_order integer not null default 0,
  min_selections integer not null default 1 check (min_selections >= 0),
  max_selections integer not null default 1 check (max_selections >= 1),
  inherit_extras boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists combo_groups_product_idx on public.combo_groups(product_id, display_order);

-- 3) Eligible products per group (price 0 = included; >0 = upgrade)
create table if not exists public.combo_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.combo_groups(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(10,2) not null default 0 check (price >= 0),
  display_order integer not null default 0,
  unique (group_id, product_id)
);
create index if not exists combo_options_group_idx on public.combo_options(group_id, display_order);

-- 4) Queryable bundle structure on order lines
alter table public.order_items
  add column if not exists combo_selections jsonb;

-- 5) RLS — same shape as the existing products/modifiers policies
alter table public.combo_groups enable row level security;
alter table public.combo_options enable row level security;

drop policy if exists "public reads active combo groups" on public.combo_groups;
create policy "public reads active combo groups" on public.combo_groups
  for select using (active = true);
drop policy if exists "staff manages combo groups" on public.combo_groups;
create policy "staff manages combo groups" on public.combo_groups
  for all using ((select role from public.profiles where id = auth.uid()) in ('admin','staff'))
  with check ((select role from public.profiles where id = auth.uid()) in ('admin','staff'));

drop policy if exists "public reads combo options" on public.combo_options;
create policy "public reads combo options" on public.combo_options
  for select using (true);
drop policy if exists "staff manages combo options" on public.combo_options;
create policy "staff manages combo options" on public.combo_options
  for all using ((select role from public.profiles where id = auth.uid()) in ('admin','staff'))
  with check ((select role from public.profiles where id = auth.uid()) in ('admin','staff'));

-- 6) Seed the example combo (idempotent)
insert into public.products (name, description, price, category, category_id, active, available, is_combo, display_order)
select 'Pasta Lunch Combo', 'Choose any pasta and any drink — one fixed price. Extras optional.', 21.00,
       'Vizio Combos', '0d4efcb8-583f-4011-8642-92fe47371de5', true, true, true, 0
where not exists (select 1 from public.products where name = 'Pasta Lunch Combo' and category = 'Vizio Combos');

-- Choice groups for the seeded combo
insert into public.combo_groups (product_id, name, display_order, min_selections, max_selections, inherit_extras, active)
select p.id, 'Choose your pasta', 0, 1, 1, true, true
from public.products p
where p.name = 'Pasta Lunch Combo' and p.category = 'Vizio Combos'
  and not exists (select 1 from public.combo_groups g where g.product_id = p.id and g.name = 'Choose your pasta');

insert into public.combo_groups (product_id, name, display_order, min_selections, max_selections, inherit_extras, active)
select p.id, 'Choose your drink', 1, 1, 1, false, true
from public.products p
where p.name = 'Pasta Lunch Combo' and p.category = 'Vizio Combos'
  and not exists (select 1 from public.combo_groups g where g.product_id = p.id and g.name = 'Choose your drink');

-- Eligible options: active+available pastas and drinks, all included ($0)
insert into public.combo_options (group_id, product_id, price, display_order)
select g.id, p.id, 0, row_number() over (order by p.display_order, p.name)
from public.combo_groups g
join public.products combo on combo.id = g.product_id
join public.products p on p.category = (case when g.name = 'Choose your pasta' then 'Pasta' else 'Drinks' end)
where combo.name = 'Pasta Lunch Combo' and combo.category = 'Vizio Combos'
  and g.name in ('Choose your pasta', 'Choose your drink')
  and p.active = true and p.available = true and p.archived_at is null
on conflict (group_id, product_id) do nothing;
