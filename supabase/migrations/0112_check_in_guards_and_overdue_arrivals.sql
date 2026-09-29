-- 0112: four faults found auditing the hosted property after 0111.
--
-- 1. Two guests checked in to one room. BK-000010 was checked in to 202, 203,
--    205 and 103 while BK-000004 and BK-000016 were still checked in there past
--    their departures. check_in_booking() never asked whether the room already
--    had somebody in it, and assign_room()'s overlap test compares booked dates,
--    which an overdue guest no longer has.
-- 2. Checking one of them out marked the room vacant_dirty with the other still
--    in it: check_out_booking() dirtied every room on the booking, whoever else
--    was checked in there.
-- 3. A late check-in left its missed nights unbilled for ever. Check-in allowed
--    an arrival before the business date, and the night audit charges only the
--    night it closes, so BK-000016's 18 Sep and BK-000017's 23 and 24 Sep were
--    never charged -- and on BK-000011 and 012 somebody posted the first night
--    by hand as miscellaneous, outside occupancy and room revenue.
--    Check-in now refuses a past arrival (HP004) and offers, as a deliberate
--    second act like the overbook override, to move the arrival to today
--    through update_booking() -- the one path that changes a stay's dates. The
--    nights before today go, and they had not been charged, since the audit
--    charges only checked_in nights.
-- 4. Bookings whose arrival had passed and whose guest never came sat holding
--    their rooms with nothing on screen saying so. dashboard_arrivals() on the
--    business date now lists them too, as dashboard_departures() lists overdue
--    guests since 0111. Nothing marks a no-show automatically (open decision
--    11); the list is the prompt.

-- 1 and 3. check_in_booking(): a second parameter is a new signature, so drop
-- the old one first or PostgREST would have two to choose between.
drop function if exists public.check_in_booking(uuid);

create function public.check_in_booking(
  p_booking_id uuid,
  p_move_arrival boolean default false
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
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may check a guest in';
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

  -- A late arrival (0112). The audit charges only the night it closes, so
  -- checking in against a past arrival leaves every earlier night unbilled.
  if v_booking.check_in < v_today then
    if v_booking.check_out <= v_today then
      raise exception 'Booking % was due to leave on %, so it cannot be checked in. Change its dates first.',
        v_booking.reference, to_char(v_booking.check_out, 'FMDD Mon YYYY');
    end if;

    if not coalesce(p_move_arrival, false) then
      raise exception 'Booking % was due to arrive on %. Move the arrival to today to check the guest in.',
        v_booking.reference, to_char(v_booking.check_in, 'FMDD Mon YYYY')
        using errcode = 'HP004';
    end if;

    -- The same path the booking screen uses, so the nights, the rules about
    -- charged nights and the activity log are the ones every date change has.
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

  update public.rooms r
  set status = 'occupied'
  from public.booking_rooms br
  where br.booking_id = v_booking.id
    and br.property_id = v_booking.property_id
    and br.status not in ('canceled', 'no_show')
    and br.room_id = r.id
    and r.property_id = v_booking.property_id;

  get diagnostics v_count = row_count;
  return query select v_count;
end;
$$;

-- 2. check_out_booking(): a room is dirtied only when nobody else is checked in
-- to it. The signature is unchanged, so create or replace is safe.
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

-- 4. dashboard_arrivals(): today's arrivals, and on the business date also
-- every booking whose arrival has passed and whose guest never checked in.
create or replace function public.dashboard_arrivals(p_date date)
returns setof public.booking_totals
language sql
stable
security invoker
set search_path = public
as $$
  select t.*
  from public.booking_totals t
  where t.property_id = public.current_property_id()
    and (
      (t.check_in = p_date and t.status not in ('canceled', 'no_show'))
      or (
        t.status in ('pending', 'confirmed')
        and t.check_in < p_date
        and p_date = (
          select bd.business_date from public.business_dates bd
          where bd.property_id = public.current_property_id() and bd.status = 'open'
        )
      )
    )
  order by t.check_in, t.customer_name;
$$;

-- The one repair: a room with a guest checked in to it that fault 2 left
-- reading vacant. Only rooms in that exact state are touched.
update public.rooms r
set status = 'occupied'
where r.status <> 'occupied'
  and r.is_enabled
  and exists (
    select 1 from public.booking_rooms br
    where br.room_id = r.id
      and br.property_id = r.property_id
      and br.status = 'checked_in'
  );

revoke all on function public.check_in_booking(uuid, boolean) from public, anon;
revoke execute on function public.check_out_booking(uuid) from anon;
revoke execute on function public.dashboard_arrivals(date) from anon;
grant execute on function public.check_in_booking(uuid, boolean) to authenticated;
