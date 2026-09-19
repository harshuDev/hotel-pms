-- 0053: the calendar shows rooms, not room types.
--
-- The client put it plainly: "in the calendar you should use the room setup
-- because it allows the hotel to see all the rooms they have and the guest
-- staying in each room". They are right, and it is what every property
-- management system does -- a receptionist's first question is "who is in
-- 101", which a grid aggregated to room type cannot answer at all.
--
-- THIS OVERRIDES THE ~1,800 ROOM RULE FOR THIS ONE SCREEN, deliberately and
-- on the client's instruction. `calendar_rooms()` returns every room. The rule
-- stands everywhere else, and the mitigations here are real rather than
-- nominal: the row is thin (an id, a number, a floor, a type and a status,
-- never the whole room), and the board groups rooms under their type so a very
-- large property collapses to a handful of headers. What the rule was written
-- to stop -- a dashboard drawing 1,800 tiles nobody asked for -- is not this.
--
-- WHAT DOES NOT CHANGE: no room is allocated when a booking is taken. That is
-- still `assign_room()`'s job, and a booking with no room yet is real and
-- common rather than an error. The board gives those their own band per room
-- type instead of pretending they belong to a room.

/* -------------------------------------------------------------------------- */
/* The rail: every room, in the order a hotel lists them                      */
/* -------------------------------------------------------------------------- */

create function public.calendar_rooms()
returns table (
  room_id uuid,
  room_number text,
  floor text,
  room_type_id uuid,
  room_type_name text,
  room_status public.room_status,
  sort_order integer
)
language sql
stable
security invoker
set search_path = public
as $function$
  select
    r.id,
    r.number,
    r.floor,
    rt.id,
    rt.name,
    r.status,
    rt.sort_order
  from public.rooms r
  join public.room_types rt
    on rt.id = r.room_type_id and rt.property_id = r.property_id
  where r.property_id = public.current_property_id()
  -- Type order first so the board groups, then the room number read as a
  -- number: '101' before '20' is what plain text ordering gives, and a hotel
  -- numbers rooms to be read in order.
  order by rt.sort_order, rt.name,
           nullif(regexp_replace(r.number, '\D', '', 'g'), '')::bigint
             nulls last,
           r.number;
$function$;

comment on function public.calendar_rooms() is
  'Every room as a calendar row, grouped by type. Deliberately unpaginated: the calendar shows the whole house.';


/* -------------------------------------------------------------------------- */
/* The bars, keyed to a room                                                  */
/* -------------------------------------------------------------------------- */

/*
 * One row per booked room that touches the window.
 *
 * `room_id` is null where nothing has been allocated yet, which is every
 * booking before check-in unless somebody placed it by hand. The board draws
 * those in an "Unassigned" band under their room type rather than guessing a
 * room -- a bar sitting on 101 that nobody has actually put in 101 is worse
 * than no bar at all, because the next person to look reads it as settled.
 *
 * NO PER-TYPE CAP ON ASSIGNED BARS, unlike `calendar_bookings()`. That cap
 * existed because every bar for a type piled onto one row; here an assigned bar
 * has a room row of its own, so the row count is bounded by the house and not
 * by how well it is selling. Unassigned bars still share a band, so those are
 * capped.
 */
