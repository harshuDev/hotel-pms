-- Layer 13a: the money reports — payments, extras, daily checkout, financial.
--
-- Everything here groups by business_date, never by created_at or paid_at.
-- The hotel operating day is the unit an auditor reconciles against, and a
-- payment taken at 01:00 belongs to the night that has not yet been closed.
--
-- Two things this migration adds before the reports themselves:
--
-- 1. Signed net and tax columns on folio_items. Reversals are reversing rows,
--    so a total must carry the sign, and CLAUDE.md is explicit that the CASE
--    lives in the column definition and nowhere else. amount_cents already had
--    one; net and tax did not, which left every report that splits tax out of
--    revenue hand-writing it.
-- 2. A role gate for the money reports. Table RLS is property isolation only,
--    so housekeeping can currently read payments. Narrowing that policy would
--    reach into the cashier screen, so this gates the report entry points and
--    leaves the tables alone. The gap in the policy itself is worth raising.

alter table public.folio_items
  add column signed_net_amount_cents bigint generated always as
    (net_amount_cents * case when reverses_id is null then 1 else -1 end) stored,
  add column signed_tax_amount_cents bigint generated always as
    (tax_amount_cents * case when reverses_id is null then 1 else -1 end) stored;

comment on column public.folio_items.signed_net_amount_cents is
  'net_amount_cents carrying the reversal sign. Sum this, never the unsigned column.';
comment on column public.folio_items.signed_tax_amount_cents is
  'tax_amount_cents carrying the reversal sign. Sum this, never the unsigned column.';

create function public.can_see_money_reports()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    public.current_role() in ('admin', 'manager', 'front_desk', 'cashier'),
    false
  );
$$;

comment on function public.can_see_money_reports() is
  'Whether the caller may run the revenue and payment reports. Housekeeping may not.';

create function public.require_money_reports()
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.can_see_money_reports() then
    -- The front end matches on this text to show an access panel rather than
    -- an error, so do not reword it without changing reportAccessDenied().
    raise exception 'REPORT_ACCESS_DENIED';
  end if;
end;
$$;

revoke all on function public.can_see_money_reports() from public, anon;
revoke all on function public.require_money_reports() from public, anon;
grant execute on function public.can_see_money_reports() to authenticated;
grant execute on function public.require_money_reports() to authenticated;


-- Folio lines, classified ----------------------------------------------------
--
-- reverse_charge() posts its row as item_type 'reversal', not as the type it
-- reverses, so filtering folio_items on item_type directly is wrong twice
-- over: a reversed room charge never comes off room revenue, and it lands in
-- whatever bucket catches 'reversal' instead. post_discount() also sets
-- reverses_id, so "has a reverses_id" does not mean "is a reversal" either.
--
-- This view is the one place that untangles the two. Read it, not folio_items,
-- whenever a report splits revenue by type.

create view public.folio_item_lines
with (security_invoker = true)
as
select
  fi.id,
  fi.property_id,
  fi.folio_id,
  fi.booking_id,
  fi.business_date,
  fi.description,
  fi.quantity,
  fi.item_type as posted_item_type,
  case
    when fi.reverses_id is null then fi.item_type
    when fi.item_type = 'discount' then 'discount'::public.folio_item_type
    else coalesce(orig.item_type, fi.item_type)
  end as effective_item_type,
  (fi.reverses_id is not null and fi.item_type <> 'discount') as is_reversal,
  (fi.item_type = 'discount') as is_discount,
  fi.signed_net_amount_cents,
  fi.signed_tax_amount_cents,
  fi.signed_amount_cents,
  fi.posted_at
from public.folio_items fi
left join public.folio_items orig
  on orig.id = fi.reverses_id and orig.property_id = fi.property_id;

comment on view public.folio_item_lines is
  'folio_items with reversals attributed back to the type they reverse. Use this for any revenue split by item type.';

revoke all on public.folio_item_lines from public, anon;
grant select on public.folio_item_lines to authenticated;


-- Payments -------------------------------------------------------------------
--
-- One row per payment, reversals included and signed, so the report and the
-- drawer can never disagree. affects_drawer is carried through because "what
-- did we take" and "what is in the till" are different questions.

