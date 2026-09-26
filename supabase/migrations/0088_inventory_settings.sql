-- Settings -> Inventory -> Settings, cloned from the client's reference:
-- "Inventory Settings", three cards each with its own Save --
--   Online Booking Cut Off Date   [ ] Set Cut-Off Date
--   Same Day Booking Cut Off Time [ ] Set Time
--   Inventory Options Visibility  six ticks, all on by default
--
-- ALL THREE ARE LIVE.
--
-- THE TWO CUT-OFFS GOVERN THE GUEST BOOKING PAGE ONLY. Staff can still take
-- any booking through `create_booking()`; these are the hotel's rules for what
-- a stranger may book online.
--   * Cut-off date: no online stay may include a night after it. It is the
--     "we have only loaded rates and inventory up to here" date.
--   * Same-day time: after it, in the HOTEL's clock (`properties.timezone`),
--     nothing arriving today can be booked online.
-- Both are enforced in ONE place, `public_booking_cutoff_reason()`, which
-- `public_room_types()` now puts into `unavailable_reason`. The guest page
-- already shows that reason against each room, and `create_public_booking()`
-- already refuses whatever it holds -- so the page and the endpoint cannot
-- disagree, and curl gets the same answer as the browser.
--
-- THE SIX VISIBILITY TICKS take a restriction's screen out of the Inventory
-- menu, make the screen itself a refusal, and drop its row from the All
-- screen. A field CANNOT BE HIDDEN WHILE IT STILL HOLDS A VALUE from the
-- business date on: a stop sell nobody can see is still stopping sales, and
-- that is the one outcome hiding must never produce. Postgres refuses by name
-- with the number of nights, and the hotel clears them first.
--
-- One row per property, made on the first save; none reads as the
-- reference's defaults (no cut-offs, every field shown).

create table public.inventory_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  online_cutoff_enabled boolean not null default false,
  online_cutoff_date date,
  same_day_cutoff_enabled boolean not null default false,
  same_day_cutoff_time time,
  show_min_stay_through boolean not null default true,
  show_min_stay_arrival boolean not null default true,
  show_closed_to_arrival boolean not null default true,
  show_closed_to_departure boolean not null default true,
  show_max_stay boolean not null default true,
  show_stop_sell boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint inventory_settings_cutoff_date
    check (not online_cutoff_enabled or online_cutoff_date is not null),
  constraint inventory_settings_cutoff_time
    check (not same_day_cutoff_enabled or same_day_cutoff_time is not null)
);

alter table public.inventory_settings enable row level security;

create policy inventory_settings_select_current_property on public.inventory_settings
  for select using (property_id = public.current_property_id());
create policy inventory_settings_insert_revenue_staff on public.inventory_settings
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy inventory_settings_update_revenue_staff on public.inventory_settings
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update on public.inventory_settings to authenticated;
revoke all on public.inventory_settings from anon;

create or replace function public.inventory_settings_row()
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the inventory settings';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  insert into public.inventory_settings (property_id) values (v_property)
  on conflict (property_id) do nothing;
  return v_property;
end;
$$;

revoke execute on function public.inventory_settings_row() from public, anon;
grant execute on function public.inventory_settings_row() to authenticated;

/* -- Online Booking Cut Off Date ----------------------------------------- */

