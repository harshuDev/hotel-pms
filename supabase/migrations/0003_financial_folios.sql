-- Layer 3: append-only guest folios and financial ledger.
-- All monetary values are integer cents (minor units); rates are basis points.

create type public.folio_status as enum ('open', 'closed', 'cancelled');
create type public.folio_kind as enum ('guest', 'company');
create type public.folio_item_type as enum (
  'room_charge', 'tax', 'food_beverage', 'laundry', 'minibar', 'transport',
  'miscellaneous', 'discount', 'adjustment', 'reversal'
);
create type public.tax_inclusion as enum ('inclusive', 'exclusive');
create type public.payment_method_kind as enum (
  'cash', 'card', 'bank_transfer', 'upi', 'ota_prepaid', 'virtual_card',
  'complimentary', 'other'
);
create type public.payment_status as enum ('posted');

create sequence public.folio_number_seq as bigint;

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  name text not null,
  rate_bps integer not null,
  inclusion public.tax_inclusion not null default 'exclusive',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, name),
  constraint tax_rates_rate_bps_valid check (rate_bps >= 0 and rate_bps <= 10000)
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  kind public.payment_method_kind not null,
  name text not null,
  affects_drawer boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, kind),
  constraint payment_methods_cash_drawer_consistency check (
    (kind = 'cash' and affects_drawer) or (kind <> 'cash' and not affects_drawer)
  )
);

create table public.folios (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  booking_id uuid not null,
  customer_id uuid not null,
  folio_number bigint not null default nextval('public.folio_number_seq'),
  kind public.folio_kind not null default 'guest',
  is_primary boolean not null default false,
  status public.folio_status not null default 'open',
  currency char(3) not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, folio_number),
  foreign key (booking_id, property_id) references public.bookings(id, property_id) on delete restrict,
  foreign key (customer_id, property_id) references public.customers(id, property_id) on delete restrict,
  constraint folios_currency_uppercase check (currency = upper(currency)),
  constraint folios_closed_at_consistency check (
    (status = 'open' and closed_at is null) or
    (status in ('closed', 'cancelled') and closed_at is not null)
  )
);
create unique index folios_one_primary_per_booking_idx
  on public.folios (booking_id) where is_primary;
create index folios_property_booking_idx on public.folios(property_id, booking_id);
create index folios_property_open_idx on public.folios(property_id, status) where status = 'open';

create table public.folio_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  folio_id uuid not null,
  booking_id uuid not null,
  booking_room_night_id uuid,
  tax_rate_id uuid,
  business_date date not null,
  item_type public.folio_item_type not null,
  description text not null,
  quantity integer not null default 1,
  unit_amount_cents bigint not null,
  net_amount_cents bigint not null,
  tax_amount_cents bigint not null default 0,
  amount_cents bigint not null,
  signed_amount_cents bigint generated always as
    (amount_cents * case when reverses_id is null then 1 else -1 end) stored,
  reverses_id uuid,
  posted_at timestamptz not null default now(),
  posted_by uuid,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  foreign key (folio_id, property_id) references public.folios(id, property_id) on delete restrict,
  foreign key (booking_id, property_id) references public.bookings(id, property_id) on delete restrict,
  foreign key (booking_room_night_id, property_id) references public.booking_room_nights(id, property_id) on delete restrict,
  foreign key (tax_rate_id, property_id) references public.tax_rates(id, property_id) on delete restrict,
  foreign key (reverses_id, property_id) references public.folio_items(id, property_id) on delete restrict,
  foreign key (posted_by, property_id) references public.staff_users(id, property_id) on delete restrict,
  constraint folio_items_amounts_nonnegative check (
    quantity > 0 and unit_amount_cents >= 0 and net_amount_cents >= 0
    and tax_amount_cents >= 0 and amount_cents >= 0
  ),
  constraint folio_items_amount_total check (amount_cents = net_amount_cents + tax_amount_cents),
  constraint folio_items_reversal_type check (
    (reverses_id is null and item_type not in ('reversal', 'discount')) or
    (reverses_id is not null and item_type in ('reversal', 'discount'))
  )
);
create unique index folio_items_one_room_charge_per_night_idx
  on public.folio_items(booking_room_night_id)
  where booking_room_night_id is not null and item_type = 'room_charge' and reverses_id is null;
