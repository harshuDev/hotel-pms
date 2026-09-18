-- The guest booking page: what a stranger with no session may see and do.
--
-- Everything in this schema has so far been reachable only with a staff
-- session, because current_property_id() reads staff_users by auth.uid() and
-- every RLS policy is rooted in it. A guest has no row there, so a public page
-- reading the ordinary way would see nothing at all.
--
-- The property is therefore named in the call rather than inferred, and the
-- reads below are security definer with the property as their first argument.
-- current_property_id() is deliberately NOT taught about a public context: it
-- is the root of every policy in the database, and giving anything else the
-- power to set it would put cross-property access one bug away.

-- 1. What the public may be shown ---------------------------------------------
--
-- Nothing distinguished a negotiated rate from a sellable one, so publishing
-- had to be a deliberate act. Off by default: an existing Corporate or
-- wholesaler plan stays invisible until somebody ticks it.

alter table public.rate_plans
  add column is_public boolean not null default false;

comment on column public.rate_plans.is_public is
  'Whether a guest with no session may see and book this plan. Off by default.';


-- 2. Stay rules, for a named property -----------------------------------------
--
-- stay_rule_violation() answered for the caller's own property. The guest page
-- needs the same answer for a property it names, and two copies of this logic
-- would drift the first time a rule changed. The body moves here and the
-- original becomes a wrapper, so there is still exactly one implementation.

