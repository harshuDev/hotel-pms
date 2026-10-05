-- 0132: a late guest can be checked in on the dates they booked.
--
-- The client could not check in BK-000047 (Kabil K, one night, 4-5 Oct):
-- "The check-in did not go through: Booking BK-000047 was due to leave on
-- 5 Oct 2026, so it cannot be checked in. Change its dates first."
--
-- What happened: the booking was taken at 10:54 UTC on 4 Oct for that
-- night, and 4 Oct was closed eleven minutes later, at 11:05 -- so the
-- business date became 5 Oct, the booking's departure day, before the guest
-- was checked in. check_in_booking() (0112) refuses a stay whose departure
-- has been reached, and its only override moves the ARRIVAL to today, which
-- on a one-night stay would leave no nights at all.
--
-- 0112's reason for refusing past dates no longer holds. It was written when
-- the night audit charged each night as it closed it, so a guest checked in
-- after their arrival night was never charged for it. Since 0125 every night
-- is charged at CHECK-OUT -- check_out_booking() posts each night slept
-- before the open business date that has no room charge -- so a guest checked
-- in on their booked dates, however late, is charged for every night.
--
-- So:
-- 1. check_in_booking_core(): the check-in, with one decision about a stay
--    whose arrival has passed -- 'refuse' (say so, as before), 'move' (the
--    arrival to today, as 0112's override) or 'keep' (check in on the booked
--    dates). Granted to nobody; the two functions below are the way in.
-- 2. check_in_booking(booking, move_arrival): unchanged for every caller.
--    A past arrival is still refused with HP004 and offers both overrides
--    now; a departure already reached is refused with HP005, whose only
--    override is the booked dates -- moving the arrival could not help it.
-- 3. check_in_booking_as_booked(booking): the new override.
--
-- Nothing is charged at check-in, as before. A guest checked in after their
-- departure date reads as due out (or overdue) at once, which is true, and is
-- charged their nights when they are checked out.

create or replace function public.check_in_booking_core(
  p_booking_id uuid,
  p_past text
)
returns table (rooms_occupied integer)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_today date;
  v_unassigned integer;
  v_count integer;
  v_in record;
  v_br uuid;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may check a guest in';
  end if;

  if p_past not in ('refuse', 'move', 'keep') then
    raise exception 'Unknown way to check in a late arrival';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and property_id = public.current_property_id()
  for update;

  if not found then
    raise exception 'That booking does not belong to this property';
  end if;

  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Booking % is %, so it cannot be checked in', v_booking.reference, v_booking.status;
  end if;

  v_today := public.open_business_date(v_booking.property_id);
  if v_today is null then
    raise exception 'There is no open business date';
  end if;

  if v_booking.check_in > v_today then
    raise exception 'Booking % arrives on %, which is after the business date',
      v_booking.reference, v_booking.check_in;
  end if;

  -- A late arrival. Kept dates are charged at check-out (0125); a moved
  -- arrival goes through update_booking(), as every date change does.
  if v_booking.check_in < v_today and p_past <> 'keep' then
    if v_booking.check_out <= v_today then
      raise exception 'Booking % was due to leave on %. Check the guest in on the booked dates, or change the dates first.',
        v_booking.reference, to_char(v_booking.check_out, 'FMDD Mon YYYY')
        using errcode = 'HP005';
    end if;

    if p_past = 'refuse' then
      raise exception 'Booking % was due to arrive on %. Check the guest in on the booked dates, or move the arrival to today.',
        v_booking.reference, to_char(v_booking.check_in, 'FMDD Mon YYYY')
        using errcode = 'HP004';
    end if;

    perform public.update_booking(p_booking_id => v_booking.id, p_check_in => v_today);

    select * into v_booking from public.bookings where id = v_booking.id;
  end if;

  select count(*) into v_unassigned
  from public.booking_rooms
  where booking_id = v_booking.id
    and property_id = v_booking.property_id
    and status not in ('canceled', 'no_show')
    and room_id is null;

  if v_unassigned > 0 then
    raise exception 'Booking % still needs % room(s) assigned', v_booking.reference, v_unassigned;
  end if;

  -- Somebody still in one of the rooms (0112). Named, as assign_room() does.
  select r.number,
         b.reference,
         coalesce(public.customer_display_name(c), 'No name recorded') as guest,
         other.check_out
    into v_in
  from public.booking_rooms mine
  join public.rooms r on r.id = mine.room_id and r.property_id = mine.property_id
  join public.booking_rooms other
    on other.room_id = mine.room_id
   and other.property_id = mine.property_id
   and other.booking_id <> mine.booking_id
   and other.status = 'checked_in'
  join public.bookings b on b.id = other.booking_id and b.property_id = other.property_id
  left join public.customers c on c.id = b.customer_id and c.property_id = b.property_id
  where mine.booking_id = v_booking.id
    and mine.property_id = v_booking.property_id
    and mine.status not in ('canceled', 'no_show')
  order by r.number
  limit 1;

  if found then
    raise exception 'Room % still has % (%) checked in, due out %. Check them out first.',
      v_in.number, v_in.guest, v_in.reference, to_char(v_in.check_out, 'FMDD Mon YYYY');
  end if;

  update public.bookings set status = 'checked_in' where id = v_booking.id;

  update public.rooms rm
  set status = 'occupied'
  from public.booking_rooms br
  where br.booking_id = v_booking.id
    and br.property_id = v_booking.property_id
    and br.status not in ('canceled', 'no_show')
    and br.room_id = rm.id
    and rm.property_id = v_booking.property_id;

  get diagnostics v_count = row_count;

  -- Extras the rate sells "at check-in" (0118).
  for v_br in
    select br.id from public.booking_rooms br
    where br.booking_id = v_booking.id
      and br.property_id = v_booking.property_id
      and br.status not in ('canceled', 'no_show')
  loop
    perform public.post_rate_plan_extras(v_br, 'check_in');
  end loop;

  return query select v_count;
end;
$$;

create or replace function public.check_in_booking(
  p_booking_id uuid,
  p_move_arrival boolean default false
)
returns table (rooms_occupied integer)
language sql
security definer
set search_path = public, auth
as $$
  select * from public.check_in_booking_core(
    p_booking_id,
    case when coalesce(p_move_arrival, false) then 'move' else 'refuse' end
  );
$$;

create or replace function public.check_in_booking_as_booked(p_booking_id uuid)
returns table (rooms_occupied integer)
language sql
security definer
set search_path = public, auth
as $$
  select * from public.check_in_booking_core(p_booking_id, 'keep');
$$;

revoke all on function public.check_in_booking_core(uuid, text) from public;
revoke execute on function public.check_in_booking_core(uuid, text) from anon, authenticated;

revoke all on function public.check_in_booking_as_booked(uuid) from public;
revoke execute on function public.check_in_booking_as_booked(uuid) from anon;
grant execute on function public.check_in_booking_as_booked(uuid) to authenticated;