create unique index folio_items_one_reversal_per_item_idx
  on public.folio_items(reverses_id) where reverses_id is not null;
create index folio_items_property_folio_posted_idx on public.folio_items(property_id, folio_id, posted_at);
create index folio_items_property_booking_business_date_idx on public.folio_items(property_id, booking_id, business_date);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  folio_id uuid not null,
  booking_id uuid not null,
  payment_method_id uuid not null,
  amount_cents bigint not null,
  signed_amount_cents bigint generated always as
    (amount_cents * case when reverses_id is null then 1 else -1 end) stored,
  currency char(3) not null,
  business_date date not null,
  paid_at timestamptz not null default now(),
  received_by uuid,
  external_reference text,
  authorization_reference text,
  shift_id uuid,
  status public.payment_status not null default 'posted',
  reverses_id uuid,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  foreign key (folio_id, property_id) references public.folios(id, property_id) on delete restrict,
  foreign key (booking_id, property_id) references public.bookings(id, property_id) on delete restrict,
  foreign key (payment_method_id, property_id) references public.payment_methods(id, property_id) on delete restrict,
  foreign key (received_by, property_id) references public.staff_users(id, property_id) on delete restrict,
  foreign key (reverses_id, property_id) references public.payments(id, property_id) on delete restrict,
  constraint payments_amount_positive check (amount_cents > 0),
  constraint payments_currency_uppercase check (currency = upper(currency)),
  constraint payments_no_self_reversal check (reverses_id is null or reverses_id <> id)
);
create unique index payments_one_reversal_per_payment_idx on public.payments(reverses_id) where reverses_id is not null;
create index payments_property_folio_paid_at_idx on public.payments(property_id, folio_id, paid_at);
create index payments_property_business_date_idx on public.payments(property_id, business_date);
create index payments_cash_shift_idx on public.payments(property_id, shift_id)
  where shift_id is not null;

-- Cross-table tenant keys are not enough to ensure a ledger row belongs to the
-- folio's booking. Validate that relationship before any append-only insert.
create function public.validate_financial_record()
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
  if tg_table_name = 'folio_items' and new.booking_room_night_id is not null then
    select br.booking_id into v_night_booking_id
    from public.booking_room_nights brn
    join public.booking_rooms br on br.id = brn.booking_room_id and br.property_id = brn.property_id
    where brn.id = new.booking_room_night_id and brn.property_id = new.property_id;
    if v_night_booking_id is null or v_night_booking_id <> new.booking_id then
      raise exception 'Room night must belong to the financial record booking';
    end if;
  end if;
  return new;
end;
$$;
create trigger folio_items_validate_before_insert before insert on public.folio_items
  for each row execute function public.validate_financial_record();
create trigger payments_validate_before_insert before insert on public.payments
  for each row execute function public.validate_financial_record();

create function public.prevent_financial_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% records are append-only; create a reversing entry instead', tg_table_name;
end;
$$;
create trigger folio_items_immutable before update or delete on public.folio_items
  for each row execute function public.prevent_financial_mutation();
create trigger payments_immutable before update or delete on public.payments
  for each row execute function public.prevent_financial_mutation();

create view public.folio_balances with (security_invoker = true) as
select f.id as folio_id, f.property_id, f.booking_id,
  coalesce(i.total_charges_cents, 0)::bigint as total_charges_cents,
  coalesce(p.total_payments_cents, 0)::bigint as total_payments_cents,
  (coalesce(i.total_charges_cents, 0) - coalesce(p.total_payments_cents, 0))::bigint as outstanding_cents,
  case when f.status <> 'open' then f.status::text
       when coalesce(i.total_charges_cents, 0) - coalesce(p.total_payments_cents, 0) = 0 then 'settled'
       when coalesce(i.total_charges_cents, 0) - coalesce(p.total_payments_cents, 0) < 0 then 'credit_balance'
       when coalesce(p.total_payments_cents, 0) = 0 then 'open'
       else 'partially_paid' end as settlement_status
