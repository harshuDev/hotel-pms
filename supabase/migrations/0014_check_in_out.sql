-- Layer 10: check-in and check-out.
--
-- This is where rooms.status finally gets maintained. Nothing has ever set a
-- room occupied when a guest arrived, which is why room_house_states has to
-- treat "rooms.status says occupied" and "a checked-in stay is assigned here"
-- as a union. Check-in sets the room occupied; check-out sets it dirty, since
-- a room a guest has just left needs servicing before it can be sold again.
--
-- Whole-booking, not per-room: sync_booking_room_status() already pushes the
-- booking's status down to all of its rooms, so a half-checked-in booking is
-- not a state this schema can hold.

create function public.is_front_office_staff()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.current_role() in ('admin', 'manager', 'front_desk');
$$;

comment on function public.is_front_office_staff() is
  'True for staff who may assign rooms and move guests in and out.';

-- Rooms that can actually take this booked room: the type that was sold, clean
-- and ready, and free for the whole stay. A dirty room is not offered — the
-- guest cannot go in it yet, and housekeeping is the thing that changes that.
create function public.available_rooms_for_booking_room(p_booking_room_id uuid)
returns table (
  room_id uuid,
  number text,
  floor integer,
  room_type_name text
)
language sql
stable
security invoker
set search_path = public
as $$
  select r.id, r.number, r.floor, rt.name
  from public.booking_rooms br
  join public.rooms r
    on r.property_id = br.property_id
   and r.room_type_id = br.room_type_id
   and r.status = 'vacant_clean'
  join public.room_types rt
    on rt.id = r.room_type_id and rt.property_id = r.property_id
  where br.id = p_booking_room_id
    and br.property_id = public.current_property_id()
    and not exists (
      select 1
      from public.booking_rooms taken
      where taken.property_id = br.property_id
        and taken.room_id = r.id
        and taken.id <> br.id
        and taken.status not in ('canceled', 'no_show', 'checked_out')
        and daterange(taken.check_in, taken.check_out, '[)')
            && daterange(br.check_in, br.check_out, '[)')
    )
  order by
    nullif(regexp_replace(r.number, '\D', '', 'g'), '')::bigint nulls last,
    r.number;
$$;

-- The rooms on a booking and whether each has been given a physical room yet.
create function public.booking_rooms_for_assignment(p_booking_id uuid)
returns table (
  booking_room_id uuid,
  room_type_name text,
  room_id uuid,
  room_number text,
  check_in date,
  check_out date
)
language sql
stable
security invoker
set search_path = public
as $$
  select br.id, rt.name, br.room_id, r.number, br.check_in, br.check_out
  from public.booking_rooms br
  join public.room_types rt
    on rt.id = br.room_type_id and rt.property_id = br.property_id
  left join public.rooms r
    on r.id = br.room_id and r.property_id = br.property_id
  where br.booking_id = p_booking_id
    and br.property_id = public.current_property_id()
  order by rt.name, br.id;
$$;

