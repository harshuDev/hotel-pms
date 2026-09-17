-- Layer 14: taking a booking.
--
-- One RPC does the whole thing in one transaction: resolve or create the
-- customer, allocate a reference, write the booking, write a booking_rooms row
-- per room asked for, and set the nightly rate on the rows the sync trigger
-- generates. Splitting that across several round trips from the browser would
-- leave a half-made booking behind on any failure, and a half-made booking is
-- worse than none — it holds inventory nobody can see a guest for.
--
-- Availability is checked here rather than in the form. A form can only check
-- what it loaded; two receptionists selling the last room at the same moment
-- both see it free. This runs inside the transaction that writes the rooms.
-- Overbooking is still allowed, but it has to be asked for: the calendar shows
-- a negative figure rather than hiding it, and so does this.

create sequence public.booking_reference_seq as bigint;

create function public.next_booking_reference()
returns text
language sql
volatile
set search_path = public
as $$
  select 'BK-' || lpad(nextval('public.booking_reference_seq')::text, 6, '0');
$$;

comment on function public.next_booking_reference() is
  'The hotel''s own booking reference. A channel''s reference goes in external_reference.';


-- What can be sold ------------------------------------------------------------
--
-- Availability for a whole stay is the tightest night in it: a room type with
-- four free on Monday and none on Tuesday can sell nothing for a two-night
-- stay. Rows are room types, never rooms — same rule as the calendar.

create function public.bookable_room_types(p_from date, p_to date)
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
    -- greatest() keeps at least one night in the span: with p_to = p_from the
    -- cross join below would otherwise produce nothing and every room type
    -- would vanish from the result rather than reading as unavailable.
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
    group by rt.id, rt.code, rt.name, rt.base_occupancy, rt.max_occupancy, rt.sort_order
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
      min(types.sellable - coalesce(sold.sold, 0)),
      types.sellable
    )::bigint as available
  from types
  cross join nights
  left join sold
    on sold.stay_date = nights.stay_date and sold.room_type_id = types.id
  group by types.id, types.code, types.name, types.base_occupancy,
           types.max_occupancy, types.sort_order, types.total_rooms, types.sellable
  order by types.sort_order, types.name;
$$;

comment on function public.bookable_room_types(date, date) is
  'Room types and how many of each are free for the whole stay — the tightest night in it, not the average.';


-- Taking the booking ----------------------------------------------------------

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
  p_allow_overbook boolean default false
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
  v_net_cents bigint;
  v_tax_cents bigint;
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

  -- The customer: either one that already exists, or one made here. Taking a
  -- booking and creating the guest are one act at the desk, so they are one
  -- transaction.
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

  -- Availability, one room type at a time, inside this transaction. Two
  -- receptionists selling the last room at once both see it free in their own
  -- form; only one of them gets past here.
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

      if v_line.quantity > v_available then
        raise exception
          'Only % of % free for these dates, and % asked for. Tick overbook to take it anyway.',
          v_available, v_type_name, v_line.quantity;
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
      coalesce((line ->> 'rate_cents')::bigint, 0) as rate_cents,
      (line ->> 'adults')::integer as adults,
      (line ->> 'children')::integer as children
    from jsonb_array_elements(p_rooms) as line
  loop
    if v_line.quantity < 1 or v_line.quantity > 50 then
      raise exception 'A room line must be for between one and fifty rooms';
    end if;
    if v_line.rate_cents < 0 then
      raise exception 'A nightly rate cannot be negative';
    end if;

    -- Checked explicitly, not left to the composite foreign key. The key does
    -- catch a room type from another property, but reports it as a constraint
    -- violation nobody at a front desk can act on.
    if not exists (
      select 1 from public.room_types rt
      where rt.id = v_line.room_type_id and rt.property_id = v_property
    ) then
      raise exception 'That room type is not on this property';
    end if;

    -- Tax once per line, not once per night: the rate is the same every night,
    -- so working it out per night would only round the same figure repeatedly.
    if p_tax_rate_id is not null then
      select t.net_cents, t.tax_cents into v_net_cents, v_tax_cents
      from public.apply_tax_rate(p_tax_rate_id, v_line.rate_cents) t;
    else
      v_net_cents := v_line.rate_cents;
      v_tax_cents := 0;
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

      -- sync_booking_room_nights() has already written one row per night at
      -- zero; this is what puts the rate on them.
      update public.booking_room_nights n
      set room_rate_cents = v_net_cents,
          tax_cents = v_tax_cents
      where n.booking_room_id = v_booking_room
        and n.property_id = v_property;
    end loop;
  end loop;

  return query select v_booking, v_reference;
end;
$$;

comment on function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text, boolean
) is
  'Takes a booking, its rooms and its nightly rates in one transaction. Refuses to oversell unless p_allow_overbook.';

revoke all on function public.next_booking_reference() from public, anon, authenticated;
revoke all on function public.bookable_room_types(date, date) from public, anon;
revoke all on function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text, boolean
) from public, anon;

grant execute on function public.bookable_room_types(date, date) to authenticated;
grant execute on function public.create_booking(
  date, date, jsonb, uuid, uuid, jsonb, integer, integer,
  public.booking_status, public.booking_settlement, uuid, text, text, text, boolean
) to authenticated;
