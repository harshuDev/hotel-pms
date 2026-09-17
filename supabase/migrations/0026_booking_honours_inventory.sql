-- Layer 15b: booking reads the inventory it is sold from.
--
-- 0025 gave the hotel somewhere to put a rate and a stay rule. On its own that
-- is nine screens editing data nothing reads, which is worse than no screens:
-- a manager closes a date to arrivals, the front desk sells it anyway, and the
-- only thing the close-out achieved was making the system look like it works.
--
-- So: availability now respects allotments and close-outs, the nightly rate
-- comes off the rate plan rather than out of a receptionist's head, and the
-- stay rules refuse a booking that breaks them.
--
-- Both refusals can be overridden, because a hotel does override them — but
-- they are two different decisions and they get two different flags. Selling a
-- room that does not exist and selling against a commercial instruction are
-- not the same act, and one tickbox covering both would hide that.

-- Custom SQLSTATEs so the front end can tell "you need to tick overbook" from
-- "you need to tick override" from "this is simply wrong", without reading the
-- message text.
--   HP001  would oversell
--   HP002  breaks a stay rule or a closed date


-- Availability now means sellable, not merely physical ------------------------

create or replace function public.bookable_room_types(p_from date, p_to date)
returns table (
  room_type_id uuid,
  code text,
  name text,
  base_occupancy integer,
  max_occupancy integer,
  total_rooms bigint,
  available bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with nights as (
    select d::date as stay_date
    from generate_series(p_from, greatest(p_to - 1, p_from), interval '1 day') as d
  ),
  types as (
    select
      rt.id, rt.code, rt.name, rt.base_occupancy, rt.max_occupancy, rt.sort_order,
      count(r.id) as total_rooms,
      count(r.id) filter (where r.status <> 'ooo') as sellable
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
      and n.stay_date < p_to
    group by n.stay_date, br.room_type_id
  )
  select
    types.id,
    types.code,
    types.name,
    types.base_occupancy,
    types.max_occupancy,
    types.total_rooms,
    coalesce(
      min(
        -- A close-out means none of this type is sold that night, whatever the
        -- physical count says. An allotment caps it below that count.
        case
          when coalesce(rtd.close_out, false) then 0
          else least(
            types.sellable,
            coalesce(rtd.allotment, types.sellable)
          ) - coalesce(sold.sold, 0)
        end
      ),
      types.sellable
    )::bigint as available
  from types
  cross join nights
  left join public.room_type_days rtd
    on rtd.room_type_id = types.id
   and rtd.stay_date = nights.stay_date
   and rtd.property_id = public.current_property_id()
  left join sold
    on sold.stay_date = nights.stay_date and sold.room_type_id = types.id
  group by types.id, types.code, types.name, types.base_occupancy,
           types.max_occupancy, types.sort_order, types.total_rooms, types.sellable
  order by types.sort_order, types.name;
$$;

comment on function public.bookable_room_types(date, date) is
  'Room types and how many of each may be sold for the whole stay: the tightest night, after out-of-order rooms, allotments and close-outs.';


-- What the rules say about one stay -------------------------------------------
--
-- Returns the reason a stay cannot be sold, or null when it can. A sentence
-- rather than a code, because it goes straight to whoever is on the phone to
-- the guest and "min stay" on its own does not tell them what to offer instead.

create function public.stay_rule_violation(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date
)
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_nights integer := p_check_out - p_check_in;
  v_row record;
  v_type text;
begin
  select rt.name into v_type
  from public.room_types rt
  where rt.id = p_room_type_id and rt.property_id = public.current_property_id();

  -- Closed out: nothing of this type sells that night, on any plan. Checked
  -- first because it outranks everything a rate plan has to say.
  select rtd.stay_date into v_row
  from public.room_type_days rtd
  where rtd.property_id = public.current_property_id()
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

  select d.stay_date, d.stop_sell into v_row
  from public.rate_plan_days d
  where d.property_id = public.current_property_id()
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
    where d.property_id = public.current_property_id()
      and d.rate_plan_id = p_rate_plan_id
      and d.room_type_id = p_room_type_id
      and d.stay_date = p_check_in
      and d.closed_to_arrival
  ) then
    return format('%s is closed to arrivals on %s.', v_type, to_char(p_check_in, 'FMDay FMDD Mon'));
  end if;

  if exists (
    select 1 from public.rate_plan_days d
    where d.property_id = public.current_property_id()
      and d.rate_plan_id = p_rate_plan_id
      and d.room_type_id = p_room_type_id
      and d.stay_date = p_check_out
      and d.closed_to_departure
  ) then
    return format('%s is closed to departures on %s.', v_type, to_char(p_check_out, 'FMDay FMDD Mon'));
  end if;

  select d.min_stay_arrival into v_row
  from public.rate_plan_days d
  where d.property_id = public.current_property_id()
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
  where d.property_id = public.current_property_id()
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
  where d.property_id = public.current_property_id()
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

