-- Layer 6: read models for the bookings list and the dashboard's movements.
--
-- Two different money questions are answered here and they are not the same
-- number. `total_cents` is what the reservation is worth: the nightly rates
-- the stay was sold at. `balance_cents` is what the guest actually owes: the
-- outstanding balance on the booking's folios. A future booking has a total
-- but owes nothing, because nothing has been posted to its folio yet.

-- One display name rule for guests and companies, used by every read model.
create function public.customer_display_name(p_customer public.customers)
returns text
language sql
immutable
as $$
  select case
    when p_customer.kind = 'company' then p_customer.company_name
    else nullif(trim(concat_ws(' ', p_customer.first_name, p_customer.last_name)), '')
  end;
$$;

comment on function public.customer_display_name(public.customers) is
  'Display name for a customer row: company name, or given and family name joined.';

-- Fold the same rule into the Layer 5 view. Column list is unchanged, so the
-- functions that read this view are unaffected.
create or replace view public.room_house_states with (security_invoker = true) as
select
  r.property_id,
  bd.business_date,
  r.id as room_id,
  r.number,
  r.floor,
  rt.name as room_type_name,
  r.status as housekeeping_status,
  case
    when r.status = 'ooo' then 'ooo'
    when stay.booking_room_id is not null or r.status = 'occupied' then
      case
        when stay.check_out = bd.business_date then 'due_out'
        else 'occupied'
      end
    when r.status = 'vacant_dirty' then 'vacant_dirty'
    when arrival.booking_room_id is not null then 'arriving'
    else 'vacant_clean'
  end as state,
  stay.guest_name,
  case
    when stay.check_out is not null
      then greatest(stay.check_out - bd.business_date, 0)
  end as nights_left
from public.rooms r
join public.business_dates bd
  on bd.property_id = r.property_id
 and bd.status = 'open'
join public.room_types rt
  on rt.id = r.room_type_id
 and rt.property_id = r.property_id
left join lateral (
  select
    br.id as booking_room_id,
    br.check_in,
    br.check_out,
    public.customer_display_name(c) as guest_name
  from public.booking_rooms br
  join public.bookings b
    on b.id = br.booking_id
   and b.property_id = br.property_id
  join public.customers c
    on c.id = b.customer_id
   and c.property_id = b.property_id
  where br.property_id = r.property_id
    and br.room_id = r.id
    and br.status = 'checked_in'
    and br.check_in <= bd.business_date
    and br.check_out >= bd.business_date
  order by br.check_out
  limit 1
) stay on true
left join lateral (
  select br.id as booking_room_id
  from public.booking_rooms br
  where br.property_id = r.property_id
    and br.room_id = r.id
    and br.status in ('pending', 'confirmed')
    and br.check_in = bd.business_date
  limit 1
) arrival on true;

-- One row per booking, carrying everything the bookings table and the
-- movements list render.
create view public.booking_totals with (security_invoker = true) as
select
  b.property_id,
  b.id as booking_id,
  b.reference,
  b.status,
  b.settlement,
  b.customer_id,
  public.customer_display_name(c) as customer_name,
  ch.name as channel_name,
  b.check_in,
  b.check_out,
  (b.check_out - b.check_in) as nights,
  b.adults,
  b.children,
  b.booked_at,
  -- The calendar date the booking was taken, read in the property's own
  -- timezone. Not a business date, and never the server's local date.
  (b.booked_at at time zone p.timezone)::date as booked_on,
  coalesce(rooms.room_count, 0)::integer as room_count,
  -- A booking may span room types. Naming one of several would be a lie, so
  -- mixed bookings say so.
  case
    when rooms.distinct_type_count > 1 then 'Mixed'
    else rooms.room_type_name
  end as room_type_name,
  -- Only when a single physical room is assigned. With two assigned rooms
  -- there is no one room number to show, and the UI renders a dash.
  case
    when rooms.assigned_count = 1 then rooms.assigned_number
  end as room_number,
  coalesce(nights.total_cents, 0)::bigint as total_cents,
  coalesce(owed.balance_cents, 0)::bigint as balance_cents
from public.bookings b
join public.properties p
  on p.id = b.property_id
join public.customers c
  on c.id = b.customer_id
 and c.property_id = b.property_id
