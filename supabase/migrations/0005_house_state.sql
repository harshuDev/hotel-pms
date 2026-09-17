-- Layer 5: the derived operational state of the house.
--
-- `rooms.status` carries only the four housekeeping/front-office states the
-- schema knows about. `due_out` and `arriving` are reservation facts layered
-- on top of them, so they are derived here rather than stored.
--
-- Everything in this file aggregates in Postgres. The dashboard reads counts,
-- never a room list, so the collapsed house board costs one row regardless of
-- whether the property has 40 rooms or 1,800.

-- One row per physical room, resolved against the property's open business
-- date. security_invoker keeps RLS in charge of property isolation.
create view public.room_house_states with (security_invoker = true) as
select
  r.property_id,
  bd.business_date,
  r.id as room_id,
  r.number,
  r.floor,
  rt.name as room_type_name,
  r.status as housekeeping_status,
  -- Precedence: out of order, then occupancy, then housekeeping, then an
  -- expected arrival. A dirty room with an arrival today stays "needs
  -- service": housekeeping must never lose a room that needs cleaning.
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
-- The stay physically in the room on the business date. A guest leaving today
-- is still in the room until check-out, hence check_out >= business_date.
left join lateral (
  select
    br.id as booking_room_id,
    br.check_in,
    br.check_out,
    case
      when c.kind = 'company' then c.company_name
      else nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '')
    end as guest_name
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
-- A room held for a guest arriving today. Checked-in arrivals are already
-- covered by `stay` above.
left join lateral (
  select br.id as booking_room_id
  from public.booking_rooms br
  where br.property_id = r.property_id
    and br.room_id = r.id
    and br.status in ('pending', 'confirmed')
    and br.check_in = bd.business_date
  limit 1
) arrival on true;

comment on view public.room_house_states is
  'Per-room operational state for the property''s open business date: ooo, occupied, due_out, vacant_dirty, arriving, vacant_clean.';

-- The dashboard house summary. One row, aggregated in Postgres.
create function public.house_summary()
returns table (
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
security invoker
set search_path = public, auth
as $$
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
  -- Reservation movements, not room states: most arrivals have no room
  -- assigned yet, so these are counted from booking_rooms.
  movements as (
    select
      count(*) filter (
        where br.check_in = (select business_date from today)
          and br.status in ('pending', 'confirmed')
      ) as expected_arrivals,
      count(*) filter (
        where br.check_out = (select business_date from today)
          and br.status = 'checked_in'
      ) as expected_departures
    from public.booking_rooms br
    where br.property_id = public.current_property_id()
      and (
        br.check_in = (select business_date from today)
        or br.check_out = (select business_date from today)
      )
  ),
  -- ADR is the mean rate of the rooms in house tonight. Rate only: tax and
  -- discount are separate columns and are not part of the average.
  adr as (
    select coalesce(round(avg(n.room_rate_cents)), 0)::bigint as adr_cents
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.stay_date = (select business_date from today)
      and n.status = 'checked_in'
  ),
  -- Only the viewer's own open shift. Cash is the only thing in the drawer;
  -- cashier_shift_expected already enforces that via affects_drawer.
  drawer as (
    select coalesce(sum(css.expected_cash_cents), 0)::bigint as drawer_cents
    from public.cashier_shift_summaries css
    where css.property_id = public.current_property_id()
      and css.cashier_id = auth.uid()
      and css.status in ('open', 'closing')
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
$$;

comment on function public.house_summary() is
  'Single-row dashboard summary for the open business date. Occupancy is physical: (occupied + due out) / sellable.';

-- The on-demand room list behind the house board's "View rooms" toggle.
-- Filtering, searching, sorting and paging all happen here so the browser
-- never receives more than one page of a 1,800-room property.
create function public.rooms_page(
  p_q text default null,
  p_state text default null,
  p_limit integer default 240,
  p_offset integer default 0
)
returns table (
  room_id uuid,
  number text,
  floor integer,
  room_type_name text,
  state text,
  guest_name text,
  nights_left integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select s.*
    from public.room_house_states s
    where s.property_id = public.current_property_id()
      and (p_state is null or s.state = p_state)
      and (
        p_q is null
        or btrim(p_q) = ''
        -- strpos rather than ilike: the needle is user input and must not be
        -- read as a LIKE pattern.
        or strpos(lower(s.number), lower(btrim(p_q))) > 0
        or strpos(lower(coalesce(s.guest_name, '')), lower(btrim(p_q))) > 0
        or strpos(lower(s.room_type_name), lower(btrim(p_q))) > 0
      )
  )
  select
    f.room_id,
    f.number,
    f.floor,
    f.room_type_name,
    f.state,
    f.guest_name,
    f.nights_left::integer,
    count(*) over ()::bigint as total_count
  from filtered f
  order by
    nullif(regexp_replace(f.number, '\D', '', 'g'), '')::bigint nulls last,
    f.number
  limit greatest(coalesce(p_limit, 240), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.rooms_page(text, text, integer, integer) is
  'Filtered, sorted, paginated room list for the open business date. total_count is the size of the full filtered set.';

grant select on public.room_house_states to authenticated;
grant execute on function public.house_summary() to authenticated;
grant execute on function public.rooms_page(text, text, integer, integer) to authenticated;
