-- 0133: a guest still in after their departure is due out TODAY, everywhere.
--
-- The client: "Check the checkout for today on the dashboard. It's still
-- showing rooms that have to checkout tomorrow 6th, but it'd check those
-- rooms out today."
--
-- On business date 5 Oct the dashboard's Departures listed eleven bookings:
-- three leaving on the 5th and eight still checked in days after their
-- departure (30 Sep, 2 Oct, 3 Oct) -- listed there since 0111 so somebody
-- checks them out. Nothing on the list departs on the 6th. But the calendar
-- drew those eight bars to the day AFTER the business date, so on the board
-- they ran to 6 Oct, and read as leaving tomorrow while the dashboard offered
-- to check them out today. The calendar change is in the page; this migration
-- puts the two dashboard counts in line with the list:
--
-- 1. room_house_states: a room whose guest is still checked in after their
--    departure is 'due_out' (nights left 0), not 'occupied'. The stay lookup
--    required check_out >= business date, so an overdue stay was not found
--    and the room fell through to its 'occupied' housekeeping status.
-- 2. house_summary(): "n due out" counts those rooms too, so the strip says
--    the same number the Departures tab holds.
--
-- Same columns, same order: create or replace, nothing dropped.

create or replace view public.room_house_states
with (security_invoker = true)
as
select r.property_id,
       bd.business_date,
       r.id as room_id,
       r.number,
       r.floor,
       rt.name as room_type_name,
       r.status as housekeeping_status,
       case
         when r.status = 'ooo'::room_status then 'ooo'::text
         when stay.booking_room_id is not null or r.status = 'occupied'::room_status then
           case
             when stay.check_out <= bd.business_date then 'due_out'::text
             else 'occupied'::text
           end
         when r.status = 'vacant_dirty'::room_status then 'vacant_dirty'::text
         when arrival.booking_room_id is not null then 'arriving'::text
         else 'vacant_clean'::text
       end as state,
       stay.guest_name,
       case
         when stay.check_out is not null then greatest(stay.check_out - bd.business_date, 0)
         else null::integer
       end as nights_left
from public.rooms r
join public.business_dates bd
  on bd.property_id = r.property_id and bd.status = 'open'::business_date_status
join public.room_types rt
  on rt.id = r.room_type_id and rt.property_id = r.property_id
left join lateral (
  -- Checked in, arrived by the business date. No lower bound on the
  -- departure: a guest still in after it is the one most needing attention.
  select br.id as booking_room_id,
         br.check_in,
         br.check_out,
         public.customer_display_name(c.*) as guest_name
  from public.booking_rooms br
  join public.bookings b on b.id = br.booking_id and b.property_id = br.property_id
  join public.customers c on c.id = b.customer_id and c.property_id = b.property_id
  where br.property_id = r.property_id
    and br.room_id = r.id
    and br.status = 'checked_in'::booking_status
    and br.check_in <= bd.business_date
  order by br.check_out
  limit 1
) stay on true
left join lateral (
  select br.id as booking_room_id
  from public.booking_rooms br
  where br.property_id = r.property_id
    and br.room_id = r.id
    and br.status = any (array['pending'::booking_status, 'confirmed'::booking_status])
    and br.check_in = bd.business_date
  limit 1
) arrival on true;

create or replace function public.house_summary()
returns table(
  business_date date,
  total_rooms bigint,
  sellable_rooms bigint,
  occupied_rooms bigint,
  due_out_rooms bigint,
  arriving_rooms bigint,
  vacant_clean_rooms bigint,
  vacant_dirty_rooms bigint,
  ooo_rooms bigint,
  expected_arrivals bigint,
  expected_departures bigint,
  occupancy_pct numeric,
  adr_cents bigint,
  drawer_cents bigint,
  outstanding_cents bigint
)
language sql
stable
set search_path to 'public', 'auth'
as $function$
  with today as (
    select bd.business_date
    from public.business_dates bd
    where bd.property_id = public.current_property_id()
      and bd.status = 'open'
  ),
  counts as (
    select
      count(*) as total_rooms,
      count(*) filter (where s.state <> 'ooo') as sellable_rooms,
      count(*) filter (where s.state = 'occupied') as occupied_rooms,
      count(*) filter (where s.state = 'due_out') as due_out_rooms,
      count(*) filter (where s.state = 'arriving') as arriving_rooms,
      count(*) filter (where s.state = 'vacant_clean') as vacant_clean_rooms,
      count(*) filter (where s.state = 'vacant_dirty') as vacant_dirty_rooms,
      count(*) filter (where s.state = 'ooo') as ooo_rooms
    from public.room_house_states s
    where s.property_id = public.current_property_id()
  ),
  movements as (
    select
      count(*) filter (
        where br.check_in = (select business_date from today)
          and br.status in ('pending', 'confirmed')
      ) as expected_arrivals,
      -- Leaving today, or still in after their departure (0133): the same
      -- rooms the Departures tab lists.
      count(*) filter (
        where br.check_out <= (select business_date from today)
          and br.status = 'checked_in'
      ) as expected_departures
    from public.booking_rooms br
    where br.property_id = public.current_property_id()
      and (
        br.check_in = (select business_date from today)
        or br.check_out <= (select business_date from today)
      )
  ),
  adr as (
    select coalesce(round(avg(n.room_rate_cents)), 0)::bigint as adr_cents
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.stay_date = (select business_date from today)
      and n.status = 'checked_in'
  ),
  -- Only the viewer's own open shift, and only when they are allowed to see
  -- it at all. Null means "not yours to see", which the tile renders as a
  -- dash; zero means an empty drawer.
  drawer as (
    select case
      when public.can_see_drawer_total() then coalesce((
        select sum(css.expected_cash_cents)
        from public.cashier_shift_summaries css
        where css.property_id = public.current_property_id()
          and css.cashier_id = auth.uid()
          and css.status in ('open', 'closing')
      ), 0)::bigint
    end as drawer_cents
  ),
  owed as (
    select coalesce(
      (
        select po.outstanding_cents
        from public.property_outstanding po
        where po.property_id = public.current_property_id()
      ),
      0
    )::bigint as outstanding_cents
  )
  select
    (select business_date from today),
    c.total_rooms,
    c.sellable_rooms,
    c.occupied_rooms,
    c.due_out_rooms,
    c.arriving_rooms,
    c.vacant_clean_rooms,
    c.vacant_dirty_rooms,
    c.ooo_rooms,
    m.expected_arrivals,
    m.expected_departures,
    coalesce(
      round(
        (c.occupied_rooms + c.due_out_rooms)::numeric * 100
          / nullif(c.sellable_rooms, 0),
        1
      ),
      0
    ),
    a.adr_cents,
    d.drawer_cents,
    o.outstanding_cents
  from counts c
  cross join movements m
  cross join adr a
  cross join drawer d
  cross join owed o;
$function$;
