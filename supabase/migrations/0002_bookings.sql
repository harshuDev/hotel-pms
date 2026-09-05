-- Layer 2: commercial reservations, their reserved rooms, and immutable
-- nightly inventory/revenue facts. Business dates remain independent from
-- timestamps; no operational state is derived from server time.

create extension if not exists btree_gist;

create type public.booking_status as enum (
  'pending', 'confirmed', 'checked_in', 'checked_out', 'canceled', 'no_show'
);
create type public.booking_settlement as enum (
  'at_property', 'prepaid_to_channel', 'virtual_card'
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  reference text not null,
  customer_id uuid not null,
  channel_id uuid not null,
  status public.booking_status not null default 'pending',
  settlement public.booking_settlement not null default 'at_property',
  check_in date not null,
  check_out date not null,
  adults integer not null default 1,
  children integer not null default 0,
  arrival_time time,
  departure_time time,
  internal_notes text,
  guest_notes text,
  external_reference text,
  external_payload jsonb,
  booked_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, reference),
  foreign key (customer_id, property_id)
    references public.customers (id, property_id) on delete restrict,
  foreign key (channel_id, property_id)
    references public.channels (id, property_id) on delete restrict,
  foreign key (created_by, property_id)
    references public.staff_users (id, property_id) on delete restrict,
  constraint bookings_dates_valid check (check_out > check_in),
  constraint bookings_guest_counts_valid check (adults > 0 and children >= 0)
);
create index bookings_property_status_idx on public.bookings (property_id, status);
create index bookings_property_check_in_idx on public.bookings (property_id, check_in);
create index bookings_property_check_out_idx on public.bookings (property_id, check_out);
create index bookings_property_booked_at_idx on public.bookings (property_id, booked_at desc);
create index bookings_property_customer_idx on public.bookings (property_id, customer_id);

create table public.booking_rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  booking_id uuid not null,
  room_type_id uuid not null,
  room_id uuid,
  status public.booking_status not null default 'pending',
  check_in date not null,
  check_out date not null,
  adults integer not null default 1,
  children integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  foreign key (booking_id, property_id)
    references public.bookings (id, property_id) on delete restrict,
  foreign key (room_type_id, property_id)
    references public.room_types (id, property_id) on delete restrict,
  foreign key (room_id, property_id)
    references public.rooms (id, property_id) on delete restrict,
  constraint booking_rooms_dates_valid check (check_out > check_in),
  constraint booking_rooms_guest_counts_valid check (adults > 0 and children >= 0)
);
create index booking_rooms_property_booking_idx
  on public.booking_rooms (property_id, booking_id);
create index booking_rooms_property_room_type_idx
  on public.booking_rooms (property_id, room_type_id);
create index booking_rooms_property_room_idx
  on public.booking_rooms (property_id, room_id)
  where room_id is not null;
create index booking_rooms_property_check_in_idx
  on public.booking_rooms (property_id, check_in);
create index booking_rooms_property_check_out_idx
  on public.booking_rooms (property_id, check_out);