create function public.calendar_room_bars(
  p_from date,
  p_nights integer,
  p_unassigned_cap integer default 40
)
returns table (
  room_id uuid,
  room_type_id uuid,
  booking_id uuid,
  booking_room_id uuid,
  reference text,
  guest_name text,
  status public.booking_status,
  check_in date,
  check_out date,
  guests integer,
  value_cents bigint,
  has_notes boolean,
  is_assigned boolean,
  unassigned_total integer
)
language sql
stable
security invoker
set search_path = public
as $function$
  with win as (
    select p_from as from_date, (p_from + greatest(coalesce(p_nights, 30), 1)) as to_date
  ),
  lines as (
    select
      br.room_id,
      br.room_type_id,
      b.id as booking_id,
      br.id as booking_room_id,
      b.reference,
      coalesce(public.customer_display_name(c), 'No name recorded') as guest_name,
      b.status,
      br.check_in,
      br.check_out,
      (br.adults + br.children) as guests,
      -- The room line's own nights, rate less discount plus tax -- not the
      -- folio, because most of these nights have not been charged yet.
      coalesce((
        select sum(n.room_rate_cents - n.discount_cents + n.tax_cents)
        from public.booking_room_nights n
        where n.booking_room_id = br.id and n.property_id = br.property_id
          and n.status not in ('canceled', 'no_show')
      ), 0)::bigint as value_cents,
      (
        nullif(btrim(coalesce(b.guest_notes, '')), '') is not null
        or nullif(btrim(coalesce(b.internal_notes, '')), '') is not null
      ) as has_notes
    from public.booking_rooms br
    join public.bookings b
      on b.id = br.booking_id and b.property_id = br.property_id
    join public.customers c
      on c.id = b.customer_id and c.property_id = b.property_id
    cross join win w
    where br.property_id = public.current_property_id()
      -- Cancellations and no-shows are off the board entirely; they hold
      -- nothing and drawing them would say a room was taken.
      and br.status not in ('canceled', 'no_show')
      and br.check_in < w.to_date
      and br.check_out > w.from_date
  ),
  ranked as (
    select
      l.*,
      case when l.room_id is null then
        row_number() over (partition by l.room_type_id order by l.check_in, l.reference)
      end as rn,
      count(*) filter (where l.room_id is null)
        over (partition by l.room_type_id) as unassigned_in_type
    from lines l
  )
  select
    r.room_id,
    r.room_type_id,
    r.booking_id,
    r.booking_room_id,
    r.reference,
    r.guest_name,
    r.status,
    r.check_in,
    r.check_out,
    r.guests,
    r.value_cents,
    r.has_notes,
    (r.room_id is not null),
    coalesce(r.unassigned_in_type, 0)::integer
  from ranked r
  where r.room_id is not null
     or r.rn <= greatest(coalesce(p_unassigned_cap, 40), 1)
  order by r.check_in, r.reference;
$function$;

comment on function public.calendar_room_bars(date, integer, integer) is
  'Calendar bars keyed to a room. Unassigned bookings come back with a null room_id and are capped per type, since they share one band.';


/* -------------------------------------------------------------------------- */
/* Taking a room back off a booking                                           */
/* -------------------------------------------------------------------------- */

/*
 * The other half of `assign_room()`. Without it a room put on the wrong
 * booking could only be moved to another room, never cleared -- and "I picked
 * the wrong line" is the commonest reason anybody touches this.
 *
 * Refused once the guest is in it: a checked-in booking with no room is a
 * person the system cannot find, and the way to undo a check-in is to undo the
 * check-in.
 */
create function public.unassign_room(p_booking_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_br public.booking_rooms;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may change a room';
  end if;

  select * into v_br
  from public.booking_rooms
  where id = p_booking_room_id and property_id = public.current_property_id();

  if not found then
    raise exception 'That booked room does not belong to this property';
  end if;

  if v_br.status = 'checked_in' then
    raise exception 'The guest is in that room. Check them out, or move them to another room instead';
  end if;

  update public.booking_rooms
  set room_id = null
  where id = v_br.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_room(p_booking_room_id uuid, p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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

  /*
   * Readiness is only a question for a stay that has already started.
   *
   * This used to demand `vacant_clean` for every assignment, which was right
   * while the only caller was check-in. The calendar now shows rooms as rows
   * and the front desk places future bookings on them -- and a room occupied
   * tonight is a perfectly good room for next March. Demanding it be clean
   * today would refuse almost every forward assignment on a busy hotel.
   *
   * What actually protects the guest is the overlap check below, which is
   * unchanged. This only stops somebody walking a guest into a dirty room now.
   */
  if v_br.check_in <= coalesce(
       (select bd.business_date from public.business_dates bd
         where bd.property_id = v_br.property_id and bd.status = 'open'),
       v_br.check_in
     )
     and v_room.status <> 'vacant_clean'
  then
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
$function$;

/* -------------------------------------------------------------------------- */
/* Grants                                                                     */
/* -------------------------------------------------------------------------- */

revoke all on function public.calendar_rooms() from public, anon;
revoke all on function public.calendar_room_bars(date, integer, integer) from public, anon;
revoke all on function public.unassign_room(uuid) from public, anon;

grant execute on function public.calendar_rooms() to authenticated;
grant execute on function public.calendar_room_bars(date, integer, integer) to authenticated;
grant execute on function public.unassign_room(uuid) to authenticated;