create function public.payments_report(p_from date, p_to date)
returns table (
  payment_id uuid,
  business_date date,
  paid_at timestamptz,
  method_name text,
  method_kind public.payment_method_kind,
  affects_drawer boolean,
  booking_id uuid,
  reference text,
  guest_name text,
  received_by text,
  external_reference text,
  is_reversal boolean,
  amount_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public.require_money_reports();

  return query
  select
    p.id,
    p.business_date,
    p.paid_at,
    pm.name,
    pm.kind,
    pm.affects_drawer,
    p.booking_id,
    b.reference,
    public.customer_display_name(c),
    su.full_name,
    p.external_reference,
    (p.reverses_id is not null),
    p.signed_amount_cents
  from public.payments p
  join public.payment_methods pm
    on pm.id = p.payment_method_id and pm.property_id = p.property_id
  join public.bookings b
    on b.id = p.booking_id and b.property_id = p.property_id
  left join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  left join public.staff_users su
    on su.id = p.received_by and su.property_id = p.property_id
  where p.property_id = public.current_property_id()
    and p.business_date between p_from and p_to
  order by p.business_date desc, p.paid_at desc;
end;
$$;

create function public.payments_report_by_method(p_from date, p_to date)
returns table (
  method_name text,
  method_kind public.payment_method_kind,
  affects_drawer boolean,
  payment_count bigint,
  reversal_count bigint,
  net_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public.require_money_reports();

  return query
  select
    pm.name,
    pm.kind,
    pm.affects_drawer,
    count(*) filter (where p.reverses_id is null),
    count(*) filter (where p.reverses_id is not null),
    coalesce(sum(p.signed_amount_cents), 0)::bigint
  from public.payments p
  join public.payment_methods pm
    on pm.id = p.payment_method_id and pm.property_id = p.property_id
  where p.property_id = public.current_property_id()
    and p.business_date between p_from and p_to
  group by pm.name, pm.kind, pm.affects_drawer
  order by coalesce(sum(p.signed_amount_cents), 0) desc, pm.name;
end;
$$;


-- Extras ---------------------------------------------------------------------
--
-- Everything the guest was charged for that is not the room. Room charges and
-- their tax are excluded deliberately: they are the occupancy report's subject,
-- and leaving them in would make "extras revenue" mean nothing.

create function public.extras_report(p_from date, p_to date)
returns table (
  item_type public.folio_item_type,
  item_count bigint,
  reversal_count bigint,
  net_cents bigint,
  tax_cents bigint,
  gross_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public.require_money_reports();

  return query
  select
    l.effective_item_type,
    count(*) filter (where not l.is_reversal),
    count(*) filter (where l.is_reversal),
    coalesce(sum(l.signed_net_amount_cents), 0)::bigint,
    coalesce(sum(l.signed_tax_amount_cents), 0)::bigint,
    coalesce(sum(l.signed_amount_cents), 0)::bigint
  from public.folio_item_lines l
  where l.property_id = public.current_property_id()
    and l.business_date between p_from and p_to
    and l.effective_item_type not in ('room_charge', 'tax', 'discount')
  group by l.effective_item_type
  order by coalesce(sum(l.signed_amount_cents), 0) desc, l.effective_item_type::text;
end;
$$;


-- Daily checkout -------------------------------------------------------------
--
-- Who departed on one business date and whether they left owing anything. A
-- single date, not a range: this is the report the duty manager runs against
-- the day just closed.

create function public.daily_checkout_report(p_date date)
returns table (
  booking_id uuid,
  reference text,
  guest_name text,
  room_numbers text,
  channel_name text,
  check_in date,
  check_out date,
  nights integer,
  charges_cents bigint,
  payments_cents bigint,
  outstanding_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public.require_money_reports();

  return query
  select
    b.id,
    b.reference,
    public.customer_display_name(c),
    rooms.numbers,
    ch.name,
    b.check_in,
    b.check_out,
    greatest((b.check_out - b.check_in), 0)::integer,
    coalesce(bal.charges, 0)::bigint,
    coalesce(bal.payments, 0)::bigint,
    coalesce(bal.outstanding, 0)::bigint
  from public.bookings b
  left join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  left join public.channels ch
    on ch.id = b.channel_id and ch.property_id = b.property_id
  left join lateral (
    select string_agg(r.number, ', ' order by r.number) as numbers
    from public.booking_rooms br
    join public.rooms r on r.id = br.room_id and r.property_id = br.property_id
    where br.booking_id = b.id and br.property_id = b.property_id
  ) rooms on true
  left join lateral (
    select
      sum(fb.total_charges_cents) as charges,
      sum(fb.total_payments_cents) as payments,
      sum(fb.outstanding_cents) as outstanding
    from public.folio_balances fb
    where fb.booking_id = b.id and fb.property_id = b.property_id
  ) bal on true
  where b.property_id = public.current_property_id()
    and b.check_out = p_date
    and b.status in ('checked_out', 'checked_in')
  order by coalesce(bal.outstanding, 0) desc, b.reference;
end;
$$;


-- Financial ------------------------------------------------------------------
--
-- Revenue posted and money received, business date by business date. The two
-- are not the same number and are not meant to be: a guest can be charged on
-- Monday and settle on Thursday. Charges and payments both carry the reversal
-- sign, so a correction shows up on the day it was made.

create function public.financial_report(p_from date, p_to date)
returns table (
  business_date date,
  room_revenue_cents bigint,
  extras_revenue_cents bigint,
  discounts_cents bigint,
  tax_cents bigint,
  charges_cents bigint,
  payments_cents bigint,
  drawer_payments_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public.require_money_reports();

  return query
  with span as (
    select d::date as business_date
    from generate_series(p_from, p_to, interval '1 day') as d
  ),
  charges as (
    select
      l.business_date,
      coalesce(sum(l.signed_net_amount_cents)
        filter (where l.effective_item_type = 'room_charge'), 0)::bigint as room_revenue,
      coalesce(sum(l.signed_net_amount_cents)
        filter (where l.effective_item_type not in ('room_charge', 'tax', 'discount')), 0)::bigint as extras_revenue,
      coalesce(sum(l.signed_net_amount_cents)
        filter (where l.effective_item_type = 'discount'), 0)::bigint as discounts,
      coalesce(sum(l.signed_tax_amount_cents), 0)::bigint as tax,
      coalesce(sum(l.signed_amount_cents), 0)::bigint as charges
    from public.folio_item_lines l
    where l.property_id = public.current_property_id()
      and l.business_date between p_from and p_to
    group by l.business_date
  ),
  taken as (
    select
      p.business_date,
      coalesce(sum(p.signed_amount_cents), 0)::bigint as payments,
      coalesce(sum(p.signed_amount_cents) filter (where pm.affects_drawer), 0)::bigint as drawer
    from public.payments p
    join public.payment_methods pm
      on pm.id = p.payment_method_id and pm.property_id = p.property_id
    where p.property_id = public.current_property_id()
      and p.business_date between p_from and p_to
    group by p.business_date
  )
  select
    span.business_date,
    coalesce(charges.room_revenue, 0)::bigint,
    coalesce(charges.extras_revenue, 0)::bigint,
    coalesce(charges.discounts, 0)::bigint,
    coalesce(charges.tax, 0)::bigint,
    coalesce(charges.charges, 0)::bigint,
    coalesce(taken.payments, 0)::bigint,
    coalesce(taken.drawer, 0)::bigint
  from span
  left join charges on charges.business_date = span.business_date
  left join taken on taken.business_date = span.business_date
  order by span.business_date;
end;
$$;

revoke all on function public.payments_report(date, date) from public, anon;
revoke all on function public.payments_report_by_method(date, date) from public, anon;
revoke all on function public.extras_report(date, date) from public, anon;
revoke all on function public.daily_checkout_report(date) from public, anon;
revoke all on function public.financial_report(date, date) from public, anon;

grant execute on function public.payments_report(date, date) to authenticated;
grant execute on function public.payments_report_by_method(date, date) to authenticated;
grant execute on function public.extras_report(date, date) to authenticated;
grant execute on function public.daily_checkout_report(date) to authenticated;
grant execute on function public.financial_report(date, date) to authenticated;
