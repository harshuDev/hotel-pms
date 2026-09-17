-- Layer 9: the night audit.
--
-- The business date has had no way to advance. It is the hotel's operating
-- day, all operational reporting groups by it, and nothing was rolling it
-- forward — nor posting the room charges that a night's stay earns.
--
-- Closing a day does three things, together or not at all:
--   1. posts each in-house room's charge for that night
--   2. closes the day
--   3. opens the next one
--
-- What it deliberately does NOT do is mark unarrived bookings as no-shows.
-- Writing off a reservation's revenue is a policy decision, not a mechanical
-- one, and nothing in the brief says which way this hotel wants it.

create function public.close_business_date()
returns table (
  closed_date date,
  next_date date,
  room_charges_posted integer,
  room_charges_cents bigint
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_bd public.business_dates;
  v_open_shifts integer;
  v_posted integer := 0;
  v_cents bigint := 0;
  v_folio uuid;
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
    format('Business date %s closed, %s room charge(s) posted',
           v_bd.business_date, v_posted),
    jsonb_build_object(
      'closed_date', v_bd.business_date,
      'next_date', v_bd.business_date + 1,
      'room_charges_posted', v_posted,
      'room_charges_cents', v_cents
    )
  );

  return query
  select v_bd.business_date, (v_bd.business_date + 1)::date, v_posted, v_cents;
end;
$$;

comment on function public.close_business_date() is
  'Night audit: posts the night''s room charges, closes the open business date and opens the next.';

revoke all on function public.close_business_date() from public, anon;
grant execute on function public.close_business_date() to authenticated;
