-- 0130: Card Vault and Request payment, the last two parts of the
-- reference's Payment tab, through Stripe.
--
-- The client asked for them after being told both need card capture: "Please
-- copy everything". This is the card capture "Card capture is not built" in
-- CLAUDE.md described, and it keeps every rule that section set:
--
-- * NO CARD NUMBER EVER REACHES THIS SERVER OR THIS DATABASE. A card is typed
--   into Stripe's own Elements frame in the browser and saved at Stripe by a
--   SetupIntent; what is stored here is Stripe's ids and what Stripe hands
--   back for display -- brand, last four, expiry, the name. That is what PCI
--   allows a merchant to keep.
-- * The secret key lives in the server's environment (STRIPE_SECRET_KEY) and
--   nowhere else. The browser gets the publishable key only.
-- * No webhook, so no new route. A payment taken from a saved card is
--   confirmed by Stripe in the same request, and a payment request is checked
--   with Stripe under the staff member's own session when the Payment tab is
--   opened. Either way the payment row is written by a staff session under
--   the same rules as every other payment.
--
-- 1. booking_cards: a card saved for a booking. Deleting a row is allowed --
--    it is not money; the card is detached at Stripe when it goes.
-- 2. payment_requests: a Stripe Checkout link sent to the guest, open until
--    it is paid, expires (Stripe gives it 24 hours) or is cancelled.
-- 3. record_gateway_payment(): the payment Stripe confirmed, on the folio
--    chosen, at the property's active Card payment type (never the drawer).
--    It is idempotent on Stripe's payment id: a second call for the same
--    payment returns the first row, so a double click or two staff opening
--    the tab together cannot post it twice -- a unique index makes sure.

create table public.booking_cards (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  gateway text not null default 'stripe' check (gateway = 'stripe'),
  gateway_customer_id text not null check (char_length(gateway_customer_id) <= 255),
  gateway_payment_method_id text not null check (char_length(gateway_payment_method_id) <= 255),
  brand text check (brand is null or char_length(brand) <= 40),
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  exp_month int check (exp_month is null or exp_month between 1 and 12),
  exp_year int check (exp_year is null or exp_year between 2000 and 2200),
  holder_name text check (holder_name is null or char_length(holder_name) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (property_id, gateway_payment_method_id)
);

create index booking_cards_booking_idx on public.booking_cards (booking_id);
create index booking_cards_customer_idx on public.booking_cards (customer_id);

alter table public.booking_cards enable row level security;

-- Who may see a card is who may take a payment. Writes go through the
-- functions below; there is no insert, update or delete policy.
create policy booking_cards_select on public.booking_cards
  for select to authenticated
  using (
    property_id = public.current_property_id()
    and coalesce(public.current_role() in ('admin', 'manager', 'front_desk', 'cashier'), false)
  );

create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  folio_id uuid references public.folios(id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null,
  gateway text not null default 'stripe' check (gateway = 'stripe'),
  gateway_session_id text not null unique check (char_length(gateway_session_id) <= 255),
  url text not null check (char_length(url) <= 2000),
  description text check (description is null or char_length(description) <= 500),
  status text not null default 'open' check (status in ('open', 'paid', 'expired', 'canceled')),
  payment_id uuid references public.payments(id) on delete restrict,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'paid') = (payment_id is not null))
);

create index payment_requests_booking_idx on public.payment_requests (booking_id);

alter table public.payment_requests enable row level security;

create policy payment_requests_select on public.payment_requests
  for select to authenticated
  using (
    property_id = public.current_property_id()
    and coalesce(public.current_role() in ('admin', 'manager', 'front_desk', 'cashier'), false)
  );

-- One payment row per gateway payment, so nothing Stripe took is posted twice.
create unique index payments_one_per_authorization
  on public.payments (property_id, authorization_reference)
  where authorization_reference is not null and reverses_id is null;

