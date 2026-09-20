-- 0062: the other two housekeeping states, and upgrading a guest's room type.
--
-- Two things the client asked for, which turn out to share one question.
--
-- THE CLIENT ON HOUSEKEEPING: "The housekeeping, does not affect availability.
-- It's there for the hotel reception and housekeeping staff to use ... If the
-- 101 is showing as dirty, the receptionist knows that the room is not ready
-- and will offer a room that's is shown ready in the system."
--
-- THE CLIENT ON UPGRADES: "when a room is in the holding area, whe can only
-- move it to the same room type. But hotels do offer upgrades ... someone
-- booked a Double Room but when he arrive at the property they changed their
-- mind and decide to upgrade to the Suite. The way the system is build now,
-- the hotel cannot upgrade the guest room in the system."
--
-- Both are right, and the second one is why the first one's rule matters.

/* ========================================================================== */
/* PART 1 -- Inspected and Do not disturb                                    */
/* ========================================================================== */

/*
 * TWO BOOLEANS, NOT TWO ENUM VALUES. This is the thing I flagged and would not
 * guess at, and the client's note settles it: housekeeping is information for
 * the front desk, not a sellability rule.
 *
 * `room_status` is the column that decides whether a room can be sold --
 * `sellable` is literally `total_rooms - count(status = 'ooo')`. So putting
 * either of these in that enum would make them availability rules by
 * accident, which is precisely what the client says they are not:
 *
 *   INSPECTED is a second fact about a room that is already CLEAN -- somebody
 *   has checked it. As an enum value every `= 'vacant_clean'` test in the
 *   database would stop matching an inspected room, including the readiness
 *   check in `assign_room()`, so a supervisor signing a room off would make it
 *   unassignable. As a boolean beside the status it adds the fact and breaks
 *   nothing.
 *
 *   DO NOT DISTURB belongs to an OCCUPIED room -- it is the guest's request,
 *   not a state of the room's cleanliness. An occupied room is already sold,
 *   so this cannot affect availability either way, and as an enum value it
 *   would have overwritten `occupied` and lost the one fact that matters.
 *
 * BROKEN IS THE EXCEPTION AND STAYS AS IT IS. "Broken" maps to `ooo`, which
 * DOES reduce what the hotel can sell -- and should: a broken room cannot take
 * a guest. That is the one place the client's "housekeeping does not affect
 * availability" is not true of this build, and it is not true on purpose.
 */

alter table public.rooms
  add column if not exists is_inspected boolean not null default false;

alter table public.rooms
  add column if not exists do_not_disturb boolean not null default false;

comment on column public.rooms.is_inspected is
  'A supervisor has checked this clean room. A fact ABOUT a vacant_clean room, never a status of its own -- as an enum value it would stop every = ''vacant_clean'' test matching. Cleared whenever the room leaves vacant_clean.';

comment on column public.rooms.do_not_disturb is
  'The guest in this room has asked not to be disturbed. Meaningful only while the room is occupied, and cleared when it is not. Affects nothing about availability: an occupied room is already sold.';

