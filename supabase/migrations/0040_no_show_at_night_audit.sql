-- 0039: the night audit records no-shows and charges the first night.
--
-- Open decision 11 is now taken. close_business_date() has always left an
-- unarrived booking alone, so a guest who never turned up stayed `confirmed`
-- for ever and held their rooms until somebody cancelled by hand. Every night
-- that went by was a room the hotel could not sell and did not bill.
--
-- What the audit now does, for every `confirmed` booking whose arrival date has
-- been reached and which nobody checked in:
--
--   * cancel_booking(..., p_no_show => true), which is the existing path and
--     already sets the booking, its rooms and its nights to `no_show` and drops
--     the room assignment. Every availability query excludes `no_show`, so the
--     inventory goes back on sale. Reusing it rather than writing a second
--     release is the point: one place decides what releasing a booking means.
--   * posts the first night as a fee on the folio.
--
-- `pending` is deliberately not swept. A pending booking is unconfirmed — the
-- guest booking page creates them — and billing somebody for a stay the hotel
-- never confirmed is not a no-show, it is a mistake.
--
-- The fee is `miscellaneous` and not `room_charge`. That is not a preference:
-- post_charge() refuses room_charge outright, because a room charge belongs to
-- a night somebody occupied and is keyed to booking_room_night_id by a unique
-- index. A no-show fee has no such night — the night is `no_show` and the
-- occupancy report excludes it. Posting it as room revenue would put room
-- revenue against a room nobody slept in and quietly break the tie between the
-- financial report and the occupancy report. It lands in the extras bucket,
-- which is where a fee belongs.
--
-- The amount is the arrival night exactly: rate less discount as the net, and
-- the night's own tax as the tax, summed across every room on the booking. A
-- two-room booking is charged two rooms.
--
-- Whether a no-show fee is VATable is a question for the hotel's accountant,
-- not for this migration. It currently carries the same tax the night carried.
-- If the answer is that it should not, that is a change here.
--
-- A booking with no rate loaded is marked no-show and charged nothing. There is
-- nothing to bill, and inventing a figure would be worse than billing nothing.

drop function if exists public.close_business_date();

create function public.close_business_date()
returns table(
  closed_date date,
  next_date date,
  room_charges_posted integer,
  room_charges_cents bigint,
  no_shows_marked integer,
  no_show_fees_cents bigint
)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_property uuid;
  v_bd public.business_dates;
  v_open_shifts integer;
  v_posted integer := 0;
  v_cents bigint := 0;
  v_no_shows integer := 0;
  v_fees bigint := 0;
  v_folio uuid;
  v_net bigint;
  v_tax bigint;
  r record;
