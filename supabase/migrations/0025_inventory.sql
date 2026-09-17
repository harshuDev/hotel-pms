-- Layer 15: the rate model, and the inventory it hangs on.
--
-- Nothing in this schema has ever stored a rate. booking_room_nights carried a
-- room_rate_cents written per night with nothing behind it, so the new booking
-- form asks a receptionist to type a price out of their head and Inventory had
-- nothing at all to edit. This is what those nine screens act on.
--
-- Three tables, because there are three different things being decided and
-- they are decided by different people at different times:
--
--   rate_plans        what the hotel sells: Best Available, Non-refundable,
--                     Corporate. A commercial decision, changed rarely.
--   rate_plan_days    the price and the stay rules for one plan, one room
--                     type, one night. Changed constantly, in bulk, over
--                     ranges and weekdays.
--   room_type_days    what is sellable at all that night, whatever the plan:
--                     an allotment cap and a close-out. Plan-independent on
--                     purpose — closing a room type closes every rate on it,
--                     and a close-out that lived on one plan would not.
--
-- Rate and restrictions share rate_plan_days rather than sitting in separate
-- tables because they share a key exactly — plan, type, night — and every
-- screen reads the same grid. Two tables would mean two upserts and two joins
-- to show one cell.
--
-- Every column is nullable and null means "no rule". That is what lets a
-- screen clear a restriction by writing null rather than needing a separate
-- delete path, and it keeps "min stay of one" distinct from "no min stay".

create table public.rate_plans (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  code text not null,
  name text not null,
  description text,
  -- Sold by default when a booking does not name a plan. One per property.
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, code)
);

create unique index rate_plans_one_default_per_property
  on public.rate_plans (property_id) where is_default;

create table public.rate_plan_days (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  rate_plan_id uuid not null,
  room_type_id uuid not null,
  stay_date date not null,

  -- The price of one room of this type, on this plan, for this night.
  -- Null means no rate is loaded, which is not the same as free.
  rate_cents bigint,

  -- Stay rules. Null means no rule; a number is a count of nights.
  min_stay_through integer,
  min_stay_arrival integer,
  max_stay integer,

  closed_to_arrival boolean not null default false,
  closed_to_departure boolean not null default false,
  stop_sell boolean not null default false,

  updated_at timestamptz not null default now(),
  updated_by uuid,

  unique (id, property_id),
  unique (rate_plan_id, room_type_id, stay_date),
  foreign key (rate_plan_id, property_id)
    references public.rate_plans (id, property_id) on delete cascade,
  foreign key (room_type_id, property_id)
    references public.room_types (id, property_id) on delete cascade,
  foreign key (updated_by, property_id)
    references public.staff_users (id, property_id) on delete set null,
  constraint rate_plan_days_rate_nonnegative
    check (rate_cents is null or rate_cents >= 0),
  constraint rate_plan_days_stays_positive check (
    (min_stay_through is null or min_stay_through > 0)
    and (min_stay_arrival is null or min_stay_arrival > 0)
    and (max_stay is null or max_stay > 0)
  ),
  constraint rate_plan_days_stay_window_sane check (
    max_stay is null
    or min_stay_through is null
    or max_stay >= min_stay_through
  )
);

create index rate_plan_days_property_date_idx
  on public.rate_plan_days (property_id, stay_date);
create index rate_plan_days_lookup_idx
  on public.rate_plan_days (property_id, room_type_id, stay_date);

create table public.room_type_days (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  room_type_id uuid not null,
  stay_date date not null,

  -- A cap on how many of this type may be sold that night, below the physical
  -- room count. Null means "as many as exist". It is a ceiling, never a
  -- promise: rooms out of order still come off the top.
  allotment integer,
  close_out boolean not null default false,

  updated_at timestamptz not null default now(),
  updated_by uuid,

  unique (id, property_id),
  unique (room_type_id, stay_date),
  foreign key (room_type_id, property_id)
    references public.room_types (id, property_id) on delete cascade,
  foreign key (updated_by, property_id)
    references public.staff_users (id, property_id) on delete set null,
  constraint room_type_days_allotment_nonnegative
    check (allotment is null or allotment >= 0)
);

create index room_type_days_property_date_idx
  on public.room_type_days (property_id, stay_date);


-- Who may change a price ------------------------------------------------------

create function public.is_revenue_staff()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(public.current_role() in ('admin', 'manager'), false);
$$;

