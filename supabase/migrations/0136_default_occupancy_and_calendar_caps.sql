-- 0136: two fixes from El Nito Hotel's first days of setup.
--
-- 1. THE CALENDAR READS THE INVENTORY CAPS. The client: "the inventory shown
--    in the calendar does not update automatically with the inventory in the
--    inventory panel". calendar_availability() counted rooms less out of
--    order less sold, and never read room_type_days -- so an Availability
--    (allotment) or a Close out set in Inventory changed what could be sold
--    (bookable_room_types(), public_room_types() and inventory_grid() all
--    apply both) while the calendar went on showing the old figure. It now
--    works the sellable figure out exactly as inventory_grid_for() does:
--    nothing on a closed-out night, else the lower of the rooms that can
--    take a guest and the allotment. Same columns, same shape.
--
-- 2. A PER-PERSON RATE PLAN REMEMBERS ITS DEFAULT OCCUPANCY. The client:
--    "The default occupancy we set when creating a rate isn't respected; the
--    system automatically sets the room's highest occupancy as the default."
--    The plan form's radio picks the party whose price is typed, the rest
--    being worked out from the increase and decrease per adult -- but the
--    choice was never stored, so every reopening put the radio back on the
--    room type's Sleeps figure and worked the other rows out from that one.
--    Saved again, that silently repriced every party.
--
--    `rate_plans.default_occupancies` is room type id -> adults, the plan's
--    own default party for that room type; absent is the room type's Sleeps.
--    It is what the plan form's radio and Room Rate Combinations' main row
--    show. THE PRICING MODEL DOES NOT MOVE: `rate_cents` is still the price
--    for the room type's Sleeps figure and every other party's price is
--    stored explicitly in the occupancy prices, exactly as the form has
--    always saved a week typed from a non-standard row. So no night already
--    priced changes meaning, and no booking path is touched.

create or replace function public.calendar_availability(p_from date, p_days integer default 14)
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
  ),
  capped as (
    select
      span.stay_date,
      types.id,
      types.code,
      types.name,
      types.sort_order,
      types.total_rooms,
      types.out_of_order,
      case
        when coalesce(rtd.close_out, false) then 0
        else least(
          types.total_rooms - types.out_of_order,
          coalesce(rtd.allotment, types.total_rooms - types.out_of_order)
        )
      end as sellable,
      coalesce(sold.sold, 0) as sold
    from span
    cross join types
    left join public.room_type_days rtd
      on rtd.room_type_id = types.id
     and rtd.stay_date = span.stay_date
     and rtd.property_id = public.current_property_id()
    left join sold
      on sold.stay_date = span.stay_date and sold.room_type_id = types.id
  )
  select
    capped.stay_date,
    capped.id,
    capped.code,
    capped.name,
    capped.total_rooms::bigint,
    capped.out_of_order::bigint,
    capped.sellable::bigint,
    capped.sold::bigint,
    (capped.sellable - capped.sold)::bigint
  from capped
  order by capped.stay_date, capped.sort_order, capped.name;
$$;

alter table public.rate_plans
  add column if not exists default_occupancies jsonb not null default '{}'::jsonb;

alter table public.rate_plans
  add constraint rate_plans_default_occupancies_object
  check (jsonb_typeof(default_occupancies) = 'object');

create or replace function public.set_rate_plan_default_occupancy(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_adults integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid;
  v_plan public.rate_plans;
  v_type public.room_types;
  v_key text := p_room_type_id::text;
begin
  if not coalesce(public.is_revenue_staff(), false) then
    raise exception 'Only managers and administrators can change a rate plan';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  select * into v_plan from public.rate_plans
  where id = p_rate_plan_id and property_id = v_property;
  if not found then
    raise exception 'That rate plan is not on this property';
  end if;
  select * into v_type from public.room_types
  where id = p_room_type_id and property_id = v_property;
  if not found then
    raise exception 'That room type is not on this property';
  end if;

  if p_adults is not null and (p_adults < 1 or p_adults > v_type.max_occupancy) then
    raise exception '% sleeps % at most', coalesce(v_type.display_name, v_type.name), v_type.max_occupancy;
  end if;

  -- The room type's own Sleeps figure is the default already: stored as
  -- absent, so changing Sleeps later still moves a plan that never chose.
  update public.rate_plans
  set default_occupancies = case
        when p_adults is null
          or p_adults = least(greatest(v_type.base_occupancy, 1), v_type.max_occupancy)
          then default_occupancies - v_key
        else jsonb_set(default_occupancies, array[v_key], to_jsonb(p_adults))
      end
  where id = v_plan.id;
end;
$$;

revoke all on function public.set_rate_plan_default_occupancy(uuid, uuid, integer) from public;
revoke execute on function public.set_rate_plan_default_occupancy(uuid, uuid, integer) from anon;
grant execute on function public.set_rate_plan_default_occupancy(uuid, uuid, integer) to authenticated;
