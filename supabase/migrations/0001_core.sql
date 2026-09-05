-- Layer 1: property-scoped operational reference data and audit records.
-- `business_dates` deliberately models the hotel's operating day separately
-- from wall-clock timestamps; code must never infer it from `now()::date`.

create extension if not exists pgcrypto;

create type public.staff_role as enum (
  'admin', 'manager', 'front_desk', 'cashier', 'housekeeping'
);
create type public.business_date_status as enum ('open', 'closed');
create type public.room_status as enum (
  'vacant_clean', 'vacant_dirty', 'occupied', 'ooo'
);
create type public.customer_kind as enum ('personal', 'company');
create type public.channel_kind as enum (
  'direct', 'ota', 'wholesaler', 'gds', 'offline'
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null,
  currency char(3) not null,
  check_in_time time not null,
  check_out_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint properties_currency_uppercase check (currency = upper(currency))
);

create table public.staff_users (
  id uuid primary key references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  full_name text not null,
  role public.staff_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, property_id)
);

create table public.business_dates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  business_date date not null,
  status public.business_date_status not null default 'open',
  opened_at timestamptz not null default now(),
  opened_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, business_date),
  foreign key (opened_by, property_id)
    references public.staff_users (id, property_id) on delete restrict,
  foreign key (closed_by, property_id)
    references public.staff_users (id, property_id) on delete restrict,
  constraint business_dates_closure_consistency check (
    (status = 'open' and closed_at is null and closed_by is null)
    or (status = 'closed' and closed_at is not null and closed_by is not null)
  )
);

-- This makes the business date an explicit state machine per property.
create unique index business_dates_one_open_per_property
  on public.business_dates (property_id)
  where status = 'open';

create table public.room_types (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  code text not null,
  name text not null,
  base_occupancy integer not null,
  max_occupancy integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, code),
  constraint room_types_occupancy_valid check (
    base_occupancy > 0 and max_occupancy >= base_occupancy
  )
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  room_type_id uuid not null,
  number text not null,
  floor integer,
  status public.room_status not null default 'vacant_clean',
  created_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, number),
  foreign key (room_type_id, property_id)
    references public.room_types (id, property_id) on delete restrict
);

create table public.room_status_history (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  room_id uuid not null,
  status public.room_status not null,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  foreign key (room_id, property_id)
    references public.rooms (id, property_id) on delete restrict,
  foreign key (changed_by, property_id)
    references public.staff_users (id, property_id) on delete restrict
);
create index room_status_history_property_room_changed_at_idx
  on public.room_status_history (property_id, room_id, changed_at desc);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  kind public.customer_kind not null,
  first_name text,
  last_name text,
  company_name text,
  national_id_number text,
  email text,
  phone text,
  exclude_from_email boolean not null default false,
  merged_into_id uuid,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  foreign key (merged_into_id, property_id)
    references public.customers (id, property_id) on delete restrict,
  constraint customers_name_for_kind check (
    (kind = 'personal' and first_name is not null and company_name is null)
    or (kind = 'company' and company_name is not null and first_name is null and last_name is null)
  ),
  constraint customers_not_merged_into_self check (merged_into_id is null or merged_into_id <> id)
);
create index customers_property_lower_email_idx
  on public.customers (property_id, lower(email));
create index customers_property_phone_idx on public.customers (property_id, phone);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  code text not null,
  name text not null,
  kind public.channel_kind not null,
  commission_bps integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, code),
  constraint channels_commission_bps_nonnegative check (commission_bps >= 0)
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  actor_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  foreign key (actor_id, property_id)
    references public.staff_users (id, property_id) on delete restrict
);
create index activity_log_property_created_at_idx
  on public.activity_log (property_id, created_at desc);

-- Security-definer lookups avoid recursive RLS evaluation on staff_users.
create function public.current_property_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select property_id from public.staff_users where id = auth.uid();
$$;

create function public.current_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public, auth
as $$
  select role from public.staff_users where id = auth.uid();
$$;

alter table public.properties enable row level security;
alter table public.staff_users enable row level security;
alter table public.business_dates enable row level security;
alter table public.room_types enable row level security;
alter table public.rooms enable row level security;
alter table public.room_status_history enable row level security;
alter table public.customers enable row level security;
alter table public.channels enable row level security;
alter table public.activity_log enable row level security;

create policy properties_select_current_property on public.properties
  for select using (id = public.current_property_id());

create policy staff_users_select_same_property on public.staff_users
  for select using (property_id = public.current_property_id());
create policy staff_users_insert_admin on public.staff_users
  for insert with check (
    property_id = public.current_property_id() and public.current_role() = 'admin'
  );
create policy staff_users_update_admin on public.staff_users
  for update using (
    property_id = public.current_property_id() and public.current_role() = 'admin'
  ) with check (
    property_id = public.current_property_id() and public.current_role() = 'admin'
  );
create policy staff_users_delete_admin on public.staff_users
  for delete using (
    property_id = public.current_property_id() and public.current_role() = 'admin'
  );

create policy business_dates_property_isolation on public.business_dates
  for all using (property_id = public.current_property_id())
  with check (property_id = public.current_property_id());
create policy room_types_property_isolation on public.room_types
  for all using (property_id = public.current_property_id())
  with check (property_id = public.current_property_id());
create policy rooms_property_isolation on public.rooms
  for all using (property_id = public.current_property_id())
  with check (property_id = public.current_property_id());
create policy customers_property_isolation on public.customers
  for all using (property_id = public.current_property_id())
  with check (property_id = public.current_property_id());
create policy channels_property_isolation on public.channels
  for all using (property_id = public.current_property_id())
  with check (property_id = public.current_property_id());

-- History is written only by the rooms audit trigger and is never mutable.
create policy room_status_history_select_same_property on public.room_status_history
  for select using (property_id = public.current_property_id());

-- The activity log is written only by security-definer audit triggers and is
-- intentionally readable but not mutable by application roles.
create policy activity_log_select_same_property on public.activity_log
  for select using (property_id = public.current_property_id());

create function public.audit_room_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.room_status_history (
    property_id, room_id, status, changed_at, changed_by
  ) values (
    new.property_id, new.id, new.status, now(), auth.uid()
  );

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    new.property_id,
    auth.uid(),
    'room',
    new.id,
    case when tg_op = 'INSERT' then 'created' else 'status_changed' end,
    case when tg_op = 'INSERT'
      then format('Room %s created as %s', new.number, new.status)
      else format('Room %s status changed from %s to %s', new.number, old.status, new.status)
    end,
    jsonb_build_object('room_number', new.number, 'status', new.status)
  );
  return new;
end;
$$;

revoke all on function public.audit_room_status_change() from public;

create trigger rooms_audit_initial_status
  after insert on public.rooms
  for each row execute function public.audit_room_status_change();
create trigger rooms_audit_status_change
  after update of status on public.rooms
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_room_status_change();
