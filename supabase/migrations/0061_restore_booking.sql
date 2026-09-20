-- 0061: putting a cancelled booking back on the house.
--
-- The client: "Restore a booking for cancelled ones ... jo bhi cancel rooms ko
-- restore krna chahe to vo bhi kr ske hai like restore the room krke option
-- ho."
--
-- Cancelling has always been a one-way door here, and it should not have been.
-- A guest rings back, or somebody cancels the wrong reference, and the only
-- way out was to take the booking again by hand -- which loses the reference,
-- the folio and the trail, and leaves the original sitting cancelled next to
-- its own replacement.
--
-- THIS IS THE EXACT REVERSE OF `cancel_booking()` AND NOTHING MORE. That
-- function sets three things -- the booking's status, its rooms' status (and
-- nulls their room_id), and the nights' status -- so this sets the same three
-- back. It does not re-price, does not touch the folio, and does not put the
-- guest back in a room.

/* -------------------------------------------------------------------------- */
/* Restoring                                                                  */
/* -------------------------------------------------------------------------- */

create or replace function public.restore_booking(
  p_booking_id uuid,
  p_allow_overbook boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
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

  /*
   * THE ROOMS WERE GIVEN BACK TO THE HOUSE, AND SOMEBODY MAY HAVE TAKEN THEM.
   *
   * This is the whole reason restoring is not just three UPDATEs. Cancelling
   * frees the inventory -- every availability query excludes `canceled` and
   * `no_show` -- so between the cancellation and now the same nights may have
   * been sold to somebody else. Putting the booking back without asking would
   * oversell the hotel silently, which is exactly what `create_booking()`
   * refuses to do with `HP001`.
   *
   * The booking's own rooms are still cancelled at this point, so they are not
   * counted in what `bookable_room_types()` reports -- which makes its answer
   * the right one: "is there room for these, on top of what is sold now".
   *
   * Grouped by type and dates, because a group booking may hold several rooms
   * of one type over one range and they have to be counted together.
   */
  if not coalesce(p_allow_overbook, false) then
    for v_line in
      select br.room_type_id, br.check_in, br.check_out, count(*)::integer as quantity
      from public.booking_rooms br
      where br.booking_id = p_booking_id
        and br.property_id = v_property
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

  /*
   * BACK TO `confirmed`, NOT TO WHATEVER IT WAS BEFORE.
   *
   * The status it held before the cancellation is not recorded anywhere this
   * function can read -- `cancel_booking()` overwrote it -- so there is no
   * honest way to put a `pending` booking back as `pending`. `confirmed` is
   * the right answer rather than a guess: restoring is an affirmative act by
   * staff, and a member of staff pressing Restore is saying the hotel intends
   * to honour this stay. Leaving it `pending` would also put it somewhere the
   * night audit never sweeps.
   */
  update public.bookings
  set status = 'confirmed'
  where id = p_booking_id and property_id = v_property;

  /*
   * `room_id` STAYS NULL. `cancel_booking()` cleared it, and the room it used
   * to be in may well be occupied now. Putting the guest back in a room is
   * `assign_room()`'s job, which does the overlap check properly; guessing the
   * old room here would be the one thing that could double-book a real bed.
   * The booking lands in its type's Unassigned band, which is where every
   * booking with no room sits.
   */
  update public.booking_rooms
  set status = 'confirmed'
  where booking_id = p_booking_id and property_id = v_property;

  update public.booking_room_nights bn
  set status = 'confirmed'
  from public.booking_rooms br
  where br.id = bn.booking_room_id
    and br.property_id = bn.property_id
    and br.booking_id = p_booking_id
    and bn.property_id = v_property;

  /*
   * NOTHING IS LOGGED HERE BY HAND, because something already does it.
   * `bookings_log_activity_after_status_change` fires on any status change and
   * writes `booking_confirmed` to `activity_log`, so the restore shows up on
   * the booking's History tab without a second insert -- and a second insert
   * would put two rows on the trail for one act.
   *
   * `booking_rooms` is likewise cascaded by
   * `bookings_sync_room_status_after_status_change`. The explicit update above
   * is kept anyway, for symmetry with `cancel_booking()` and so this function
   * reads as the whole reversal rather than half of it relying on a trigger
   * somewhere else. It is idempotent either way. The NIGHTS are not covered by
   * any trigger, which is why that update is the one that genuinely has to be
   * here.
   *
   * THE FOLIO IS NOT TOUCHED, and that is deliberate. `folio_items` is
   * append-only. If a cancellation fee or a no-show fee was posted, it stands
   * until somebody reverses it on purpose with `reverse_charge()` -- which is
   * a separate decision about money, and not one a Restore button should be
   * making on a receptionist's behalf.
   */
end;
$function$;

comment on function public.restore_booking(uuid, boolean) is
  'Puts a cancelled or no-show booking back on the house: the exact reverse of cancel_booking(), plus the availability check cancelling made necessary. Restores to confirmed with no room assigned, and never touches the folio.';

revoke all on function public.restore_booking(uuid, boolean) from public, anon;
grant execute on function public.restore_booking(uuid, boolean) to authenticated;
