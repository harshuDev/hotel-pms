-- 0039: cancel_booking() and close_folio() could never run.
--
-- Both assign an enum column from a bare CASE:
--
--   set status = case when p_no_show then 'no_show' else 'canceled' end
--
-- Postgres resolves two unknown literals in a CASE to `text`, and text does not
-- assign to an enum column, so every call raised
--
--   column "status" is of type booking_status but expression is of type text
--
-- before touching a row. It is not a data-dependent failure and there is no
-- input that avoids it: the statement cannot be planned. Casting one branch is
-- enough for Postgres to resolve the other, but both are cast here so that
-- neither can be edited later without the type being visible.
--
-- What was actually broken:
--
--   * cancel_booking() is what the Cancel button on the booking screen calls,
--     through src/lib/actions/booking-edit.ts. Cancelling a booking has never
--     worked. It surfaced as the raw Postgres message, which says nothing a
--     receptionist could act on.
--   * close_folio() has no caller yet, in SQL or in the application, so nothing
--     visible depended on it. It is fixed in the same migration because it is
--     the same mistake and leaving one of two is how the second gets forgotten.
--
-- Found while building the no-show step of the night audit, which calls
-- cancel_booking() rather than releasing a booking a second way. Reusing it is
-- what exposed this; a second copy would have worked and left the button
-- broken.
--
-- No behaviour is being changed here. Every branch keeps the label it had —
-- including folio_status's 'cancelled', which really is spelled with two Ls
-- while booking_status uses 'canceled' with one. That inconsistency is in the
-- schema from 0001 and is not this migration's to rename: the label is correct
-- for its type and changing an enum label would rewrite stored values.

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_no_show boolean default false,
  p_reason text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_property uuid;
  v_booking public.bookings;
  v_outstanding bigint;
  v_status public.booking_status;
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

  -- Decided once, as the enum, rather than three bare CASEs that each have to
  -- be resolved by the planner.
  v_status := case
    when coalesce(p_no_show, false) then 'no_show'::public.booking_status
    else 'canceled'::public.booking_status
  end;

  -- A cancellation fee is a real thing, so a balance does not stop this. It is
  -- returned instead, because somebody still has to chase it.
  select coalesce(sum(fb.outstanding_cents), 0) into v_outstanding
  from public.folio_balances fb
  where fb.booking_id = p_booking_id and fb.property_id = v_property;

  update public.bookings
  set status = v_status,
      internal_notes = case
        when nullif(btrim(coalesce(p_reason, '')), '') is null then internal_notes
        else coalesce(internal_notes || E'\n', '') || btrim(p_reason)
      end
  where id = p_booking_id and property_id = v_property;

  -- The rooms and their nights come off the house, which is what frees the
  -- inventory. Every availability query excludes canceled and no_show.
  update public.booking_rooms
  set status = v_status,
      room_id = null
  where booking_id = p_booking_id and property_id = v_property;

  update public.booking_room_nights bn
  set status = v_status
  from public.booking_rooms br
  where br.id = bn.booking_room_id
    and br.property_id = bn.property_id
    and br.booking_id = p_booking_id
    and bn.property_id = v_property;

  return v_outstanding;
end;
$function$;

create or replace function public.close_folio(
  p_folio_id uuid,
  p_cancel boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_balance bigint;
  v_status public.folio_status;
begin
  perform public.require_financial_staff();

  if not p_cancel then
    select outstanding_cents into v_balance
    from public.folio_balances
    where folio_id = p_folio_id and property_id = public.current_property_id();

    if v_balance is null then
      raise exception 'Folio not found for current property';
    end if;

    if v_balance <> 0 then
      raise exception 'Only a settled folio can be closed';
    end if;
  end if;

  v_status := case
    when p_cancel then 'cancelled'::public.folio_status
    else 'closed'::public.folio_status
  end;

  update public.folios
  set status = v_status,
      closed_at = now(),
      updated_at = now()
  where id = p_folio_id
    and property_id = public.current_property_id()
    and status = 'open';

  if not found then
    raise exception 'Open folio not found for current property';
  end if;
end;
$function$;
