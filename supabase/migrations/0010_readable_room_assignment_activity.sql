-- The activity feed showed raw UUIDs to front desk staff:
--
--   Room assigned to booking 00000000-0000-0000-0000-000000000073
--
-- log_booking_activity() formatted the room-assignment summary from
-- new.booking_id. Nobody reads a UUID. It now names the room and the booking
-- reference, and carries both in metadata so the feed can bold them.
--
-- Only the room-assignment branch and its metadata change; the booking status
-- branch and every action name are untouched, so existing rows stay valid.

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