create or replace function public.save_online_booking_cutoff(
  p_enabled boolean,
  p_date date
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.inventory_settings_row();
  v_open date := public.open_business_date(v_property);
begin
  if coalesce(p_enabled, false) and p_date is null then
    raise exception 'Choose the cut-off date';
  end if;
  if coalesce(p_enabled, false) and v_open is not null and p_date < v_open then
    raise exception 'Choose a cut-off date from the business date on';
  end if;
  update public.inventory_settings set
    online_cutoff_enabled = coalesce(p_enabled, false),
    -- Unticking drops the date rather than keeping one nothing reads.
    online_cutoff_date = case when coalesce(p_enabled, false) then p_date end,
    updated_at = now()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_online_booking_cutoff(boolean, date) from public, anon;
grant execute on function public.save_online_booking_cutoff(boolean, date) to authenticated;

/* -- Same Day Booking Cut Off Time --------------------------------------- */

create or replace function public.save_same_day_booking_cutoff(
  p_enabled boolean,
  p_time time
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.inventory_settings_row();
begin
  if coalesce(p_enabled, false) and p_time is null then
    raise exception 'Choose the cut-off time';
  end if;
  update public.inventory_settings set
    same_day_cutoff_enabled = coalesce(p_enabled, false),
    same_day_cutoff_time = case when coalesce(p_enabled, false) then p_time end,
    updated_at = now()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_same_day_booking_cutoff(boolean, time) from public, anon;
grant execute on function public.save_same_day_booking_cutoff(boolean, time) to authenticated;

/* -- Inventory Options Visibility ---------------------------------------- */

create or replace function public.save_inventory_visibility(
  p_min_stay_through boolean,
  p_min_stay_arrival boolean,
  p_closed_to_arrival boolean,
  p_closed_to_departure boolean,
  p_max_stay boolean,
  p_stop_sell boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.inventory_settings_row();
  v_open date := coalesce(public.open_business_date(v_property), current_date);
  v_field record;
  v_nights bigint;
begin
  -- A field may not be hidden while it is still set on a night to come.
  for v_field in
    select * from (values
      ('Min Stay Through', coalesce(p_min_stay_through, true), 'min_stay_through is not null'),
      ('Min Stay Arrival', coalesce(p_min_stay_arrival, true), 'min_stay_arrival is not null'),
      ('Closed To Arrival', coalesce(p_closed_to_arrival, true), 'closed_to_arrival'),
      ('Closed To Departure', coalesce(p_closed_to_departure, true), 'closed_to_departure'),
      ('Max Stay', coalesce(p_max_stay, true), 'max_stay is not null'),
      ('Stop Sell', coalesce(p_stop_sell, true), 'stop_sell')
    ) as f(label, shown, predicate)
    where not f.shown
  loop
    -- The predicate is one of the six literals above, never caller input.
    execute format(
      'select count(*) from public.rate_plan_days d
       join public.rate_plans rp on rp.id = d.rate_plan_id and rp.is_active
       where d.property_id = $1 and d.stay_date >= $2 and %s',
      v_field.predicate
    ) into v_nights using v_property, v_open;
    if v_nights > 0 then
      raise exception '% is still set on % night%. Clear it before hiding it.',
        v_field.label, v_nights, case when v_nights = 1 then '' else 's' end;
    end if;
  end loop;

  update public.inventory_settings set
    show_min_stay_through = coalesce(p_min_stay_through, true),
    show_min_stay_arrival = coalesce(p_min_stay_arrival, true),
    show_closed_to_arrival = coalesce(p_closed_to_arrival, true),
    show_closed_to_departure = coalesce(p_closed_to_departure, true),
    show_max_stay = coalesce(p_max_stay, true),
    show_stop_sell = coalesce(p_stop_sell, true),
    updated_at = now()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_inventory_visibility(boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.save_inventory_visibility(boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;

/* -- The one place the cut-offs are decided ------------------------------ */

-- Security definer, called only from `public_room_types()` (itself security
-- definer), so it needs no grant of its own and has none.
create or replace function public.public_booking_cutoff_reason(
  p_property_id uuid,
  p_from date,
  p_to date
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.online_cutoff_enabled and s.online_cutoff_date is not null
         and greatest(p_to - 1, p_from) > s.online_cutoff_date
      then 'Online bookings are open for stays up to '
           || to_char(s.online_cutoff_date, 'FMDD Mon YYYY')
    when s.same_day_cutoff_enabled and s.same_day_cutoff_time is not null
         and p_from = (now() at time zone p.timezone)::date
         and (now() at time zone p.timezone)::time >= s.same_day_cutoff_time
      then 'Online bookings for today closed at '
           || to_char(s.same_day_cutoff_time, 'HH24:MI')
  end
  from public.inventory_settings s
  join public.properties p on p.id = s.property_id
  where s.property_id = p_property_id;
$$;

revoke execute on function public.public_booking_cutoff_reason(uuid, date, date) from public, anon, authenticated;

-- Unchanged except for the last column: a cut-off comes before a stay rule,
-- because it applies to every room and rate alike.
create or replace function public.public_room_types(p_property_id uuid, p_rate_plan_id uuid, p_from date, p_to date)
 returns table(room_type_id uuid, code text, name text, base_occupancy integer, max_occupancy integer, available bigint, nights integer, total_cents bigint, unavailable_reason text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    select n.stay_date, coalesce(r.room_type_id, br.room_type_id) as room_type_id, count(*) as sold
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
    coalesce(
      public.public_booking_cutoff_reason(p_property_id, p_from, p_to),
      public.stay_rule_violation_for(
        p_property_id, (select id from plan), priced.id, p_from, p_to
      )
    )
  from priced
  where exists (select 1 from plan)
  order by priced.sort_order, priced.name;
$function$;
