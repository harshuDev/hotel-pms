-- 0114: an event can carry its own week of prices.
--
-- The client's Room Rate Combinations screen lists events beside seasons in
-- its Season filter, as their reference does. Until now save_week_rates()
-- refused an event by name, so an event could be drawn on the calendar
-- (0113) but never priced.
--
-- 1. save_week_rates() takes an event. Its nights are the event's own ranges,
--    and like a season it always replaces the price on them.
-- 2. AN EVENT WINS ITS NIGHTS. Events may overlap seasons, and a season is
--    saved over all of its dates, so without this re-saving a season would
--    quietly put the season's price back on the event's nights. A season or
--    the Default Season now leaves out every night covered by an event that
--    is priced for the same plan and room type.
-- 3. add_season_range() and update_season_range() re-apply an event's saved
--    week to its new dates, as they already did for a season.
--
-- Nothing already stored changes: no event carries week rates yet.

-- 1 and 2.
create or replace function public.save_week_rates(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_season_type_id uuid,
  p_days jsonb,
  p_replace_rates boolean default false
)
returns integer
language plpgsql
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_open date;
  v_to date;
  v_dates date[];
  v_changed integer;
  v_replace boolean := coalesce(p_replace_rates, false) or p_season_type_id is not null;
  v_max integer;
  v_derived boolean;
  v_kind text;
