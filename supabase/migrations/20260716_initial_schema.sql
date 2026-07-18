-- Base schema for a new Vizio Food Supabase project.
-- Run before auth_profiles and ordering_workflow migrations.

create extension if not exists pgcrypto;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  phone text not null default '',
  orders_count integer not null default 0,
  total_spend numeric(10,2) not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  -- `category` supports the current React create-product payload.
  category text not null default 'Pasta',
  category_id uuid references public.categories(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

-- Keeps the text payload used by the client and the relational category link in sync.
create or replace function public.sync_product_category() returns trigger language plpgsql as $$
begin
  insert into public.categories (name) values (new.category) on conflict (name) do nothing;
  select id into new.category_id from public.categories where name = new.category;
  return new;
end;
$$;
create trigger products_sync_category before insert or update of category on public.products for each row execute procedure public.sync_product_category();

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  reorder_threshold integer not null default 0 check (reorder_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurant_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Vizio Food',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  hours text not null default '',
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  tax_rate numeric(5,2) not null default 10 check (tax_rate >= 0),
  instagram text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  percentage_off numeric(5,2) check (percentage_off between 0 and 100),
  amount_off numeric(10,2) check (amount_off >= 0),
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (percentage_off is not null or amount_off is not null)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('VF-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null default '',
  total numeric(10,2) not null default 0 check (total >= 0),
  status text not null default 'New',
  items_count integer not null default 0 check (items_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null default 1 check (quantity > 0),
  modifiers jsonb not null default '[]'::jsonb,
  special_instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_modifiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, name)
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index products_category_id_idx on public.products(category_id);
create index products_active_idx on public.products(active);
create index orders_status_created_at_idx on public.orders(status, created_at desc);
create index orders_customer_id_idx on public.orders(customer_id);
create index order_items_order_id_idx on public.order_items(order_id);
create index product_modifiers_product_id_idx on public.product_modifiers(product_id);
create index order_status_history_order_id_idx on public.order_status_history(order_id, created_at desc);
create index customers_email_idx on public.customers(email);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger categories_updated_at before update on public.categories for each row execute procedure public.set_updated_at();
create trigger customers_updated_at before update on public.customers for each row execute procedure public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute procedure public.set_updated_at();
create trigger inventory_updated_at before update on public.inventory for each row execute procedure public.set_updated_at();
create trigger restaurant_settings_updated_at before update on public.restaurant_settings for each row execute procedure public.set_updated_at();
create trigger coupons_updated_at before update on public.coupons for each row execute procedure public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute procedure public.set_updated_at();
create trigger order_items_updated_at before update on public.order_items for each row execute procedure public.set_updated_at();
create trigger product_modifiers_updated_at before update on public.product_modifiers for each row execute procedure public.set_updated_at();

alter table public.categories enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.product_modifiers enable row level security;
alter table public.order_status_history enable row level security;

-- Public ordering reads only active menu records. Staff management policies are supplied after profiles exist.
create policy "public reads active products" on public.products for select using (active = true);
create policy "public reads categories" on public.categories for select using (true);
create policy "public reads restaurant settings" on public.restaurant_settings for select using (true);
create policy "customers read own customer record" on public.customers for select using (auth_user_id = auth.uid());
create policy "customers read own orders" on public.orders for select using (customer_id in (select id from public.customers where auth_user_id = auth.uid()));
create policy "customers read own order items" on public.order_items for select using (order_id in (select o.id from public.orders o join public.customers c on c.id=o.customer_id where c.auth_user_id=auth.uid()));

alter publication supabase_realtime add table public.orders;
