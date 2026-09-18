-- 0041: meeting room debts join the debtors report.
--
-- Open decision 14 is now taken. The report joined `bookings`, so a meeting
-- room folio — which has no bookings row and never will, because putting one
-- there would inflate occupancy, ADR and RevPAR — could not appear however much
-- it owed. The balance showed on the meeting room booking and nowhere a
-- receptionist would look for money owed to the hotel.
--
-- The report now returns both, ranked together, with a `kind` saying which. It
-- is one question — who owes this hotel money — and answering it in two places
-- is how a debt gets missed.
--
-- Three seams worth knowing:
--
-- `check_out` means different things on the two sides. For a room booking it is
-- the morning the guest leaves and is not a night stayed; for a meeting room
-- `ends_on` is a day the room was occupied, because that module is inclusive at
-- both ends. Overdue is counted from each one's own last day, so both are
-- right, and the screen says so rather than leaving it to be discovered.
--
-- The status cast is deliberate and loud. meeting_room_booking_status is
-- (pending, confirmed, canceled) and every one of those labels exists in
-- booking_status, so the cast is lossless today. Add a meeting room status that
-- booking_status does not have and this raises rather than mislabelling a row —
-- which is the right failure, and the fix is an explicit mapping here.
--
-- A meeting room booking with no folio cannot owe anything: folio_id is null
-- until the first charge, which is exactly what makes null mean "no money was
-- taken" rather than "there is an empty folio nobody looked at".

drop function if exists public.debtors_report();

create function public.debtors_report()
returns table(
  kind text,
  booking_id uuid,
  reference text,
  customer_name text,
  status public.booking_status,
  check_in date,
  check_out date,
  charges_cents bigint,
  payments_cents bigint,
  outstanding_cents bigint,
  days_overdue integer
)
language sql
stable
set search_path to 'public'
as $function$
  with today as (
    select bd.business_date
    from public.business_dates bd
    where bd.property_id = public.current_property_id()
      and bd.status = 'open'
  ),
  rows as (
    select
      'room'::text as kind,
      b.id as booking_id,
      b.reference,
      public.customer_display_name(c) as customer_name,
      b.status,
      b.check_in,
      b.check_out,
      owed.charges_cents,
      owed.payments_cents,
      owed.outstanding_cents,
      -- Only counts once they have gone. A guest still in house is not late.
      greatest(
        coalesce((select business_date from today), b.check_out) - b.check_out,
        0
      )::integer as days_overdue
    from public.bookings b
    join public.customers c
      on c.id = b.customer_id and c.property_id = b.property_id
    join lateral (
      select
        coalesce(sum(fb.total_charges_cents), 0)::bigint as charges_cents,
        coalesce(sum(fb.total_payments_cents), 0)::bigint as payments_cents,
        coalesce(sum(greatest(fb.outstanding_cents, 0)), 0)::bigint as outstanding_cents
      from public.folio_balances fb
      where fb.booking_id = b.id
        and fb.property_id = b.property_id
    ) owed on true
    where b.property_id = public.current_property_id()
      and owed.outstanding_cents > 0

    union all

    select
      'meeting_room'::text as kind,
      mb.id as booking_id,
      mb.reference,
      -- The event is what identifies a meeting room booking to the person
      -- chasing it; the customer is who to chase. Prefer the customer and fall
      -- back to the event rather than showing a blank.
      coalesce(public.customer_display_name(c), mb.event_name) as customer_name,
      mb.status::text::public.booking_status as status,
      mb.starts_on as check_in,
      mb.ends_on as check_out,
      owed.charges_cents,
      owed.payments_cents,
      owed.outstanding_cents,
      -- ends_on is a day the room was held, so the day after it is the first
      -- day the debt is late.
      greatest(
        coalesce((select business_date from today), mb.ends_on) - mb.ends_on,
        0
      )::integer as days_overdue
    from public.meeting_room_bookings mb
    left join public.customers c
      on c.id = mb.customer_id and c.property_id = mb.property_id
    join lateral (
      select
        coalesce(sum(fb.total_charges_cents), 0)::bigint as charges_cents,
        coalesce(sum(fb.total_payments_cents), 0)::bigint as payments_cents,
        coalesce(sum(greatest(fb.outstanding_cents, 0)), 0)::bigint as outstanding_cents
      from public.folio_balances fb
      where fb.folio_id = mb.folio_id
        and fb.property_id = mb.property_id
    ) owed on true
    where mb.property_id = public.current_property_id()
      and mb.folio_id is not null
      and owed.outstanding_cents > 0
  )
  select
    rows.kind,
    rows.booking_id,
    rows.reference,
    rows.customer_name,
    rows.status,
    rows.check_in,
    rows.check_out,
    rows.charges_cents,
    rows.payments_cents,
    rows.outstanding_cents,
    rows.days_overdue
  from rows
  order by rows.outstanding_cents desc, rows.check_out;
$function$;

revoke all on function public.debtors_report() from public;
grant execute on function public.debtors_report() to authenticated;