begin
  select b.business_date into v_open
  from public.business_dates b
  where b.property_id = public.current_property_id() and b.status = 'open';
  if v_open is null then
    raise exception 'There is no open business date';
  end if;
  v_property := public.inventory_guard(p_rate_plan_id, v_open, v_open);
  if p_rate_plan_id is null then
    raise exception 'Pick a rate plan';
  end if;
  select rt.max_occupancy into v_max
  from public.room_types rt where rt.id = p_room_type_id and rt.property_id = v_property;
  if not found then
    raise exception 'That room type is not on this property';
  end if;
  select rp.parent_rate_plan_id is not null into v_derived
  from public.rate_plans rp where rp.id = p_rate_plan_id;
  if p_season_type_id is not null then
    select t.kind into v_kind from public.season_types t
    where t.id = p_season_type_id and t.property_id = v_property;
    if v_kind is null then
      raise exception 'Choose a season, an event or the Default Season';
    end if;
  end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 7 then
    raise exception 'Send one entry per weekday';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_days) as d
    cross join lateral jsonb_each(
      case when jsonb_typeof(d->'occupancy_rates') = 'object' then d->'occupancy_rates' else '{}'::jsonb end
    ) as o
    where case when o.key ~ '^[0-9]{1,2}$' then o.key::integer not between 1 and v_max else true end
       or not (jsonb_typeof(o.value) = 'number' and o.value::text ~ '^[0-9]{1,12}$')
  ) then
    raise exception 'A price per occupancy is a whole amount for 1 to % adults', v_max;
  end if;

  insert into public.rate_plan_week_rates (
    property_id, rate_plan_id, room_type_id, season_type_id, weekday,
    rate_cents, min_stay_through, min_stay_arrival, max_stay,
    closed_to_arrival, closed_to_departure, stop_sell, occupancy_rates, updated_at, updated_by
  )
  select
    v_property, p_rate_plan_id, p_room_type_id, p_season_type_id, (d->>'weekday')::smallint,
    (d->>'rate_cents')::bigint, (d->>'min_stay_through')::integer,
    (d->>'min_stay_arrival')::integer, (d->>'max_stay')::integer,
    coalesce((d->>'closed_to_arrival')::boolean, false),
    coalesce((d->>'closed_to_departure')::boolean, false),
    coalesce((d->>'stop_sell')::boolean, false),
    case when jsonb_typeof(d->'occupancy_rates') = 'object' then d->'occupancy_rates' end,
    now(), auth.uid()
  from jsonb_array_elements(p_days) as d
  on conflict (rate_plan_id, room_type_id, season_type_id, weekday) do update set
    rate_cents = excluded.rate_cents,
    min_stay_through = excluded.min_stay_through,
    min_stay_arrival = excluded.min_stay_arrival,
    max_stay = excluded.max_stay,
    closed_to_arrival = excluded.closed_to_arrival,
    closed_to_departure = excluded.closed_to_departure,
    stop_sell = excluded.stop_sell,
    occupancy_rates = excluded.occupancy_rates,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  if p_season_type_id is not null then
    v_to := v_open + 730;
    select coalesce(array_agg(distinct d::date), '{}') into v_dates
    from public.seasons s
    cross join lateral generate_series(greatest(s.starts_on, v_open), least(s.ends_on, v_to), interval '1 day') as d
    where s.property_id = v_property and s.season_type_id = p_season_type_id and s.kind = v_kind
      and s.ends_on >= v_open;
  else
    v_to := v_open + 364;
    select coalesce(array_agg(d::date), '{}') into v_dates
    from generate_series(v_open, v_to, interval '1 day') as d
    where not exists (
      select 1 from public.seasons s
      where s.property_id = v_property and s.kind = 'season'
        and d::date between s.starts_on and s.ends_on
    );
  end if;

  -- An event priced for this plan and room type wins its nights: a season or
  -- the Default Season saved later leaves them alone, whatever it replaces.
  if v_kind is distinct from 'event' then
    select coalesce(array_agg(n.d), '{}') into v_dates
    from unnest(v_dates) as n(d)
    where not exists (
      select 1
      from public.seasons e
      join public.rate_plan_week_rates ew
        on ew.season_type_id = e.season_type_id
       and ew.rate_plan_id = p_rate_plan_id and ew.room_type_id = p_room_type_id
       and ew.rate_cents is not null
      where e.property_id = v_property and e.kind = 'event'
        and n.d between e.starts_on and e.ends_on
    );
  end if;

  -- The nights whose rate this will set or change.
  select count(*) into v_changed
  from unnest(v_dates) as n(stay_date)
  join public.rate_plan_week_rates w
    on w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
   and w.season_type_id is not distinct from p_season_type_id
   and w.weekday = extract(isodow from n.stay_date)
  left join public.rate_plan_days r
    on r.rate_plan_id = p_rate_plan_id and r.room_type_id = p_room_type_id and r.stay_date = n.stay_date
  where w.rate_cents is not null
    and (r.rate_cents is null or (v_replace and r.rate_cents <> w.rate_cents));

  insert into public.rate_plan_days (
    property_id, rate_plan_id, room_type_id, stay_date, rate_cents,
    min_stay_through, min_stay_arrival, max_stay,
    closed_to_arrival, closed_to_departure, stop_sell, updated_by
  )
  select
    v_property, p_rate_plan_id, p_room_type_id, n.stay_date, w.rate_cents,
    w.min_stay_through, w.min_stay_arrival, w.max_stay,
    w.closed_to_arrival, w.closed_to_departure, w.stop_sell, auth.uid()
  from unnest(v_dates) as n(stay_date)
  join public.rate_plan_week_rates w
    on w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
   and w.season_type_id is not distinct from p_season_type_id
   and w.weekday = extract(isodow from n.stay_date)
  where w.rate_cents is not null or w.min_stay_through is not null
     or w.min_stay_arrival is not null or w.max_stay is not null
     or w.closed_to_arrival or w.closed_to_departure or w.stop_sell
  on conflict (rate_plan_id, room_type_id, stay_date) do update set
    rate_cents = case
      when v_replace and excluded.rate_cents is not null then excluded.rate_cents
      else coalesce(public.rate_plan_days.rate_cents, excluded.rate_cents)
    end,
    min_stay_through = coalesce(public.rate_plan_days.min_stay_through, excluded.min_stay_through),
    min_stay_arrival = coalesce(public.rate_plan_days.min_stay_arrival, excluded.min_stay_arrival),
    max_stay = coalesce(public.rate_plan_days.max_stay, excluded.max_stay),
    closed_to_arrival = public.rate_plan_days.closed_to_arrival or excluded.closed_to_arrival,
    closed_to_departure = public.rate_plan_days.closed_to_departure or excluded.closed_to_departure,
    stop_sell = public.rate_plan_days.stop_sell or excluded.stop_sell,
    updated_by = excluded.updated_by
  where (public.rate_plan_days.rate_cents is null and excluded.rate_cents is not null)
     or (v_replace and excluded.rate_cents is not null
         and public.rate_plan_days.rate_cents is distinct from excluded.rate_cents)
     or (public.rate_plan_days.min_stay_through is null and excluded.min_stay_through is not null)
     or (public.rate_plan_days.min_stay_arrival is null and excluded.min_stay_arrival is not null)
     or (public.rate_plan_days.max_stay is null and excluded.max_stay is not null)
     or (not public.rate_plan_days.closed_to_arrival and excluded.closed_to_arrival)
     or (not public.rate_plan_days.closed_to_departure and excluded.closed_to_departure)
     or (not public.rate_plan_days.stop_sell and excluded.stop_sell);

  if not v_derived then
    if v_replace then
      delete from public.rate_plan_occupancy_days o
      using unnest(v_dates) as n(stay_date), public.rate_plan_week_rates w
      where o.rate_plan_id = p_rate_plan_id and o.room_type_id = p_room_type_id
        and o.stay_date = n.stay_date
        and w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
        and w.season_type_id is not distinct from p_season_type_id
        and w.weekday = extract(isodow from n.stay_date)
        and w.occupancy_rates is not null
        and not (w.occupancy_rates ? o.adults::text);
    end if;

    insert into public.rate_plan_occupancy_days (
      property_id, rate_plan_id, room_type_id, stay_date, adults, rate_cents, updated_by
    )
    select v_property, p_rate_plan_id, p_room_type_id, n.stay_date, o.key::smallint,
           o.value::text::bigint, auth.uid()
    from unnest(v_dates) as n(stay_date)
    join public.rate_plan_week_rates w
      on w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
     and w.season_type_id is not distinct from p_season_type_id
     and w.weekday = extract(isodow from n.stay_date)
     and w.occupancy_rates is not null
    cross join lateral jsonb_each(w.occupancy_rates) as o
    on conflict (rate_plan_id, room_type_id, stay_date, adults) do update
      set rate_cents = excluded.rate_cents, updated_at = now(), updated_by = excluded.updated_by
      where v_replace and public.rate_plan_occupancy_days.rate_cents <> excluded.rate_cents;
  end if;

  return v_changed;
