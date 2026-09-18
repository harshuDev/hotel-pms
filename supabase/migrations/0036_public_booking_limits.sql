-- Limits on the anonymous booking endpoint.
--
-- create_public_booking() is granted to anon, so the browser form is not where
-- any of this can be enforced: the RPC is reachable directly with curl, and
-- `max={12}` on an input is a suggestion to a browser, not a rule. Three
-- things were missing, all confirmed against the endpoint before this was
-- written.
--
-- These are guards on a public endpoint, not the hotel's policy. A front desk
-- can still take a ninety-night booking for a party of thirty through
-- create_booking(); a stranger on the internet cannot.

create or replace function public.create_public_booking(
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
  -- A stranger may book at most this far ahead, for at most this many nights,
  -- and may hold at most this many unconfirmed bookings at once.
  c_max_nights constant integer := 30;
  c_max_days_ahead constant integer := 500;
  c_max_pending constant integer := 5;

  v_channel uuid;
  v_customer uuid;
  v_booking uuid;
  v_booking_room uuid;
  v_reference text;
  v_available bigint;
  v_total bigint;
  v_reason text;
  v_max_occupancy integer;
  v_pending integer;
  v_night record;
  v_rate bigint;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception 'Choose a departure date after the arrival date';
  end if;

  if p_check_in < current_date then
    raise exception 'That arrival date has passed';
  end if;

  if p_check_out - p_check_in > c_max_nights then
    raise exception
      'Stays longer than % nights cannot be booked online. Please contact the hotel.',
      c_max_nights;
  end if;

  if p_check_in > current_date + c_max_days_ahead then
    raise exception 'That date is too far ahead to book online yet';
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

  if coalesce(p_children, 0) < 0 then
    raise exception 'That is not a number of children';
  end if;

  select c.id into v_channel
  from public.channels c
  join public.properties p on p.id = c.property_id and p.is_active
  where c.property_id = p_property_id and c.kind = 'direct' and c.is_active
  order by c.code
  limit 1;

  if v_channel is null then
    raise exception 'This property is not set up to take bookings online';
  end if;

  -- The room has to actually hold them. public_room_types() returns
  -- max_occupancy and the page shows it, but until now nothing checked it on
  -- the way in — fifty adults went into a room that sleeps three.
  select rt.max_occupancy into v_max_occupancy
  from public.room_types rt
  where rt.id = p_room_type_id and rt.property_id = p_property_id;

  if v_max_occupancy is null then
    raise exception 'That room is not available on this rate';
  end if;

  if p_adults + coalesce(p_children, 0) > v_max_occupancy then
    raise exception 'That room sleeps % people', v_max_occupancy;
  end if;

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

  if v_total is null then
    raise exception 'That room has no price loaded for those dates' using errcode = 'HP002';
  end if;

  select c.id into v_customer
  from public.customers c
  where c.property_id = p_property_id
    and lower(c.email) = lower(btrim(p_email))
  limit 1;

  -- One address cannot sit on an unlimited amount of unsold inventory. This
  -- does not stop a determined abuser, who can use another address — it stops
  -- an accident and a casual script, and the count falls back as the hotel
  -- confirms or cancels. Anything stronger than this belongs in front of the
  -- API, not in a function.
  if v_customer is not null then
    select count(*) into v_pending
    from public.bookings b
    where b.property_id = p_property_id
      and b.customer_id = v_customer
      and b.status = 'pending';

    if v_pending >= c_max_pending then
      raise exception
        'There are already % unconfirmed bookings on this email. The hotel will be in touch about those first.',
        v_pending;
    end if;
  end if;

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

  insert into public.booking_rooms (
    property_id, booking_id, room_type_id, status, check_in, check_out,
    adults, children
  )
  values (
    p_property_id, v_booking, p_room_type_id, 'pending', p_check_in, p_check_out,
    p_adults, coalesce(p_children, 0)
  )
  returning id into v_booking_room;

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

    update public.booking_room_nights
    set room_rate_cents = v_rate
    where id = v_night.id;
  end loop;

  return query select v_booking, v_reference;
end;
$$;
