-- Production-safe product management alignment. This migration is intentionally additive.
alter table public.products
  add column if not exists active boolean not null default true,
  add column if not exists available boolean not null default true,
  add column if not exists featured boolean not null default false,
  add column if not exists popular boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists display_order integer not null default 0,
  add column if not exists preparation_time integer not null default 15 check (preparation_time >= 0),
  add column if not exists calories integer check (calories is null or calories >= 0),
  add column if not exists allergens text[] not null default '{}',
  add column if not exists ingredients text[] not null default '{}',
  add column if not exists sku text,
  add column if not exists internal_notes text not null default '',
  add column if not exists image_url text,
  add column if not exists thumbnail_url text,
  add column if not exists gallery text[] not null default '{}',
  add column if not exists gallery_images text[] not null default '{}',
  add column if not exists tags text[] not null default '{}',
  add column if not exists visibility text not null default 'public' check (visibility in ('public', 'hidden', 'private')),
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists vegetarian boolean not null default false,
  add column if not exists vegan boolean not null default false,
  add column if not exists halal boolean not null default false,
  add column if not exists gluten_free boolean not null default false,
  add column if not exists inventory_quantity integer not null default 0;

-- Preserve legacy gallery values while introducing the canonical gallery column.
update public.products set gallery = gallery_images where cardinality(gallery) = 0 and cardinality(gallery_images) > 0;
update public.products set archived = true where archived_at is not null and archived = false;

create unique index if not exists products_sku_unique_idx on public.products (sku) where sku is not null and sku <> '';
create index if not exists products_management_browse_idx on public.products (archived, active, available, visibility, display_order, name);
create index if not exists products_category_management_idx on public.products (category, display_order, name);
create index if not exists products_featured_management_idx on public.products (featured, popular) where archived = false;
create index if not exists products_created_by_idx on public.products (created_by);
create index if not exists products_updated_by_idx on public.products (updated_by);

-- Public menu consumers only receive products that are actually publishable.
drop policy if exists "public reads active products" on public.products;
create policy "public reads active products" on public.products for select using (active = true and available = true and archived = false and visibility = 'public');

-- Keep audit attribution and the legacy gallery field in sync for all admin writes.
create or replace function public.manage_product_metadata() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.archived then new.archived_at := coalesce(new.archived_at, now()); else new.archived_at := null; end if;
  if cardinality(new.gallery) > 0 then new.gallery_images := new.gallery; elsif cardinality(new.gallery_images) > 0 then new.gallery := new.gallery_images; end if;
  return new;
end;
$$;
drop trigger if exists products_manage_metadata on public.products;
create trigger products_manage_metadata before insert or update on public.products for each row execute procedure public.manage_product_metadata();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads product images" on storage.objects;
create policy "public reads product images" on storage.objects for select using (bucket_id = 'product-images');
drop policy if exists "staff manages product images" on storage.objects;
create policy "staff manages product images" on storage.objects for all using (bucket_id = 'product-images' and public.is_admin()) with check (bucket_id = 'product-images' and public.is_admin());
