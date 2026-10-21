-- 0144: Channex, step three -- bookings IN from the booking revisions feed.
--
-- Read against docs.channex.io (Bookings Collection, 2026-10-21):
--  * GET /booking_revisions/feed lists the revisions not yet acknowledged;
--    POST /booking_revisions/:id/ack takes one off it. Channex asks for the
--    ack only once the booking is saved -- "if it's acked it is in the PMS" --
--    and keeps offering an unacked revision, emailing after 30 minutes.
--  * A REVISION IS THE WHOLE BOOKING AS IT NOW STANDS (status new, modified
--    or cancelled, every room, every night's price), not a diff. So a
--    modification is applied as "make the booking match this one".
--
-- Decided here:
--  * THIS IS THE THIRD WAY A BOOKING IS MADE, beside create_booking() and
--    create_public_booking(), and it has to be. Both of those refuse a stay
--    that would oversell or break a rule; an OTA booking has already been
--    sold and confirmed to the guest, so refusing it changes nothing at the
--    OTA and loses the booking here. It is taken as sold: confirmed, at the
--    OTA's own nightly prices (converted to the hotel's currency, 0138), with
--    the rate plan's taxes split out by tax_split_multi() as every booking's
--    are. It runs as nobody: there is no session, so the property is passed
--    in, never read from current_property_id(). It is granted to nobody.
--  * AN OVERSOLD NIGHT IS ACCEPTED AND FLAGGED, not refused: the revision's
--    outcome is "attention" and its message names the room type and night.
--  * A BOOKING IN HOUSE OR DEPARTED IS NEVER CHANGED BY CHANNEX. Its folio and
--    rooms are the desk's. The revision is kept, acknowledged, flagged, and
--    written to the booking's history, so somebody makes the change by hand.
--  * A ROOM TYPE CHANNEX NAMES BUT THIS HOTEL HAS NOT LINKED is a failure: the
--    revision is NOT acknowledged, so Channex keeps it and warns, and the next
--    pull tries again once the link exists.
--  * IDEMPOTENT TWICE OVER: one row per revision id (a revision applied is
--    only acknowledged again, never applied again), and one booking per
--    Channex booking id (a "new" for a booking already here is a change).
--    Rooms are matched by Channex's booking_room_id, else by position.
--  * ACKNOWLEDGED ONLY AFTER COMMIT. channex_pull_bookings_all() is a
--    PROCEDURE so it can COMMIT each booking before it acks it: a failure
--    after an ack would otherwise roll the booking back with Channex told it
--    arrived. If the ack itself fails, the next run acks it. The Settings
--    button applies but never acks; the next run does.
--  * pg_cron runs it every minute. After a run that changed anything the
--    hotel's availability is pushed straight back (0142's push).
--
-- Nothing here deletes a row; a room that leaves the booking is cancelled on
-- its own (canceled_separately, 0065).

-- 1. Tables ----------------------------------------------------------------------

create table if not exists public.channex_bookings (
  property_id uuid not null references public.properties (id) on delete cascade,
  channex_property_id text not null,
  channex_booking_id text not null,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  unique_id text,
  created_at timestamptz not null default now(),
  primary key (property_id, channex_booking_id),
  unique (booking_id)
);

