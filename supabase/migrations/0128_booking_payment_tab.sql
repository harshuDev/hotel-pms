-- 0128: the booking's Payment tab, as the reference's Transactions.
--
-- The client sent their current system's Payment tab and asked for it to work
-- the same way: a Transactions list (Date, Time, Type, Payer Name,
-- Description, Amount), "+ Add Manual Transaction" and "Total payments".
--
-- 1. payments.payer_name and payments.description: who paid, and what the
--    desk wrote about it. Nullable, set once on insert -- payments stay
--    append-only (payments_immutable is untouched), so they cannot be edited
--    afterwards, like every other money row.
-- 2. record_booking_payment(): a payment taken from the booking itself.
--    - It goes on the booking's open primary folio, and OPENS that folio if
--      there is none yet. Since 0125 nothing is charged until check-out, so a
--      deposit taken before arrival would otherwise have nowhere to go; the
--      folio is made by the first money, as it always was.
--    - Cash needs the caller's own open cashier shift on the open business
--      date, refused by name if there is none (validate_cash_payment_shift()
--      would refuse anyway, less helpfully). Card, transfer and the rest need
--      no shift, exactly as on the Cashier screen.
-- 3. booking_payments(): the tab's list, security invoker under RLS.
--
-- NOT built: the reference's Card Vault and "Request payment". Both need card
-- capture through a payment gateway, which is deferred (no Stripe code, no
-- keys -- see "Card capture is not built"). No card number is stored here.

alter table public.payments
  add column payer_name text,
  add column description text;

alter table public.payments
  add constraint payments_payer_name_length check (payer_name is null or char_length(payer_name) <= 200),
  add constraint payments_description_length check (description is null or char_length(description) <= 500);

create or replace function public.record_booking_payment(
  p_booking_id uuid,
  p_payment_method_id uuid,
  p_amount_cents bigint,
  p_payer_name text default null,
  p_description text default null,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_method public.payment_methods;
  v_folio public.folios;
  v_folio_id uuid;
  v_date date;
  v_shift uuid;
  v_id uuid;
begin
  perform public.require_financial_staff();

  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That booking does not belong to this property';
  end if;

  select * into v_method from public.payment_methods
  where id = p_payment_method_id and property_id = v_booking.property_id and is_active;
  if not found then
    raise exception 'Choose an active payment type';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  v_date := public.open_business_date(v_booking.property_id);
  if v_date is null then
    raise exception 'There is no open business date';
  end if;

  if v_method.affects_drawer then
    select s.id into v_shift
    from public.cashier_shifts s
    join public.business_dates bd on bd.id = s.business_date_id and bd.property_id = s.property_id
    where s.property_id = v_booking.property_id
      and s.cashier_id = auth.uid()
      and s.status = 'open'
      and bd.business_date = v_date
    order by s.opened_at desc
    limit 1;
    if v_shift is null then
      raise exception 'Open your cashier shift before taking a cash payment';
    end if;
  end if;

  select * into v_folio from public.folios
  where booking_id = v_booking.id and property_id = v_booking.property_id and status = 'open'
  order by is_primary desc, folio_number
  limit 1;
  v_folio_id := v_folio.id;
  if v_folio_id is null then
    v_folio_id := public.create_folio(
      v_booking.id, 'guest'::public.folio_kind,
      not exists (select 1 from public.folios where booking_id = v_booking.id and is_primary)
    );
    select * into v_folio from public.folios where id = v_folio_id;
  end if;

  insert into public.payments (
    property_id, folio_id, booking_id, payment_method_id, amount_cents, currency, business_date,
    received_by, external_reference, shift_id, payer_name, description
  ) values (
    v_folio.property_id, v_folio.id, v_folio.booking_id, v_method.id, p_amount_cents, v_folio.currency, v_date,
    auth.uid(), nullif(btrim(p_reference), ''), v_shift,
    nullif(btrim(p_payer_name), ''), nullif(btrim(p_description), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_booking_payment(uuid, uuid, bigint, text, text, text) from public;
revoke execute on function public.record_booking_payment(uuid, uuid, bigint, text, text, text) from anon;
grant execute on function public.record_booking_payment(uuid, uuid, bigint, text, text, text) to authenticated;

create or replace function public.booking_payments(p_booking_id uuid)
returns table (
  payment_id uuid,
  business_date date,
  paid_at timestamptz,
  method text,
  payer_name text,
  description text,
  reference text,
  amount_cents bigint,
  is_reversal boolean,
  is_reversed boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.business_date, p.paid_at, pm.name, p.payer_name, p.description,
         p.external_reference, p.signed_amount_cents::bigint,
         (p.reverses_id is not null),
         exists (select 1 from public.payments r where r.reverses_id = p.id)
  from public.payments p
  left join public.payment_methods pm on pm.id = p.payment_method_id
  where p.booking_id = p_booking_id
  order by p.paid_at, p.id;
$$;

revoke all on function public.booking_payments(uuid) from public;
revoke execute on function public.booking_payments(uuid) from anon;
grant execute on function public.booking_payments(uuid) to authenticated;