from public.folios f
left join lateral (select sum(signed_amount_cents) as total_charges_cents from public.folio_items where folio_id = f.id) i on true
left join lateral (select sum(signed_amount_cents) as total_payments_cents from public.payments where folio_id = f.id) p on true;

create view public.property_outstanding with (security_invoker = true) as
select property_id, coalesce(sum(greatest(outstanding_cents, 0)), 0)::bigint as outstanding_cents,
  count(*) filter (where settlement_status in ('open', 'partially_paid'))::bigint as open_folio_count
from public.folio_balances group by property_id;

create function public.require_financial_staff()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null or public.current_role() not in ('admin', 'manager', 'front_desk', 'cashier') then
    raise exception 'Current staff user is not permitted to post financial transactions';
  end if;
end;
$$;

create function public.open_business_date(p_property_id uuid)
returns date language sql stable security definer set search_path = public as $$
  select business_date from public.business_dates where property_id = p_property_id and status = 'open';
$$;

create function public.create_folio(p_booking_id uuid, p_kind public.folio_kind default 'guest', p_is_primary boolean default false)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_booking public.bookings; v_id uuid;
begin
  perform public.require_financial_staff();
  select * into v_booking from public.bookings where id = p_booking_id and property_id = public.current_property_id();
  if not found then raise exception 'Booking not found for current property'; end if;
  insert into public.folios(property_id, booking_id, customer_id, kind, is_primary, currency)
  select v_booking.property_id, v_booking.id, v_booking.customer_id, p_kind, p_is_primary, p.currency
  from public.properties p where p.id = v_booking.property_id returning id into v_id;
  return v_id;
end;
$$;

create function public.close_folio(p_folio_id uuid, p_cancel boolean default false)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_balance bigint;
begin
  perform public.require_financial_staff();
  if not p_cancel then
    select outstanding_cents into v_balance from public.folio_balances
    where folio_id = p_folio_id and property_id = public.current_property_id();
    if v_balance is null then raise exception 'Folio not found for current property'; end if;
    if v_balance <> 0 then raise exception 'Only a settled folio can be closed'; end if;
  end if;
  update public.folios set status = case when p_cancel then 'cancelled' else 'closed' end,
    closed_at = now(), updated_at = now()
  where id = p_folio_id and property_id = public.current_property_id() and status = 'open';
  if not found then raise exception 'Open folio not found for current property'; end if;
end;
$$;