comment on function public.is_revenue_staff() is
  'Whether the caller may change rates, restrictions and availability. Front desk may read them, not set them.';

revoke all on function public.is_revenue_staff() from public, anon;
grant execute on function public.is_revenue_staff() to authenticated;


-- Row level security ----------------------------------------------------------
--
-- Anyone in the property reads: a receptionist needs the rate to quote it and
-- the restrictions to know why a stay will not sell. Only revenue staff write.

alter table public.rate_plans enable row level security;
alter table public.rate_plan_days enable row level security;
alter table public.room_type_days enable row level security;

create policy rate_plans_select_same_property on public.rate_plans
  for select using (property_id = public.current_property_id());
create policy rate_plans_insert_revenue on public.rate_plans
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy rate_plans_update_revenue on public.rate_plans
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy rate_plans_delete_revenue on public.rate_plans
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create policy rate_plan_days_select_same_property on public.rate_plan_days
  for select using (property_id = public.current_property_id());
create policy rate_plan_days_insert_revenue on public.rate_plan_days
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy rate_plan_days_update_revenue on public.rate_plan_days
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy rate_plan_days_delete_revenue on public.rate_plan_days
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create policy room_type_days_select_same_property on public.room_type_days
  for select using (property_id = public.current_property_id());
create policy room_type_days_insert_revenue on public.room_type_days
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy room_type_days_update_revenue on public.room_type_days
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy room_type_days_delete_revenue on public.room_type_days
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

-- touch_booking_updated_at() has always been generic — it only ever set
-- new.updated_at — but its name says otherwise, and three more tables are
-- about to use it. Renamed, with the booking trigger re-pointed, so there is
-- one of these rather than two identical ones under different names.
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger bookings_touch_updated_at on public.bookings;
create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.touch_updated_at();
drop function public.touch_booking_updated_at();

revoke all on function public.touch_updated_at() from public, anon, authenticated;

create trigger rate_plans_touch
  before update on public.rate_plans
  for each row execute function public.touch_updated_at();
create trigger rate_plan_days_touch
  before update on public.rate_plan_days
  for each row execute function public.touch_updated_at();
create trigger room_type_days_touch
  before update on public.room_type_days
  for each row execute function public.touch_updated_at();


-- Reading the grid ------------------------------------------------------------
--
-- One row per room type per night, carrying everything all nine screens show.
-- They are the same grid with a different column brought forward, so they are
-- one query rather than nine.
--
-- Rows are room types, never rooms — the ~1,800 rule holds here as it does on
-- the calendar. A property has a handful of types and the caller passes a date
-- range, so the result is bounded by dates, not by the size of the hotel.

create function public.inventory_grid(
  p_rate_plan_id uuid,
  p_from date,
  p_days integer default 28
)
returns table (
  stay_date date,
  room_type_id uuid,
  room_type_code text,
  room_type_name text,
  rate_cents bigint,
  min_stay_through integer,
  min_stay_arrival integer,
  max_stay integer,
  closed_to_arrival boolean,
  closed_to_departure boolean,
  stop_sell boolean,
  allotment integer,
  close_out boolean,
  physical_rooms bigint,
  out_of_order bigint,
  sold bigint,
  sellable bigint
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
      p_from + greatest(coalesce(p_days, 28), 1) - 1,
      interval '1 day'
    ) as d
  ),
  types as (
    select
      rt.id, rt.code, rt.name, rt.sort_order,
      count(r.id) as physical_rooms,
      count(r.id) filter (where r.status = 'ooo') as out_of_order
    from public.room_types rt
    left join public.rooms r
      on r.room_type_id = rt.id and r.property_id = rt.property_id
    where rt.property_id = public.current_property_id()
    group by rt.id, rt.code, rt.name, rt.sort_order
  ),
  sold as (
    select n.stay_date, br.room_type_id, count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_from + greatest(coalesce(p_days, 28), 1)
    group by n.stay_date, br.room_type_id
  )
  select
    span.stay_date,
    types.id,
    types.code,
    types.name,
    d.rate_cents,
    d.min_stay_through,
    d.min_stay_arrival,
    d.max_stay,
    coalesce(d.closed_to_arrival, false),
    coalesce(d.closed_to_departure, false),
    coalesce(d.stop_sell, false),
    rtd.allotment,
    coalesce(rtd.close_out, false),
    types.physical_rooms,
    types.out_of_order,
    coalesce(sold.sold, 0)::bigint,
    -- What may actually be sold that night: the physical rooms, less those out
    -- of order, capped by any allotment, and nothing at all when closed out.
    case
      when coalesce(rtd.close_out, false) then 0
      else least(
        types.physical_rooms - types.out_of_order,
        coalesce(rtd.allotment, types.physical_rooms - types.out_of_order)
      )
    end::bigint
  from span
  cross join types
  left join public.rate_plan_days d
    on d.rate_plan_id = p_rate_plan_id
   and d.room_type_id = types.id
   and d.stay_date = span.stay_date
   and d.property_id = public.current_property_id()
  left join public.room_type_days rtd
    on rtd.room_type_id = types.id
   and rtd.stay_date = span.stay_date
   and rtd.property_id = public.current_property_id()
  left join sold
    on sold.stay_date = span.stay_date and sold.room_type_id = types.id
  order by types.sort_order, types.name, span.stay_date;
