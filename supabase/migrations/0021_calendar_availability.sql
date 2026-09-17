-- Layer 12: the availability calendar.
--
-- Rows are room types, not rooms. A property may run ~1,800 rooms and
-- CLAUDE.md is explicit that no query may return every room and no UI may
-- render one element per room, so a per-room tape chart is the wrong shape for
-- the default view. A reservations agent is asking "can I sell a Deluxe on the
-- fourteenth", and that is a handful of rows however large the hotel is.
--
-- available is deliberately allowed to go negative. An overbooked night is
-- exactly the thing a calendar exists to show, and clamping it at zero would
-- hide the one number worth seeing.

create function public.calendar_availability(
  p_from date,
  p_days integer default 14
)
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
as $$
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
      br.room_type_id,
      count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_from + greatest(coalesce(p_days, 14), 0)
    group by n.stay_date, br.room_type_id
  )
  select
    span.stay_date,
    types.id,
    types.code,
    types.name,
    types.total_rooms,
    types.out_of_order,
    (types.total_rooms - types.out_of_order) as sellable,
    coalesce(sold.sold, 0) as sold,
    (types.total_rooms - types.out_of_order - coalesce(sold.sold, 0)) as available
  from span
  cross join types
  left join sold
    on sold.stay_date = span.stay_date
   and sold.room_type_id = types.id
  order by types.sort_order, types.name, span.stay_date;
$$;

comment on function public.calendar_availability(date, integer) is
  'Rooms available per room type per night. available may be negative, which means the night is overbooked.';

revoke all on function public.calendar_availability(date, integer) from public, anon;
grant execute on function public.calendar_availability(date, integer) to authenticated;
