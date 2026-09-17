-- Layer 13b: the operational reports — booking, reservations, cancellation,
-- channel, housekeeping, in house.
--
-- Two of these look alike and are not. The booking report is production: what
-- was sold during a period, dated by when it was booked. The reservations
-- report is what is on the books to arrive during a period, dated by arrival.
-- A booking made in June for an October stay belongs to June in one and
-- October in the other, and running them against each other is how a hotel
-- tells pickup from pace.
--
-- Reservation value throughout is rate less discount over the booked nights,
-- excluding tax, so it matches the occupancy report rather than the folio. The
-- folio is what has actually been posted; this is what the stay is worth.

-- A no-show left no audit trail: log_booking_activity() named every other
-- status change and fell through on this one, so a booking could go from
-- confirmed to no_show with nothing recorded and nobody to ask.
create or replace function public.log_booking_activity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  activity_action text;
  activity_summary text;
  v_reference text;
  v_room_number text;
begin
  if tg_table_name = 'bookings' then
    if tg_op = 'INSERT' then
      activity_action := 'booking_created';
      activity_summary := format('Booking %s created', new.reference);
    elsif new.status is not distinct from old.status then
      return new;
    elsif new.status = 'confirmed' then
      activity_action := 'booking_confirmed';
      activity_summary := format('Booking %s confirmed', new.reference);
    elsif new.status = 'canceled' then
      activity_action := 'booking_cancelled';
      activity_summary := format('Booking %s canceled', new.reference);
    elsif new.status = 'no_show' then
      activity_action := 'booking_no_show';
      activity_summary := format('Booking %s marked no show', new.reference);
    elsif new.status = 'checked_in' then
      activity_action := 'guest_checked_in';
      activity_summary := format('Guest checked in for booking %s', new.reference);
    elsif new.status = 'checked_out' then
      activity_action := 'guest_checked_out';
      activity_summary := format('Guest checked out for booking %s', new.reference);
    else
      return new;
    end if;

    insert into public.activity_log (
      property_id, actor_id, entity_type, entity_id, action, summary, metadata
    ) values (
      new.property_id, auth.uid(), 'booking', new.id, activity_action,
      activity_summary, jsonb_build_object('reference', new.reference, 'status', new.status)
    );
  elsif (tg_op = 'INSERT' and new.room_id is not null)
     or (tg_op = 'UPDATE' and new.room_id is distinct from old.room_id and new.room_id is not null) then
    select b.reference into v_reference
    from public.bookings b
    where b.id = new.booking_id and b.property_id = new.property_id;

    select r.number into v_room_number
    from public.rooms r
    where r.id = new.room_id and r.property_id = new.property_id;

    activity_action := 'room_assigned';
    activity_summary := format(
      'Room %s assigned to booking %s',
      coalesce(v_room_number, '?'),
      coalesce(v_reference, '?')
    );

    insert into public.activity_log (
      property_id, actor_id, entity_type, entity_id, action, summary, metadata
    ) values (
      new.property_id, auth.uid(), 'booking_room', new.id, activity_action,
      activity_summary,
      jsonb_build_object(
        'booking_id', new.booking_id,
        'room_id', new.room_id,
        'reference', v_reference,
        'room_number', v_room_number
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.log_booking_activity() from public, anon, authenticated;


-- Booking (production) -------------------------------------------------------
--
-- Dated by when the booking was made, in the property's timezone. A booking
-- taken at 23:30 in London is a London booking, not a UTC one.

create function public.booking_report(p_from date, p_to date)
returns table (
  booking_id uuid,
  reference text,
  guest_name text,
  channel_name text,
  channel_kind public.channel_kind,
  status public.booking_status,
  settlement public.booking_settlement,
  booked_on date,
  check_in date,
  check_out date,
  nights integer,
  room_count bigint,
  room_nights bigint,
  value_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    b.id,
    b.reference,
    public.customer_display_name(c),
    ch.name,
    ch.kind,
    b.status,
    b.settlement,
    (b.booked_at at time zone p.timezone)::date,
    b.check_in,
    b.check_out,
    greatest((b.check_out - b.check_in), 0)::integer,
    coalesce(agg.room_count, 0)::bigint,
    coalesce(agg.room_nights, 0)::bigint,
    coalesce(agg.value_cents, 0)::bigint
  from public.bookings b
  join public.properties p on p.id = b.property_id
  left join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  left join public.channels ch
    on ch.id = b.channel_id and ch.property_id = b.property_id
  left join lateral (
    select
      count(distinct br.id) as room_count,
      count(n.id) as room_nights,
      sum(n.room_rate_cents - n.discount_cents) as value_cents
    from public.booking_rooms br
    left join public.booking_room_nights n
      on n.booking_room_id = br.id and n.property_id = br.property_id
    where br.booking_id = b.id and br.property_id = b.property_id
  ) agg on true
  where b.property_id = public.current_property_id()
    and (b.booked_at at time zone p.timezone)::date between p_from and p_to
  order by b.booked_at desc;
$$;

create function public.booking_report_by_channel(p_from date, p_to date)
returns table (
  channel_name text,
  channel_kind public.channel_kind,
  commission_bps integer,
  booking_count bigint,
  canceled_count bigint,
  room_nights bigint,
  value_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  -- Grouped off bookings directly rather than off booking_report(), because
  -- joining a summary back to channels by name would break on a property with
  -- two channels sharing a name, and on the bookings that have no channel.
  select
    coalesce(ch.name, 'No channel'),
    ch.kind,
    coalesce(ch.commission_bps, 0),
    count(*)::bigint,
    count(*) filter (where b.status in ('canceled', 'no_show'))::bigint,
    coalesce(sum(agg.room_nights), 0)::bigint,
    coalesce(sum(agg.value_cents), 0)::bigint
  from public.bookings b
  join public.properties p on p.id = b.property_id
  left join public.channels ch
    on ch.id = b.channel_id and ch.property_id = b.property_id
  left join lateral (
    select
      count(n.id) as room_nights,
      sum(n.room_rate_cents - n.discount_cents) as value_cents
    from public.booking_rooms br
    left join public.booking_room_nights n
      on n.booking_room_id = br.id and n.property_id = br.property_id
    where br.booking_id = b.id and br.property_id = b.property_id
  ) agg on true
  where b.property_id = public.current_property_id()
    and (b.booked_at at time zone p.timezone)::date between p_from and p_to
  group by ch.name, ch.kind, ch.commission_bps
  order by coalesce(sum(agg.value_cents), 0) desc, coalesce(ch.name, 'No channel');
$$;


-- Reservations (pace) --------------------------------------------------------
--
-- What is on the books to arrive, arrival date by arrival date. Cancellations
-- and no-shows are excluded: this is the question "how many people are we
-- expecting", and a cancelled booking is not an expectation.

create function public.reservations_report(p_from date, p_to date)
returns table (
  arrival_date date,
  booking_count bigint,
  pending_count bigint,
  room_count bigint,
  adults bigint,
  children bigint,
  room_nights bigint,
  value_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with span as (
    select d::date as arrival_date
    from generate_series(p_from, p_to, interval '1 day') as d
  ),
  arrivals as (
    select
      b.check_in as arrival_date,
      count(*)::bigint as booking_count,
      count(*) filter (where b.status = 'pending')::bigint as pending_count,
      coalesce(sum(agg.room_count), 0)::bigint as room_count,
      coalesce(sum(b.adults), 0)::bigint as adults,
      coalesce(sum(b.children), 0)::bigint as children,
      coalesce(sum(agg.room_nights), 0)::bigint as room_nights,
      coalesce(sum(agg.value_cents), 0)::bigint as value_cents
    from public.bookings b
    left join lateral (
      select
        count(distinct br.id) as room_count,
        count(n.id) as room_nights,
        sum(n.room_rate_cents - n.discount_cents) as value_cents
      from public.booking_rooms br
      left join public.booking_room_nights n
        on n.booking_room_id = br.id and n.property_id = br.property_id
      where br.booking_id = b.id and br.property_id = b.property_id
    ) agg on true
    where b.property_id = public.current_property_id()
      and b.check_in between p_from and p_to
      and b.status not in ('canceled', 'no_show')
    group by b.check_in
  )
  select
    span.arrival_date,
    coalesce(a.booking_count, 0)::bigint,
    coalesce(a.pending_count, 0)::bigint,
    coalesce(a.room_count, 0)::bigint,
    coalesce(a.adults, 0)::bigint,
    coalesce(a.children, 0)::bigint,
    coalesce(a.room_nights, 0)::bigint,
    coalesce(a.value_cents, 0)::bigint
  from span
  left join arrivals a on a.arrival_date = span.arrival_date
  order by span.arrival_date;
$$;


-- Cancellation ---------------------------------------------------------------
--
-- Ranged on arrival date, not on when the booking was cancelled. The schema
-- has no cancelled_at column, and the nearest thing — the activity log — only
-- records a row when a status change goes through the trigger, which is why
-- cancelled_on below is nullable rather than filtered on. "Arrivals we lost in
-- this period" is also the question a revenue manager is actually asking.
-- If cancellation-dated reporting is wanted, bookings needs the column.

create function public.cancellation_report(p_from date, p_to date)
returns table (
  booking_id uuid,
  reference text,
  guest_name text,
  channel_name text,
  status public.booking_status,
  booked_on date,
  cancelled_on date,
  check_in date,
  check_out date,
  nights integer,
  room_count bigint,
  room_nights bigint,
  lost_value_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    b.id,
    b.reference,
    public.customer_display_name(c),
    ch.name,
    b.status,
    (b.booked_at at time zone p.timezone)::date,
    (log.created_at at time zone p.timezone)::date,
    b.check_in,
    b.check_out,
    greatest((b.check_out - b.check_in), 0)::integer,
    coalesce(agg.room_count, 0)::bigint,
    coalesce(agg.room_nights, 0)::bigint,
    coalesce(agg.value_cents, 0)::bigint
  from public.bookings b
  join public.properties p on p.id = b.property_id
  left join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  left join public.channels ch
    on ch.id = b.channel_id and ch.property_id = b.property_id
  left join lateral (
    select
      count(distinct br.id) as room_count,
      count(n.id) as room_nights,
      sum(n.room_rate_cents - n.discount_cents) as value_cents
    from public.booking_rooms br
    left join public.booking_room_nights n
      on n.booking_room_id = br.id and n.property_id = br.property_id
    where br.booking_id = b.id and br.property_id = b.property_id
  ) agg on true
  left join lateral (
    select al.created_at
    from public.activity_log al
    where al.entity_id = b.id
      and al.property_id = b.property_id
      and al.action in ('booking_cancelled', 'booking_no_show')
    order by al.created_at desc
    limit 1
  ) log on true
  where b.property_id = public.current_property_id()
    and b.status in ('canceled', 'no_show')
    and b.check_in between p_from and p_to
  order by b.check_in, b.reference;
$$;


-- Channel --------------------------------------------------------------------
--
-- Room nights and revenue by channel over the nights stayed, not the nights
-- booked, so it lines up with the occupancy report. Commission is computed
-- from the channel's own basis points; it is what the channel is owed on this
-- business, not money that has moved.

create function public.channel_report(p_from date, p_to date)
returns table (
  channel_name text,
  channel_kind public.channel_kind,
  commission_bps integer,
  booking_count bigint,
  room_nights bigint,
  room_revenue_cents bigint,
  commission_cents bigint,
  net_revenue_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(ch.name, 'No channel'),
    ch.kind,
    coalesce(ch.commission_bps, 0),
    count(distinct b.id)::bigint,
    count(n.id)::bigint,
    coalesce(sum(n.room_rate_cents - n.discount_cents), 0)::bigint,
    -- Integer minor units throughout: divide last, and round rather than
    -- truncate, so the commission on a run of nights does not drift.
    round(
      coalesce(sum(n.room_rate_cents - n.discount_cents), 0)
      * coalesce(ch.commission_bps, 0) / 10000.0
    )::bigint,
    (
      coalesce(sum(n.room_rate_cents - n.discount_cents), 0)
      - round(
          coalesce(sum(n.room_rate_cents - n.discount_cents), 0)
          * coalesce(ch.commission_bps, 0) / 10000.0
        )
    )::bigint
  from public.booking_room_nights n
  join public.booking_rooms br
    on br.id = n.booking_room_id and br.property_id = n.property_id
  join public.bookings b
    on b.id = br.booking_id and b.property_id = br.property_id
  left join public.channels ch
    on ch.id = b.channel_id and ch.property_id = b.property_id
  where n.property_id = public.current_property_id()
    and n.stay_date between p_from and p_to
    and n.status not in ('canceled', 'no_show')
  group by ch.name, ch.kind, ch.commission_bps
  order by coalesce(sum(n.room_rate_cents - n.discount_cents), 0) desc, coalesce(ch.name, 'No channel');
$$;


-- Housekeeping ---------------------------------------------------------------
--
-- A floor summary and a paginated room list, never every room at once. A
-- property may run around 1,800 rooms; floors are a handful whatever the size,
-- and the list is the thing a housekeeper walks a floor with.

create function public.housekeeping_summary()
returns table (
  floor integer,
  room_count bigint,
  vacant_clean bigint,
  vacant_dirty bigint,
  occupied bigint,
  due_out bigint,
  arriving bigint,
  ooo bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.floor,
    count(*)::bigint,
    count(*) filter (where s.state = 'vacant_clean')::bigint,
    count(*) filter (where s.state = 'vacant_dirty')::bigint,
    count(*) filter (where s.state = 'occupied')::bigint,
    count(*) filter (where s.state = 'due_out')::bigint,
    count(*) filter (where s.state = 'arriving')::bigint,
    count(*) filter (where s.state = 'ooo')::bigint
  from public.room_house_states s
  where s.property_id = public.current_property_id()
  group by s.floor
  order by s.floor nulls last;
$$;

create function public.housekeeping_rooms(
  p_floor integer default null,
  p_state text default null,
  p_limit integer default 120,
  p_offset integer default 0
)
returns table (
  room_id uuid,
  number text,
  floor integer,
  room_type_name text,
  housekeeping_status public.room_status,
  state text,
  guest_name text,
  nights_left integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select s.*
    from public.room_house_states s
    where s.property_id = public.current_property_id()
      and (p_floor is null or s.floor = p_floor)
      and (p_state is null or s.state = p_state)
  )
  select
    f.room_id,
    f.number,
    f.floor,
    f.room_type_name,
    f.housekeeping_status,
    f.state,
    f.guest_name,
    f.nights_left::integer,
    count(*) over ()::bigint
  from filtered f
  order by
    f.floor nulls last,
    nullif(regexp_replace(f.number, '\D', '', 'g'), '')::bigint nulls last,
    f.number
  limit greatest(coalesce(p_limit, 120), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;


-- In house -------------------------------------------------------------------
--
-- Everyone staying tonight, on the open business date. Bounded by the rooms
-- that are actually occupied, so it needs no pagination in the way a room list
-- does. Balance comes from the folio, so it is what the guest owes now.

create function public.in_house_report()
returns table (
  booking_id uuid,
  reference text,
  guest_name text,
  room_number text,
  room_type_name text,
  channel_name text,
  check_in date,
  check_out date,
  nights integer,
  nights_stayed integer,
  nights_left integer,
  adults integer,
  children integer,
  balance_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    b.id,
    b.reference,
    public.customer_display_name(c),
    r.number,
    rt.name,
    ch.name,
    br.check_in,
    br.check_out,
    greatest((br.check_out - br.check_in), 0)::integer,
    greatest((bd.business_date - br.check_in), 0)::integer,
    greatest((br.check_out - bd.business_date), 0)::integer,
    br.adults,
    br.children,
    coalesce(bal.outstanding, 0)::bigint
  from public.booking_rooms br
  join public.bookings b
    on b.id = br.booking_id and b.property_id = br.property_id
  join public.business_dates bd
    on bd.property_id = br.property_id and bd.status = 'open'
  join public.room_types rt
    on rt.id = br.room_type_id and rt.property_id = br.property_id
  left join public.rooms r
    on r.id = br.room_id and r.property_id = br.property_id
  left join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  left join public.channels ch
    on ch.id = b.channel_id and ch.property_id = b.property_id
  left join lateral (
    select sum(fb.outstanding_cents) as outstanding
    from public.folio_balances fb
    where fb.booking_id = b.id and fb.property_id = b.property_id
  ) bal on true
  where br.property_id = public.current_property_id()
    and br.status = 'checked_in'
    and br.check_in <= bd.business_date
    and br.check_out > bd.business_date
  order by
    nullif(regexp_replace(coalesce(r.number, ''), '\D', '', 'g'), '')::bigint nulls last,
    r.number,
    b.reference;
$$;

revoke all on function public.booking_report(date, date) from public, anon;
revoke all on function public.booking_report_by_channel(date, date) from public, anon;
revoke all on function public.reservations_report(date, date) from public, anon;
revoke all on function public.cancellation_report(date, date) from public, anon;
revoke all on function public.channel_report(date, date) from public, anon;
revoke all on function public.housekeeping_summary() from public, anon;
revoke all on function public.housekeeping_rooms(integer, text, integer, integer) from public, anon;
revoke all on function public.in_house_report() from public, anon;

grant execute on function public.booking_report(date, date) to authenticated;
grant execute on function public.booking_report_by_channel(date, date) to authenticated;
grant execute on function public.reservations_report(date, date) to authenticated;
grant execute on function public.cancellation_report(date, date) to authenticated;
grant execute on function public.channel_report(date, date) to authenticated;
grant execute on function public.housekeeping_summary() to authenticated;
grant execute on function public.housekeeping_rooms(integer, text, integer, integer) to authenticated;
grant execute on function public.in_house_report() to authenticated;