$$;

comment on function public.inventory_grid(uuid, date, integer) is
  'One row per room type per night: rate, restrictions, availability and what is already sold. The source for all nine Inventory screens.';


-- Writing the grid ------------------------------------------------------------
--
-- Inventory is edited in bulk or not at all. "Min stay two on every Friday and
-- Saturday until March" is the actual job; setting one cell at a time is the
-- exception, expressed as a one-day range. So every write takes a date range,
-- a set of room types and an optional set of weekdays.
--
-- p_days_of_week uses Postgres numbering: 0 is Sunday through 6 is Saturday.
-- Null or empty means every day in the range.
--
-- There is one function per screen rather than one with a field name passed in
-- as text. Nine short functions that each say what they do beat one that takes
-- a column name from the browser and builds SQL around it.

create function public.inventory_target_dates(
  p_from date,
  p_to date,
  p_days_of_week integer[]
)
returns setof date
language sql
immutable
set search_path = public
as $$
  select d::date
  from generate_series(p_from, p_to, interval '1 day') as d
  where p_days_of_week is null
     or cardinality(p_days_of_week) = 0
     or extract(dow from d)::integer = any (p_days_of_week);
$$;

create function public.inventory_guard(p_rate_plan_id uuid, p_from date, p_to date)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change rates and availability';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_to < p_from then
    raise exception 'The last date must not be before the first';
  end if;

  -- Two years at a time. Beyond that it is almost always a mistyped year, and
  -- the write would touch hundreds of thousands of rows before anyone noticed.
  if p_to - p_from > 730 then
    raise exception 'Set at most two years at a time';
  end if;

  if p_rate_plan_id is not null and not exists (
    select 1 from public.rate_plans rp
    where rp.id = p_rate_plan_id and rp.property_id = v_property
  ) then
    raise exception 'That rate plan is not on this property';
  end if;

  return v_property;
end;
$$;

revoke all on function public.inventory_target_dates(date, date, integer[])
  from public, anon;
revoke all on function public.inventory_guard(uuid, date, date) from public, anon;
grant execute on function public.inventory_target_dates(date, date, integer[])
  to authenticated;
grant execute on function public.inventory_guard(uuid, date, date) to authenticated;


-- The nine setters, one per Inventory screen. Nine short functions that each
-- say what they do beat one that takes a column name from the browser and
-- builds SQL around it.

-- The nightly price. Null clears the rate, which is not the same as free.
create function public.set_rates(
  p_rate_plan_id uuid, p_room_type_ids uuid[], p_from date, p_to date,
  p_days_of_week integer[] default null, p_rate_cents bigint default null
)
returns integer language plpgsql security invoker set search_path = public, auth as $$
declare v_property uuid; v_count integer;
begin
  v_property := public.inventory_guard(p_rate_plan_id, p_from, p_to);
  if p_rate_plan_id is null then raise exception 'Pick a rate plan before setting this'; end if;
  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date, rate_cents, updated_by)
  select v_property, p_rate_plan_id, rt.id, d.stay_date, p_rate_cents, auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (rate_plan_id, room_type_id, stay_date) do update
    set rate_cents = excluded.rate_cents, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Nights a stay covering this date must run to. Null clears it.
