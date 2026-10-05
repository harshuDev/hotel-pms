-- 0127: the booking's Folio tab, laid out as the reference's.
--
-- The client sent their current system's folio and asked for ours to work the
-- same way: Accommodation (one line per room with Count, Net, Taxes, Total and
-- a nights and a tax breakdown), Payments, then Total, Accommodation
-- Sub-total, Extra Sub-total, each tax with its base, and Due.
--
-- Since 0125 nothing is charged until check-out, so a folio read from
-- folio_items alone would be empty for the whole stay. The reference shows
-- the stay from the moment it is booked, and so does this:
--   - a night already CHARGED is read from the folio items posted for it
--     (the room charge, any included meals or extras split off it, and any
--     reversal of them), so what is shown is what was posted;
--   - a live night not yet charged is read from booking_room_nights, at the
--     rate check-out will post it at;
--   - a cancelled night with nothing posted is not shown.
-- So Total less payments is exactly the folio balance plus the nights still
-- to post -- the figure the check-out dialog shows.
--
-- One read, aggregated here (the "aggregation in Postgres" rule), security
-- invoker so RLS decides what the caller sees.

create or replace function public.booking_folio_view(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as (
    select bk.id, bk.property_id
    from public.bookings bk
    where bk.id = p_booking_id
  ),
  folio as (
    select f.id, f.folio_number, f.status, f.opened_at
    from public.folios f, b
    where f.booking_id = b.id and f.property_id = b.property_id
    order by f.is_primary desc, f.folio_number
    limit 1
  ),
  -- Every folio item posted against one of the booking's nights.
  night_items as (
    select fi.booking_room_night_id as night_id,
           sum(fi.signed_net_amount_cents)::bigint as net,
           sum(fi.signed_tax_amount_cents)::bigint as tax
    from public.folio_items fi, b
    where fi.booking_id = b.id and fi.property_id = b.property_id
      and fi.booking_room_night_id is not null
    group by fi.booking_room_night_id
  ),
  nights as (
    select n.id, n.booking_room_id, n.stay_date,
           (ni.night_id is not null) as charged,
           coalesce(ni.net, n.room_rate_cents - n.discount_cents)::bigint as net,
           coalesce(ni.tax, n.tax_cents)::bigint as tax
    from b
    join public.booking_rooms br on br.booking_id = b.id and br.property_id = b.property_id
    join public.booking_room_nights n on n.booking_room_id = br.id and n.property_id = br.property_id
    left join night_items ni on ni.night_id = n.id
    where ni.night_id is not null or n.status not in ('canceled', 'no_show')
  ),
  rooms as (
    select br.id, br.status, br.adults, br.children,
           coalesce(rt.display_name, rt.name) as room_type,
           r.number as room_number,
           rp.name as rate_plan,
           min(br.check_in) as check_in
    from b
    join public.booking_rooms br on br.booking_id = b.id and br.property_id = b.property_id
    join public.room_types rt on rt.id = br.room_type_id
    left join public.rooms r on r.id = br.room_id
    left join public.rate_plans rp on rp.id = br.rate_plan_id
    where exists (select 1 from nights x where x.booking_room_id = br.id)
    group by br.id, rt.display_name, rt.name, r.number, rp.name
  ),
  -- The tax each line carries, per rate. A charged night reads its posted
  -- items' breakdowns (a reversal negative); an uncharged night its own.
  -- A charge posted before 0116 carries no breakdown and goes to the rate it
  -- names, or to an unnamed tax.
  tax_parts as (
    select key::uuid as tax_rate_id, (value)::bigint as cents, n.net as base, n.id as line
    from nights n
    join public.booking_room_nights brn on brn.id = n.id
    cross join lateral jsonb_each_text(coalesce(brn.tax_breakdown, '{}'::jsonb))
    where not n.charged
    union all
    select (bd.key)::uuid,
           (bd.value)::bigint * case when fi.reverses_id is null then 1 else -1 end,
           fi.signed_net_amount_cents, fi.id
    from public.folio_items fi
    join b on fi.booking_id = b.id and fi.property_id = b.property_id
    cross join lateral jsonb_each_text(fi.tax_breakdown) bd
    where fi.tax_breakdown is not null
    union all
    select fi.tax_rate_id, fi.signed_tax_amount_cents, fi.signed_net_amount_cents, fi.id
    from public.folio_items fi
    join b on fi.booking_id = b.id and fi.property_id = b.property_id
    where fi.tax_breakdown is null and fi.signed_tax_amount_cents <> 0
  ),
  taxes as (
    select tp.tax_rate_id, tr.name, tr.kind, tr.rate_bps, tr.fee_cents, tr.fee_per, tr.sort_order,
           sum(tp.cents)::bigint as cents,
           sum(tp.base)::bigint as base
    from tax_parts tp
    left join public.tax_rates tr on tr.id = tp.tax_rate_id
    group by tp.tax_rate_id, tr.name, tr.kind, tr.rate_bps, tr.fee_cents, tr.fee_per, tr.sort_order
    having sum(tp.cents) <> 0
  ),
  extras as (
    select fi.id, fi.description, fi.quantity, fi.item_type, fi.business_date,
           fi.signed_net_amount_cents as net,
           fi.signed_tax_amount_cents as tax,
           fi.signed_amount_cents as total,
           (fi.reverses_id is not null) as is_reversal,
           exists (select 1 from public.folio_items rv where rv.reverses_id = fi.id) as is_reversed,
           fi.posted_at
    from public.folio_items fi
    join b on fi.booking_id = b.id and fi.property_id = b.property_id
    where fi.booking_room_night_id is null
  ),
  pays as (
    select p.id, p.business_date, p.paid_at, pm.name as method,
           p.signed_amount_cents as amount,
           (p.reverses_id is not null) as is_reversal
    from public.payments p
    join b on p.booking_id = b.id and p.property_id = b.property_id
    left join public.payment_methods pm on pm.id = p.payment_method_id
  ),
  sums as (
    select
      coalesce((select sum(net) from nights), 0)::bigint as acc_net,
      coalesce((select sum(tax) from nights), 0)::bigint as acc_tax,
      coalesce((select sum(net) from extras), 0)::bigint as ext_net,
      coalesce((select sum(tax) from extras), 0)::bigint as ext_tax,
      coalesce((select sum(amount) from pays), 0)::bigint as paid
  )
  select jsonb_build_object(
    'folio', (select jsonb_build_object(
                'id', f.id, 'number', f.folio_number, 'status', f.status, 'opened_at', f.opened_at)
              from folio f),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'booking_room_id', r.id,
        'room_type', r.room_type,
        'room_number', r.room_number,
        'rate_plan', r.rate_plan,
        'status', r.status,
        'adults', r.adults,
        'children', r.children,
        'count', (select count(*) from nights n where n.booking_room_id = r.id),
        'net', (select coalesce(sum(n.net), 0) from nights n where n.booking_room_id = r.id),
        'tax', (select coalesce(sum(n.tax), 0) from nights n where n.booking_room_id = r.id),
        'nights', (select jsonb_agg(jsonb_build_object(
                      'stay_date', n.stay_date, 'net', n.net, 'tax', n.tax, 'charged', n.charged)
                    order by n.stay_date)
                   from nights n where n.booking_room_id = r.id),
        'taxes', (select coalesce(jsonb_agg(jsonb_build_object('tax_rate_id', t.tax_rate_id, 'cents', t.cents)), '[]'::jsonb)
                  from (
                    select tp.tax_rate_id, sum(tp.cents)::bigint as cents
                    from tax_parts tp
                    where tp.line in (select n.id from nights n where n.booking_room_id = r.id and not n.charged)
                       or tp.line in (select fi.id from public.folio_items fi
                                      join public.booking_room_nights brn on brn.id = fi.booking_room_night_id
                                      where brn.booking_room_id = r.id)
                    group by tp.tax_rate_id
                    having sum(tp.cents) <> 0
                  ) t)
      ) order by r.check_in, r.room_number nulls last, r.id)
      from rooms r), '[]'::jsonb),
    'extras', coalesce((
      select jsonb_agg(jsonb_build_object(
        'folio_item_id', e.id, 'description', e.description, 'quantity', e.quantity,
        'item_type', e.item_type, 'business_date', e.business_date,
        'net', e.net, 'tax', e.tax, 'total', e.total,
        'is_reversal', e.is_reversal, 'is_reversed', e.is_reversed
      ) order by e.posted_at)
      from extras e), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_id', p.id, 'business_date', p.business_date, 'paid_at', p.paid_at,
        'method', p.method, 'amount', p.amount, 'is_reversal', p.is_reversal
      ) order by p.paid_at)
      from pays p), '[]'::jsonb),
    'taxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tax_rate_id', t.tax_rate_id, 'name', t.name, 'kind', t.kind, 'rate_bps', t.rate_bps,
        'fee_cents', t.fee_cents, 'fee_per', t.fee_per, 'base', t.base, 'cents', t.cents)
        order by t.sort_order nulls last, t.name)
      from taxes t), '[]'::jsonb),
    'accommodation_net', s.acc_net,
    'accommodation_tax', s.acc_tax,
    'extras_net', s.ext_net,
    'extras_tax', s.ext_tax,
    'total', s.acc_net + s.acc_tax + s.ext_net + s.ext_tax,
    'paid', s.paid,
    'due', s.acc_net + s.acc_tax + s.ext_net + s.ext_tax - s.paid
  )
  from sums s
  where exists (select 1 from b);
$$;

revoke all on function public.booking_folio_view(uuid) from public;
revoke execute on function public.booking_folio_view(uuid) from anon;
grant execute on function public.booking_folio_view(uuid) to authenticated;