-- ---------------------------------------------------------------------------
-- Card Vault
-- ---------------------------------------------------------------------------

create or replace function public.add_booking_card(
  p_booking_id uuid,
  p_gateway_customer_id text,
  p_gateway_payment_method_id text,
  p_brand text,
  p_last4 text,
  p_exp_month int,
  p_exp_year int,
  p_holder_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_id uuid;
begin
  perform public.require_financial_staff();
  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That booking does not belong to this property';
  end if;
  if coalesce(btrim(p_gateway_customer_id), '') = '' or coalesce(btrim(p_gateway_payment_method_id), '') = '' then
    raise exception 'The card was not saved at the payment gateway';
  end if;

  insert into public.booking_cards (
    property_id, booking_id, customer_id, gateway_customer_id, gateway_payment_method_id,
    brand, last4, exp_month, exp_year, holder_name
  ) values (
    v_booking.property_id, v_booking.id, v_booking.customer_id, p_gateway_customer_id, p_gateway_payment_method_id,
    nullif(btrim(p_brand), ''), nullif(btrim(p_last4), ''), p_exp_month, p_exp_year, nullif(btrim(p_holder_name), '')
  )
  on conflict (property_id, gateway_payment_method_id) do update set booking_id = excluded.booking_id
  returning id into v_id;

  insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
  values (v_booking.property_id, auth.uid(), 'booking', v_booking.id, 'card_added',
          format('Card ending %s added to the card vault', coalesce(nullif(btrim(p_last4), ''), '----')),
          jsonb_build_object('card_id', v_id));
  return v_id;
end;
$$;

-- Removes the row and hands back the gateway's id, so the server detaches the
-- card at Stripe only once Postgres has agreed.
create or replace function public.remove_booking_card(p_card_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_card public.booking_cards;
begin
  perform public.require_financial_staff();
  delete from public.booking_cards
  where id = p_card_id and property_id = public.current_property_id()
  returning * into v_card;
  if not found then
    raise exception 'That card is not on this property';
  end if;

  insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
  values (v_card.property_id, auth.uid(), 'booking', v_card.booking_id, 'card_removed',
          format('Card ending %s removed from the card vault', coalesce(v_card.last4, '----')),
          jsonb_build_object('card_id', v_card.id));
  return v_card.gateway_payment_method_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- A payment the gateway confirmed
-- ---------------------------------------------------------------------------

create or replace function public.record_gateway_payment(
  p_booking_id uuid,
  p_folio_id uuid,
  p_amount_cents bigint,
  p_gateway_reference text,
  p_payer_name text default null,
  p_description text default null,
  p_request_id uuid default null
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
  v_id uuid;
begin
  perform public.require_financial_staff();

  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That booking does not belong to this property';
  end if;
  if coalesce(btrim(p_gateway_reference), '') = '' then
    raise exception 'The payment gateway did not return a payment reference';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  -- Serialise on the gateway's id: two sessions recording one payment at the
  -- same moment must not both pass the check below.
  perform pg_advisory_xact_lock(hashtext('gateway_payment:' || p_gateway_reference));

  select id into v_id from public.payments
  where property_id = v_booking.property_id and authorization_reference = p_gateway_reference
    and reverses_id is null;

  if v_id is null then
    select * into v_method from public.payment_methods
    where property_id = v_booking.property_id and is_active and kind = 'card'
    order by created_at, name
    limit 1;
    if not found then
      raise exception 'Add an active card payment type in Settings before taking card payments';
    end if;

    v_date := public.open_business_date(v_booking.property_id);
    if v_date is null then
      raise exception 'There is no open business date';
    end if;

    if p_folio_id is not null then
      select * into v_folio from public.folios
      where id = p_folio_id and booking_id = v_booking.id and property_id = v_booking.property_id;
      if not found then
        raise exception 'That folio is not on this booking';
      end if;
    end if;
    -- A closed folio still takes what the guest has already paid: the money
    -- has left their card. It goes to the open primary instead.
    if v_folio.id is null or v_folio.status <> 'open' then
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
    end if;

    insert into public.payments (
      property_id, folio_id, booking_id, payment_method_id, amount_cents, currency, business_date,
      received_by, authorization_reference, payer_name, description
    ) values (
      v_folio.property_id, v_folio.id, v_folio.booking_id, v_method.id, p_amount_cents, v_folio.currency, v_date,
      auth.uid(), p_gateway_reference,
      nullif(btrim(p_payer_name), ''), nullif(btrim(p_description), '')
    )
    returning id into v_id;
  end if;

  if p_request_id is not null then
    update public.payment_requests
    set status = 'paid', payment_id = v_id, closed_at = now()
    where id = p_request_id and property_id = v_booking.property_id and status <> 'paid';
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Request payment
-- ---------------------------------------------------------------------------

create or replace function public.add_payment_request(
  p_booking_id uuid,
  p_folio_id uuid,
  p_amount_cents bigint,
  p_currency text,
  p_gateway_session_id text,
  p_url text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_id uuid;
begin
  perform public.require_financial_staff();
  select * into v_booking from public.bookings
  where id = p_booking_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That booking does not belong to this property';
  end if;
  if p_folio_id is not null and not exists (
    select 1 from public.folios where id = p_folio_id and booking_id = v_booking.id
  ) then
    raise exception 'That folio is not on this booking';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  insert into public.payment_requests (
    property_id, booking_id, folio_id, amount_cents, currency, gateway_session_id, url, description
  ) values (
    v_booking.property_id, v_booking.id, p_folio_id, p_amount_cents, upper(p_currency),
    p_gateway_session_id, p_url, nullif(btrim(p_description), '')
  )
  returning id into v_id;

  insert into public.activity_log (property_id, actor_id, entity_type, entity_id, action, summary, metadata)
  values (v_booking.property_id, auth.uid(), 'booking', v_booking.id, 'payment_requested',
          format('Payment of %s.%s %s requested', p_amount_cents / 100,
                 lpad((p_amount_cents % 100)::text, 2, '0'), upper(p_currency)),
          jsonb_build_object('request_id', v_id));
  return v_id;
end;
$$;

create or replace function public.close_payment_request(p_request_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.require_financial_staff();
  if p_status not in ('expired', 'canceled') then
    raise exception 'A payment request is closed as expired or cancelled';
  end if;
  update public.payment_requests
  set status = p_status, closed_at = now()
  where id = p_request_id and property_id = public.current_property_id() and status = 'open';
end;
$$;

revoke all on function public.add_booking_card(uuid, text, text, text, text, int, int, text) from public;
revoke execute on function public.add_booking_card(uuid, text, text, text, text, int, int, text) from anon;
grant execute on function public.add_booking_card(uuid, text, text, text, text, int, int, text) to authenticated;

revoke all on function public.remove_booking_card(uuid) from public;
revoke execute on function public.remove_booking_card(uuid) from anon;
grant execute on function public.remove_booking_card(uuid) to authenticated;

revoke all on function public.record_gateway_payment(uuid, uuid, bigint, text, text, text, uuid) from public;
revoke execute on function public.record_gateway_payment(uuid, uuid, bigint, text, text, text, uuid) from anon;
grant execute on function public.record_gateway_payment(uuid, uuid, bigint, text, text, text, uuid) to authenticated;

revoke all on function public.add_payment_request(uuid, uuid, bigint, text, text, text, text) from public;
revoke execute on function public.add_payment_request(uuid, uuid, bigint, text, text, text, text) from anon;
grant execute on function public.add_payment_request(uuid, uuid, bigint, text, text, text, text) to authenticated;

revoke all on function public.close_payment_request(uuid, text) from public;
revoke execute on function public.close_payment_request(uuid, text) from anon;
grant execute on function public.close_payment_request(uuid, text) to authenticated;
