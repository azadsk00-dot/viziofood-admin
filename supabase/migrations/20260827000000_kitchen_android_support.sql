-- Kitchen Android APK support — ADDITIVE ONLY.
--
-- Adds: kitchen device registration/heartbeat, order acknowledgement,
-- notification audit logs, incident log, print job origin. Nothing existing
-- is dropped, renamed or constrained further; the web/admin/printer systems
-- keep working unchanged (unknown columns are ignored by supabase-js).
--
-- Deploy (when ready): supabase db push   — reviewed first, never automatic.

-- ═══ 1. Kitchen devices (registration + heartbeat + push token) ═══════════

create table if not exists public.kitchen_devices (
  id                  uuid primary key default gen_random_uuid(),
  device_id           text not null unique,               -- stable app-generated UUID
  user_id             uuid references auth.users on delete set null,
  name                text not null default '',           -- e.g. "Kitchen Tablet 1"
  platform            text not null default 'android',
  app_version         text not null default '',
  push_token          text not null default '',           -- Expo push token (wraps FCM)
  enabled             boolean not null default true,      -- false after logout: never notify
  last_seen           timestamptz,
  connectivity        text not null default '',           -- online | offline
  realtime_status     text not null default '',           -- connected | disconnected
  printer_status      text not null default '',           -- online | offline | error
  notification_status text not null default '',           -- enabled | disabled
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists kitchen_devices_last_seen_idx on public.kitchen_devices (last_seen desc);

alter table public.kitchen_devices enable row level security;

create policy "kitchen_read_devices"
  on public.kitchen_devices for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
    )
  );

create policy "kitchen_upsert_devices"
  on public.kitchen_devices for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
    )
  );

create policy "kitchen_update_devices"
  on public.kitchen_devices for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
    )
  );

create policy "admin_delete_devices"
  on public.kitchen_devices for delete
  to authenticated
  using (public.is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kitchen_devices'
  ) then
    alter publication supabase_realtime add table public.kitchen_devices;
  end if;
end;
$$;

-- ═══ 2. Order acknowledgement ═════════════════════════════════════════════
-- Additive columns; NOT in the kitchen-protected column list of
-- enforce_order_status_transition(), so kitchen role may set them while the
-- payment/customer columns stay read-only for kitchen.

select public.add_column_if_missing('orders', 'acknowledged_at', 'timestamptz');
select public.add_column_if_missing(
  'orders', 'acknowledged_by',
  'uuid references auth.users on delete set null'
);
create index if not exists orders_acknowledged_idx
  on public.orders (acknowledged_at)
  where acknowledged_at is null;

-- ═══ 3. Notification audit log ════════════════════════════════════════════
-- One row per (order, device) notification; opened/acknowledged timestamps
-- are filled in later, giving an audit trail for "did anyone see it?".

create table if not exists public.kitchen_notification_logs (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders on delete cascade,
  order_number    text not null default '',
  device_id       text not null default '',
  user_id         uuid references auth.users on delete set null,
  source          text not null default 'realtime' check (source in ('realtime', 'push', 'reconciliation')),
  notified_at     timestamptz not null default now(),
  opened_at       timestamptz,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (order_id, device_id)
);

alter table public.kitchen_notification_logs enable row level security;

create policy "kitchen_read_notification_logs"
  on public.kitchen_notification_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
    )
  );

create policy "kitchen_insert_notification_logs"
  on public.kitchen_notification_logs for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
    )
  );

create policy "kitchen_update_notification_logs"
  on public.kitchen_notification_logs for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
    )
  );

-- ═══ 4. Incident log ══════════════════════════════════════════════════════
-- Append-only operational log: printer failures, network outages, missed
-- orders, manual reprints. No update/delete policies — nothing is edited.

create table if not exists public.kitchen_incidents (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in (
                'printer_failure', 'network_outage', 'missed_order',
                'manual_reprint', 'print_retry', 'app_recovery', 'other')),
  severity    text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  order_id    uuid references public.orders on delete set null,
  device_id   text not null default '',
  message     text not null default '',
  details     jsonb not null default '{}',
  user_id     uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists kitchen_incidents_created_idx on public.kitchen_incidents (created_at desc);
create index if not exists kitchen_incidents_kind_idx on public.kitchen_incidents (kind);

alter table public.kitchen_incidents enable row level security;

create policy "kitchen_read_incidents"
  on public.kitchen_incidents for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
    )
  );

create policy "kitchen_insert_incidents"
  on public.kitchen_incidents for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'staff', 'kitchen')
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kitchen_incidents'
  ) then
    alter publication supabase_realtime add table public.kitchen_incidents;
  end if;
end;
$$;

-- ═══ 5. Print job origin (audit: auto vs reprint vs retry) ════════════════

select public.add_column_if_missing(
  'print_jobs', 'origin',
  $$text not null default 'auto' check (origin in ('auto', 'reprint', 'retry'))$$
);