-- Put a guest in a room. The overlap constraint on booking_rooms is the real
-- guard against double-booking; this just fails earlier and more kindly.
create function public.assign_room(p_booking_room_id uuid, p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_br public.booking_rooms;
  v_room public.rooms;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may assign a room';
  end if;

  select * into v_br
  from public.booking_rooms
  where id = p_booking_room_id and property_id = public.current_property_id();

  if not found then
    raise exception 'That booked room does not belong to this property';
  end if;

  if v_br.status in ('canceled', 'no_show', 'checked_out') then
    raise exception 'A % booking cannot be given a room', v_br.status;
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id and property_id = v_br.property_id;

  if not found then
    raise exception 'That room does not belong to this property';
  end if;

  if v_room.room_type_id <> v_br.room_type_id then
    raise exception 'Room % is not the room type this booking was sold', v_room.number;
  end if;

  if v_room.status <> 'vacant_clean' then
    raise exception 'Room % is %, so it is not ready for a guest', v_room.number, v_room.status;
  end if;

  -- The exclusion constraint on booking_rooms is the real guard and still
  -- catches a race, but it reports a gist key clash. Say the useful thing.
  if exists (
    select 1
    from public.booking_rooms taken
    where taken.property_id = v_br.property_id
      and taken.room_id = p_room_id
      and taken.id <> v_br.id
      and taken.status not in ('canceled', 'no_show', 'checked_out')
      and daterange(taken.check_in, taken.check_out, '[)')
          && daterange(v_br.check_in, v_br.check_out, '[)')
  ) then
    raise exception 'Room % is already taken for part of % to %',
      v_room.number, v_br.check_in, v_br.check_out;
  end if;

  update public.booking_rooms
  set room_id = p_room_id
  where id = v_br.id;
end;
$$;

create function public.check_in_booking(p_booking_id uuid)
returns table (rooms_occupied integer)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_today date;
  v_unassigned integer;
  v_count integer;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may check a guest in';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and property_id = public.current_property_id()
  for update;

  if not found then
    raise exception 'That booking does not belong to this property';
  end if;

  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Booking % is %, so it cannot be checked in', v_booking.reference, v_booking.status;
  end if;

  v_today := public.open_business_date(v_booking.property_id);
  if v_today is null then
    raise exception 'There is no open business date';
  end if;

  -- Late arrivals happen; guests arriving before their booking does not.
  if v_booking.check_in > v_today then
    raise exception 'Booking % arrives on %, which is after the business date',
      v_booking.reference, v_booking.check_in;
  end if;

  select count(*) into v_unassigned
  from public.booking_rooms
  where booking_id = v_booking.id
    and property_id = v_booking.property_id
    and room_id is null;

  if v_unassigned > 0 then
    raise exception 'Booking % still needs % room(s) assigned', v_booking.reference, v_unassigned;
  end if;

  -- The status change cascades: sync_booking_room_status() pushes it to the
  -- booked rooms, which pushes it to their nights, which is what ADR and the
  -- night audit read.
  update public.bookings set status = 'checked_in' where id = v_booking.id;

  update public.rooms r
  set status = 'occupied'
  from public.booking_rooms br
  where br.booking_id = v_booking.id
    and br.property_id = v_booking.property_id
    and br.room_id = r.id
    and r.property_id = v_booking.property_id;

  get diagnostics v_count = row_count;
  return query select v_count;
end;
$$;

create function public.check_out_booking(p_booking_id uuid)
returns table (rooms_released integer, outstanding_cents bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_count integer;
  v_owed bigint;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may check a guest out';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and property_id = public.current_property_id()
  for update;

  if not found then
    raise exception 'That booking does not belong to this property';
  end if;

  if v_booking.status <> 'checked_in' then
    raise exception 'Booking % is %, so it cannot be checked out', v_booking.reference, v_booking.status;
  end if;

  update public.bookings set status = 'checked_out' where id = v_booking.id;

  -- A room a guest has just left is dirty, never ready.
  update public.rooms r
  set status = 'vacant_dirty'
  from public.booking_rooms br
  where br.booking_id = v_booking.id
    and br.property_id = v_booking.property_id
    and br.room_id = r.id
    and r.property_id = v_booking.property_id;

  get diagnostics v_count = row_count;

  -- Returned, not enforced. Hotels do let guests leave owing money — company
  -- billing, city ledger, a disputed charge — so this is the front desk's call
  -- to make with the number in front of them.
  select coalesce(sum(greatest(fb.outstanding_cents, 0)), 0) into v_owed
  from public.folio_balances fb
  where fb.booking_id = v_booking.id
    and fb.property_id = v_booking.property_id;

  return query select v_count, v_owed;
end;
$$;

revoke all on function
  public.is_front_office_staff(),
  public.available_rooms_for_booking_room(uuid),
  public.booking_rooms_for_assignment(uuid),
  public.assign_room(uuid, uuid),
  public.check_in_booking(uuid),
  public.check_out_booking(uuid)
from public, anon;

grant execute on function
  public.is_front_office_staff(),
  public.available_rooms_for_booking_room(uuid),
  public.booking_rooms_for_assignment(uuid),
  public.assign_room(uuid, uuid),
  public.check_in_booking(uuid),
  public.check_out_booking(uuid)
to authenticated;