join public.channels ch
  on ch.id = b.channel_id
 and ch.property_id = b.property_id
left join lateral (
  select
    count(*) as room_count,
    count(distinct br.room_type_id) as distinct_type_count,
    min(rt.name) as room_type_name,
    count(br.room_id) as assigned_count,
    min(r.number) as assigned_number
  from public.booking_rooms br
  join public.room_types rt
    on rt.id = br.room_type_id
   and rt.property_id = br.property_id
  left join public.rooms r
    on r.id = br.room_id
   and r.property_id = br.property_id
  where br.booking_id = b.id
    and br.property_id = b.property_id
) rooms on true
-- The reservation's value: every night currently on the booking, at the rate
-- it was sold for.
left join lateral (
  select sum(n.room_rate_cents + n.tax_cents - n.discount_cents) as total_cents
  from public.booking_room_nights n
  join public.booking_rooms br
    on br.id = n.booking_room_id
   and br.property_id = n.property_id
  where br.booking_id = b.id
    and br.property_id = b.property_id
) nights on true
-- What is actually owed, from the ledger. Credit balances on one folio do not
-- cancel out debt on another.
left join lateral (
  select sum(greatest(fb.outstanding_cents, 0)) as balance_cents
  from public.folio_balances fb
  where fb.booking_id = b.id
    and fb.property_id = b.property_id
) owed on true;

comment on view public.booking_totals is
  'One row per booking for list and movement reads. total_cents is the reservation value from booking_room_nights; balance_cents is outstanding folio debt.';

-- The bookings list. Filtering, searching and paging run in Postgres; a
-- property accumulates bookings without limit.
create function public.bookings_page(
  p_q text default null,
  p_status public.booking_status default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  booking_id uuid,
  reference text,
  status public.booking_status,
  settlement public.booking_settlement,
  customer_id uuid,
  customer_name text,
  channel_name text,
  check_in date,
  check_out date,
  nights integer,
  adults integer,
  children integer,
  booked_at timestamptz,
  booked_on date,
  room_count integer,
  room_type_name text,
  room_number text,
  total_cents bigint,
  balance_cents bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select t.*
    from public.booking_totals t
    where t.property_id = public.current_property_id()
      and (p_status is null or t.status = p_status)
      and (
        p_q is null
        or btrim(p_q) = ''
        -- strpos, not ilike: the needle is user input and must never be
        -- read as a LIKE pattern.
        or strpos(lower(t.reference), lower(btrim(p_q))) > 0
        or strpos(lower(coalesce(t.customer_name, '')), lower(btrim(p_q))) > 0
      )
  )
  select
    f.booking_id, f.reference, f.status, f.settlement, f.customer_id,
    f.customer_name, f.channel_name, f.check_in, f.check_out, f.nights,
    f.adults, f.children, f.booked_at, f.booked_on, f.room_count, f.room_type_name,
    f.room_number, f.total_cents, f.balance_cents,
    count(*) over ()::bigint as total_count
  from filtered f
  order by f.check_in desc, f.reference
  limit greatest(coalesce(p_limit, 25), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.bookings_page(text, public.booking_status, integer, integer) is
  'Filtered, paginated bookings list. total_count is the size of the full filtered set.';

-- Guests arriving on a business date. Canceled and no-show reservations are
-- not movements.
create function public.dashboard_arrivals(p_date date)
returns setof public.booking_totals
language sql
stable
security invoker
set search_path = public
as $$
  select t.*
  from public.booking_totals t
  where t.property_id = public.current_property_id()
    and t.check_in = p_date
    and t.status not in ('canceled', 'no_show')
  order by t.customer_name;
$$;

create function public.dashboard_departures(p_date date)
returns setof public.booking_totals
language sql
stable
security invoker
set search_path = public
as $$
  select t.*
  from public.booking_totals t
  where t.property_id = public.current_property_id()
    and t.check_out = p_date
    and t.status not in ('canceled', 'no_show')
  order by t.customer_name;
$$;

grant select on public.booking_totals to authenticated;
grant execute on function public.customer_display_name(public.customers) to authenticated;
grant execute on function public.bookings_page(text, public.booking_status, integer, integer) to authenticated;
grant execute on function public.dashboard_arrivals(date) to authenticated;
grant execute on function public.dashboard_departures(date) to authenticated;
