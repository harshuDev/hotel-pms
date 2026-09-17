-- Layer 16: one booking, read and changed.
--
-- Until now a booking could be taken and then never opened again. Every list
-- row was a dead end, and the only way to change anything was through the
-- tables. This is the screen behind the reference.
--
-- What editing a booking may and may not do follows from rules already in the
-- schema rather than from taste:
--
--   Posted money is never touched. folio_items and payments are append-only,
--   so shortening a stay does not un-charge a night that has already been
--   posted by the night audit. The charge stands and is reversed deliberately
--   if it should not.
--
--   Arrival cannot move once the guest has arrived. Departure can, because
--   extending an in-house stay is the single most common change a front desk
--   makes. sync_booking_room_nights() already adds and removes only the nights
--   that actually changed and leaves the rates on the rest alone.
--
--   A room that has been assigned or checked into is not simply deleted off a
--   booking. Release the room first; that is a separate, visible act.

create function public.booking_detail(p_booking_id uuid)
returns table (
  booking_id uuid,
  reference text,
  status public.booking_status,
  settlement public.booking_settlement,
  customer_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  channel_id uuid,
  channel_name text,
  check_in date,
  check_out date,
  nights integer,
  adults integer,
  children integer,
  arrival_time time,
  departure_time time,
  guest_notes text,
  internal_notes text,
  external_reference text,
  booked_on date,
  booked_by text,
  room_count bigint,
  rooms_assigned bigint,
  reservation_value_cents bigint,
  charges_cents bigint,
  payments_cents bigint,
  balance_cents bigint,
  business_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    b.id,
    b.reference,
    b.status,
    b.settlement,
    b.customer_id,
    public.customer_display_name(c),
    c.email,
    c.phone,
    b.channel_id,
    ch.name,
    b.check_in,
    b.check_out,
    greatest((b.check_out - b.check_in), 0)::integer,
    b.adults,
    b.children,
    b.arrival_time,
    b.departure_time,
    b.guest_notes,
    b.internal_notes,
    b.external_reference,
    (b.booked_at at time zone p.timezone)::date,
    su.full_name,
    coalesce(r.room_count, 0)::bigint,
    coalesce(r.rooms_assigned, 0)::bigint,
    coalesce(r.value_cents, 0)::bigint,
    coalesce(bal.charges, 0)::bigint,
    coalesce(bal.payments, 0)::bigint,
    coalesce(bal.outstanding, 0)::bigint,
    bd.business_date
  from public.bookings b
  join public.properties p on p.id = b.property_id
  left join public.business_dates bd
    on bd.property_id = b.property_id and bd.status = 'open'
  left join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  left join public.channels ch
    on ch.id = b.channel_id and ch.property_id = b.property_id
  left join public.staff_users su
    on su.id = b.created_by and su.property_id = b.property_id
  left join lateral (
    select
      count(distinct br.id) as room_count,
      count(distinct br.id) filter (where br.room_id is not null) as rooms_assigned,
      sum(n.room_rate_cents - n.discount_cents) as value_cents
    from public.booking_rooms br
    left join public.booking_room_nights n
      on n.booking_room_id = br.id and n.property_id = br.property_id
    where br.booking_id = b.id and br.property_id = b.property_id
  ) r on true
  left join lateral (
    select
      sum(fb.total_charges_cents) as charges,
      sum(fb.total_payments_cents) as payments,
      sum(fb.outstanding_cents) as outstanding
    from public.folio_balances fb
    where fb.booking_id = b.id and fb.property_id = b.property_id
  ) bal on true
  where b.id = p_booking_id
    and b.property_id = public.current_property_id();
$$;

-- The rooms on a booking, each with what it is worth and whether any of its
-- nights have already been charged. That last figure is what tells a
-- receptionist whether shortening the stay is tidy or messy.
create function public.booking_room_lines(p_booking_id uuid)
returns table (
  booking_room_id uuid,
  room_type_id uuid,
  room_type_name text,
  room_id uuid,
  room_number text,
  status public.booking_status,
  check_in date,
  check_out date,
  nights integer,
  adults integer,
  children integer,
  value_cents bigint,
  tax_cents bigint,
  discount_cents bigint,
  nights_charged bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    br.id,
    br.room_type_id,
    rt.name,
    br.room_id,
    r.number,
    br.status,
    br.check_in,
    br.check_out,
    greatest((br.check_out - br.check_in), 0)::integer,
    br.adults,
    br.children,
    coalesce(n.value_cents, 0)::bigint,
    coalesce(n.tax_cents, 0)::bigint,
    coalesce(n.discount_cents, 0)::bigint,
    coalesce(n.charged, 0)::bigint
  from public.booking_rooms br
  join public.room_types rt
    on rt.id = br.room_type_id and rt.property_id = br.property_id
  left join public.rooms r
    on r.id = br.room_id and r.property_id = br.property_id
  left join lateral (
    select
      sum(bn.room_rate_cents - bn.discount_cents) as value_cents,
      sum(bn.tax_cents) as tax_cents,
      sum(bn.discount_cents) as discount_cents,
      count(*) filter (
        where exists (
          select 1 from public.folio_items fi
          where fi.booking_room_night_id = bn.id
            and fi.property_id = bn.property_id
            and fi.reverses_id is null
        )
      ) as charged
    from public.booking_room_nights bn
    where bn.booking_room_id = br.id and bn.property_id = br.property_id
  ) n on true
  where br.booking_id = p_booking_id
    and br.property_id = public.current_property_id()
  order by r.number nulls last, rt.name, br.id;
$$;

-- Night by night, so a guest querying "why is Friday more" has an answer.
create function public.booking_nights(p_booking_id uuid)
returns table (
  booking_room_id uuid,
  room_type_name text,
  room_number text,
  stay_date date,
  room_rate_cents bigint,
  tax_cents bigint,
  discount_cents bigint,
  status public.booking_status,
  charged boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    br.id,
    rt.name,
    r.number,
    bn.stay_date,
    bn.room_rate_cents,
    bn.tax_cents,
    bn.discount_cents,
    bn.status,
    exists (
      select 1 from public.folio_items fi
      where fi.booking_room_night_id = bn.id
        and fi.property_id = bn.property_id
        and fi.reverses_id is null
    )
  from public.booking_room_nights bn
  join public.booking_rooms br
    on br.id = bn.booking_room_id and br.property_id = bn.property_id
  join public.room_types rt
    on rt.id = br.room_type_id and rt.property_id = br.property_id
  left join public.rooms r
    on r.id = br.room_id and r.property_id = br.property_id
  where br.booking_id = p_booking_id
    and br.property_id = public.current_property_id()
  order by r.number nulls last, br.id, bn.stay_date;
$$;

-- The folio as a guest would read it: charges and payments in one list, in the
-- order they were posted, with the running balance left to the caller because
-- a folio can be split and a running total across two of them means nothing.
create function public.booking_folio_lines(p_booking_id uuid)
returns table (
  line_id uuid,
  folio_id uuid,
  folio_number bigint,
  business_date date,
  posted_at timestamptz,
  kind text,
  description text,
  is_reversal boolean,
  amount_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.folio_id,
    f.folio_number,
    l.business_date,
    l.posted_at,
    'charge'::text,
    l.description,
    l.is_reversal,
    l.signed_amount_cents
  from public.folio_item_lines l
  join public.folios f on f.id = l.folio_id and f.property_id = l.property_id
  where l.booking_id = p_booking_id
    and l.property_id = public.current_property_id()

  union all

  select
    p.id,
    p.folio_id,
    f.folio_number,
    p.business_date,
    p.paid_at,
    'payment'::text,
    pm.name,
    (p.reverses_id is not null),
    p.signed_amount_cents
  from public.payments p
  join public.folios f on f.id = p.folio_id and f.property_id = p.property_id
  join public.payment_methods pm
    on pm.id = p.payment_method_id and pm.property_id = p.property_id
  where p.booking_id = p_booking_id
    and p.property_id = public.current_property_id()

  -- Business date first: a folio is read day by day, and posted_at is the
  -- same instant for everything written in one transaction, so it can only
  -- ever be the tiebreak.
  order by 4, 5, 1;
$$;

create function public.booking_activity(p_booking_id uuid)
returns table (
  activity_id uuid,
  action text,
  summary text,
  actor text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    al.id,
    al.action,
    al.summary,
    su.full_name,
    al.created_at
  from public.activity_log al
  left join public.staff_users su
    on su.id = al.actor_id and su.property_id = al.property_id
  where al.property_id = public.current_property_id()
    and (
      (al.entity_type = 'booking' and al.entity_id = p_booking_id)
      or (
        al.entity_type = 'booking_room'
        and al.entity_id in (
          select br.id from public.booking_rooms br
          where br.booking_id = p_booking_id
            and br.property_id = al.property_id
        )
      )
    )
  order by al.created_at desc;
$$;

revoke all on function public.booking_detail(uuid) from public, anon;
revoke all on function public.booking_room_lines(uuid) from public, anon;
revoke all on function public.booking_nights(uuid) from public, anon;
revoke all on function public.booking_folio_lines(uuid) from public, anon;
revoke all on function public.booking_activity(uuid) from public, anon;

grant execute on function public.booking_detail(uuid) to authenticated;
grant execute on function public.booking_room_lines(uuid) to authenticated;
grant execute on function public.booking_nights(uuid) to authenticated;
grant execute on function public.booking_folio_lines(uuid) to authenticated;
grant execute on function public.booking_activity(uuid) to authenticated;


-- Changing a booking ----------------------------------------------------------

create function public.update_booking(
  p_booking_id uuid,
  p_check_in date default null,
  p_check_out date default null,
  p_adults integer default null,
  p_children integer default null,
  p_channel_id uuid default null,
  p_settlement public.booking_settlement default null,
  p_arrival_time time default null,
  p_departure_time time default null,
  p_guest_notes text default null,
  p_internal_notes text default null,
  p_external_reference text default null,
  p_allow_overbook boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_booking public.bookings;
  v_check_in date;
  v_check_out date;
  v_charged date;
  v_line record;
  v_available bigint;
  v_type_name text;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can change a booking';
  end if;

  v_property := public.current_property_id();

  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = v_property;
  if not found then
    raise exception 'That booking is not on this property';
  end if;

  if v_booking.status in ('canceled', 'no_show', 'checked_out') then
    raise exception
      'Booking % is %, so it can no longer be changed',
      v_booking.reference, replace(v_booking.status::text, '_', ' ');
  end if;

  v_check_in := coalesce(p_check_in, v_booking.check_in);
  v_check_out := coalesce(p_check_out, v_booking.check_out);

  if v_check_out <= v_check_in then
    raise exception 'The departure date must be after the arrival date';
  end if;

  -- Once the guest is here, the arrival date is history. The departure date is
  -- not: extending a stay is the commonest change a front desk makes.
  if v_booking.status = 'checked_in' and v_check_in <> v_booking.check_in then
    raise exception
      'Booking % has already checked in, so the arrival date cannot move',
      v_booking.reference;
  end if;

  -- A night the night audit has already charged cannot be taken off the
  -- booking, because the charge is posted and folio items are append-only.
  -- Reverse the charge first if it genuinely should not stand.
  select bn.stay_date into v_charged
  from public.booking_room_nights bn
  join public.booking_rooms br
    on br.id = bn.booking_room_id and br.property_id = bn.property_id
  where br.booking_id = p_booking_id
    and br.property_id = v_property
    and (bn.stay_date < v_check_in or bn.stay_date >= v_check_out)
    and exists (
      select 1 from public.folio_items fi
      where fi.booking_room_night_id = bn.id
        and fi.property_id = bn.property_id
        and fi.reverses_id is null
    )
  order by bn.stay_date
  limit 1;

  if v_charged is not null then
    raise exception
      '% has already been charged to the folio, so it cannot be dropped from the stay. Reverse the charge first.',
      to_char(v_charged, 'FMDay FMDD Mon');
  end if;

  -- Only extra nights need checking, and only against the nights being added.
  if not p_allow_overbook and (v_check_in < v_booking.check_in or v_check_out > v_booking.check_out) then
    for v_line in
      select br.room_type_id, count(*) as quantity
      from public.booking_rooms br
      where br.booking_id = p_booking_id and br.property_id = v_property
        and br.status not in ('canceled', 'no_show')
      group by br.room_type_id
    loop
      select b.available, b.name into v_available, v_type_name
      from public.bookable_room_types(v_check_in, v_check_out) b
      where b.room_type_id = v_line.room_type_id;

      -- This booking's own rooms are already counted as sold over the nights
      -- it already held, so only the shortfall on the new nights matters.
      if coalesce(v_available, 0) < 0 then
        raise exception
          '% is already oversold over these dates. Tick overbook to extend anyway.',
          v_type_name
          using errcode = 'HP001';
      end if;
    end loop;
  end if;

  update public.bookings set
    check_in = v_check_in,
    check_out = v_check_out,
    adults = greatest(coalesce(p_adults, adults), 1),
    children = greatest(coalesce(p_children, children), 0),
    channel_id = coalesce(p_channel_id, channel_id),
    settlement = coalesce(p_settlement, settlement),
    arrival_time = coalesce(p_arrival_time, arrival_time),
    departure_time = coalesce(p_departure_time, departure_time),
    guest_notes = coalesce(nullif(btrim(coalesce(p_guest_notes, '')), ''), guest_notes),
    internal_notes = coalesce(nullif(btrim(coalesce(p_internal_notes, '')), ''), internal_notes),
    external_reference = coalesce(nullif(btrim(coalesce(p_external_reference, '')), ''), external_reference)
  where id = p_booking_id and property_id = v_property;

  -- The rooms follow the booking. sync_booking_room_nights() then adds and
  -- removes only the nights that actually changed and leaves the rates on the
  -- rest alone, which is why a date change does not silently re-price a stay.
  update public.booking_rooms set
    check_in = v_check_in,
    check_out = v_check_out
  where booking_id = p_booking_id and property_id = v_property
    and status not in ('canceled', 'no_show');

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'booking', p_booking_id, 'booking_changed',
    format('Booking %s changed', v_booking.reference),
    jsonb_build_object(
      'reference', v_booking.reference,
      'check_in', v_check_in,
      'check_out', v_check_out
    )
  );
end;
$$;

-- Nights added by an extension come in at zero, because no rate plan was named
-- and nothing should invent a price. This is how they get one.
create function public.set_booking_room_rate(
  p_booking_room_id uuid,
  p_rate_cents bigint,
  p_from date default null,
  p_to date default null,
  p_tax_rate_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_room public.booking_rooms;
  v_net bigint;
  v_tax bigint;
  v_count integer;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can change a rate';
  end if;

  v_property := public.current_property_id();

  select * into v_room from public.booking_rooms
  where id = p_booking_room_id and property_id = v_property;
  if not found then
    raise exception 'That room is not on a booking for this property';
  end if;

  if p_rate_cents is null or p_rate_cents < 0 then
    raise exception 'A nightly rate cannot be negative';
  end if;

  if p_tax_rate_id is not null then
    select t.net_cents, t.tax_cents into v_net, v_tax
    from public.apply_tax_rate(p_tax_rate_id, p_rate_cents) t;
  else
    v_net := p_rate_cents;
    v_tax := 0;
  end if;

  -- A night already charged keeps its rate. The folio is what the guest owes,
  -- and changing the night underneath it would put the two out of step.
  update public.booking_room_nights bn
  set room_rate_cents = v_net, tax_cents = v_tax
  where bn.booking_room_id = p_booking_room_id
    and bn.property_id = v_property
    and (p_from is null or bn.stay_date >= p_from)
    and (p_to is null or bn.stay_date <= p_to)
    and not exists (
      select 1 from public.folio_items fi
      where fi.booking_room_night_id = bn.id
        and fi.property_id = bn.property_id
        and fi.reverses_id is null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.cancel_booking(
  p_booking_id uuid,
  p_no_show boolean default false,
  p_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_booking public.bookings;
  v_outstanding bigint;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can cancel a booking';
  end if;

  v_property := public.current_property_id();

  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = v_property;
  if not found then
    raise exception 'That booking is not on this property';
  end if;

  if v_booking.status in ('canceled', 'no_show') then
    raise exception 'Booking % is already cancelled', v_booking.reference;
  end if;

  if v_booking.status = 'checked_out' then
    raise exception 'Booking % has already departed', v_booking.reference;
  end if;

  if v_booking.status = 'checked_in' then
    raise exception
      'Booking % is in house. Check the guest out rather than cancelling',
      v_booking.reference;
  end if;

  -- A cancellation fee is a real thing, so a balance does not stop this. It is
  -- returned instead, because somebody still has to chase it.
  select coalesce(sum(fb.outstanding_cents), 0) into v_outstanding
  from public.folio_balances fb
  where fb.booking_id = p_booking_id and fb.property_id = v_property;

  update public.bookings
  set status = case when coalesce(p_no_show, false) then 'no_show' else 'canceled' end,
      internal_notes = case
        when nullif(btrim(coalesce(p_reason, '')), '') is null then internal_notes
        else coalesce(internal_notes || E'\n', '') || btrim(p_reason)
      end
  where id = p_booking_id and property_id = v_property;

  -- The rooms and their nights come off the house, which is what frees the
  -- inventory. booking_room_nights excludes canceled and no_show everywhere.
  update public.booking_rooms
  set status = case when coalesce(p_no_show, false) then 'no_show' else 'canceled' end,
      room_id = null
  where booking_id = p_booking_id and property_id = v_property;

  update public.booking_room_nights bn
  set status = case when coalesce(p_no_show, false) then 'no_show' else 'canceled' end
  from public.booking_rooms br
  where br.id = bn.booking_room_id
    and br.property_id = bn.property_id
    and br.booking_id = p_booking_id
    and bn.property_id = v_property;

  return v_outstanding;
end;
$$;

create function public.confirm_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_booking public.bookings;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can confirm a booking';
  end if;

  v_property := public.current_property_id();

  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = v_property;
  if not found then
    raise exception 'That booking is not on this property';
  end if;

  if v_booking.status <> 'pending' then
    raise exception
      'Booking % is %, not pending',
      v_booking.reference, replace(v_booking.status::text, '_', ' ');
  end if;

  update public.bookings set status = 'confirmed'
  where id = p_booking_id and property_id = v_property;

  update public.booking_rooms set status = 'confirmed'
  where booking_id = p_booking_id and property_id = v_property
    and status = 'pending';
end;
$$;

revoke all on function public.update_booking(
  uuid, date, date, integer, integer, uuid, public.booking_settlement,
  time, time, text, text, text, boolean
) from public, anon;
revoke all on function public.set_booking_room_rate(uuid, bigint, date, date, uuid)
  from public, anon;
revoke all on function public.cancel_booking(uuid, boolean, text) from public, anon;
revoke all on function public.confirm_booking(uuid) from public, anon;

grant execute on function public.update_booking(
  uuid, date, date, integer, integer, uuid, public.booking_settlement,
  time, time, text, text, text, boolean
) to authenticated;
grant execute on function public.set_booking_room_rate(uuid, bigint, date, date, uuid)
  to authenticated;
grant execute on function public.cancel_booking(uuid, boolean, text) to authenticated;
grant execute on function public.confirm_booking(uuid) to authenticated;