create function public.set_min_stay_through(
  p_rate_plan_id uuid, p_room_type_ids uuid[], p_from date, p_to date,
  p_days_of_week integer[] default null, p_min_stay_through integer default null
)
returns integer language plpgsql security invoker set search_path = public, auth as $$
declare v_property uuid; v_count integer;
begin
  v_property := public.inventory_guard(p_rate_plan_id, p_from, p_to);
  if p_rate_plan_id is null then raise exception 'Pick a rate plan before setting this'; end if;
  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date, min_stay_through, updated_by)
  select v_property, p_rate_plan_id, rt.id, d.stay_date, p_min_stay_through, auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (rate_plan_id, room_type_id, stay_date) do update
    set min_stay_through = excluded.min_stay_through, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Nights a stay arriving on this date must run to. Null clears it.
create function public.set_min_stay_arrival(
  p_rate_plan_id uuid, p_room_type_ids uuid[], p_from date, p_to date,
  p_days_of_week integer[] default null, p_min_stay_arrival integer default null
)
returns integer language plpgsql security invoker set search_path = public, auth as $$
declare v_property uuid; v_count integer;
begin
  v_property := public.inventory_guard(p_rate_plan_id, p_from, p_to);
  if p_rate_plan_id is null then raise exception 'Pick a rate plan before setting this'; end if;
  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date, min_stay_arrival, updated_by)
  select v_property, p_rate_plan_id, rt.id, d.stay_date, p_min_stay_arrival, auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (rate_plan_id, room_type_id, stay_date) do update
    set min_stay_arrival = excluded.min_stay_arrival, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Longest stay allowed over this date. Null clears it.
create function public.set_max_stay(
  p_rate_plan_id uuid, p_room_type_ids uuid[], p_from date, p_to date,
  p_days_of_week integer[] default null, p_max_stay integer default null
)
returns integer language plpgsql security invoker set search_path = public, auth as $$
declare v_property uuid; v_count integer;
begin
  v_property := public.inventory_guard(p_rate_plan_id, p_from, p_to);
  if p_rate_plan_id is null then raise exception 'Pick a rate plan before setting this'; end if;
  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date, max_stay, updated_by)
  select v_property, p_rate_plan_id, rt.id, d.stay_date, p_max_stay, auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (rate_plan_id, room_type_id, stay_date) do update
    set max_stay = excluded.max_stay, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Nobody may arrive on this date.
create function public.set_closed_to_arrival(
  p_rate_plan_id uuid, p_room_type_ids uuid[], p_from date, p_to date,
  p_days_of_week integer[] default null, p_closed_to_arrival boolean default false
)
returns integer language plpgsql security invoker set search_path = public, auth as $$
declare v_property uuid; v_count integer;
begin
  v_property := public.inventory_guard(p_rate_plan_id, p_from, p_to);
  if p_rate_plan_id is null then raise exception 'Pick a rate plan before setting this'; end if;
  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date, closed_to_arrival, updated_by)
  select v_property, p_rate_plan_id, rt.id, d.stay_date, coalesce(p_closed_to_arrival, false), auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (rate_plan_id, room_type_id, stay_date) do update
    set closed_to_arrival = excluded.closed_to_arrival, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Nobody may depart on this date.
create function public.set_closed_to_departure(
  p_rate_plan_id uuid, p_room_type_ids uuid[], p_from date, p_to date,
  p_days_of_week integer[] default null, p_closed_to_departure boolean default false
)
returns integer language plpgsql security invoker set search_path = public, auth as $$
declare v_property uuid; v_count integer;
begin
  v_property := public.inventory_guard(p_rate_plan_id, p_from, p_to);
  if p_rate_plan_id is null then raise exception 'Pick a rate plan before setting this'; end if;
  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date, closed_to_departure, updated_by)
  select v_property, p_rate_plan_id, rt.id, d.stay_date, coalesce(p_closed_to_departure, false), auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (rate_plan_id, room_type_id, stay_date) do update
    set closed_to_departure = excluded.closed_to_departure, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- This rate plan is not sold on this date.
create function public.set_stop_sell(
  p_rate_plan_id uuid, p_room_type_ids uuid[], p_from date, p_to date,
  p_days_of_week integer[] default null, p_stop_sell boolean default false
)
returns integer language plpgsql security invoker set search_path = public, auth as $$
declare v_property uuid; v_count integer;
begin
  v_property := public.inventory_guard(p_rate_plan_id, p_from, p_to);
  if p_rate_plan_id is null then raise exception 'Pick a rate plan before setting this'; end if;
  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date, stop_sell, updated_by)
  select v_property, p_rate_plan_id, rt.id, d.stay_date, coalesce(p_stop_sell, false), auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (rate_plan_id, room_type_id, stay_date) do update
    set stop_sell = excluded.stop_sell, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Ceiling on rooms of this type sold that night. Null means as many as exist.