create function public.stay_rule_violation_for(
  p_property_id uuid,
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_nights integer := p_check_out - p_check_in;
  v_row record;
  v_type text;
begin
  select rt.name into v_type
  from public.room_types rt
  where rt.id = p_room_type_id and rt.property_id = p_property_id;

  if v_type is null then
    return 'That room type is not on this property.';
  end if;

  -- Closed out: nothing of this type sells that night, on any plan. Checked
  -- first because it outranks everything a rate plan has to say.
  select rtd.stay_date into v_row
  from public.room_type_days rtd
  where rtd.property_id = p_property_id
    and rtd.room_type_id = p_room_type_id
    and rtd.stay_date >= p_check_in
    and rtd.stay_date < p_check_out
    and rtd.close_out
  order by rtd.stay_date
  limit 1;
  if found then
    return format('%s is closed out on %s.', v_type, to_char(v_row.stay_date, 'FMDay FMDD Mon'));
  end if;

  if p_rate_plan_id is null then
    return null;
  end if;

  select d.stay_date into v_row
  from public.rate_plan_days d
  where d.property_id = p_property_id
    and d.rate_plan_id = p_rate_plan_id
    and d.room_type_id = p_room_type_id
    and d.stay_date >= p_check_in
    and d.stay_date < p_check_out
    and d.stop_sell
  order by d.stay_date
  limit 1;
  if found then
    return format('This rate is on stop sell for %s on %s.', v_type, to_char(v_row.stay_date, 'FMDay FMDD Mon'));
  end if;

  -- Arrival and departure are single dates, not the whole stay. Closed to
  -- departure is checked against check_out, which is not a night stayed.
  if exists (
    select 1 from public.rate_plan_days d
    where d.property_id = p_property_id
      and d.rate_plan_id = p_rate_plan_id
      and d.room_type_id = p_room_type_id
      and d.stay_date = p_check_in
      and d.closed_to_arrival
  ) then
    return format('%s is closed to arrivals on %s.', v_type, to_char(p_check_in, 'FMDay FMDD Mon'));
  end if;

  if exists (
    select 1 from public.rate_plan_days d
    where d.property_id = p_property_id
      and d.rate_plan_id = p_rate_plan_id
      and d.room_type_id = p_room_type_id
      and d.stay_date = p_check_out
      and d.closed_to_departure
  ) then
    return format('%s is closed to departures on %s.', v_type, to_char(p_check_out, 'FMDay FMDD Mon'));
  end if;

  select d.min_stay_arrival into v_row
  from public.rate_plan_days d
  where d.property_id = p_property_id
    and d.rate_plan_id = p_rate_plan_id
    and d.room_type_id = p_room_type_id
    and d.stay_date = p_check_in
    and d.min_stay_arrival > v_nights;
  if found then
    return format(
      'Arriving on %s needs at least %s nights, and this stay is %s.',
      to_char(p_check_in, 'FMDay FMDD Mon'), v_row.min_stay_arrival, v_nights
    );
  end if;

  select d.stay_date, d.min_stay_through into v_row
  from public.rate_plan_days d
  where d.property_id = p_property_id
    and d.rate_plan_id = p_rate_plan_id
    and d.room_type_id = p_room_type_id
    and d.stay_date >= p_check_in
    and d.stay_date < p_check_out
    and d.min_stay_through > v_nights
  order by d.stay_date
  limit 1;
  if found then
    return format(
      'A stay over %s must run at least %s nights, and this one is %s.',
      to_char(v_row.stay_date, 'FMDay FMDD Mon'), v_row.min_stay_through, v_nights
    );
  end if;

  select d.stay_date, d.max_stay into v_row
  from public.rate_plan_days d
  where d.property_id = p_property_id
    and d.rate_plan_id = p_rate_plan_id
    and d.room_type_id = p_room_type_id
    and d.stay_date >= p_check_in
    and d.stay_date < p_check_out
    and d.max_stay < v_nights
  order by d.stay_date
  limit 1;
  if found then
    return format(
      'A stay over %s may run at most %s nights, and this one is %s.',
      to_char(v_row.stay_date, 'FMDay FMDD Mon'), v_row.max_stay, v_nights
    );
  end if;

  return null;
end;
$$;

create or replace function public.stay_rule_violation(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date
)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select public.stay_rule_violation_for(
    public.current_property_id(), p_rate_plan_id, p_room_type_id, p_check_in, p_check_out
  );
$$;


-- 3. The public reads ----------------------------------------------------------
--
-- properties.is_active has existed since 0001 and been honoured nowhere. It
-- means something here: a property switched off is not publicly bookable, and
-- these are the first reads to check it.

create function public.public_property(p_property_id uuid)
returns table (
  property_id uuid,
  name text,
  currency char(3),
  timezone text,
  check_in_time time,
  check_out_time time
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.currency, p.timezone, p.check_in_time, p.check_out_time
  from public.properties p
  where p.id = p_property_id and p.is_active;
$$;

create function public.public_rate_plans(p_property_id uuid)
returns table (
  rate_plan_id uuid,
  code text,
  name text,
  description text
)
language sql
stable
security definer
set search_path = public
as $$
  select rp.id, rp.code, rp.name, rp.description
  from public.rate_plans rp
  join public.properties p on p.id = rp.property_id and p.is_active
  where rp.property_id = p_property_id
    and rp.is_active
    and rp.is_public
  order by rp.sort_order, rp.name;
$$;

-- What is actually sellable, and for how much.
--
-- Availability is the tightest night, exactly as it is for staff: a type with
-- four free on Monday and none on Tuesday sells nothing for a two-night stay.
--
-- total_cents is null when any night of the stay has no rate loaded on the
-- plan. A missing rate is not free — a booking against it is refused — so the
-- page must be able to tell "no price" apart from "zero", and a null says so.

create function public.public_room_types(
  p_property_id uuid,
  p_rate_plan_id uuid,
  p_from date,
  p_to date
)
returns table (
  room_type_id uuid,
  code text,
  name text,
  base_occupancy integer,
  max_occupancy integer,
  available bigint,
  nights integer,
  total_cents bigint,
  unavailable_reason text
)
language sql
stable
security definer
set search_path = public
as $$
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
    select n.stay_date, br.room_type_id, count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    where n.property_id = p_property_id
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_to
    group by n.stay_date, br.room_type_id
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
      -- Null if any night is unpriced: bool_or over the nights, then a case.
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
    public.stay_rule_violation_for(
      p_property_id, (select id from plan), priced.id, p_from, p_to
    )
  from priced
  where exists (select 1 from plan)
  order by priced.sort_order, priced.name;
$$;


-- 4. Taking the booking --------------------------------------------------------
--
-- "Taking a booking goes through create_booking() and nothing else" is the
-- rule, and this is the one sanctioned exception, for a reason that cannot be
-- worked around: create_booking() resolves the property through
-- current_property_id(), which reads staff_users by auth.uid(). A guest has no
-- row there. Teaching current_property_id() about a public context was the
-- alternative and was rejected — it is the root of every RLS policy in this
-- database, and anything able to set it would be one bug away from
-- cross-property access.
--
-- What makes a second path acceptable is how much less this one can do. It
-- takes one room type on one public plan, always writes `pending`, never
-- overbooks, never ignores a stay rule, and has no parameter through which any
-- of that could be asked for. Everything it does happens in this transaction,
-- which is the actual point of the single-path rule: a booking assembled from
-- several calls leaves a half-made one behind on any failure.

create function public.create_public_booking(
  p_property_id uuid,
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text default null,
  p_adults integer default 2,
  p_children integer default 0,
  p_notes text default null
)
returns table (booking_id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel uuid;
  v_customer uuid;
  v_booking uuid;
  v_booking_room uuid;
  v_reference text;
  v_available bigint;
  v_total bigint;
  v_reason text;
  v_night record;
  v_rate bigint;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception 'Choose a departure date after the arrival date';
  end if;

  if p_check_in < current_date then
    raise exception 'That arrival date has passed';
  end if;

  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'A booking needs a first and last name';
  end if;

  if btrim(coalesce(p_email, '')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That email address does not look right';
  end if;

  if coalesce(p_adults, 0) < 1 then
    raise exception 'A booking needs at least one adult';
  end if;

  -- Every booking must have a source. A public one is direct, and the property
  -- has to have configured that channel before it can sell online at all.
  select c.id into v_channel
  from public.channels c
  join public.properties p on p.id = c.property_id and p.is_active
  where c.property_id = p_property_id and c.kind = 'direct' and c.is_active
  order by c.code
  limit 1;

  if v_channel is null then
    raise exception 'This property is not set up to take bookings online';
  end if;

  -- Availability and the stay rules are checked here, inside the transaction,
  -- not in the browser. A page can only check what it loaded, and two guests
  -- taking the last room at the same moment both see it free.
  select t.available, t.total_cents, t.unavailable_reason
    into v_available, v_total, v_reason
  from public.public_room_types(p_property_id, p_rate_plan_id, p_check_in, p_check_out) t
  where t.room_type_id = p_room_type_id;

  if not found then
    raise exception 'That room is not available on this rate';
  end if;

  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'HP002';
  end if;

  if coalesce(v_available, 0) < 1 then
    raise exception 'That room is fully booked for those dates' using errcode = 'HP001';
  end if;

  -- A null total means a night with no rate loaded. That is not free, and a
  -- bill nobody can settle is worse than a booking that was never taken.
  if v_total is null then
    raise exception 'That room has no price loaded for those dates' using errcode = 'HP002';
  end if;

  -- Match on email so a returning guest does not become a second customer.
  select c.id into v_customer
  from public.customers c
  where c.property_id = p_property_id
    and lower(c.email) = lower(btrim(p_email))
  limit 1;

  if v_customer is null then
    insert into public.customers (
      property_id, kind, first_name, last_name, email, phone
    )
    values (
      p_property_id, 'personal', btrim(p_first_name), btrim(p_last_name),
      lower(btrim(p_email)), nullif(btrim(coalesce(p_phone, '')), '')
    )
    returning id into v_customer;
  end if;

  v_reference := public.next_booking_reference();

  insert into public.bookings (
    property_id, reference, customer_id, channel_id, status, settlement,
    check_in, check_out, adults, children, guest_notes, booked_at
  )
  values (
    p_property_id, v_reference, v_customer, v_channel, 'pending', 'at_property',
    p_check_in, p_check_out, p_adults, coalesce(p_children, 0),
    nullif(btrim(coalesce(p_notes, '')), ''), now()
  )
  returning id into v_booking;

  -- The nights are generated by the trigger on this insert.
  insert into public.booking_rooms (
    property_id, booking_id, room_type_id, status, check_in, check_out,
    adults, children
  )
  values (
    p_property_id, v_booking, p_room_type_id, 'pending', p_check_in, p_check_out,
    p_adults, coalesce(p_children, 0)
  )
  returning id into v_booking_room;

  -- Priced per night off the plan, never one figure spread across the stay:
  -- a Friday is not a Tuesday, and daily rates exist to stop exactly that.
  for v_night in
    select n.id, n.stay_date
    from public.booking_room_nights n
    where n.booking_room_id = v_booking_room
  loop
    select d.rate_cents into v_rate
    from public.rate_plan_days d
    where d.property_id = p_property_id
      and d.rate_plan_id = p_rate_plan_id
      and d.room_type_id = p_room_type_id
      and d.stay_date = v_night.stay_date;

    -- The column is room_rate_cents and it is `not null default 0`, so an
    -- unpriced night would land as zero rather than as an absent price. That
    -- cannot happen here: a null total was refused above, before anything was
    -- written.
    update public.booking_room_nights
    set room_rate_cents = v_rate
    where id = v_night.id;
  end loop;

  return query select v_booking, v_reference;
end;
$$;


-- 5. Grants --------------------------------------------------------------------
--
-- These four are the entire public surface. anon gets nothing else: no table,
-- no view, and none of the staff RPCs.

revoke all on function public.stay_rule_violation_for(uuid, uuid, uuid, date, date) from public, anon;
grant execute on function public.stay_rule_violation_for(uuid, uuid, uuid, date, date) to authenticated;

revoke all on function public.public_property(uuid) from public;
revoke all on function public.public_rate_plans(uuid) from public;
revoke all on function public.public_room_types(uuid, uuid, date, date) from public;
revoke all on function public.create_public_booking(
  uuid, uuid, uuid, date, date, text, text, text, text, integer, integer, text
) from public;

grant execute on function public.public_property(uuid) to anon, authenticated;
grant execute on function public.public_rate_plans(uuid) to anon, authenticated;
grant execute on function public.public_room_types(uuid, uuid, date, date) to anon, authenticated;
grant execute on function public.create_public_booking(
  uuid, uuid, uuid, date, date, text, text, text, text, integer, integer, text
) to anon, authenticated;
