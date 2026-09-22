-- 0065  One room of a group booking can be cancelled on its own.
--
-- THE CLIENT: "Group bookings allow the receptionist to be able to cancel a
-- reservation." A group here is one `bookings` row carrying several
-- `booking_rooms` — that is what "Add Group Booking" makes and what
-- `create_booking()` has always taken. Until now the only cancel was
-- `cancel_booking()`, which cancels the WHOLE booking: five rooms booked, one
-- guest drops out, and the front desk's choice was to cancel all five or none.
--
-- WHAT MAKES THIS MORE THAN AN UPDATE STATEMENT is that two things already in
-- the schema would quietly undo it, and both are fixed here.
--
--   1. `sync_booking_room_status()` pushes the booking's status down onto
--      EVERY room whenever `bookings.status` changes. Cancel room 3 of a
--      group, check the group in, and that trigger would resurrect room 3 as
--      `checked_in` — a room back on the house with a guest implied in it.
--   2. `restore_booking()` sets every room on the booking back to `confirmed`.
--      A room cancelled on its own before the group was cancelled would come
--      back with the group, which nobody asked for.
--
-- Both need to tell "cancelled because the booking was" from "cancelled on its
-- own", and nothing in the schema could. `booking_rooms.canceled_separately`
-- is that fact, and it is the whole reason this is a column and not just a
-- function.

/* -------------------------------------------------------------------------- */
/* 1. The fact that distinguishes the two cancellations                       */
/* -------------------------------------------------------------------------- */

-- NOT a second status. `booking_rooms.status` still says `canceled`, so every
-- availability query, the calendar's Cancelled band and every report keep
-- working with no change at all — a separately cancelled room frees its
-- inventory exactly like any other. This column only answers "who cancelled
-- it", which is a question only the two paths above ever ask.
alter table public.booking_rooms
  add column if not exists canceled_separately boolean not null default false;

comment on column public.booking_rooms.canceled_separately is
  'True when this room alone was cancelled out of its booking, rather than the whole booking being cancelled. Stops sync_booking_room_status() and restore_booking() bringing it back with the others.';

/* -------------------------------------------------------------------------- */
/* 2. Cancelling one room                                                     */
/* -------------------------------------------------------------------------- */

