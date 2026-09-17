-- Fix: validate_financial_record() blocked every payment.
--
-- The function is shared by folio_items and payments. It guarded a
-- folio_items-only column like this:
--
--   if tg_table_name = 'folio_items' and new.booking_room_night_id is not null
--
-- PL/pgSQL evaluates that as a single SQL expression against the actual NEW
-- record, so on a payments row it raised
--
--   record "new" has no field "booking_room_night_id"
--
-- before the left operand could rule the branch out. Every insert into
-- payments failed, record_payment() included, which left folio settlement and
-- the whole cashier drawer path unusable.
--
-- Nesting the conditions fixes it: PL/pgSQL compiles an expression on first
-- execution, so the inner test is never compiled for a payments row. The
-- validation itself is unchanged.

create or replace function public.validate_financial_record()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_folio public.folios;
  v_night_booking_id uuid;
begin
  select * into v_folio from public.folios
    where id = new.folio_id and property_id = new.property_id;
  if not found or v_folio.booking_id <> new.booking_id then
    raise exception 'Financial record booking must match its folio booking';
  end if;
  if tg_table_name = 'folio_items' then
    if new.booking_room_night_id is not null then
      select br.booking_id into v_night_booking_id
      from public.booking_room_nights brn
      join public.booking_rooms br on br.id = brn.booking_room_id and br.property_id = brn.property_id
      where brn.id = new.booking_room_night_id and brn.property_id = new.property_id;
      if v_night_booking_id is null or v_night_booking_id <> new.booking_id then
        raise exception 'Room night must belong to the financial record booking';
      end if;
    end if;
  end if;
  return new;
end;
$$;
