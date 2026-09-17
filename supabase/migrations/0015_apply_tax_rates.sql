-- Tax had nowhere to be calculated.
--
-- post_charge() accepted a tax_rate_id, stored it on the folio item, and never
-- looked at tax_rates.rate_bps. The caller had to work the tax out and pass it
-- in — which in this application means JavaScript doing arithmetic on money,
-- something CLAUDE.md forbids outright. Rates existed; nothing applied them.
--
-- Worse, the old shape could only ever express an exclusive rate. It set
-- net = unit x quantity and amount = net + tax, so an inclusive rate — where
-- the price a guest is quoted already contains the tax — had no way to be
-- represented at all.

-- One definition of how a rate turns an amount into net, tax and gross.
--
-- Intermediates are numeric because numeric is exact decimal, not floating
-- point; every value returned is whole pence as bigint. round() is half-up,
-- and amounts here are never negative.
create function public.apply_tax_rate(
  p_tax_rate_id uuid,
  p_amount_cents bigint
)
returns table (
  net_cents bigint,
  tax_cents bigint,
  gross_cents bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rate public.tax_rates;
  v_tax bigint;
begin
  select * into v_rate
  from public.tax_rates
  where id = p_tax_rate_id and property_id = public.current_property_id();

  if not found then
    raise exception 'That tax rate does not belong to this property';
  end if;

  if not v_rate.is_active then
    raise exception 'Tax rate % is retired and cannot be applied to a new charge', v_rate.name;
  end if;

  if p_amount_cents < 0 then
    raise exception 'Tax cannot be applied to a negative amount';
  end if;

  if v_rate.inclusion = 'exclusive' then
    -- The amount is net. Tax goes on top.
    v_tax := round(p_amount_cents::numeric * v_rate.rate_bps / 10000)::bigint;
    return query select p_amount_cents, v_tax, p_amount_cents + v_tax;
  else
    -- The amount is what the guest pays. Tax is already inside it.
    v_tax := round(
      p_amount_cents::numeric * v_rate.rate_bps / (10000 + v_rate.rate_bps)
    )::bigint;
    return query select p_amount_cents - v_tax, v_tax, p_amount_cents;
  end if;
end;
$$;

comment on function public.apply_tax_rate(uuid, bigint) is
  'Splits an amount into net, tax and gross for a tax rate, honouring whether the rate is inclusive or exclusive.';

-- p_tax_amount_cents now defaults to null rather than 0, which is what lets a
-- caller say "work it out" as distinct from "there is no tax". Passing a
-- figure still overrides everything, so existing callers are unaffected:
-- record_paid_out() passes 0 and still posts a charge with no tax.
create or replace function public.post_charge(
  p_folio_id uuid,
  p_item_type public.folio_item_type,
  p_description text,
  p_unit_amount_cents bigint,
  p_quantity integer default 1,
  p_tax_amount_cents bigint default null,
  p_tax_rate_id uuid default null,
  p_business_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_folio public.folios;
  v_date date;
  v_id uuid;
  v_base bigint;
  v_net bigint;
  v_tax bigint;
  v_amount bigint;
begin
  perform public.require_financial_staff();

  select * into v_folio
  from public.folios
  where id = p_folio_id and property_id = public.current_property_id() and status = 'open';

  if not found then
    raise exception 'Open folio not found for current property';
  end if;

  v_date := coalesce(p_business_date, public.open_business_date(v_folio.property_id));
  if v_date is null then
    raise exception 'No open business date for property';
  end if;

  if p_item_type in ('room_charge', 'reversal', 'discount')
     or p_unit_amount_cents < 0
     or p_quantity <= 0
     or coalesce(p_tax_amount_cents, 0) < 0 then
    raise exception 'Invalid manual charge values';
  end if;

  v_base := p_unit_amount_cents * p_quantity;

  if p_tax_amount_cents is not null then
    -- Explicit figure wins, and is treated as added on top, exactly as before.
    v_net := v_base;
    v_tax := p_tax_amount_cents;
    v_amount := v_net + v_tax;
  elsif p_tax_rate_id is not null then
    select t.net_cents, t.tax_cents, t.gross_cents
    into v_net, v_tax, v_amount
    from public.apply_tax_rate(p_tax_rate_id, v_base) t;
  else
    v_net := v_base;
    v_tax := 0;
    v_amount := v_base;
  end if;

  insert into public.folio_items (
    property_id, folio_id, booking_id, business_date, item_type, description,
    quantity, unit_amount_cents, net_amount_cents, tax_amount_cents,
    amount_cents, tax_rate_id, posted_by
  ) values (
    v_folio.property_id, v_folio.id, v_folio.booking_id, v_date, p_item_type,
    p_description, p_quantity, p_unit_amount_cents, v_net, v_tax,
    v_amount, p_tax_rate_id, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.apply_tax_rate(uuid, bigint) from public, anon;
grant execute on function public.apply_tax_rate(uuid, bigint) to authenticated;
