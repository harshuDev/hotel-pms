-- Layer 8: what the cashier screen needs that Layer 4 did not model.
--
-- cash_movements recorded an amount and a free-text reason. The paid-out form
-- has always collected more than that: a category, who the money went to, and
-- whether the hotel is recharging it to a guest. Those were dropped on the
-- floor. They are columns now, so paid-outs can be reported on.
--
-- A recharged paid-out is two facts in one action — cash leaves the drawer and
-- the guest owes the hotel — so record_paid_out() writes both inside a single
-- transaction and links them. Never one without the other.

create type public.paid_out_category as enum (
  'taxi', 'guest_purchase', 'medical', 'supplies', 'staff_advance', 'other'
);

alter table public.cash_movements
  add column category public.paid_out_category,
  add column payee text,
  add column recharge_folio_item_id uuid;

alter table public.cash_movements
  add constraint cash_movements_recharge_folio_item_fk
  foreign key (recharge_folio_item_id, property_id)
  references public.folio_items (id, property_id) on delete restrict;

-- Only a paid-out has a payee or a recharge; a cash drop does not.
alter table public.cash_movements
  add constraint cash_movements_paid_out_fields_only check (
    movement_type = 'paid_out'
    or (category is null and payee is null and recharge_folio_item_id is null)
  );

create index cash_movements_recharge_folio_item_idx
  on public.cash_movements (property_id, recharge_folio_item_id)
  where recharge_folio_item_id is not null;

-- Money out of the drawer, optionally recharged to a guest folio.
create function public.record_paid_out(
  p_shift_id uuid,
  p_amount_cents bigint,
  p_category public.paid_out_category,
  p_reason text,
  p_payee text default null,
  p_recharge_booking_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_shift public.cashier_shifts;
  v_folio_id uuid;
  v_item_id uuid;
  v_id uuid;
begin
  perform public.require_financial_staff();

  select * into v_shift
  from public.cashier_shifts
  where id = p_shift_id
    and property_id = public.current_property_id()
    and status = 'open';

  if not found then
    raise exception 'Open cashier shift not found for the current property';
  end if;

  if v_shift.cashier_id <> auth.uid()
     and public.current_role() not in ('admin', 'manager') then
    raise exception 'A paid-out may only be recorded against your own open shift';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'A paid-out must be more than zero';
  end if;

  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A paid-out needs a reason';
  end if;

  -- Recharge first: if the guest cannot be charged, no cash leaves the drawer.
  if p_recharge_booking_id is not null then
    select f.id into v_folio_id
    from public.folios f
    where f.booking_id = p_recharge_booking_id
      and f.property_id = public.current_property_id()
      and f.status = 'open'
    order by f.is_primary desc, f.folio_number
    limit 1;

    if v_folio_id is null then
      raise exception 'That booking has no open folio to recharge the paid-out to';
    end if;

    v_item_id := public.post_charge(
      v_folio_id, 'miscellaneous', btrim(p_reason), p_amount_cents, 1, 0
    );
  end if;

  insert into public.cash_movements (
    property_id, shift_id, business_date_id, movement_type, direction,
    amount_cents, reason, created_by, category, payee, recharge_folio_item_id
  ) values (
    v_shift.property_id, v_shift.id, v_shift.business_date_id, 'paid_out', 'out',
    p_amount_cents, btrim(p_reason), auth.uid(), p_category,
    nullif(btrim(coalesce(p_payee, '')), ''), v_item_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_paid_out(uuid, bigint, public.paid_out_category, text, text, uuid) is
  'Records cash leaving the drawer, and the guest charge when it is recharged, in one transaction.';

-- The signed-in cashier's own open shift, if they have one.
create function public.current_cashier_shift()
returns table (
  shift_id uuid,
  cashier_id uuid,
  cashier_name text,
  business_date date,
  status public.cashier_shift_status,
  opened_at timestamptz,
  opening_balance_cents bigint
)
language sql
stable
security invoker
set search_path = public, auth
as $$
  select s.id, s.cashier_id, u.full_name, bd.business_date, s.status,
         s.opened_at, s.opening_balance_cents
  from public.cashier_shifts s
  join public.business_dates bd
    on bd.id = s.business_date_id and bd.property_id = s.property_id
  join public.staff_users u
    on u.id = s.cashier_id and u.property_id = s.property_id
  where s.property_id = public.current_property_id()
    and s.cashier_id = auth.uid()
    and s.status in ('open', 'closing')
  order by s.opened_at desc
  limit 1;
$$;

-- Payments taken during a shift.
--
-- Only cash carries shift_id — validate_cash_payment_shift() rejects it on
-- anything else — so a card payment is tied to the shift by who took it and
-- when, not by a foreign key.
create function public.cashier_shift_payments(p_shift_id uuid)
returns table (
  payment_id uuid,
  booking_reference text,
  guest_name text,
  payment_method_id uuid,
  method_name text,
  affects_drawer boolean,
  amount_cents bigint,
  paid_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    b.reference,
    public.customer_display_name(c),
    pm.id,
    pm.name,
    pm.affects_drawer,
    p.signed_amount_cents,
    p.paid_at
  from public.cashier_shifts s
  join public.payments p
    on p.property_id = s.property_id
   and p.received_by = s.cashier_id
   and p.paid_at >= s.opened_at
   and (s.closed_at is null or p.paid_at < s.closed_at)
  join public.payment_methods pm
    on pm.id = p.payment_method_id and pm.property_id = p.property_id
  join public.bookings b
    on b.id = p.booking_id and b.property_id = p.property_id
  join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  where s.id = p_shift_id
    and s.property_id = public.current_property_id()
  order by p.paid_at desc;
$$;

create function public.cashier_shift_paid_outs(p_shift_id uuid)
returns table (
  movement_id uuid,
  amount_cents bigint,
  category public.paid_out_category,
  reason text,
  payee text,
  recharge_booking_reference text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.id,
    m.amount_cents,
    m.category,
    m.reason,
    m.payee,
    b.reference,
    m.created_at
  from public.cash_movements m
  left join public.folio_items fi
    on fi.id = m.recharge_folio_item_id and fi.property_id = m.property_id
  left join public.bookings b
    on b.id = fi.booking_id and b.property_id = fi.property_id
  where m.shift_id = p_shift_id
    and m.property_id = public.current_property_id()
    and m.movement_type = 'paid_out'
  order by m.created_at desc;
$$;

revoke all on function
  public.record_paid_out(uuid, bigint, public.paid_out_category, text, text, uuid),
  public.current_cashier_shift(),
  public.cashier_shift_payments(uuid),
  public.cashier_shift_paid_outs(uuid)
from public, anon;

grant execute on function
  public.record_paid_out(uuid, bigint, public.paid_out_category, text, text, uuid),
  public.current_cashier_shift(),
  public.cashier_shift_payments(uuid),
  public.cashier_shift_paid_outs(uuid)
to authenticated;
