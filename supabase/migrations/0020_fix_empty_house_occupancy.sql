-- An empty house reported 100% occupancy.
--
-- Three functions clamped occupancy like this:
--
--   coalesce(round(least(sold * 100 / nullif(rooms, 0), 100), 1), 0)
--
-- With no sellable rooms the division is null, and LEAST ignores nulls — so
-- `least(null, 100)` is 100, not null. The coalesce never fired. A property
-- with no rooms, or one whose rooms are all out of order, showed a full house.
--
-- Live consequence: occupancy_forecast() has been feeding the dashboard's
-- pace chart 100% for every night since 0009 was applied.
--
-- The fix is the order of operations. Divide, then coalesce the null away,
-- then clamp:
--
--   least(coalesce(round(sold * 100 / nullif(rooms, 0), 1), 0), 100)
--
-- which gives 0 for an empty house and still caps a genuine overbooking at
-- 100. house_summary() was never affected: it has no LEAST, so its coalesce
-- worked.

create or replace function public.occupancy_forecast(p_from date, p_days integer default 28)
returns table (series_date date, occupancy_pct numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with sellable as (
    select count(*) filter (where r.status <> 'ooo') as rooms
    from public.rooms r
    where r.property_id = public.current_property_id()
  ),
  nights as (
    select n.stay_date, count(*) as sold
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_from + greatest(coalesce(p_days, 28), 0)
    group by n.stay_date
  )
  select
    d::date,
    least(
      coalesce(
        round(
          coalesce(nights.sold, 0)::numeric * 100
            / nullif((select rooms from sellable), 0),
          1
        ),
        0
      ),
      100
    )
  from generate_series(
    p_from,
    p_from + greatest(coalesce(p_days, 28), 1) - 1,
    interval '1 day'
  ) as d
  left join nights on nights.stay_date = d::date
  order by d;
$$;

create or replace function public.occupancy_report(p_from date, p_to date)
returns table (
  stay_date date,
  rooms_sold bigint,
  sellable_rooms bigint,
  occupancy_pct numeric,
  room_revenue_cents bigint,
  adr_cents bigint,
  revpar_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with sellable as (
    select count(*) filter (where r.status <> 'ooo') as rooms
    from public.rooms r
    where r.property_id = public.current_property_id()
  ),
  nights as (
    select
      n.stay_date,
      count(*) as rooms_sold,
      sum(n.room_rate_cents - n.discount_cents) as revenue
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date between p_from and p_to
    group by n.stay_date
  )
  select
    d::date,
    coalesce(nights.rooms_sold, 0),
    (select rooms from sellable),
    least(
      coalesce(
        round(
          coalesce(nights.rooms_sold, 0)::numeric * 100
            / nullif((select rooms from sellable), 0),
          1
        ),
        0
      ),
      100
    ),
    coalesce(nights.revenue, 0)::bigint,
    coalesce(
      round(nights.revenue::numeric / nullif(nights.rooms_sold, 0)),
      0
    )::bigint,
    coalesce(
      round(
        coalesce(nights.revenue, 0)::numeric
          / nullif((select rooms from sellable), 0)
      ),
      0
    )::bigint
  from generate_series(p_from, p_to, interval '1 day') as d
  left join nights on nights.stay_date = d::date
  order by d;
$$;

create or replace function public.occupancy_report_summary(p_from date, p_to date)
returns table (
  nights integer,
  rooms_sold bigint,
  room_nights_available bigint,
  occupancy_pct numeric,
  room_revenue_cents bigint,
  adr_cents bigint,
  revpar_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with sellable as (
    select count(*) filter (where r.status <> 'ooo') as rooms
    from public.rooms r
    where r.property_id = public.current_property_id()
  ),
  span as (
    select (p_to - p_from + 1) as nights
  ),
  sold as (
    select
      count(*) as rooms_sold,
      coalesce(sum(n.room_rate_cents - n.discount_cents), 0) as revenue
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date between p_from and p_to
  )
  select
    span.nights::integer,
    sold.rooms_sold,
    (span.nights * (select rooms from sellable))::bigint,
    least(
      coalesce(
        round(
          sold.rooms_sold::numeric * 100
            / nullif(span.nights * (select rooms from sellable), 0),
          1
        ),
        0
      ),
      100
    ),
    sold.revenue::bigint,
    coalesce(round(sold.revenue::numeric / nullif(sold.rooms_sold, 0)), 0)::bigint,
    coalesce(
      round(
        sold.revenue::numeric
          / nullif(span.nights * (select rooms from sellable), 0)
      ),
      0
    )::bigint
  from span cross join sold;
$$;