-- A room is unavailable for every active booked night in [check_in, check_out).
-- Unassigned room-type reservations remain valid; canceled/no-show/checked-out
-- reservations do not reserve a physical room.
alter table public.booking_rooms
  add constraint booking_rooms_no_overlapping_room_assignment
  exclude using gist (
    property_id with =,
    room_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (
    room_id is not null
    and status not in ('canceled', 'no_show', 'checked_out')
  );

create table public.booking_room_nights (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  booking_room_id uuid not null,
  stay_date date not null,
  room_rate_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  status public.booking_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (booking_room_id, stay_date),
  foreign key (booking_room_id, property_id)
    references public.booking_rooms (id, property_id) on delete restrict,
  constraint booking_room_nights_amounts_nonnegative check (
    room_rate_cents >= 0 and tax_cents >= 0 and discount_cents >= 0
  )
);
create index booking_room_nights_property_stay_date_idx
  on public.booking_room_nights (property_id, stay_date);
create index booking_room_nights_property_status_stay_date_idx
  on public.booking_room_nights (property_id, status, stay_date);

-- Each room's dates must stay within the booking's commercial dates and its
-- initially inherited status must agree with the booking. This also prevents
-- accidentally assigning a physical room from another property.
create function public.validate_booking_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_booking public.bookings;
begin
  select * into parent_booking
  from public.bookings
  where id = new.booking_id and property_id = new.property_id;

  if not found then
    raise exception 'Booking must belong to the same property as booking room';
  end if;

  if new.check_in < parent_booking.check_in or new.check_out > parent_booking.check_out then
    raise exception 'Booking room dates must fall within the booking dates';
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    new.status := parent_booking.status;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger booking_rooms_validate_before_write
  before insert or update on public.booking_rooms
  for each row execute function public.validate_booking_room();

-- Preserve explicitly set nightly financial values for unchanged dates while
-- adding/removing only the nights affected by a pre-arrival date adjustment.
create function public.sync_booking_room_nights()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.booking_room_nights
  where booking_room_id = new.id
    and stay_date not in (
      select night.stay_date::date
      from generate_series(
        new.check_in::timestamp,
        (new.check_out - 1)::timestamp,
        interval '1 day'
      ) as night(stay_date)
    );

  insert into public.booking_room_nights (property_id, booking_room_id, stay_date, status)
  select new.property_id, new.id, night.stay_date::date, new.status
  from generate_series(
    new.check_in::timestamp,
    (new.check_out - 1)::timestamp,
    interval '1 day'
  ) as night(stay_date)
  on conflict (booking_room_id, stay_date) do update
    set status = excluded.status,
        updated_at = now();
  return new;
end;
$$;

create trigger booking_rooms_sync_nights_after_write
  after insert or update of check_in, check_out, status, property_id
  on public.booking_rooms
  for each row execute function public.sync_booking_room_nights();

create function public.touch_booking_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.touch_booking_updated_at();

create function public.sync_booking_room_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    update public.booking_rooms
    set status = new.status
    where booking_id = new.id
      and property_id = new.property_id
      and status is distinct from new.status;
  end if;
  return new;
end;
$$;

create trigger bookings_sync_room_status_after_status_change
  after update of status on public.bookings
  for each row execute function public.sync_booking_room_status();

-- Activity records are produced in the database, never by application code.
create function public.log_booking_activity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  activity_action text;
  activity_summary text;
begin
  if tg_table_name = 'bookings' then
    if tg_op = 'INSERT' then
      activity_action := 'booking_created';
      activity_summary := format('Booking %s created', new.reference);
    elsif new.status is not distinct from old.status then
      return new;
    elsif new.status = 'confirmed' then
      activity_action := 'booking_confirmed';
      activity_summary := format('Booking %s confirmed', new.reference);
    elsif new.status = 'canceled' then
      activity_action := 'booking_cancelled';
      activity_summary := format('Booking %s canceled', new.reference);
    elsif new.status = 'checked_in' then
      activity_action := 'guest_checked_in';
      activity_summary := format('Guest checked in for booking %s', new.reference);
    elsif new.status = 'checked_out' then
      activity_action := 'guest_checked_out';
      activity_summary := format('Guest checked out for booking %s', new.reference);
    else
      return new;
    end if;

    insert into public.activity_log (
      property_id, actor_id, entity_type, entity_id, action, summary, metadata
    ) values (
      new.property_id, auth.uid(), 'booking', new.id, activity_action,
      activity_summary, jsonb_build_object('reference', new.reference, 'status', new.status)
    );
  elsif tg_op = 'INSERT' and new.room_id is not null then
    activity_action := 'room_assigned';
    activity_summary := format('Room assigned to booking %s', new.booking_id);
    insert into public.activity_log (
      property_id, actor_id, entity_type, entity_id, action, summary, metadata
    ) values (
      new.property_id, auth.uid(), 'booking_room', new.id, activity_action,
      activity_summary, jsonb_build_object('booking_id', new.booking_id, 'room_id', new.room_id)
    );
  elsif tg_op = 'UPDATE' and new.room_id is distinct from old.room_id and new.room_id is not null then
    activity_action := 'room_assigned';
    activity_summary := format('Room assigned to booking %s', new.booking_id);
    insert into public.activity_log (
      property_id, actor_id, entity_type, entity_id, action, summary, metadata
    ) values (
      new.property_id, auth.uid(), 'booking_room', new.id, activity_action,
      activity_summary, jsonb_build_object('booking_id', new.booking_id, 'room_id', new.room_id)
    );
  end if;
  return new;
end;
$$;

create trigger bookings_log_activity_after_insert
  after insert on public.bookings
  for each row execute function public.log_booking_activity();
create trigger bookings_log_activity_after_status_change
  after update of status on public.bookings
  for each row
  when (old.status is distinct from new.status)
  execute function public.log_booking_activity();
create trigger booking_rooms_log_assignment_after_insert
  after insert on public.booking_rooms
  for each row execute function public.log_booking_activity();
create trigger booking_rooms_log_assignment_after_update
  after update of room_id on public.booking_rooms
  for each row
  when (old.room_id is distinct from new.room_id)
  execute function public.log_booking_activity();

alter table public.bookings enable row level security;
alter table public.booking_rooms enable row level security;
alter table public.booking_room_nights enable row level security;

create policy bookings_property_isolation on public.bookings
  for all using (property_id = public.current_property_id())
  with check (property_id = public.current_property_id());
create policy booking_rooms_property_isolation on public.booking_rooms
  for all using (property_id = public.current_property_id())
  with check (property_id = public.current_property_id());

-- Nights are produced by the security-definer synchronization trigger. They
-- are visible to the property but not client-writable, preserving nightly
-- financial and inventory facts for reporting.
create policy booking_room_nights_select_same_property on public.booking_room_nights
  for select using (property_id = public.current_property_id());

revoke all on function public.validate_booking_room() from public;
revoke all on function public.sync_booking_room_nights() from public;
revoke all on function public.sync_booking_room_status() from public;
revoke all on function public.log_booking_activity() from public;
