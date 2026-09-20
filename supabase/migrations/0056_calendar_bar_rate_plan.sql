-- 0056: a calendar bar says which rate the room was sold on.
--
-- The board already carries the guest, the party size, the value and the
-- booking's status. What it could not say is what the room was SOLD as, which
-- is the question a receptionist asks before quoting anything to the guest in
-- front of them -- "is this the Room Only rate or the B&B one".
--
-- NOTHING IS ADDED TO THE SCHEMA. `booking_rooms.rate_plan_id` has been there
-- since 0037 and is populated on every row this property holds; the board's
-- read simply never returned it. This joins the plan and returns its name.
--
-- IT IS NULLABLE AND THAT IS REAL. A stay booked before 0037 has no
-- `rate_plan_id` at all, so its bar has no rate to show. The board draws
-- nothing there rather than guessing a plan -- the same rule the Rate plan
-- report follows when it counts those nights under "Not recorded".

/* Dropped and recreated rather than replaced: the return type gains a column,
   and `create or replace function` cannot change one. */
drop function if exists public.calendar_room_bars(date, integer, integer);

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
  unassigned_total integer,
  /* What the room was sold as. Null for a stay taken before 0037, which
     recorded no plan at all. */
  rate_plan_name text
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
      ) as has_notes,
      -- left join: a pre-0037 line has no plan, and that is not a reason to
      -- drop the bar off the board.
      rp.name as rate_plan_name
    from public.booking_rooms br
    join public.bookings b
      on b.id = br.booking_id and b.property_id = br.property_id
    join public.customers c
      on c.id = b.customer_id and c.property_id = b.property_id
    left join public.rate_plans rp
      on rp.id = br.rate_plan_id and rp.property_id = br.property_id
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
    coalesce(r.unassigned_in_type, 0)::integer,
    r.rate_plan_name
  from ranked r
  where r.room_id is not null
     or r.rn <= greatest(coalesce(p_unassigned_cap, 40), 1)
  order by r.check_in, r.reference;
$function$;

comment on function public.calendar_room_bars(date, integer, integer) is
  'Calendar bars keyed to a room, with the rate plan each was sold on. Unassigned bookings come back with a null room_id and are capped per type, since they share one band.';

revoke all on function public.calendar_room_bars(date, integer, integer) from public, anon;
grant execute on function public.calendar_room_bars(date, integer, integer) to authenticated;