/*
 * The five choices the reference offers, as one call.
 *
 * One function rather than a setter per flag, because they are one decision
 * at a front desk -- somebody picks a state off a menu -- and the mapping from
 * that choice to a status plus its flags belongs in one place where it cannot
 * drift from the menu that draws it.
 *
 * `do_not_disturb` is NOT one of these: it is a toggle on an occupied room
 * rather than a point on the clean-to-broken scale, so it has its own function
 * below. Putting it here would mean "set the room to do not disturb" had to
 * answer "and is it clean?", which has no sensible answer.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'housekeeping_choice') then
    create type public.housekeeping_choice as enum
      ('inspected', 'clean', 'dirty', 'broken');
  end if;
end $$;

create or replace function public.set_room_housekeeping(
  p_room_id uuid,
  p_choice public.housekeeping_choice
)
returns void
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_room public.rooms;
  v_status public.room_status;
begin
  select * into v_room from public.rooms
  where id = p_room_id and property_id = public.current_property_id();

  if not found then
    raise exception 'That room is not on this property';
  end if;

  /*
   * OCCUPIED IS NOT REACHABLE FROM HERE, in either direction, which is the
   * rule `set_room_status()` has carried since 0030: a room is occupied
   * because a guest is in it, and check-in and check-out are what move it.
   * Marking an occupied room clean would tell the board the guest had gone.
   */
  if v_room.status = 'occupied' then
    raise exception
      'Room % has a guest in it. Check them out before changing its housekeeping state',
      v_room.number;
  end if;

  v_status := case p_choice
    when 'inspected' then 'vacant_clean'::public.room_status
    when 'clean' then 'vacant_clean'::public.room_status
    when 'dirty' then 'vacant_dirty'::public.room_status
    when 'broken' then 'ooo'::public.room_status
  end;

  /*
   * `is_inspected` only survives while the room is clean. Dirtying it or
   * taking it out of order throws the inspection away, because it is no longer
   * true -- and leaving a stale true behind is how a board ends up telling a
   * receptionist a dirty room has been signed off.
   */
  update public.rooms
  set status = v_status,
      is_inspected = (p_choice = 'inspected'),
      do_not_disturb = false
  where id = p_room_id and property_id = public.current_property_id();
end;
$function$;

comment on function public.set_room_housekeeping(uuid, public.housekeeping_choice) is
  'The five-state housekeeping menu from the calendar rail, as one call. Inspected and Clean are both vacant_clean and differ by the is_inspected flag; Broken is ooo and is the only choice that changes what the hotel can sell. Occupied is not reachable from here.';