create table if not exists public.channex_booking_rooms (
  booking_room_id uuid primary key references public.booking_rooms (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  channex_room_key text not null,
  unique (booking_id, channex_room_key)
);

create table if not exists public.channex_booking_revisions (
  channex_revision_id text primary key,
  property_id uuid not null references public.properties (id) on delete cascade,
  channex_property_id text not null,
  channex_booking_id text,
  booking_id uuid references public.bookings (id) on delete set null,
  ota_name text,
  ota_reservation_code text,
  revision_status text,
  outcome text not null check (outcome in ('applied', 'attention', 'failed')),
  message text check (char_length(message) <= 1000),
  payload jsonb not null,
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  acked_at timestamptz
);

create index if not exists channex_booking_revisions_property_idx
  on public.channex_booking_revisions (property_id, received_at desc);
create index if not exists channex_booking_revisions_unacked_idx
  on public.channex_booking_revisions (property_id)
  where acked_at is null and outcome <> 'failed';

alter table public.channex_bookings enable row level security;
alter table public.channex_booking_rooms enable row level security;
alter table public.channex_booking_revisions enable row level security;

create policy channex_bookings_select_team on public.channex_bookings
  for select using (property_id = public.current_property_id() and public.is_platform_member(auth.uid()));
create policy channex_booking_rooms_select_team on public.channex_booking_rooms
  for select using (property_id = public.current_property_id() and public.is_platform_member(auth.uid()));
create policy channex_booking_revisions_select_team on public.channex_booking_revisions
  for select using (property_id = public.current_property_id() and public.is_platform_member(auth.uid()));

revoke all on public.channex_bookings, public.channex_booking_rooms, public.channex_booking_revisions from anon;
revoke insert, update, delete, truncate on public.channex_bookings, public.channex_booking_rooms,
  public.channex_booking_revisions from authenticated;
grant select on public.channex_bookings, public.channex_booking_rooms, public.channex_booking_revisions
  to authenticated;

-- 2. Small helpers -----------------------------------------------------------------

-- "76.50" (or 76.5, or "50000") from Channex as integer hundredths. Every
-- currency is stored in hundredths here, francs included.
create or replace function public.channex_cents(p_value text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case
    when btrim(coalesce(p_value, '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      then round(btrim(p_value)::numeric * 100)::bigint
  end;
$$;

revoke all on function public.channex_cents(text) from public;
revoke execute on function public.channex_cents(text) from anon, authenticated;

-- The sales channel a booking from this OTA belongs to: an existing one whose
-- name or code reads the same once punctuation is ignored ("BookingCom" is
-- Booking.com), else a new OTA channel at no commission, so it shows up in
-- Sales Channels for the hotel to set its commission.
create or replace function public.channex_ota_channel(p_property uuid, p_ota_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := coalesce(nullif(btrim(p_ota_name), ''), 'Channex');
  v_key text := lower(regexp_replace(coalesce(nullif(btrim(p_ota_name), ''), 'Channex'), '[^[:alnum:]]', '', 'g'));
  v_id uuid;
  v_code text;
  v_try text;
  v_n integer := 1;
begin
  select c.id into v_id
  from public.channels c
  where c.property_id = p_property
    and (lower(regexp_replace(c.name, '[^[:alnum:]]', '', 'g')) = v_key
      or lower(regexp_replace(c.code, '[^[:alnum:]]', '', 'g')) = v_key)
  order by c.is_active desc, c.created_at
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- Channex writes Booking.com as "BookingCom".
  if v_key = 'bookingcom' then
    v_name := 'Booking.com';
  end if;
  v_code := left(upper(regexp_replace(v_name, '[^[:alnum:]]', '', 'g')), 10);
  if v_code = '' then
    v_code := 'OTA';
  end if;
  v_try := v_code;
  while exists (select 1 from public.channels c where c.property_id = p_property and c.code = v_try) loop
    v_n := v_n + 1;
    v_try := v_code || v_n::text;
  end loop;

  insert into public.channels (property_id, code, name, kind, commission_bps, is_active)
  values (p_property, v_try, v_name, 'ota', 0, true)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.channex_ota_channel(uuid, text) from public;
revoke execute on function public.channex_ota_channel(uuid, text) from anon, authenticated;

-- The guest: the hotel's customer with that email, else a new one.
create or replace function public.channex_customer(p_property uuid, p_customer jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(coalesce(p_customer ->> 'mail', '')), ''));
  v_first text := nullif(btrim(coalesce(p_customer ->> 'name', '')), '');
  v_last text := nullif(btrim(coalesce(p_customer ->> 'surname', '')), '');
  v_country text := upper(nullif(btrim(coalesce(p_customer ->> 'country', '')), ''));
  v_id uuid;
begin
  if v_email is not null and v_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    select c.id into v_id
    from public.customers c
    where c.property_id = p_property and lower(c.email) = v_email and c.merged_into_id is null
    order by c.created_at
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  else
    v_email := null;
  end if;

  -- A first name is required on a personal customer.
  if v_first is null then
    v_first := coalesce(v_last, 'Guest');
    v_last := null;
  end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    v_country := null;
  end if;

  insert into public.customers (property_id, kind, first_name, last_name, email, phone, country)
  values (
    p_property, 'personal', v_first, v_last, v_email,
    left(nullif(btrim(coalesce(p_customer ->> 'phone', '')), ''), 64),
    v_country
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.channex_customer(uuid, jsonb) from public;
revoke execute on function public.channex_customer(uuid, jsonb) from anon, authenticated;

-- 3. Applying one revision --------------------------------------------------------

-- Makes the booking match the revision. Raises on anything it cannot do, and
-- the caller records that as a failure. Granted to nobody.
create or replace function public.channex_apply_revision_core(p_property uuid, p_attrs jsonb)
returns table (outcome text, message text, booking_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cx text;
  v_base text;
  v_from_currency text;
  v_status text := lower(coalesce(p_attrs ->> 'status', 'new'));
  v_cx_booking text := p_attrs ->> 'booking_id';
  v_booking public.bookings;
  v_booking_id uuid;
  v_in date;
  v_out date;
  v_adults integer;
  v_children integer;
  v_settlement public.booking_settlement;
  v_arrival time;
  v_room record;
  v_line public.booking_rooms;
  v_line_id uuid;
  v_seen uuid[] := '{}';
  v_types uuid[] := '{}';
  v_type uuid;
  v_plan uuid;
  v_taxes uuid[];
  v_night record;
  v_gross bigint;
  v_net bigint;
  v_tax bigint;
  v_breakdown jsonb;
  v_nights integer;
  v_over record;
  v_ota text := coalesce(nullif(btrim(p_attrs ->> 'ota_name'), ''), 'Channex');
  v_created boolean := false;
begin
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = p_property;
  select btrim(p.currency) into v_base from public.properties p where p.id = p_property;
  v_from_currency := upper(coalesce(nullif(btrim(p_attrs ->> 'currency'), ''), v_base));

  if v_cx_booking is null then
    raise exception 'The Channex booking has no booking id';
  end if;

  select cb.booking_id into v_booking_id
  from public.channex_bookings cb
  where cb.property_id = p_property and cb.channex_booking_id = v_cx_booking;

  if v_booking_id is not null then
    select * into v_booking from public.bookings b where b.id = v_booking_id and b.property_id = p_property;
  end if;

  -- A booking the desk already has in house, or has checked out, is theirs.
  if v_booking_id is not null and v_booking.status in ('checked_in', 'checked_out') then
    insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
    values (
      p_property, null, 'booking', v_booking_id, 'channex_change_not_applied',
      format('Booking %s is %s, so the change from %s was not applied. Change it by hand.',
        v_booking.reference, replace(v_booking.status::text, '_', ' '), v_ota),
      jsonb_build_object('reference', v_booking.reference, 'revision_status', v_status)
    );
    return query select 'attention'::text,
      format('Booking %s is %s, so the change from %s was not applied. Change it by hand.',
        v_booking.reference, replace(v_booking.status::text, '_', ' '), v_ota),
      v_booking_id;
    return;
  end if;

  -- Cancelled ------------------------------------------------------------------
  if v_status = 'cancelled' then
    if v_booking_id is null then
      return query select 'applied'::text,
        'Nothing to cancel: that booking never reached this hotel'::text, null::uuid;
      return;
    end if;
    if v_booking.status in ('canceled', 'no_show') then
      return query select 'applied'::text,
        format('Booking %s is already cancelled', v_booking.reference), v_booking_id;
      return;
    end if;

    update public.bookings b
    set status = 'canceled',
        external_payload = p_attrs,
        internal_notes = coalesce(b.internal_notes || E'\n', '') || format('Cancelled on %s', v_ota)
    where b.id = v_booking_id;

    update public.booking_rooms br
    set status = 'canceled', room_id = null
    where br.booking_id = v_booking_id and br.property_id = p_property;

    update public.booking_room_nights bn
    set status = 'canceled'
    from public.booking_rooms br
    where br.id = bn.booking_room_id and br.booking_id = v_booking_id and bn.property_id = p_property;

    return query select 'applied'::text, format('Booking %s canceled', v_booking.reference), v_booking_id;
    return;
  end if;

  -- New or modified: the booking becomes what the revision says -------------------
  if coalesce(jsonb_typeof(p_attrs -> 'rooms'), '') <> 'array' or jsonb_array_length(p_attrs -> 'rooms') = 0 then
    raise exception 'The Channex booking has no rooms';
  end if;

  select
    least((p_attrs ->> 'arrival_date')::date, min((r.value ->> 'checkin_date')::date)),
    greatest((p_attrs ->> 'departure_date')::date, max((r.value ->> 'checkout_date')::date)),
    coalesce(sum(greatest(coalesce((r.value -> 'occupancy' ->> 'adults')::integer, 1), 1)), 1),
    coalesce(sum(greatest(coalesce((r.value -> 'occupancy' ->> 'children')::integer, 0), 0)), 0)
  into v_in, v_out, v_adults, v_children
  from jsonb_array_elements(p_attrs -> 'rooms') r;

  if v_in is null or v_out is null or v_out <= v_in then
    raise exception 'The Channex booking has no valid dates';
  end if;

  v_settlement := case
    when p_attrs ->> 'payment_collect' = 'ota' then 'prepaid_to_channel'::public.booking_settlement
    when coalesce((p_attrs -> 'guarantee' ->> 'is_virtual')::boolean, false) then 'virtual_card'::public.booking_settlement
    else 'at_property'::public.booking_settlement
  end;
  v_arrival := case when p_attrs ->> 'arrival_hour' ~ '^[0-2]?[0-9]:[0-5][0-9]$'
    then (p_attrs ->> 'arrival_hour')::time end;

  if v_booking_id is null then
    insert into public.bookings (
      property_id, reference, customer_id, channel_id, status, settlement,
      check_in, check_out, adults, children, arrival_time, guest_notes,
      external_reference, external_payload, booked_at
    )
    values (
      p_property, public.next_booking_reference(),
      public.channex_customer(p_property, coalesce(p_attrs -> 'customer', '{}'::jsonb)),
      public.channex_ota_channel(p_property, p_attrs ->> 'ota_name'),
      'confirmed', v_settlement, v_in, v_out, v_adults, v_children, v_arrival,
      nullif(btrim(coalesce(p_attrs ->> 'notes', '')), ''),
      coalesce(nullif(btrim(p_attrs ->> 'ota_reservation_code'), ''), p_attrs ->> 'unique_id'),
      p_attrs,
      coalesce(case when p_attrs ->> 'inserted_at' ~ '^\d{4}-\d{2}-\d{2}T'
        then ((p_attrs ->> 'inserted_at') || 'Z')::timestamptz end, now())
    )
    returning * into v_booking;
    v_booking_id := v_booking.id;
    v_created := true;

    insert into public.channex_bookings (property_id, channex_property_id, channex_booking_id, booking_id, unique_id)
    values (p_property, coalesce(v_cx, ''), v_cx_booking, v_booking_id, p_attrs ->> 'unique_id');
  else
    update public.bookings b set
      status = case when b.status in ('pending', 'canceled', 'no_show')
        then 'confirmed'::public.booking_status else b.status end,
      check_in = v_in,
      check_out = v_out,
      adults = v_adults,
      children = v_children,
      settlement = v_settlement,
      arrival_time = coalesce(v_arrival, b.arrival_time),
      guest_notes = coalesce(nullif(btrim(coalesce(p_attrs ->> 'notes', '')), ''), b.guest_notes),
      external_reference = coalesce(nullif(btrim(p_attrs ->> 'ota_reservation_code'), ''), b.external_reference),
      external_payload = p_attrs
    where b.id = v_booking_id
    returning * into v_booking;
  end if;

  -- The rooms, one by one.
  for v_room in
    select r.value as j, r.ordinality as idx
    from jsonb_array_elements(p_attrs -> 'rooms') with ordinality r
  loop
    select m.room_type_id into v_type
    from public.channex_room_type_map m
    where m.property_id = p_property and m.channex_property_id = v_cx
      and m.channex_room_type_id = v_room.j ->> 'room_type_id';
    if v_type is null then
      raise exception 'Channex room type % is not linked to a room type here',
        coalesce(v_room.j ->> 'room_type_id', 'not mapped');
    end if;

    select m.rate_plan_id into v_plan
    from public.channex_rate_plan_map m
    where m.property_id = p_property and m.channex_property_id = v_cx
      and m.channex_rate_plan_id in (v_room.j ->> 'rate_plan_id', v_room.j -> 'meta' ->> 'parent_rate_plan_id')
    order by (m.channex_rate_plan_id = v_room.j ->> 'rate_plan_id') desc
    limit 1;

    v_line_id := null;
    select br.* into v_line
    from public.channex_booking_rooms cr
    join public.booking_rooms br on br.id = cr.booking_room_id
    where cr.booking_id = v_booking_id
      and cr.channex_room_key = coalesce(v_room.j ->> 'booking_room_id', 'idx:' || v_room.idx);

    if found then
      v_line_id := v_line.id;
      begin
        update public.booking_rooms br set
          room_type_id = v_type,
          rate_plan_id = v_plan,
          room_id = case when br.room_type_id = v_type then br.room_id end,
          check_in = (v_room.j ->> 'checkin_date')::date,
          check_out = (v_room.j ->> 'checkout_date')::date,
          adults = greatest(coalesce((v_room.j -> 'occupancy' ->> 'adults')::integer, 1), 1),
          children = greatest(coalesce((v_room.j -> 'occupancy' ->> 'children')::integer, 0), 0),
          status = 'confirmed',
          canceled_separately = false
        where br.id = v_line_id;
      exception when exclusion_violation then
        -- The room it was in is taken on the new dates: the line goes back
        -- to Unassigned for the desk to place.
        update public.booking_rooms br set
          room_type_id = v_type,
          rate_plan_id = v_plan,
          room_id = null,
          check_in = (v_room.j ->> 'checkin_date')::date,
          check_out = (v_room.j ->> 'checkout_date')::date,
          adults = greatest(coalesce((v_room.j -> 'occupancy' ->> 'adults')::integer, 1), 1),
          children = greatest(coalesce((v_room.j -> 'occupancy' ->> 'children')::integer, 0), 0),
          status = 'confirmed',
          canceled_separately = false
        where br.id = v_line_id;
      end;
    else
      insert into public.booking_rooms (
        property_id, booking_id, room_type_id, rate_plan_id, status,
        check_in, check_out, adults, children
      )
      values (
        p_property, v_booking_id, v_type, v_plan, 'confirmed',
        (v_room.j ->> 'checkin_date')::date, (v_room.j ->> 'checkout_date')::date,
        greatest(coalesce((v_room.j -> 'occupancy' ->> 'adults')::integer, 1), 1),
        greatest(coalesce((v_room.j -> 'occupancy' ->> 'children')::integer, 0), 0)
      )
      returning id into v_line_id;

      insert into public.channex_booking_rooms (booking_room_id, property_id, booking_id, channex_room_key)
      values (v_line_id, p_property, v_booking_id, coalesce(v_room.j ->> 'booking_room_id', 'idx:' || v_room.idx));
    end if;

    v_seen := v_seen || v_line_id;
    v_types := v_types || v_type;

    -- The plan's taxes, else the hotel's default tax.
    if v_plan is not null then
      select coalesce(array_agg(x.tax_rate_id order by x.sort_order), '{}') into v_taxes
      from public.rate_plan_taxes x
      where x.rate_plan_id = v_plan and x.property_id = p_property;
    else
      select coalesce(array_agg(t.id), '{}') into v_taxes
      from (
        select tr.id from public.tax_rates tr
        where tr.property_id = p_property and tr.is_active and tr.kind = 'tax'
        order by tr.sort_order, tr.created_at
        limit 1
      ) t;
    end if;

    v_nights := (v_room.j ->> 'checkout_date')::date - (v_room.j ->> 'checkin_date')::date;

    -- Every night not yet charged takes the OTA's price for it.
    for v_night in
      select n.id, n.stay_date
      from public.booking_room_nights n
      where n.booking_room_id = v_line_id
        and not exists (
          select 1 from public.folio_items fi
          where fi.booking_room_night_id = n.id and fi.reverses_id is null)
    loop
      v_gross := coalesce(
        public.channex_cents(v_room.j -> 'days' ->> v_night.stay_date::text),
        public.channex_cents(v_room.j ->> 'amount') / greatest(v_nights, 1),
        0);
      if v_from_currency <> v_base then
        v_gross := public.convert_currency_cents(p_property, v_gross, v_from_currency, v_base);
        if v_gross is null then
          raise exception 'No exchange rate from % to %', v_from_currency, v_base;
        end if;
      end if;

      select t.net_cents, t.tax_cents, t.breakdown into v_net, v_tax, v_breakdown
      from public.tax_split_multi(
        p_property, v_taxes, greatest(v_gross, 0), false,
        greatest(coalesce((v_room.j -> 'occupancy' ->> 'adults')::integer, 1), 1),
        greatest(coalesce((v_room.j -> 'occupancy' ->> 'children')::integer, 0), 0)) t;

      update public.booking_room_nights n
      set room_rate_cents = coalesce(v_net, 0),
          tax_cents = coalesce(v_tax, 0),
          tax_breakdown = v_breakdown,
          discount_cents = 0,
          status = 'confirmed'
      where n.id = v_night.id;
    end loop;
  end loop;

  -- A room Channex no longer lists comes off the booking on its own. Only
  -- rooms that came from Channex: a room the desk added stays.
  for v_line in
    select br.*
    from public.booking_rooms br
    join public.channex_booking_rooms cr on cr.booking_room_id = br.id
    where br.booking_id = v_booking_id
      and br.status not in ('canceled', 'no_show')
      and not (br.id = any (v_seen))
  loop
    update public.booking_rooms br set
      status = 'canceled',
      canceled_separately = true,
      room_id = null,
      check_in = least(greatest(br.check_in, v_in), v_out - 1),
      check_out = greatest(least(br.check_out, v_out), least(greatest(br.check_in, v_in), v_out - 1) + 1)
    where br.id = v_line.id;

    update public.booking_room_nights n set status = 'canceled'
    where n.booking_room_id = v_line.id;
  end loop;

  -- Oversold? Taken anyway -- the OTA has sold it -- and flagged.
  select g.room_type_name, g.stay_date into v_over
  from public.inventory_grid_for(p_property, null, v_in, v_out - v_in) g
  where g.room_type_id = any (v_types) and g.sellable - g.sold < 0
  order by g.stay_date
  limit 1;

  if found then
    return query select 'attention'::text,
      format('%s is oversold on %s', v_over.room_type_name, to_char(v_over.stay_date, 'FMDD Mon YYYY')),
      v_booking_id;
    return;
  end if;

  if v_created then
    return query select 'applied'::text, format('Booking %s created', v_booking.reference), v_booking_id;
  else
    insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
    values (p_property, null, 'booking', v_booking_id, 'booking_changed',
      format('Booking %s changed', v_booking.reference),
      jsonb_build_object('reference', v_booking.reference, 'check_in', v_in, 'check_out', v_out, 'source', 'channex'));
    return query select 'applied'::text, format('Booking %s changed', v_booking.reference), v_booking_id;
  end if;
end;
$$;

revoke all on function public.channex_apply_revision_core(uuid, jsonb) from public;
revoke execute on function public.channex_apply_revision_core(uuid, jsonb) from anon, authenticated;

-- One feed entry: recorded, applied unless it already was, never raising. A
-- revision already applied comes back as 'seen' so it is only acknowledged.
create or replace function public.channex_apply_revision(p_property uuid, p_revision jsonb)
returns table (revision_id text, outcome text, message text, booking_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attrs jsonb := coalesce(p_revision -> 'attributes', p_revision);
  v_id text := coalesce(p_revision ->> 'id', v_attrs ->> 'id');
  v_cx text;
  v_prev public.channex_booking_revisions;
  v_outcome text;
  v_message text;
  v_booking uuid;
begin
  if v_id is null then
    return;
  end if;
  -- One revision of one hotel at a time, whoever is pulling.
  perform pg_advisory_xact_lock(hashtext('channex-bookings:' || p_property::text));

  select * into v_prev from public.channex_booking_revisions r where r.channex_revision_id = v_id;
  if found and v_prev.outcome <> 'failed' then
    return query select v_id, 'seen'::text, v_prev.message, v_prev.booking_id;
    return;
  end if;

  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = p_property;

  begin
    select a.outcome, a.message, a.booking_id into v_outcome, v_message, v_booking
    from public.channex_apply_revision_core(p_property, v_attrs) a;
  exception when others then
    v_outcome := 'failed';
    v_message := sqlerrm;
    v_booking := null;
  end;

  insert into public.channex_booking_revisions (
    channex_revision_id, property_id, channex_property_id, channex_booking_id, booking_id,
    ota_name, ota_reservation_code, revision_status, outcome, message, payload, applied_at
  )
  values (
    v_id, p_property, coalesce(v_cx, ''), v_attrs ->> 'booking_id', v_booking,
    v_attrs ->> 'ota_name', v_attrs ->> 'ota_reservation_code', v_attrs ->> 'status',
    v_outcome, left(v_message, 1000), v_attrs,
    case when v_outcome <> 'failed' then now() end
  )
  on conflict (channex_revision_id) do update set
    booking_id = excluded.booking_id,
    outcome = excluded.outcome,
    message = excluded.message,
    payload = excluded.payload,
    attempts = public.channex_booking_revisions.attempts + 1,
    applied_at = excluded.applied_at;

  return query select v_id, v_outcome, left(v_message, 1000), v_booking;
end;
$$;

revoke all on function public.channex_apply_revision(uuid, jsonb) from public;
revoke execute on function public.channex_apply_revision(uuid, jsonb) from anon, authenticated;

-- 4. Talking to Channex -------------------------------------------------------------

-- The hotel's unacknowledged revisions, oldest first, up to 100. Null when
-- Channex could not be asked; the error is in the second column.
create or replace function public.channex_fetch_feed(p_property uuid)
returns table (revisions jsonb, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cx text;
  v_status integer;
  v_body jsonb;
begin
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = p_property;
  if v_cx is null then
    return query select null::jsonb, 'Create the hotel in Channex first'::text;
    return;
  end if;
  begin
    select r.status, r.body into v_status, v_body
    from public.channex_call(p_property, 'GET',
      '/booking_revisions/feed?filter[property_id]=' || v_cx || '&order[inserted_at]=asc&pagination[limit]=100') r;
  exception when others then
    return query select null::jsonb, left(sqlerrm, 1000);
    return;
  end;
  if v_status = 200 and jsonb_typeof(v_body -> 'data') = 'array' then
    return query select v_body -> 'data', null::text;
  else
    return query select null::jsonb, public.channex_error_text(v_status, v_body);
  end if;
end;
$$;

revoke all on function public.channex_fetch_feed(uuid) from public;
revoke execute on function public.channex_fetch_feed(uuid) from anon, authenticated;

-- Tells Channex the revision is saved here. True when it agreed (or already
-- had: a 404 on a revision we hold means it was acked before).
create or replace function public.channex_ack_revision(p_property uuid, p_revision_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status integer;
begin
  begin
    select r.status into v_status
    from public.channex_call(p_property, 'POST', '/booking_revisions/' || p_revision_id || '/ack') r;
  exception when others then
    return false;
  end;
  if v_status in (200, 201, 204, 404) then
    update public.channex_booking_revisions r set acked_at = now()
    where r.channex_revision_id = p_revision_id;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.channex_ack_revision(uuid, text) from public;
revoke execute on function public.channex_ack_revision(uuid, text) from anon, authenticated;

-- 0142's push, for after a run that changed bookings. Never raises.
create or replace function public.channex_try_push(p_property uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.channex_push_ari_for(p_property, false, null);
exception when others then
  insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message)
  values (p_property, 'ari', false, 0, 0, left(sqlerrm, 1000));
end;
$$;

revoke all on function public.channex_try_push(uuid) from public;
revoke execute on function public.channex_try_push(uuid) from anon, authenticated;

-- 5. The pull --------------------------------------------------------------------

-- Every active hotel with a Channex property: acknowledge what is saved but
-- not yet acked, then apply the feed a revision at a time -- COMMIT, then
-- ack, then COMMIT. A PROCEDURE, so it can commit; no SECURITY DEFINER and no
-- SET clause, both of which forbid that. pg_cron runs it as the owner.
-- Granted to nobody.
create or replace procedure public.channex_pull_bookings_all()
language plpgsql
as $$
declare
  v_property uuid;
  v_feed record;
  v_rev jsonb;
  v_res record;
  v_pending text;
  v_page integer;
  v_acked integer;
  v_changed boolean;
begin
  for v_property in
    select c.property_id from public.channex_connections c
    where c.is_active and c.api_key_secret_id is not null and c.channex_property_id is not null
    order by c.property_id
  loop
    v_changed := false;

    -- Saved before (by the Settings button, or a run whose ack failed).
    for v_pending in
      select r.channex_revision_id from public.channex_booking_revisions r
      where r.property_id = v_property and r.acked_at is null and r.outcome <> 'failed'
      order by r.received_at
    loop
      perform public.channex_ack_revision(v_property, v_pending);
      commit;
    end loop;

    for v_page in 1..10 loop
      select * into v_feed from public.channex_fetch_feed(v_property);
      exit when v_feed.revisions is null or jsonb_array_length(v_feed.revisions) = 0;

      v_acked := 0;
      for v_rev in select x.value from jsonb_array_elements(v_feed.revisions) x loop
        select * into v_res from public.channex_apply_revision(v_property, v_rev);
        commit;
        if v_res.outcome is not null and v_res.outcome <> 'failed' then
          if v_res.outcome <> 'seen' then
            v_changed := true;
          end if;
          if public.channex_ack_revision(v_property, v_res.revision_id) then
            v_acked := v_acked + 1;
          end if;
          commit;
        end if;
      end loop;

      -- Only failures left on the page: they wait for the next run.
      exit when v_acked = 0;
    end loop;

    if v_changed then
      perform public.channex_try_push(v_property);
      commit;
    end if;
  end loop;
end;
$$;

revoke all on procedure public.channex_pull_bookings_all() from public;
revoke execute on procedure public.channex_pull_bookings_all() from anon, authenticated;

-- The Settings button: one page of the feed, applied now. It does NOT ack --
-- the minute's run acks what this saved -- so nothing is acked unless it is
-- committed.
create or replace function public.channex_pull_bookings()
returns table (revision_id text, outcome text, message text, booking_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_feed record;
  v_rev jsonb;
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  select * into v_feed from public.channex_fetch_feed(v_property);
  if v_feed.error is not null then
    raise exception '%', v_feed.error;
  end if;
  for v_rev in select x.value from jsonb_array_elements(coalesce(v_feed.revisions, '[]'::jsonb)) x loop
    return query select * from public.channex_apply_revision(v_property, v_rev);
  end loop;
end;
$$;

revoke all on function public.channex_pull_bookings() from public;
revoke execute on function public.channex_pull_bookings() from anon;
grant execute on function public.channex_pull_bookings() to authenticated;

select cron.schedule('channex-booking-pull', '* * * * *', $cron$call public.channex_pull_bookings_all()$cron$);