comment on function public.stay_rule_violation(uuid, uuid, date, date) is
  'Why this stay cannot be sold on this plan, as a sentence, or null when it can.';

revoke all on function public.stay_rule_violation(uuid, uuid, date, date) from public, anon;
grant execute on function public.stay_rule_violation(uuid, uuid, date, date) to authenticated;


-- Taking a booking, now against the inventory ---------------------------------
--
-- Dropped and recreated rather than replaced: the new rate plan parameter has
-- a default, so adding it would have created a second overload and left
-- PostgREST choosing between them.

drop function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text, boolean
);

create function public.create_booking(
  p_check_in date,
  p_check_out date,
  p_rooms jsonb,
  p_channel_id uuid,
  p_customer_id uuid default null,
  p_customer jsonb default null,
  p_adults integer default 1,
  p_children integer default 0,
  p_status public.booking_status default 'confirmed',
  p_settlement public.booking_settlement default 'at_property',
  p_tax_rate_id uuid default null,
  p_guest_notes text default null,
  p_internal_notes text default null,
  p_external_reference text default null,
  p_allow_overbook boolean default false,
  p_rate_plan_id uuid default null,
  p_ignore_restrictions boolean default false
)
returns table (booking_id uuid, reference text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_customer uuid;
  v_booking uuid;
  v_reference text;
  v_booking_room uuid;
  v_line record;
  v_available bigint;
  v_type_name text;
  v_violation text;
  v_net_cents bigint;
  v_tax_cents bigint;
  v_missing date;
  v_night record;
  i integer;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can take a booking';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_check_out <= p_check_in then
    raise exception 'The departure date must be after the arrival date';
  end if;

  if p_status not in ('pending', 'confirmed') then
    raise exception 'A new booking can only be taken as pending or confirmed';
  end if;

  if p_adults is null or p_adults < 1 then
    raise exception 'A booking needs at least one adult';
  end if;

  if p_rooms is null or jsonb_typeof(p_rooms) <> 'array'
     or jsonb_array_length(p_rooms) = 0 then
    raise exception 'A booking needs at least one room';
  end if;

  if p_rate_plan_id is not null and not exists (
    select 1 from public.rate_plans rp
    where rp.id = p_rate_plan_id and rp.property_id = v_property and rp.is_active
  ) then
    raise exception 'That rate plan is not available on this property';
  end if;

  if p_customer_id is not null then
    select c.id into v_customer
    from public.customers c
    where c.id = p_customer_id and c.property_id = v_property;
    if v_customer is null then
      raise exception 'That customer is not on this property';
    end if;
  elsif p_customer is not null then
    insert into public.customers (
      property_id, kind, first_name, last_name, company_name, email, phone
    ) values (
      v_property,
      coalesce((p_customer ->> 'kind')::public.customer_kind, 'personal'),
      nullif(btrim(coalesce(p_customer ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'last_name', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'company_name', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'phone', '')), '')
    )
    returning id into v_customer;
  else
    raise exception 'A booking needs a guest: pick an existing customer or enter a new one';
  end if;

  if not exists (
    select 1 from public.channels ch
    where ch.id = p_channel_id and ch.property_id = v_property and ch.is_active
  ) then
    raise exception 'That booking source is not available on this property';
  end if;

  -- The stay rules, before anything is written. A close-out applies whether or
  -- not a plan was named; everything else is the plan's.
  if not p_ignore_restrictions then
    for v_line in
      select (line ->> 'room_type_id')::uuid as room_type_id
      from jsonb_array_elements(p_rooms) as line
    loop
      v_violation := public.stay_rule_violation(
        p_rate_plan_id, v_line.room_type_id, p_check_in, p_check_out
      );
      if v_violation is not null then
        raise exception '%', v_violation using errcode = 'HP002';
      end if;
    end loop;
  end if;

  -- Availability, inside this transaction, and now after allotments and
  -- close-outs rather than against the bare physical room count.
  if not p_allow_overbook then
    for v_line in
      select
        (line ->> 'room_type_id')::uuid as room_type_id,
        coalesce((line ->> 'quantity')::integer, 1) as quantity
      from jsonb_array_elements(p_rooms) as line
    loop
      select b.available, b.name into v_available, v_type_name
      from public.bookable_room_types(p_check_in, p_check_out) b
      where b.room_type_id = v_line.room_type_id;

      if v_available is null then
        raise exception 'That room type is not on this property';
      end if;

      if v_line.quantity > greatest(v_available, 0) then
        raise exception
          'Only % of % free for these dates, and % asked for.',
          greatest(v_available, 0), v_type_name, v_line.quantity
          using errcode = 'HP001';
      end if;
    end loop;
  end if;

  v_reference := public.next_booking_reference();

  insert into public.bookings (
    property_id, reference, customer_id, channel_id, status, settlement,
    check_in, check_out, adults, children, guest_notes, internal_notes,
    external_reference, created_by
  ) values (
    v_property, v_reference, v_customer, p_channel_id, p_status, p_settlement,
    p_check_in, p_check_out, p_adults, coalesce(p_children, 0),
    nullif(btrim(coalesce(p_guest_notes, '')), ''),
    nullif(btrim(coalesce(p_internal_notes, '')), ''),
    nullif(btrim(coalesce(p_external_reference, '')), ''),
    auth.uid()
  )
  returning id into v_booking;

  for v_line in
    select
      (line ->> 'room_type_id')::uuid as room_type_id,
      coalesce((line ->> 'quantity')::integer, 1) as quantity,
      (line ->> 'rate_cents')::bigint as rate_cents,
      (line ->> 'adults')::integer as adults,
      (line ->> 'children')::integer as children
    from jsonb_array_elements(p_rooms) as line
  loop
    if v_line.quantity < 1 or v_line.quantity > 50 then
      raise exception 'A room line must be for between one and fifty rooms';
    end if;
    if v_line.rate_cents is not null and v_line.rate_cents < 0 then
      raise exception 'A nightly rate cannot be negative';
    end if;

    if not exists (
      select 1 from public.room_types rt
      where rt.id = v_line.room_type_id and rt.property_id = v_property
    ) then
      raise exception 'That room type is not on this property';
    end if;

    -- A line either names its own rate, which holds for every night, or takes
    -- the plan's rate, which is per night and is the reason daily rates exist.
    -- Neither means there is no price, and a booking with no price is a bill
    -- nobody can settle.
    if v_line.rate_cents is null then
      if p_rate_plan_id is null then
        raise exception
          'Give a nightly rate, or pick a rate plan that has one loaded for these dates';
      end if;

      select gs::date into v_missing
      from generate_series(p_check_in, p_check_out - 1, interval '1 day') as gs
      where not exists (
        select 1 from public.rate_plan_days d
        where d.property_id = v_property
          and d.rate_plan_id = p_rate_plan_id
          and d.room_type_id = v_line.room_type_id
          and d.stay_date = gs::date
          and d.rate_cents is not null
      )
      order by gs
      limit 1;

      if v_missing is not null then
        raise exception
          'No rate is loaded for % on this plan. Load one, or give a rate for the booking.',
          to_char(v_missing, 'FMDay FMDD Mon YYYY');
      end if;
    end if;

    for i in 1 .. v_line.quantity loop
      insert into public.booking_rooms (
        property_id, booking_id, room_type_id, status,
        check_in, check_out, adults, children
      ) values (
        v_property, v_booking, v_line.room_type_id, p_status,
        p_check_in, p_check_out,
        greatest(coalesce(v_line.adults, p_adults), 1),
        greatest(coalesce(v_line.children, coalesce(p_children, 0)), 0)
      )
      returning id into v_booking_room;

      -- sync_booking_room_nights() has written one row per night at zero. Each
      -- night is priced on its own: a Friday is not a Tuesday, and putting one
      -- figure across the whole stay is what a daily rate plan exists to stop.
      for v_night in
        select
          bn.id,
          coalesce(v_line.rate_cents, d.rate_cents) as rate_cents
        from public.booking_room_nights bn
        left join public.rate_plan_days d
          on d.property_id = v_property
         and d.rate_plan_id = p_rate_plan_id
         and d.room_type_id = v_line.room_type_id
         and d.stay_date = bn.stay_date
        where bn.booking_room_id = v_booking_room
          and bn.property_id = v_property
      loop
        if p_tax_rate_id is not null then
          select t.net_cents, t.tax_cents into v_net_cents, v_tax_cents
          from public.apply_tax_rate(p_tax_rate_id, v_night.rate_cents) t;
        else
          v_net_cents := v_night.rate_cents;
          v_tax_cents := 0;
        end if;

        update public.booking_room_nights
        set room_rate_cents = v_net_cents, tax_cents = v_tax_cents
        where id = v_night.id;
      end loop;
    end loop;
  end loop;

  return query select v_booking, v_reference;
end;
$$;

comment on function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text,
  boolean, uuid, boolean
) is
  'Takes a booking, its rooms and its nightly rates in one transaction, against the loaded inventory. HP001 means it would oversell; HP002 means it breaks a stay rule.';

revoke all on function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text,
  boolean, uuid, boolean
) from public, anon;
grant execute on function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text,
  boolean, uuid, boolean
) to authenticated;
