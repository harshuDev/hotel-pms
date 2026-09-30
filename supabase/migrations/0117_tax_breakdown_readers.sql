-- 0117: what reads the per-tax split 0116 stored.
--
-- 1. booking_invoice_taxes(booking): each tax on the booking's folio and what
--    it came to, so the printed invoice lists "VAT 20%" and "City tax 3%"
--    separately rather than one Tax figure. Summed from folio_items'
--    tax_breakdown, signed the way every amount is (a reversal takes its
--    share back off). A charge posted before 0116 has no breakdown: its tax
--    goes to the rate it names, or to an unnamed line (tax_rate_id null) --
--    so the lines always add up to the invoice's tax total exactly.
-- 2. set_booking_room_rate() with no taxes named prices the nights with the
--    taxes the room's other nights already carry. Its one caller prices the
--    nights an extension added, and before this they came in tax-free
--    whatever the rest of the stay was charged. An explicit empty set is
--    still "no tax".

create or replace function public.booking_invoice_taxes(p_booking_id uuid)
returns table (tax_rate_id uuid, name text, rate_bps integer, tax_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with parts as (
    -- Each item's share per tax. signed_tax_amount_cents / tax_amount_cents
    -- is exactly 1 or -1, so it carries the reversal sign without writing
    -- the CASE out again.
    select (b.key)::uuid as tax_rate_id,
           (b.value)::bigint * (fi.signed_tax_amount_cents / fi.tax_amount_cents) as cents
    from public.folio_items fi
    cross join lateral jsonb_each_text(fi.tax_breakdown) b
    where fi.booking_id = p_booking_id
      and fi.property_id = public.current_property_id()
      and fi.tax_amount_cents <> 0
      and fi.tax_breakdown is not null
    union all
    -- Posted before 0116: the whole tax, to the rate the item names if any.
    select fi.tax_rate_id, fi.signed_tax_amount_cents
    from public.folio_items fi
    where fi.booking_id = p_booking_id
      and fi.property_id = public.current_property_id()
      and fi.tax_amount_cents <> 0
      and fi.tax_breakdown is null
  )
  select p.tax_rate_id, t.name, t.rate_bps, sum(p.cents)::bigint
  from parts p
  left join public.tax_rates t on t.id = p.tax_rate_id
  group by p.tax_rate_id, t.name, t.rate_bps, t.sort_order
  having sum(p.cents) <> 0
  order by t.sort_order nulls last, t.name;
$$;
revoke all on function public.booking_invoice_taxes(uuid) from public, anon;
grant execute on function public.booking_invoice_taxes(uuid) to authenticated;

create or replace function public.set_booking_room_rate(
  p_booking_room_id uuid,
  p_rate_cents bigint,
  p_from date default null,
  p_to date default null,
  p_tax_rate_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_room public.booking_rooms;
  v_taxes uuid[];
  v_net bigint;
  v_tax bigint;
  v_breakdown jsonb;
  v_count integer;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can change a rate';
  end if;

  v_property := public.current_property_id();

  select * into v_room from public.booking_rooms
  where id = p_booking_room_id and property_id = v_property;
  if not found then
    raise exception 'That room is not on a booking for this property';
  end if;

  if p_rate_cents is null or p_rate_cents < 0 then
    raise exception 'A nightly rate cannot be negative';
  end if;

  -- None named: the taxes the rest of this room's stay carries.
  v_taxes := p_tax_rate_ids;
  if v_taxes is null then
    select coalesce(array_agg(distinct k::uuid), '{}') into v_taxes
    from public.booking_room_nights bn
    cross join lateral jsonb_object_keys(bn.tax_breakdown) k
    where bn.booking_room_id = p_booking_room_id
      and bn.property_id = v_property
      and bn.tax_breakdown is not null;
  end if;

  if cardinality(v_taxes) > 0 then
    -- A named set must be live; one inherited from the stay skips a rate
    -- retired since, as the guest page does.
    select t.net_cents, t.tax_cents, t.breakdown into v_net, v_tax, v_breakdown
    from public.tax_split_multi(v_property, v_taxes, p_rate_cents, p_tax_rate_ids is not null) t;
  else
    v_net := p_rate_cents;
    v_tax := 0;
    v_breakdown := null;
  end if;

  -- A night already charged keeps its rate. The folio is what the guest owes,
  -- and changing the night underneath it would put the two out of step.
  update public.booking_room_nights bn
  set room_rate_cents = v_net, tax_cents = coalesce(v_tax, 0), tax_breakdown = v_breakdown
  where bn.booking_room_id = p_booking_room_id
    and bn.property_id = v_property
    and (p_from is null or bn.stay_date >= p_from)
    and (p_to is null or bn.stay_date <= p_to)
    and not exists (
      select 1 from public.folio_items fi
      where fi.booking_room_night_id = bn.id
        and fi.property_id = bn.property_id
        and fi.reverses_id is null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.set_booking_room_rate(uuid, bigint, date, date, uuid[]) from public, anon;
grant execute on function public.set_booking_room_rate(uuid, bigint, date, date, uuid[]) to authenticated;
