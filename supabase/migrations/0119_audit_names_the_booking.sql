-- 0119: a refusal during the night audit names the booking.
--
-- close_business_date() posts every checked-in night in the house. When one
-- is refused -- what a rate includes priced above the night (0041, 0118), a
-- rule a function raises -- the message said what was wrong and not where,
-- and nothing else about the audit says which of a hundred rooms it was. The
-- same refusal now reads "Booking BK-000123: ...". Only our own raised
-- refusals are rewrapped; a database error keeps its own code and message.
-- Otherwise as 0118.

create or replace function public.close_business_date()
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
  -- coalesce, so a caller with no active staff row -- anonymous, or somebody
  -- deactivated since 0016 -- is refused rather than falling through a null.
  if not coalesce(public.current_role() in ('admin', 'manager'), false) then
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

  -- No no-show sweep (0064): a confirmed booking whose guest has not arrived
  -- is left as it is, and only `checked_in` nights are charged.

  for r in
    select
      n.id as night_id,
      n.booking_room_id,
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

    -- Whatever refuses a night names the booking it belongs to (0119):
    -- the audit posts every room in the house, and "the meals are worth more
    -- than the night" is no use without saying whose night.
    begin
      perform public.post_room_charge(v_folio, r.night_id, v_bd.business_date);

      -- Extras the rate sells "each night" (0118), with the night.
      perform public.post_rate_plan_extras(r.booking_room_id, 'each_night', v_bd.business_date);
    exception when raise_exception then
      raise exception 'Booking %: %', r.reference, sqlerrm;
    end;

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
  select
    v_bd.business_date,
    (v_bd.business_date + 1)::date,
    v_posted,
    v_cents;
end;
$$;