create or replace function public.set_room_do_not_disturb(
  p_room_id uuid,
  p_on boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_room public.rooms;
begin
  select * into v_room from public.rooms
  where id = p_room_id and property_id = public.current_property_id();

  if not found then
    raise exception 'That room is not on this property';
  end if;

  /*
   * Only an occupied room can carry it, because it is the GUEST's request.
   * A vacant room with a do-not-disturb flag is a housekeeper walking past a
   * room that nobody is in.
   */
  if coalesce(p_on, false) and v_room.status <> 'occupied' then
    raise exception
      'Room % has no guest in it, so there is nobody to disturb',
      v_room.number;
  end if;

  update public.rooms
  set do_not_disturb = coalesce(p_on, false)
  where id = p_room_id and property_id = public.current_property_id();
end;
$function$;

/* The rail draws a dot per room, so it needs the two flags with it. */
drop function if exists public.calendar_rooms();

create function public.calendar_rooms()
returns table (
  room_id uuid,
  room_number text,
  floor text,
  room_type_id uuid,
  room_type_name text,
  room_status public.room_status,
  is_inspected boolean,
  do_not_disturb boolean,
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
    r.is_inspected,
    r.do_not_disturb,
    rt.sort_order
  from public.rooms r
  join public.room_types rt
    on rt.id = r.room_type_id and rt.property_id = r.property_id
  where r.property_id = public.current_property_id()
  order by rt.sort_order, rt.name,
           nullif(regexp_replace(r.number, '\D', '', 'g'), '')::bigint
             nulls last,
           r.number;
$function$;

/* ========================================================================== */
/* PART 2 -- Upgrading a guest into another room type                        */
/* ========================================================================== */

/*
 * `assign_room()` refused any room whose type differed from the one the
 * booking was sold, which made an upgrade impossible -- exactly as the client
 * describes. The refusal was not wrong, it was just absolute: putting a guest
 * in the wrong type BY ACCIDENT is a real mistake, and putting them in a
 * better one ON PURPOSE is a normal thing a hotel does at the desk.
 *
 * So it becomes a deliberate act rather than an impossible one:
 * `p_allow_type_change` defaults false, and the refusal still fires without
 * it. The front desk has to mean it.
 *
 * WHAT DOES NOT CHANGE IS THE PRICE. `booking_rooms.room_type_id` still says
 * what the guest was SOLD, and `booking_room_nights` still carries the rates
 * already generated against it. That is what an upgrade is: the same money,
 * a better room. Rewriting the sold type would restate what the hotel agreed
 * to charge, and re-pricing the nights would hand the guest a bill they never
 * accepted -- neither is a thing a Move button should do on its own.
 */
/*
 * THE OLD TWO-ARGUMENT SIGNATURE IS DROPPED FIRST, and that is not tidying.
 *
 * Adding a defaulted third parameter does not replace the old function, it
 * creates a SECOND one -- and then `assign_room(uuid, uuid)` matches both, so
 * Postgres refuses the call outright with "function is not unique". Every
 * existing caller breaks, which is precisely the overload trap CLAUDE.md
 * warns about for `set_room_photo()` and `set_rate_plan_cancellation_policy()`.
 * I walked into it and the rig caught it.
 *
 * Dropping the two-argument form leaves one function whose default covers
 * every call that used to reach the old one.
 */
drop function if exists public.assign_room(uuid, uuid);

create or replace function public.assign_room(
  p_booking_room_id uuid,
  p_room_id uuid,
  p_allow_type_change boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_br public.booking_rooms;
  v_room public.rooms;
  v_sold_type text;
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

  if v_room.room_type_id <> v_br.room_type_id
     and not coalesce(p_allow_type_change, false)
  then
    select rt.name into v_sold_type from public.room_types rt
    where rt.id = v_br.room_type_id and rt.property_id = v_br.property_id;

    raise exception
      'Room % is not a %, which is what this booking was sold. Confirm the upgrade to put the guest in it.',
      v_room.number, coalesce(v_sold_type, 'that type')
      using errcode = 'HP003';
  end if;

  /*
   * Readiness is only a question for a stay that has already started, which is
   * 0053's rule and is unchanged. A room occupied tonight is a perfectly good
   * room for next March.
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

  if exists (
    select 1
    from public.booking_rooms taken
    where taken.room_id = p_room_id
      and taken.property_id = v_br.property_id
      and taken.id <> p_booking_room_id
      and taken.status not in ('canceled', 'no_show', 'checked_out')
      and daterange(taken.check_in, taken.check_out, '[)')
          && daterange(v_br.check_in, v_br.check_out, '[)')
  ) then
    raise exception
      'Room % is already taken for part of % to %',
      v_room.number, v_br.check_in, v_br.check_out;
  end if;

  update public.booking_rooms
  set room_id = p_room_id
  where id = p_booking_room_id and property_id = v_br.property_id;
end;
$function$;

comment on function public.assign_room(uuid, uuid, boolean) is
  'Puts a booked room in a physical room. A room of another type is refused with HP003 unless p_allow_type_change says the upgrade is deliberate; the sold type and the nightly rates are never rewritten, so an upgrade is the same money in a better room.';

/* ========================================================================== */
/* PART 3 -- Availability counts the room a guest is ACTUALLY in             */
/* ========================================================================== */

/*
 * THIS IS THE PART THAT MAKES PART 2 SAFE, and without it the upgrade would
 * quietly oversell the hotel.
 *
 * Every availability read counted a booked night against
 * `booking_rooms.room_type_id` -- the type it was SOLD as. That was exactly
 * right while `assign_room()` refused any other type, because then the sold
 * type and the physical room's type were always the same thing.
 *
 * The moment an upgrade is possible they come apart. A Double booking sitting
 * in a Suite would still have counted against Double: the board would show the
 * Suite as free while a guest was asleep in it, and the hotel could sell it
 * twice. The exclusion constraint would catch the second ASSIGNMENT, but only
 * after somebody had taken the booking and promised the room.
 *
 * So the count follows the physical room wherever there is one, and falls back
 * to the sold type for a booking nobody has placed yet:
 *
 *     coalesce(the assigned room's type, the type it was sold as)
 *
 * That is the true statement in both cases, and it is the same statement the
 * old code made whenever the two agreed -- so nothing changes for a hotel that
 * never upgrades anybody.
 *
 * Four functions carried the identical `sold` CTE and all four are corrected.
 * `inventory_grid` is included because its "sold" column is what an Inventory
 * screen shows a revenue manager, and one screen disagreeing with the board
 * about how many rooms are gone is worse than either number being wrong alone.
 */

create or replace function public.calendar_availability(
  p_from date,
  p_days integer default 14
)
/*
 * The return type matches the existing one EXACTLY -- bigint throughout, and
 * `sold` before `available`. `create or replace` refuses any other shape,
 * which is how this was caught: the first draft had integers in a different
 * order and Postgres would not have it. Replacing rather than dropping keeps
 * the grants and anything that depends on it.
 */
returns table (
  stay_date date,
  room_type_id uuid,
  room_type_code text,
  room_type_name text,
  total_rooms bigint,
  out_of_order bigint,
  sellable bigint,
  sold bigint,
  available bigint
)
language sql
stable
security invoker
set search_path = public
as $function$
  with span as (
    select d::date as stay_date
    from generate_series(
      p_from,
      p_from + greatest(coalesce(p_days, 14), 1) - 1,
      interval '1 day'
    ) as d
  ),
  types as (
    select
      rt.id,
      rt.code,
      rt.name,
      rt.sort_order,
      count(r.id) as total_rooms,
      count(r.id) filter (where r.status = 'ooo') as out_of_order
    from public.room_types rt
    left join public.rooms r
      on r.room_type_id = rt.id and r.property_id = rt.property_id
    where rt.property_id = public.current_property_id()
    group by rt.id, rt.code, rt.name, rt.sort_order
  ),
  sold as (
    select
      n.stay_date,
      coalesce(r.room_type_id, br.room_type_id) as room_type_id,
      count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    left join public.rooms r
      on r.id = br.room_id and r.property_id = br.property_id
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_from + greatest(coalesce(p_days, 14), 0)
    group by n.stay_date, coalesce(r.room_type_id, br.room_type_id)
  )
  select
    span.stay_date,
    types.id,
    types.code,
    types.name,
    types.total_rooms::bigint,
    types.out_of_order::bigint,
    (types.total_rooms - types.out_of_order)::bigint,
    coalesce(sold.sold, 0)::bigint,
    (types.total_rooms - types.out_of_order - coalesce(sold.sold, 0))::bigint
  from span
  cross join types
  left join sold
    on sold.stay_date = span.stay_date and sold.room_type_id = types.id
  order by span.stay_date, types.sort_order, types.name;
$function$;

revoke all on function public.calendar_availability(date, integer) from public, anon;
grant execute on function public.calendar_availability(date, integer) to authenticated;

/* -------------------------------------------------------------------------- */
/* The same correction in the other three availability reads.                 */
/*                                                                            */
/* Taken from the live definitions and patched at the `sold` CTE only, so      */
/* nothing else about them moves. `create or replace` keeps their grants,      */
/* which matters for public_room_types: it is `security definer` and the guest */
/* booking page calls it as `anon`.                                           */
/* -------------------------------------------------------------------------- */

/* -- bookable_room_types: count against the room the guest is actually in -- */
CREATE OR REPLACE FUNCTION public.bookable_room_types(p_from date, p_to date)
 RETURNS TABLE(room_type_id uuid, code text, name text, base_occupancy integer, max_occupancy integer, total_rooms bigint, available bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with nights as (
    select d::date as stay_date
    from generate_series(p_from, greatest(p_to - 1, p_from), interval '1 day') as d
  ),
  types as (
    select
      rt.id, rt.code, rt.name, rt.base_occupancy, rt.max_occupancy, rt.sort_order,
      count(r.id) as total_rooms,
      count(r.id) filter (where r.status <> 'ooo') as sellable
    from public.room_types rt
    left join public.rooms r
      on r.room_type_id = rt.id and r.property_id = rt.property_id
    where rt.property_id = public.current_property_id()
    group by rt.id, rt.code, rt.name, rt.sort_order
  ),
  sold as (
    select
      n.stay_date,
      coalesce(r.room_type_id, br.room_type_id) as room_type_id,
      count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    left join public.rooms r
      on r.id = br.room_id and r.property_id = br.property_id
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_to
    group by n.stay_date, coalesce(r.room_type_id, br.room_type_id)
  )
  select
    types.id,
    types.code,
    types.name,
    types.base_occupancy,
    types.max_occupancy,
    types.total_rooms,
    coalesce(
      min(
        -- A close-out means none of this type is sold that night, whatever the
        -- physical count says. An allotment caps it below that count.
        case
          when coalesce(rtd.close_out, false) then 0
          else least(
            types.sellable,
            coalesce(rtd.allotment, types.sellable)
          ) - coalesce(sold.sold, 0)
        end
      ),
      types.sellable
    )::bigint as available
  from types
  cross join nights
  left join public.room_type_days rtd
    on rtd.room_type_id = types.id
   and rtd.stay_date = nights.stay_date
   and rtd.property_id = public.current_property_id()
  left join sold
    on sold.stay_date = nights.stay_date and sold.room_type_id = types.id
  group by types.id, types.code, types.name, types.base_occupancy,
           types.max_occupancy, types.sort_order, types.total_rooms, types.sellable
  order by types.sort_order, types.name;
$function$;

/* -- public_room_types: count against the room the guest is actually in -- */
CREATE OR REPLACE FUNCTION public.public_room_types(p_property_id uuid, p_rate_plan_id uuid, p_from date, p_to date)
 RETURNS TABLE(room_type_id uuid, code text, name text, base_occupancy integer, max_occupancy integer, available bigint, nights integer, total_cents bigint, unavailable_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with plan as (
    select rp.id
    from public.rate_plans rp
    join public.properties p on p.id = rp.property_id and p.is_active
    where rp.id = p_rate_plan_id
      and rp.property_id = p_property_id
      and rp.is_active
      and rp.is_public
  ),
  nights as (
    select d::date as stay_date
    from generate_series(p_from, greatest(p_to - 1, p_from), interval '1 day') as d
  ),
  types as (
    select
      rt.id, rt.code, rt.name, rt.base_occupancy, rt.max_occupancy, rt.sort_order,
      count(r.id) filter (where r.status <> 'ooo') as sellable
    from public.room_types rt
    left join public.rooms r
      on r.room_type_id = rt.id and r.property_id = rt.property_id
    where rt.property_id = p_property_id
    group by rt.id, rt.code, rt.name, rt.sort_order
  ),
  sold as (
    select
      n.stay_date,
      coalesce(r.room_type_id, br.room_type_id) as room_type_id,
      count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    left join public.rooms r
      on r.id = br.room_id and r.property_id = br.property_id
    where n.property_id = p_property_id
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_to
    group by n.stay_date, coalesce(r.room_type_id, br.room_type_id)
  ),
  priced as (
    select
      types.id,
      types.code,
      types.name,
      types.base_occupancy,
      types.max_occupancy,
      types.sort_order,
      coalesce(
        min(
          case
            when coalesce(rtd.close_out, false) then 0
            else least(types.sellable, coalesce(rtd.allotment, types.sellable))
                 - coalesce(sold.sold, 0)
          end
        ),
        types.sellable
      )::bigint as available,
      (p_to - p_from)::integer as nights,
      -- Null if any night is unpriced: bool_or over the nights, then a case.
      case
        when bool_or(rpd.rate_cents is null) then null
        else sum(rpd.rate_cents)::bigint
      end as total_cents
    from types
    cross join nights
    left join public.room_type_days rtd
      on rtd.room_type_id = types.id
     and rtd.stay_date = nights.stay_date
     and rtd.property_id = p_property_id
    left join public.rate_plan_days rpd
      on rpd.room_type_id = types.id
     and rpd.stay_date = nights.stay_date
     and rpd.property_id = p_property_id
     and rpd.rate_plan_id = (select id from plan)
    left join sold
      on sold.stay_date = nights.stay_date and sold.room_type_id = types.id
    group by types.id, types.code, types.name, types.base_occupancy,
             types.max_occupancy, types.sort_order, types.sellable
  )
  select
    priced.id,
    priced.code,
    priced.name,
    priced.base_occupancy,
    priced.max_occupancy,
    greatest(priced.available, 0)::bigint,
    priced.nights,
    priced.total_cents,
    public.stay_rule_violation_for(
      p_property_id, (select id from plan), priced.id, p_from, p_to
    )
  from priced
  where exists (select 1 from plan)
  order by priced.sort_order, priced.name;
$function$;

/* -- inventory_grid: count against the room the guest is actually in -- */
CREATE OR REPLACE FUNCTION public.inventory_grid(p_rate_plan_id uuid, p_from date, p_days integer DEFAULT 28)
 RETURNS TABLE(stay_date date, room_type_id uuid, room_type_code text, room_type_name text, rate_cents bigint, min_stay_through integer, min_stay_arrival integer, max_stay integer, closed_to_arrival boolean, closed_to_departure boolean, stop_sell boolean, allotment integer, close_out boolean, physical_rooms bigint, out_of_order bigint, sold bigint, sellable bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with span as (
    select d::date as stay_date
    from generate_series(
      p_from,
      p_from + greatest(coalesce(p_days, 28), 1) - 1,
      interval '1 day'
    ) as d
  ),
  types as (
    select
      rt.id, rt.code, rt.name, rt.sort_order,
      count(r.id) as physical_rooms,
      count(r.id) filter (where r.status = 'ooo') as out_of_order
    from public.room_types rt
    left join public.rooms r
      on r.room_type_id = rt.id and r.property_id = rt.property_id
    where rt.property_id = public.current_property_id()
    group by rt.id, rt.code, rt.name, rt.sort_order
  ),
  sold as (
    select
      n.stay_date,
      coalesce(r.room_type_id, br.room_type_id) as room_type_id,
      count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    left join public.rooms r
      on r.id = br.room_id and r.property_id = br.property_id
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_from + greatest(coalesce(p_days, 28), 1)
    group by n.stay_date, coalesce(r.room_type_id, br.room_type_id)
  )
  select
    span.stay_date,
    types.id,
    types.code,
    types.name,
    d.rate_cents,
    d.min_stay_through,
    d.min_stay_arrival,
    d.max_stay,
    coalesce(d.closed_to_arrival, false),
    coalesce(d.closed_to_departure, false),
    coalesce(d.stop_sell, false),
    rtd.allotment,
    coalesce(rtd.close_out, false),
    types.physical_rooms,
    types.out_of_order,
    coalesce(sold.sold, 0)::bigint,
    -- What may actually be sold that night: the physical rooms, less those out
    -- of order, capped by any allotment, and nothing at all when closed out.
    case
      when coalesce(rtd.close_out, false) then 0
      else least(
        types.physical_rooms - types.out_of_order,
        coalesce(rtd.allotment, types.physical_rooms - types.out_of_order)
      )
    end::bigint
  from span
  cross join types
  left join public.rate_plan_days d
    on d.rate_plan_id = p_rate_plan_id
   and d.room_type_id = types.id
   and d.stay_date = span.stay_date
   and d.property_id = public.current_property_id()
  left join public.room_type_days rtd
    on rtd.room_type_id = types.id
   and rtd.stay_date = span.stay_date
   and rtd.property_id = public.current_property_id()
  left join sold
    on sold.stay_date = span.stay_date and sold.room_type_id = types.id
  order by types.sort_order, types.name, span.stay_date;
$function$;

/* -------------------------------------------------------------------------- */
/* Grants                                                                     */
/* -------------------------------------------------------------------------- */

revoke all on function public.set_room_housekeeping(uuid, public.housekeeping_choice) from public, anon;
revoke all on function public.set_room_do_not_disturb(uuid, boolean) from public, anon;
revoke all on function public.calendar_rooms() from public, anon;
revoke all on function public.assign_room(uuid, uuid, boolean) from public, anon;
revoke all on function public.bookable_room_types(date, date) from public, anon;
revoke all on function public.inventory_grid(uuid, date, integer) from public, anon;

grant execute on function public.set_room_housekeeping(uuid, public.housekeeping_choice) to authenticated;
grant execute on function public.set_room_do_not_disturb(uuid, boolean) to authenticated;
grant execute on function public.calendar_rooms() to authenticated;
grant execute on function public.assign_room(uuid, uuid, boolean) to authenticated;
grant execute on function public.bookable_room_types(date, date) to authenticated;
grant execute on function public.inventory_grid(uuid, date, integer) to authenticated;

/* The guest surface keeps anon, as it had before. */
revoke all on function public.public_room_types(uuid, uuid, date, date) from public;
grant execute on function public.public_room_types(uuid, uuid, date, date) to anon, authenticated;