create function public.post_charge(p_folio_id uuid, p_item_type public.folio_item_type, p_description text,
  p_unit_amount_cents bigint, p_quantity integer default 1, p_tax_amount_cents bigint default 0,
  p_tax_rate_id uuid default null, p_business_date date default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_folio public.folios; v_date date; v_id uuid; v_amount bigint;
begin
  perform public.require_financial_staff();
  select * into v_folio from public.folios where id = p_folio_id and property_id = public.current_property_id() and status = 'open';
  if not found then raise exception 'Open folio not found for current property'; end if;
  v_date := coalesce(p_business_date, public.open_business_date(v_folio.property_id));
  if v_date is null then raise exception 'No open business date for property'; end if;
  if p_item_type in ('room_charge', 'reversal', 'discount') or p_unit_amount_cents < 0 or p_quantity <= 0 or p_tax_amount_cents < 0 then
    raise exception 'Invalid manual charge values';
  end if;
  v_amount := p_unit_amount_cents * p_quantity + p_tax_amount_cents;
  insert into public.folio_items(property_id, folio_id, booking_id, business_date, item_type, description, quantity,
    unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, tax_rate_id, posted_by)
  values (v_folio.property_id, v_folio.id, v_folio.booking_id, v_date, p_item_type, p_description, p_quantity,
    p_unit_amount_cents, p_unit_amount_cents * p_quantity, p_tax_amount_cents, v_amount, p_tax_rate_id, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create function public.post_room_charge(p_folio_id uuid, p_booking_room_night_id uuid, p_business_date date default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_folio public.folios; v_night record; v_date date; v_id uuid; v_net bigint;
begin
  perform public.require_financial_staff();
  select * into v_folio from public.folios where id = p_folio_id and property_id = public.current_property_id() and status = 'open';
  select brn.*, br.booking_id into v_night from public.booking_room_nights brn
    join public.booking_rooms br on br.id = brn.booking_room_id and br.property_id = brn.property_id
    where brn.id = p_booking_room_night_id and brn.property_id = public.current_property_id();
  if not found or v_night.booking_id <> v_folio.booking_id then raise exception 'Room night does not belong to folio booking'; end if;
  v_date := coalesce(p_business_date, public.open_business_date(v_folio.property_id));
  if v_date is null or v_date <> v_night.stay_date then raise exception 'Room charge must post on its open stay business date'; end if;
  v_net := v_night.room_rate_cents - v_night.discount_cents;
  if v_net < 0 then raise exception 'Room night discount exceeds room rate'; end if;
  insert into public.folio_items(property_id, folio_id, booking_id, booking_room_night_id, business_date, item_type, description,
    quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, posted_by)
  values (v_folio.property_id, v_folio.id, v_folio.booking_id, p_booking_room_night_id, v_date, 'room_charge',
    format('Room charge for %s', v_night.stay_date), 1, v_net, v_net, v_night.tax_cents, v_net + v_night.tax_cents, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create function public.reverse_charge(p_folio_item_id uuid, p_description text default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_item public.folio_items; v_id uuid;
begin
  perform public.require_financial_staff();
  select * into v_item from public.folio_items where id = p_folio_item_id and property_id = public.current_property_id() and reverses_id is null;
  if not found then raise exception 'Original folio item not found or is already a reversal'; end if;
  insert into public.folio_items(property_id, folio_id, booking_id, business_date, item_type, description, quantity,
    unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, tax_rate_id, reverses_id, posted_by)
  values (v_item.property_id, v_item.folio_id, v_item.booking_id, public.open_business_date(v_item.property_id), 'reversal',
    coalesce(p_description, 'Reversal: ' || v_item.description), v_item.quantity, v_item.unit_amount_cents, v_item.net_amount_cents,
    v_item.tax_amount_cents, v_item.amount_cents, v_item.tax_rate_id, v_item.id, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create function public.record_payment(p_folio_id uuid, p_payment_method_id uuid, p_amount_cents bigint,
  p_external_reference text default null, p_authorization_reference text default null, p_shift_id uuid default null,
  p_business_date date default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_folio public.folios; v_method public.payment_methods; v_date date; v_id uuid;
begin
  perform public.require_financial_staff();
  select * into v_folio from public.folios where id = p_folio_id and property_id = public.current_property_id() and status = 'open';
  select * into v_method from public.payment_methods where id = p_payment_method_id and property_id = public.current_property_id() and is_active;
  if not found or v_folio.id is null then raise exception 'Open folio or active payment method not found'; end if;
  if p_amount_cents <= 0 then raise exception 'Payment amount must be positive'; end if;
  v_date := coalesce(p_business_date, public.open_business_date(v_folio.property_id));
  if v_date is null then raise exception 'No open business date for property'; end if;
  insert into public.payments(property_id, folio_id, booking_id, payment_method_id, amount_cents, currency, business_date,
    received_by, external_reference, authorization_reference, shift_id)
  values(v_folio.property_id, v_folio.id, v_folio.booking_id, v_method.id, p_amount_cents, v_folio.currency, v_date,
    auth.uid(), p_external_reference, p_authorization_reference, p_shift_id) returning id into v_id;
  return v_id;
end;
$$;

create function public.post_discount(p_folio_item_id uuid, p_amount_cents bigint, p_description text)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_item public.folio_items; v_id uuid; v_date date;
begin
  perform public.require_financial_staff();
  select * into v_item from public.folio_items where id = p_folio_item_id
    and property_id = public.current_property_id() and reverses_id is null;
  if not found then raise exception 'Original charge not found or is already reversed'; end if;
  if p_amount_cents <= 0 or p_amount_cents > v_item.amount_cents then
    raise exception 'Discount amount must be positive and not exceed original charge';
  end if;
  v_date := public.open_business_date(v_item.property_id);
  if v_date is null then raise exception 'No open business date for property'; end if;
  insert into public.folio_items(property_id, folio_id, booking_id, business_date, item_type, description, quantity,
    unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, reverses_id, posted_by)
  values(v_item.property_id, v_item.folio_id, v_item.booking_id, v_date, 'discount', p_description, 1,
    p_amount_cents, p_amount_cents, 0, p_amount_cents, v_item.id, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create function public.reverse_payment(p_payment_id uuid, p_external_reference text default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_payment public.payments; v_id uuid; v_date date;
begin
  perform public.require_financial_staff();
  select * into v_payment from public.payments where id = p_payment_id and property_id = public.current_property_id() and reverses_id is null;
  if not found then raise exception 'Original payment not found or is already a reversal'; end if;
  v_date := public.open_business_date(v_payment.property_id);
  if v_date is null then raise exception 'No open business date for property'; end if;
  insert into public.payments(property_id, folio_id, booking_id, payment_method_id, amount_cents, currency, business_date,
    received_by, external_reference, authorization_reference, shift_id, reverses_id)
  values(v_payment.property_id, v_payment.folio_id, v_payment.booking_id, v_payment.payment_method_id, v_payment.amount_cents,
    v_payment.currency, v_date, auth.uid(), coalesce(p_external_reference, v_payment.external_reference),
    v_payment.authorization_reference, v_payment.shift_id, v_payment.id) returning id into v_id;
  return v_id;
end;
$$;

create function public.get_folio_balance(p_folio_id uuid)
returns table(total_charges_cents bigint, total_payments_cents bigint, outstanding_cents bigint, settlement_status text)
language sql stable security invoker set search_path = public as $$
  select total_charges_cents, total_payments_cents, outstanding_cents, settlement_status
  from public.folio_balances where folio_id = p_folio_id and property_id = public.current_property_id();
$$;

create function public.log_financial_activity()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare v_action text; v_summary text; v_method public.payment_methods; v_balance bigint;
begin
  if tg_table_name = 'folios' then
    insert into public.activity_log(property_id, actor_id, entity_type, entity_id, action, summary, metadata)
    values(new.property_id, auth.uid(), 'folio', new.id, 'folio_opened', format('Folio %s opened', new.folio_number),
      jsonb_build_object('booking_id', new.booking_id, 'folio_id', new.id));
  elsif tg_table_name = 'folio_items' then
    v_action := case when new.reverses_id is null then 'charge_posted' else 'charge_reversed' end;
    v_summary := case when new.reverses_id is null then format('Charge posted: %s', new.description) else format('Charge reversed: %s', new.description) end;
    insert into public.activity_log(property_id, actor_id, entity_type, entity_id, action, summary, metadata)
    values(new.property_id, new.posted_by, 'folio_item', new.id, v_action, v_summary,
      jsonb_build_object('booking_id', new.booking_id, 'folio_id', new.folio_id, 'amount_cents', new.amount_cents, 'item_type', new.item_type));
  else
    select * into v_method from public.payment_methods where id = new.payment_method_id;
    v_action := case when new.reverses_id is null then 'payment_received' else 'payment_reversed' end;
    insert into public.activity_log(property_id, actor_id, entity_type, entity_id, action, summary, metadata)
    values(new.property_id, new.received_by, 'payment', new.id, v_action,
      case when new.reverses_id is null then format('Payment received via %s', v_method.name) else format('Payment reversed via %s', v_method.name) end,
      jsonb_build_object('booking_id', new.booking_id, 'folio_id', new.folio_id, 'amount_cents', new.amount_cents, 'payment_method', v_method.kind));
    select outstanding_cents into v_balance from public.folio_balances where folio_id = new.folio_id;
    if v_balance = 0 then
      insert into public.activity_log(property_id, actor_id, entity_type, entity_id, action, summary, metadata)
      values(new.property_id, new.received_by, 'folio', new.folio_id, 'folio_settled', 'Folio settled',
        jsonb_build_object('booking_id', new.booking_id, 'folio_id', new.folio_id));
    end if;
  end if;
  return new;
end;
$$;
create trigger folios_log_opened after insert on public.folios for each row execute function public.log_financial_activity();
create trigger folio_items_log_activity after insert on public.folio_items for each row execute function public.log_financial_activity();
create trigger payments_log_activity after insert on public.payments for each row execute function public.log_financial_activity();

-- Every reservation begins with one guest folio. Later split/company folios use create_folio.
create function public.create_primary_folio_for_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.folios(property_id, booking_id, customer_id, kind, is_primary, currency)
  select new.property_id, new.id, new.customer_id, 'guest', true, p.currency from public.properties p where p.id = new.property_id;
  return new;
end;
$$;
-- Backfill bookings created before this migration, then protect the invariant going forward.
insert into public.folios(property_id, booking_id, customer_id, kind, is_primary, currency)
select b.property_id, b.id, b.customer_id, 'guest', true, p.currency
from public.bookings b join public.properties p on p.id = b.property_id
where not exists (select 1 from public.folios f where f.booking_id = b.id and f.is_primary);

create trigger bookings_create_primary_folio after insert on public.bookings
  for each row execute function public.create_primary_folio_for_booking();

alter table public.tax_rates enable row level security;
alter table public.payment_methods enable row level security;
alter table public.folios enable row level security;
alter table public.folio_items enable row level security;
alter table public.payments enable row level security;
create policy tax_rates_select_same_property on public.tax_rates for select using (property_id = public.current_property_id());
create policy tax_rates_manage_finance on public.tax_rates for all using (
  property_id = public.current_property_id() and public.current_role() in ('admin', 'manager')
) with check (property_id = public.current_property_id() and public.current_role() in ('admin', 'manager'));
create policy payment_methods_select_same_property on public.payment_methods for select using (property_id = public.current_property_id());
create policy payment_methods_manage_finance on public.payment_methods for all using (
  property_id = public.current_property_id() and public.current_role() in ('admin', 'manager')
) with check (property_id = public.current_property_id() and public.current_role() in ('admin', 'manager'));
create policy folios_select_same_property on public.folios for select using (property_id = public.current_property_id());
create policy folio_items_select_same_property on public.folio_items for select using (property_id = public.current_property_id());
create policy payments_select_same_property on public.payments for select using (property_id = public.current_property_id());

revoke all on table public.folios, public.folio_items, public.payments from anon, authenticated;
grant select on public.folios, public.folio_items, public.payments to authenticated;
revoke all on function public.validate_financial_record(), public.prevent_financial_mutation(), public.require_financial_staff(), public.open_business_date(uuid), public.log_financial_activity(), public.create_primary_folio_for_booking() from public;
revoke all on function public.create_folio(uuid, public.folio_kind, boolean), public.close_folio(uuid, boolean), public.post_charge(uuid, public.folio_item_type, text, bigint, integer, bigint, uuid, date), public.post_room_charge(uuid, uuid, date), public.reverse_charge(uuid, text), public.post_discount(uuid, bigint, text), public.record_payment(uuid, uuid, bigint, text, text, uuid, date), public.reverse_payment(uuid, text) from public;
grant execute on function public.create_folio(uuid, public.folio_kind, boolean), public.close_folio(uuid, boolean), public.post_charge(uuid, public.folio_item_type, text, bigint, integer, bigint, uuid, date), public.post_room_charge(uuid, uuid, date), public.reverse_charge(uuid, text), public.post_discount(uuid, bigint, text), public.record_payment(uuid, uuid, bigint, text, text, uuid, date), public.reverse_payment(uuid, text), public.get_folio_balance(uuid) to authenticated;