-- Plan-independent: it applies whatever is being sold.
create function public.set_allotment(
  p_room_type_ids uuid[], p_from date, p_to date,
  p_days_of_week integer[] default null, p_allotment integer default null
)
returns integer language plpgsql security invoker set search_path = public, auth as $$
declare v_property uuid; v_count integer;
begin
  v_property := public.inventory_guard(null, p_from, p_to);
  insert into public.room_type_days (property_id, room_type_id, stay_date, allotment, updated_by)
  select v_property, rt.id, d.stay_date, p_allotment, auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (room_type_id, stay_date) do update
    set allotment = excluded.allotment, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- The room type is not sold at all that night, on any rate plan.
-- Plan-independent: it applies whatever is being sold.
create function public.set_close_out(
  p_room_type_ids uuid[], p_from date, p_to date,
  p_days_of_week integer[] default null, p_close_out boolean default false
)
returns integer language plpgsql security invoker set search_path = public, auth as $$
declare v_property uuid; v_count integer;
begin
  v_property := public.inventory_guard(null, p_from, p_to);
  insert into public.room_type_days (property_id, room_type_id, stay_date, close_out, updated_by)
  select v_property, rt.id, d.stay_date, coalesce(p_close_out, false), auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (room_type_id, stay_date) do update
    set close_out = excluded.close_out, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Enough rate-plan management to get a property started from the Rates screen.
-- There is no property settings area yet, and a hotel with no rate plan has
-- nothing to load a price onto.
create function public.create_rate_plan(
  p_code text, p_name text, p_description text default null,
  p_is_default boolean default false
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_property uuid; v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can create a rate plan';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if btrim(coalesce(p_code, '')) = '' or btrim(coalesce(p_name, '')) = '' then
    raise exception 'A rate plan needs a code and a name';
  end if;
  -- One default per property, enforced by a partial unique index. Standing the
  -- old one down here rather than letting the index refuse the insert.
  if coalesce(p_is_default, false) then
    update public.rate_plans set is_default = false
    where property_id = v_property and is_default;
  end if;
  insert into public.rate_plans (property_id, code, name, description, is_default, sort_order)
  values (
    v_property, upper(btrim(p_code)), btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_is_default, false),
    coalesce((select max(sort_order) + 1 from public.rate_plans where property_id = v_property), 0)
  )
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.set_rates(uuid, uuid[], date, date, integer[], bigint) from public, anon;
revoke all on function public.set_min_stay_through(uuid, uuid[], date, date, integer[], integer) from public, anon;
revoke all on function public.set_min_stay_arrival(uuid, uuid[], date, date, integer[], integer) from public, anon;
revoke all on function public.set_max_stay(uuid, uuid[], date, date, integer[], integer) from public, anon;
revoke all on function public.set_closed_to_arrival(uuid, uuid[], date, date, integer[], boolean) from public, anon;
revoke all on function public.set_closed_to_departure(uuid, uuid[], date, date, integer[], boolean) from public, anon;
revoke all on function public.set_stop_sell(uuid, uuid[], date, date, integer[], boolean) from public, anon;
revoke all on function public.set_allotment(uuid[], date, date, integer[], integer) from public, anon;
revoke all on function public.set_close_out(uuid[], date, date, integer[], boolean) from public, anon;
revoke all on function public.create_rate_plan(text, text, text, boolean) from public, anon;

grant execute on function public.set_rates(uuid, uuid[], date, date, integer[], bigint) to authenticated;
grant execute on function public.set_min_stay_through(uuid, uuid[], date, date, integer[], integer) to authenticated;
grant execute on function public.set_min_stay_arrival(uuid, uuid[], date, date, integer[], integer) to authenticated;
grant execute on function public.set_max_stay(uuid, uuid[], date, date, integer[], integer) to authenticated;
grant execute on function public.set_closed_to_arrival(uuid, uuid[], date, date, integer[], boolean) to authenticated;
grant execute on function public.set_closed_to_departure(uuid, uuid[], date, date, integer[], boolean) to authenticated;
grant execute on function public.set_stop_sell(uuid, uuid[], date, date, integer[], boolean) to authenticated;
grant execute on function public.set_allotment(uuid[], date, date, integer[], integer) to authenticated;
grant execute on function public.set_close_out(uuid[], date, date, integer[], boolean) to authenticated;
grant execute on function public.create_rate_plan(text, text, text, boolean) to authenticated;
