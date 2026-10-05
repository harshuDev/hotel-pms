-- 0126: fix check_out_booking() from 0125. Its loop variable was named `r`,
-- which shadows the `rooms r` alias in the update that dirties the room, so
-- every check-out raised "record r has no field id". Caught by the rolled-back
-- test straight after 0125 was applied. The loop variable is now v_n; nothing
-- else changes.

create or replace function public.check_out_booking(p_booking_id uuid)
returns table (rooms_released integer, outstanding_cents bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_count integer;
  v_owed bigint;
  v_br uuid;
  v_today date;
  v_folio uuid;
  v_n record;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may check a guest out';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and property_id = public.current_property_id()
  for update;

  if not found then
    raise exception 'That booking does not belong to this property';
  end if;

  if v_booking.status <> 'checked_in' then
    raise exception 'Booking % is %, so it cannot be checked out', v_booking.reference, v_booking.status;
  end if;

  v_today := public.open_business_date(v_booking.property_id);
  if v_today is null then
    raise exception 'There is no open business date';
  end if;

  -- The stay's room charges (0125), every night slept and not yet charged.
  for v_n in
    select n.id as night_id, n.booking_room_id, n.stay_date
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    where br.booking_id = v_booking.id
      and n.property_id = v_booking.property_id
      and n.status = 'checked_in'
      and n.stay_date < v_today
      and not exists (
        select 1 from public.folio_items fi
        where fi.booking_room_night_id = n.id
          and fi.item_type = 'room_charge'
          and fi.reverses_id is null
      )
    order by n.stay_date, n.booking_room_id
  loop
    if v_folio is null then
      select f.id into v_folio
      from public.folios f
      where f.booking_id = v_booking.id
        and f.property_id = v_booking.property_id
        and f.status = 'open'
      order by f.is_primary desc, f.folio_number
      limit 1;
      if v_folio is null then
        raise exception 'Booking % has no open folio, so its room charges cannot be posted', v_booking.reference;
      end if;
    end if;

    begin
      perform public.post_room_charge(v_folio, v_n.night_id, v_today);
      perform public.post_rate_plan_extras(v_n.booking_room_id, 'each_night', v_n.stay_date);
    exception when raise_exception then
      raise exception 'Booking %: %', v_booking.reference, sqlerrm;
    end;
  end loop;

  -- Extras the rate sells "at check-out" (0118), before the balance is read.
  for v_br in
    select br.id from public.booking_rooms br
    where br.booking_id = v_booking.id
      and br.property_id = v_booking.property_id
      and br.status not in ('canceled', 'no_show')
  loop
    perform public.post_rate_plan_extras(v_br, 'check_out');
  end loop;

  update public.bookings set status = 'checked_out' where id = v_booking.id;

  -- A room a guest has just left is dirty, never ready -- unless another guest
  -- is still checked in to it, whose room it still is (0112).
  update public.rooms r
  set status = 'vacant_dirty'
  from public.booking_rooms br
  where br.booking_id = v_booking.id
    and br.property_id = v_booking.property_id
    and br.room_id = r.id
    and r.property_id = v_booking.property_id
    and not exists (
      select 1 from public.booking_rooms other
      where other.room_id = r.id
        and other.property_id = r.property_id
        and other.booking_id <> v_booking.id
        and other.status = 'checked_in'
    );

  get diagnostics v_count = row_count;

  select coalesce(sum(greatest(fb.outstanding_cents, 0)), 0) into v_owed
  from public.folio_balances fb
  where fb.booking_id = v_booking.id
    and fb.property_id = v_booking.property_id;

  return query select v_count, v_owed;
end;
$$;
