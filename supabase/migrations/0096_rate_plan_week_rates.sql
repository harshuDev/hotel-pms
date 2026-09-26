-- Settings -> Inventory -> Rate Plans -> "Room Rate Combinations", cloned
-- from the client's reference: for a season (or the Default Season), per room
-- type and rate plan, a Monday-to-Sunday rate with MST, MSA, MXS, CTA, CTD
-- and SS.
--
-- PRICES HERE ARE PER NIGHT (`rate_plan_days`), so a weekday template has to
-- be written onto nights. THE CLIENT DECIDED HOW: "Only fill nights that have
-- no price yet." So `save_week_rates()` stores the template and then FILLS:
--   * a night's rate is written only where the night has none;
--   * a min / max stay only where that rule is not set;
--   * CTA, CTD and stop sell are only ever SWITCHED ON -- a tick adds one, and
--     an unticked box removes nothing a person set.
-- Nothing priced or restricted by hand in Inventory is ever overwritten; the
-- Inventory screens stay the way to change a night that already has a value.
--
-- WHICH NIGHTS: from the open business date on, never the past.
--   * A season: the nights of its ranges (seasons are `season_types` of kind
--     'season' since 0095), at most two years ahead.
--   * The Default Season (no season): the next 365 nights that no season
--     covers.
-- The two-year cap and the role check are `inventory_guard()`'s, the same
-- guard every Inventory setter goes through.

create table public.rate_plan_week_rates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  rate_plan_id uuid not null,
  room_type_id uuid not null,
  -- Null is the Default Season.
  season_type_id uuid,
  -- ISO: 1 = Monday ... 7 = Sunday, the reference's column order.
  weekday smallint not null check (weekday between 1 and 7),
  rate_cents bigint check (rate_cents is null or rate_cents >= 0),
  min_stay_through integer check (min_stay_through is null or min_stay_through between 1 and 365),
  min_stay_arrival integer check (min_stay_arrival is null or min_stay_arrival between 1 and 365),
  max_stay integer check (max_stay is null or max_stay between 1 and 365),
  closed_to_arrival boolean not null default false,
  closed_to_departure boolean not null default false,
  stop_sell boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  foreign key (rate_plan_id, property_id)
    references public.rate_plans (id, property_id) on delete cascade,
  foreign key (room_type_id, property_id)
    references public.room_types (id, property_id) on delete cascade,
  foreign key (season_type_id, property_id)
    references public.season_types (id, property_id) on delete cascade,
  unique nulls not distinct (rate_plan_id, room_type_id, season_type_id, weekday)
);

alter table public.rate_plan_week_rates enable row level security;

create policy rate_plan_week_rates_select_current_property on public.rate_plan_week_rates
  for select using (property_id = public.current_property_id());
create policy rate_plan_week_rates_insert_revenue_staff on public.rate_plan_week_rates
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy rate_plan_week_rates_update_revenue_staff on public.rate_plan_week_rates
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy rate_plan_week_rates_delete_revenue_staff on public.rate_plan_week_rates
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.rate_plan_week_rates to authenticated;
revoke all on public.rate_plan_week_rates from anon;

/*
 * p_days: a JSON array of up to seven objects --
 *   { "weekday": 1..7, "rate_cents": int|null, "min_stay_through": int|null,
 *     "min_stay_arrival": int|null, "max_stay": int|null,
 *     "closed_to_arrival": bool, "closed_to_departure": bool, "stop_sell": bool }
 * Returns how many nights had their PRICE filled.
 */
create or replace function public.save_week_rates(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_season_type_id uuid,
  p_days jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_open date;
  v_to date;
  v_dates date[];
  v_filled integer;
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
  if not exists (
    select 1 from public.room_types rt where rt.id = p_room_type_id and rt.property_id = v_property
  ) then
    raise exception 'That room type is not on this property';
  end if;
  if p_season_type_id is not null and not exists (
    select 1 from public.season_types t
    where t.id = p_season_type_id and t.property_id = v_property and t.kind = 'season'
  ) then
    raise exception 'Choose a season, or the Default Season';
  end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 7 then
    raise exception 'Send one entry per weekday';
  end if;

  -- The template: the week as typed, replacing what was stored for it.
  insert into public.rate_plan_week_rates (
    property_id, rate_plan_id, room_type_id, season_type_id, weekday,
    rate_cents, min_stay_through, min_stay_arrival, max_stay,
    closed_to_arrival, closed_to_departure, stop_sell, updated_at, updated_by
  )
  select
    v_property, p_rate_plan_id, p_room_type_id, p_season_type_id, (d->>'weekday')::smallint,
    (d->>'rate_cents')::bigint, (d->>'min_stay_through')::integer,
    (d->>'min_stay_arrival')::integer, (d->>'max_stay')::integer,
    coalesce((d->>'closed_to_arrival')::boolean, false),
    coalesce((d->>'closed_to_departure')::boolean, false),
    coalesce((d->>'stop_sell')::boolean, false),
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
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  -- The nights it applies to.
  if p_season_type_id is not null then
    v_to := v_open + 730;
    select coalesce(array_agg(distinct d::date), '{}') into v_dates
    from public.seasons s
    cross join lateral generate_series(greatest(s.starts_on, v_open), least(s.ends_on, v_to), interval '1 day') as d
    where s.property_id = v_property and s.season_type_id = p_season_type_id and s.kind = 'season'
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

  -- How many nights get a price: those with none, where the template has one.
  select count(*) into v_filled
  from unnest(v_dates) as n(stay_date)
  join public.rate_plan_week_rates w
    on w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
   and w.season_type_id is not distinct from p_season_type_id
   and w.weekday = extract(isodow from n.stay_date)
  left join public.rate_plan_days r
    on r.rate_plan_id = p_rate_plan_id and r.room_type_id = p_room_type_id and r.stay_date = n.stay_date
  where w.rate_cents is not null and r.rate_cents is null;

  -- FILL ONLY: never replace a value a night already has.
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
    rate_cents = coalesce(public.rate_plan_days.rate_cents, excluded.rate_cents),
    min_stay_through = coalesce(public.rate_plan_days.min_stay_through, excluded.min_stay_through),
    min_stay_arrival = coalesce(public.rate_plan_days.min_stay_arrival, excluded.min_stay_arrival),
    max_stay = coalesce(public.rate_plan_days.max_stay, excluded.max_stay),
    closed_to_arrival = public.rate_plan_days.closed_to_arrival or excluded.closed_to_arrival,
    closed_to_departure = public.rate_plan_days.closed_to_departure or excluded.closed_to_departure,
    stop_sell = public.rate_plan_days.stop_sell or excluded.stop_sell,
    updated_by = excluded.updated_by
  -- Only nights that actually gain something are touched.
  where (public.rate_plan_days.rate_cents is null and excluded.rate_cents is not null)
     or (public.rate_plan_days.min_stay_through is null and excluded.min_stay_through is not null)
     or (public.rate_plan_days.min_stay_arrival is null and excluded.min_stay_arrival is not null)
     or (public.rate_plan_days.max_stay is null and excluded.max_stay is not null)
     or (not public.rate_plan_days.closed_to_arrival and excluded.closed_to_arrival)
     or (not public.rate_plan_days.closed_to_departure and excluded.closed_to_departure)
     or (not public.rate_plan_days.stop_sell and excluded.stop_sell);

  return v_filled;
end;
$$;

revoke execute on function public.save_week_rates(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_week_rates(uuid, uuid, uuid, jsonb) to authenticated;