begin
  if public.current_role() not in ('admin', 'manager') then
    raise exception 'Only an administrator or manager may close the business date';
  end if;

  v_property := public.current_property_id();

  select * into v_bd
  from public.business_dates
  where property_id = v_property and status = 'open'
  for update;

  if not found then
    raise exception 'There is no open business date to close';
  end if;

  -- A shift belongs to a business date, and a cash payment must land on an
  -- open one. Closing the day under an open drawer would strand that shift:
  -- it could never take another cash payment, and its float would sit on a
  -- day that is already shut.
  select count(*) into v_open_shifts
  from public.cashier_shifts
  where property_id = v_property
    and business_date_id = v_bd.id
    and status in ('open', 'closing');

  if v_open_shifts > 0 then
    raise exception
      'Close the % open cashier shift(s) before closing the business date',
      v_open_shifts;
  end if;

  -- No-shows first. They cannot collide with the room charges below: that loop
  -- only posts nights already `checked_in`, and these are `confirmed`, so no
  -- booking is touched by both. Doing them first means the released rooms are
  -- free from the moment the day rolls.
  --
  -- `<=` rather than `=` on the arrival date so a backlog cannot accumulate
  -- silently. Run daily there is never more than one day's worth; run for the
  -- first time against an old open date, it sweeps what was missed.
  for r in
    select b.id, b.reference, b.check_in
    from public.bookings b
    where b.property_id = v_property
      and b.status = 'confirmed'
      and b.check_in <= v_bd.business_date
    order by b.reference
  loop
    -- Read the arrival night before releasing it. cancel_booking() moves the
    -- night to `no_show` but leaves its money alone, so either order would
    -- give the same figure; taking it first says which figure is meant.
    select
      coalesce(sum(n.room_rate_cents - n.discount_cents), 0)::bigint,
      coalesce(sum(n.tax_cents), 0)::bigint
    into v_net, v_tax
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    where br.booking_id = r.id
      and n.property_id = v_property
      and n.stay_date = r.check_in
      and n.status not in ('canceled', 'no_show');

    perform public.cancel_booking(
      r.id,
      true,
      format('No-show recorded by the night audit closing %s', v_bd.business_date)
    );

    v_no_shows := v_no_shows + 1;

    if v_net > 0 then
      select f.id into v_folio
      from public.folios f
      where f.booking_id = r.id
        and f.property_id = v_property
        and f.status = 'open'
      order by f.is_primary desc, f.folio_number
      limit 1;

      if v_folio is null then
        raise exception
          'Booking % has no open folio, so its no-show fee for % cannot be posted',
          r.reference, r.check_in;
      end if;

      perform public.post_charge(
        v_folio,
        'miscellaneous',
        format('No-show fee for %s (first night)', r.check_in),
        v_net,
        1,
        v_tax,
        null,
        v_bd.business_date
      );

      v_fees := v_fees + v_net + v_tax;
    end if;
  end loop;

  -- One room charge per room per night. The not-exists keeps a retried audit
  -- from double-charging, and the unique index behind it is the real guard.
  for r in
    select
      n.id as night_id,
      br.booking_id,
      b.reference,
      n.room_rate_cents,
      n.tax_cents,
      n.discount_cents
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    join public.bookings b
      on b.id = br.booking_id and b.property_id = br.property_id
    where n.property_id = v_property
      and n.stay_date = v_bd.business_date
      and n.status = 'checked_in'
      and not exists (
        select 1
        from public.folio_items fi
        where fi.booking_room_night_id = n.id
          and fi.item_type = 'room_charge'
          and fi.reverses_id is null
      )
    order by b.reference
  loop
    select f.id into v_folio
    from public.folios f
    where f.booking_id = r.booking_id
      and f.property_id = v_property
      and f.status = 'open'
    order by f.is_primary desc, f.folio_number
    limit 1;

    if v_folio is null then
      raise exception
        'Booking % has no open folio, so its room charge for % cannot be posted',
        r.reference, v_bd.business_date;
    end if;

    perform public.post_room_charge(v_folio, r.night_id, v_bd.business_date);

    v_posted := v_posted + 1;
    v_cents := v_cents + (r.room_rate_cents - r.discount_cents + r.tax_cents);
  end loop;

  update public.business_dates
  set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = v_bd.id;

  insert into public.business_dates (property_id, business_date, status, opened_by)
  values (v_property, v_bd.business_date + 1, 'open', auth.uid());

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'business_date', v_bd.id, 'business_date_closed',
    format('Business date %s closed, %s room charge(s) posted, %s no-show(s)',
           v_bd.business_date, v_posted, v_no_shows),
    jsonb_build_object(
      'closed_date', v_bd.business_date,
      'next_date', v_bd.business_date + 1,
      'room_charges_posted', v_posted,
      'room_charges_cents', v_cents,
      'no_shows_marked', v_no_shows,
      'no_show_fees_cents', v_fees
    )
  );

  return query
  select
    v_bd.business_date,
    (v_bd.business_date + 1)::date,
    v_posted,
    v_cents,
    v_no_shows,
    v_fees;
end;
$function$;

revoke all on function public.close_business_date() from public;
grant execute on function public.close_business_date() to authenticated;