create or replace function public.cancel_booking_room(
  p_booking_room_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_line public.booking_rooms;
  v_booking public.bookings;
  v_live integer;
  v_room_label text;
begin
  -- Same gate as cancel_booking(). Cancelling one room of a group is the same
  -- kind of act as cancelling the booking, just smaller.
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can cancel a room';
  end if;

  v_property := public.current_property_id();

  select * into v_line from public.booking_rooms
  where id = p_booking_room_id and property_id = v_property;
  if not found then
    raise exception 'That room line is not on this property';
  end if;

  select * into v_booking from public.bookings
  where id = v_line.booking_id and property_id = v_property;

  if v_line.status in ('canceled', 'no_show') then
    raise exception 'That room on booking % is already cancelled', v_booking.reference;
  end if;

  if v_line.status = 'checked_out' then
    raise exception 'That room on booking % has already departed', v_booking.reference;
  end if;

  -- A guest in the room is checked out, never cancelled -- the same refusal
  -- cancel_booking() gives, for the same reason.
  if v_line.status = 'checked_in' then
    raise exception
      'That room on booking % is in house. Check the guest out rather than cancelling',
      v_booking.reference;
  end if;

  -- THE LAST LIVE ROOM IS REFUSED, and this is the rule that keeps the two
  -- paths honest. Cancelling every room one at a time would leave a booking
  -- still reading `confirmed` while occupying nothing and billing nothing --
  -- a reservation that exists for no room. Cancelling a booking is
  -- cancel_booking()'s job and stays its job.
  select count(*)::integer into v_live
  from public.booking_rooms br
  where br.booking_id = v_line.booking_id
    and br.property_id = v_property
    and br.status not in ('canceled', 'no_show');

  if v_live <= 1 then
    raise exception
      'That is the only room left on booking %. Cancel the booking instead',
      v_booking.reference;
  end if;

  v_room_label := coalesce(
    (select 'room ' || r.number from public.rooms r
     where r.id = v_line.room_id and r.property_id = v_property),
    'an unassigned room'
  );

  -- room_id goes null with the status, exactly as cancel_booking() does it:
  -- the room is back on the house and must not read as still held. The nights
  -- follow through `booking_rooms_sync_nights_after_write`, and are set here
  -- as well because that is the shape cancel_booking() uses and this is
  -- inventory coming off sale.
  update public.booking_rooms
  set status = 'canceled',
      room_id = null,
      canceled_separately = true
  where id = p_booking_room_id and property_id = v_property;

  update public.booking_room_nights
  set status = 'canceled'
  where booking_room_id = p_booking_room_id and property_id = v_property;

  -- Logged by hand, because nothing else writes it: the booking's own status
  -- has not moved, so `bookings_log_activity_after_status_change` does not
  -- fire. `booking_activity()` already reads `entity_type = 'booking_room'`
  -- rows, so this lands on the booking's History tab with no change there.
  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'booking_room', p_booking_room_id,
    'booking_room_canceled',
    format('Cancelled %s on booking %s', v_room_label, v_booking.reference),
    jsonb_build_object(
      'booking_id', v_line.booking_id,
      'reference', v_booking.reference,
      'check_in', v_line.check_in,
      'check_out', v_line.check_out,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  -- The reason goes on the booking's own notes too, where cancel_booking()
  -- puts one, so somebody reading the reservation sees it without opening the
  -- trail.
  if nullif(btrim(coalesce(p_reason, '')), '') is not null then
    update public.bookings
    set internal_notes =
      coalesce(internal_notes || E'\n', '') ||
      format('%s cancelled: %s', initcap(v_room_label), btrim(p_reason))
    where id = v_line.booking_id and property_id = v_property;
  end if;

  -- The folio is NOT touched. Nights already charged stay charged and a
  -- cancellation fee stands until somebody reverses it deliberately, which is
  -- exactly what cancel_booking() does and why folio_items is append-only.
end;
$$;

revoke execute on function public.cancel_booking_room(uuid, text) from public, anon;
grant execute on function public.cancel_booking_room(uuid, text) to authenticated;

/* -------------------------------------------------------------------------- */
/* 3. Putting one back                                                        */
/* -------------------------------------------------------------------------- */

-- The mirror of the above, for the same reason `restore_booking()` exists:
-- a destructive control with no undo is one misclick away from a reservation
-- nobody can rebuild, and the room-level control would be the only one in this
-- application without one.
create or replace function public.restore_booking_room(
  p_booking_room_id uuid,
  p_allow_overbook boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_line public.booking_rooms;
  v_booking public.bookings;
  v_available integer;
  v_type_name text;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can restore a room';
  end if;

  v_property := public.current_property_id();

  select * into v_line from public.booking_rooms
  where id = p_booking_room_id and property_id = v_property;
  if not found then
    raise exception 'That room line is not on this property';
  end if;

  select * into v_booking from public.bookings
  where id = v_line.booking_id and property_id = v_property;

  if not v_line.canceled_separately then
    raise exception
      'That room was not cancelled on its own, so there is nothing to put back here';
  end if;

  -- A live room on a dead booking would be a room held for a reservation that
  -- no longer exists. Restoring the booking is the way back from there.
  if v_booking.status in ('canceled', 'no_show') then
    raise exception
      'Booking % is cancelled. Restore the booking rather than this one room',
      v_booking.reference;
  end if;

  -- Cancelling gave the room back to the house and somebody may have sold it.
  -- The line is still cancelled here, so bookable_room_types() answers "is
  -- there room for one more, on top of what is sold now" -- the same question
  -- restore_booking() asks, and the same override.
  if not coalesce(p_allow_overbook, false) then
    select b.available, b.name into v_available, v_type_name
    from public.bookable_room_types(v_line.check_in, v_line.check_out) b
    where b.room_type_id = v_line.room_type_id;

    if v_available is null then
      raise exception 'That room type is no longer on this property';
    end if;

    if greatest(v_available, 0) < 1 then
      raise exception
        'No % free for those dates.', v_type_name
        using errcode = 'HP001';
    end if;
  end if;

  -- Back to `confirmed`, never to whatever it was: cancelling overwrote that,
  -- so restoring a `pending` room as `pending` would be a guess. `room_id`
  -- stays null -- the old room may be occupied now, and assign_room() does the
  -- overlap check properly. The room lands in its type's Unassigned band.
  update public.booking_rooms
  set status = 'confirmed',
      room_id = null,
      canceled_separately = false
  where id = p_booking_room_id and property_id = v_property;

  update public.booking_room_nights
  set status = 'confirmed'
  where booking_room_id = p_booking_room_id and property_id = v_property;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'booking_room', p_booking_room_id,
    'booking_room_restored',
    format('Restored a room on booking %s', v_booking.reference),
    jsonb_build_object(
      'booking_id', v_line.booking_id,
      'reference', v_booking.reference,
      'check_in', v_line.check_in,
      'check_out', v_line.check_out
    )
  );
end;
$$;

revoke execute on function public.restore_booking_room(uuid, boolean) from public, anon;
grant execute on function public.restore_booking_room(uuid, boolean) to authenticated;

/* -------------------------------------------------------------------------- */
/* 4. The two places that would have undone it                                */
/* -------------------------------------------------------------------------- */

-- Pushes the booking's status onto its rooms, EXCEPT the ones somebody
-- cancelled on their own. Without that exception, checking a group in would
-- put a cancelled room back on the house as occupied.
create or replace function public.sync_booking_room_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    update public.booking_rooms
    set status = new.status
    where booking_id = new.id
      and property_id = new.property_id
      and status is distinct from new.status
      and not canceled_separately;
  end if;
  return new;
end;
$$;

-- Restoring a booking brings back the rooms that went WITH it, and leaves
-- alone the ones cancelled on their own beforehand. That applies to the
-- availability check as much as to the update: demanding rooms it is not
-- going to restore would refuse restores that are perfectly sellable.
create or replace function public.restore_booking(
  p_booking_id uuid,
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
  v_line record;
  v_available integer;
  v_type_name text;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can restore a booking';
  end if;

  v_property := public.current_property_id();

  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = v_property;
  if not found then
    raise exception 'That booking is not on this property';
  end if;

  if v_booking.status not in ('canceled', 'no_show') then
    raise exception
      'Booking % is not cancelled, so there is nothing to restore',
      v_booking.reference;
  end if;

  -- The rooms were given back to the house and somebody may have taken them.
  -- The booking's own rooms are still cancelled here, so bookable_room_types()
  -- answers "is there room for these, on top of what is sold now".
  if not coalesce(p_allow_overbook, false) then
    for v_line in
      select br.room_type_id, br.check_in, br.check_out, count(*)::integer as quantity
      from public.booking_rooms br
      where br.booking_id = p_booking_id
        and br.property_id = v_property
        and not br.canceled_separately
      group by br.room_type_id, br.check_in, br.check_out
    loop
      select b.available, b.name into v_available, v_type_name
      from public.bookable_room_types(v_line.check_in, v_line.check_out) b
      where b.room_type_id = v_line.room_type_id;

      if v_available is null then
        raise exception 'That room type is no longer on this property';
      end if;

      if v_line.quantity > greatest(v_available, 0) then
        raise exception
          'Only % of % free for those dates, and this booking needs %.',
          greatest(v_available, 0), v_type_name, v_line.quantity
          using errcode = 'HP001';
      end if;
    end loop;
  end if;

  -- Back to confirmed, not to whatever it was before: cancel_booking()
  -- overwrote that, so there is no honest way to restore a pending booking as
  -- pending. Restoring is an affirmative act by staff.
  update public.bookings
  set status = 'confirmed'
  where id = p_booking_id and property_id = v_property;

  -- room_id stays null. The old room may be occupied now; assign_room() does
  -- the overlap check properly. A room cancelled on its own stays cancelled:
  -- restoring the group was never a decision about that room.
  update public.booking_rooms
  set status = 'confirmed'
  where booking_id = p_booking_id
    and property_id = v_property
    and not canceled_separately;

  update public.booking_room_nights bn
  set status = 'confirmed'
  from public.booking_rooms br
  where br.id = bn.booking_room_id
    and br.property_id = bn.property_id
    and br.booking_id = p_booking_id
    and not br.canceled_separately
    and bn.property_id = v_property;

  -- Nothing is logged by hand: bookings_log_activity_after_status_change
  -- already writes it. The folio is untouched -- it is append-only, and a
  -- cancellation fee stands until somebody reverses it deliberately.
end;
$$;

revoke execute on function public.restore_booking(uuid, boolean) from public, anon;
grant execute on function public.restore_booking(uuid, boolean) to authenticated;

/* -------------------------------------------------------------------------- */
/* 5. The two reads that have to show it                                      */
/* -------------------------------------------------------------------------- */

-- Gains `canceled_separately`, so the Rooms tab can offer Restore on the line
-- it applies to and nothing on a line that went down with its booking. The
-- return type changes, so this is a drop rather than a replace — which makes
-- the regenerated types a compile error at every call site.
drop function if exists public.booking_room_lines(uuid);

create function public.booking_room_lines(p_booking_id uuid)
returns table (
  booking_room_id uuid,
  room_type_id uuid,
  room_type_name text,
  room_id uuid,
  room_number text,
  status public.booking_status,
  canceled_separately boolean,
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
set search_path = public
as $$
  select
    br.id, br.room_type_id, rt.name, br.room_id, r.number, br.status,
    br.canceled_separately,
    br.check_in, br.check_out,
    greatest((br.check_out - br.check_in), 0)::integer,
    br.adults, br.children,
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

revoke execute on function public.booking_room_lines(uuid) from public, anon;
grant execute on function public.booking_room_lines(uuid) to authenticated;

-- A cancelled room line is not something to put a guest in. It was offered
-- before because there was no way for a line to be cancelled while its
-- booking was live; now there is.
create or replace function public.booking_rooms_for_assignment(p_booking_id uuid)
returns table (
  booking_room_id uuid,
  room_type_name text,
  room_id uuid,
  room_number text,
  check_in date,
  check_out date
)
language sql
stable
set search_path = public
as $$
  select br.id, rt.name, br.room_id, r.number, br.check_in, br.check_out
  from public.booking_rooms br
  join public.room_types rt
    on rt.id = br.room_type_id and rt.property_id = br.property_id
  left join public.rooms r
    on r.id = br.room_id and r.property_id = br.property_id
  where br.booking_id = p_booking_id
    and br.property_id = public.current_property_id()
    and br.status not in ('canceled', 'no_show')
  order by rt.name, br.id;
$$;

revoke execute on function public.booking_rooms_for_assignment(uuid) from public, anon;
grant execute on function public.booking_rooms_for_assignment(uuid) to authenticated;