end;
$$;

-- 3.
create or replace function public.add_season_range(
  p_season_type_id uuid,
  p_starts_on date,
  p_ends_on date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_property uuid;
  v_type public.season_types;
  v_clash record;
  v_id uuid;
  v_pair record;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change seasons';
  end if;
  v_property := public.current_property_id();
  select * into v_type from public.season_types
  where id = p_season_type_id and property_id = v_property;
  if not found then
    raise exception 'That season or event is not on this property';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'Choose the start and the end';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'It cannot end before it starts';
  end if;

  if v_type.kind = 'season' then
    select t.name, s.starts_on, s.ends_on into v_clash
    from public.seasons s
    join public.season_types t on t.id = s.season_type_id
    where s.property_id = v_property and s.kind = 'season'
      and daterange(s.starts_on, s.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
    order by s.starts_on
    limit 1;
    if found then
      raise exception 'That overlaps % (% - %). Seasons cannot overlap.',
        v_clash.name, to_char(v_clash.starts_on, 'FMDD Mon YYYY'), to_char(v_clash.ends_on, 'FMDD Mon YYYY');
    end if;
  end if;

  insert into public.seasons (property_id, name, starts_on, ends_on, season_type_id, kind)
  values (v_property, v_type.name, p_starts_on, p_ends_on, v_type.id, v_type.kind)
  returning id into v_id;

  if v_type.kind in ('season', 'event') then
    for v_pair in
      select w.rate_plan_id, w.room_type_id,
             jsonb_agg(jsonb_build_object(
               'weekday', w.weekday, 'rate_cents', w.rate_cents,
               'min_stay_through', w.min_stay_through, 'min_stay_arrival', w.min_stay_arrival,
               'max_stay', w.max_stay, 'closed_to_arrival', w.closed_to_arrival,
               'closed_to_departure', w.closed_to_departure, 'stop_sell', w.stop_sell,
               'occupancy_rates', w.occupancy_rates
             )) as days
      from public.rate_plan_week_rates w
      join public.rate_plans rp on rp.id = w.rate_plan_id and rp.is_active
      where w.property_id = v_property and w.season_type_id = v_type.id
      group by w.rate_plan_id, w.room_type_id
    loop
      perform public.save_week_rates(v_pair.rate_plan_id, v_pair.room_type_id, v_type.id, v_pair.days, true);
    end loop;
  end if;

  return v_id;
end;
$$;

create or replace function public.update_season_range(
  p_id uuid,
  p_starts_on date,
  p_ends_on date
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_property uuid;
  v_range public.seasons;
  v_clash record;
  v_pair record;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change seasons';
  end if;
  v_property := public.current_property_id();
  select * into v_range from public.seasons
  where id = p_id and property_id = v_property;
  if not found then
    raise exception 'Those dates are not on this property';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'Choose the start and the end';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'It cannot end before it starts';
  end if;

  if v_range.kind = 'season' then
    select t.name, s.starts_on, s.ends_on into v_clash
    from public.seasons s
    join public.season_types t on t.id = s.season_type_id
    where s.property_id = v_property and s.kind = 'season'
      and s.id <> v_range.id
      and daterange(s.starts_on, s.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
    order by s.starts_on
    limit 1;
    if found then
      raise exception 'That overlaps % (% - %). Seasons cannot overlap.',
        v_clash.name, to_char(v_clash.starts_on, 'FMDD Mon YYYY'), to_char(v_clash.ends_on, 'FMDD Mon YYYY');
    end if;
  end if;

  update public.seasons
  set starts_on = p_starts_on, ends_on = p_ends_on
  where id = v_range.id and property_id = v_property;

  -- The season's saved week rates follow it onto its new dates (0110's rule
  -- for added dates). save_week_rates() writes every range of the season, so
  -- the unchanged ranges are rewritten with the prices they already carry.
  if v_range.kind in ('season', 'event') then
    for v_pair in
      select w.rate_plan_id, w.room_type_id,
             jsonb_agg(jsonb_build_object(
               'weekday', w.weekday, 'rate_cents', w.rate_cents,
               'min_stay_through', w.min_stay_through, 'min_stay_arrival', w.min_stay_arrival,
               'max_stay', w.max_stay, 'closed_to_arrival', w.closed_to_arrival,
               'closed_to_departure', w.closed_to_departure, 'stop_sell', w.stop_sell,
               'occupancy_rates', w.occupancy_rates
             )) as days
      from public.rate_plan_week_rates w
      join public.rate_plans rp on rp.id = w.rate_plan_id and rp.is_active
      where w.property_id = v_property and w.season_type_id = v_range.season_type_id
      group by w.rate_plan_id, w.room_type_id
    loop
      perform public.save_week_rates(v_pair.rate_plan_id, v_pair.room_type_id, v_range.season_type_id, v_pair.days, true);
    end loop;
  end if;
end;
$$;

revoke all on function public.save_week_rates(uuid, uuid, uuid, jsonb, boolean) from public, anon;
revoke all on function public.add_season_range(uuid, date, date) from public, anon;
revoke all on function public.update_season_range(uuid, date, date) from public, anon;
grant execute on function public.save_week_rates(uuid, uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.add_season_range(uuid, date, date) to authenticated;
grant execute on function public.update_season_range(uuid, date, date) to authenticated;
