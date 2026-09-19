-- 0052: the nine reports the client's reference system carries and this one
-- did not.
--
-- Thirteen were built; the reference's menu has twenty-two. These are the
-- other nine. Four needed something behind them first -- 0050 added the guest
-- identity fields, 0051 added the waitlist -- and the remaining five are
-- questions about data this database already held and nobody had asked.
--
-- CONVENTIONS, all inherited and none of them new here:
--   * `security invoker`, so RLS does the filtering. No report re-implements
--     property isolation.
--   * Every operational figure groups by `business_date`. `paid_at` and
--     `created_at` are wall-clock and are never the axis.
--   * Revenue splits read `folio_item_lines`, never `folio_items`, and sum the
--     `signed_` columns. `reverse_charge()` posts as `item_type = 'reversal'`
--     and `post_discount()` sets `reverses_id`, so the raw table attributes
--     both to the wrong bucket.
--   * Anything showing money is behind `require_money_reports()`.

/* -------------------------------------------------------------------------- */
/* A second gate, for guest identity                                          */
/* -------------------------------------------------------------------------- */

/*
 * Passport numbers and dates of birth are not revenue, so the money gate is
 * the wrong test -- a cashier may see a folio and has no business reading a
 * guest's travel document. This is the front-office test instead.
 *
 * IT RAISES THE SAME STRING on purpose. `src/lib/queries.ts` matches on
 * REPORT_ACCESS_DENIED to render <ReportNoAccess /> rather than an error page,
 * and a second string would mean a second branch at both ends for an identical
 * outcome. What differs is who passes, not what the refusal looks like.
 */
create function public.require_guest_identity_reports()
returns void
language plpgsql
stable
set search_path = public
as $function$
begin
  if not public.is_front_office_staff() then
    raise exception 'REPORT_ACCESS_DENIED';
  end if;
end;
$function$;

-- `is_front_office_staff()` predates the coalesce rule and still reads
-- `current_role() in (...)`, which is null for a caller with no active staff
-- row. `if not null` is not true, so this fails closed -- the refusal happens.
-- That is the safe direction, and the seven `not in` guards CLAUDE.md lists are
-- the unsafe one. Not swept in here.

comment on function public.require_guest_identity_reports() is
  'Raises REPORT_ACCESS_DENIED for anyone outside the front office. Guards the reports that show passport and date-of-birth data.';


/* -------------------------------------------------------------------------- */
/* 1. Manager report                                                          */
/* -------------------------------------------------------------------------- */

/*
 * The one page a general manager opens in the morning: how full, at what rate,
 * how much came in, and how much of it was actually collected.
 *
 * Every figure here exists on another report. That is the point -- it is a
 * front page, not a new source of truth, and each line is worked out the same
 * way the report it comes from works it out, so the two can never disagree.
 */
create function public.manager_report(p_from date, p_to date)
returns table (
  business_date date,
  rooms_sold bigint,
  sellable_rooms bigint,
  occupancy_pct numeric,
  adr_cents bigint,
  revpar_cents bigint,
  room_revenue_cents bigint,
  other_revenue_cents bigint,
  total_revenue_cents bigint,
  payments_cents bigint,
  arrivals bigint,
  departures bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
begin
  perform public.require_money_reports();

  return query
  with sellable as (
    select count(*) filter (where r.status <> 'ooo') as rooms
    from public.rooms r
    where r.property_id = public.current_property_id()
  ),
  -- Rooms sold and room revenue come from the nights, exactly as the occupancy
  -- report does. Not from the folio: most future nights are not charged yet.
  nights as (
    select
      n.stay_date as d,
      count(*) as rooms_sold,
      sum(n.room_rate_cents - n.discount_cents) as revenue
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date between p_from and p_to
    group by n.stay_date
  ),
  -- Revenue that is not the room, off the folio, netted of reversals.
  extras as (
    select
      l.business_date as d,
      sum(l.signed_net_amount_cents) as net
    from public.folio_item_lines l
    where l.property_id = public.current_property_id()
      and l.business_date between p_from and p_to
      and l.effective_item_type not in ('room_charge', 'tax', 'discount')
    group by l.business_date
  ),
  taken as (
    select p.business_date as d, sum(p.signed_amount_cents) as paid
    from public.payments p
    where p.property_id = public.current_property_id()
      and p.business_date between p_from and p_to
    group by p.business_date
  ),
  -- Movements are counted off the booking, not the folio: a departure that
  -- settled nothing is still a departure.
  moves as (
    select
      d::date as d,
      (select count(*) from public.bookings b
        where b.property_id = public.current_property_id()
          and b.check_in = d::date
          and b.status in ('confirmed', 'checked_in', 'checked_out')) as arrivals,
      (select count(*) from public.bookings b
        where b.property_id = public.current_property_id()
          and b.check_out = d::date
          and b.status in ('checked_in', 'checked_out')) as departures
    from generate_series(p_from, p_to, interval '1 day') as d
  )
  select
    m.d,
    coalesce(n.rooms_sold, 0),
    (select s.rooms from sellable s),
    least(
      coalesce(
        round(coalesce(n.rooms_sold, 0)::numeric * 100
          / nullif((select s.rooms from sellable s), 0), 1),
        0
      ),
      100
    ),
    -- ADR is revenue over rooms SOLD; RevPAR is revenue over rooms AVAILABLE.
    -- Confusing the two is the commonest error on a report like this.
    coalesce(round(n.revenue::numeric / nullif(n.rooms_sold, 0)), 0)::bigint,
    coalesce(
      round(coalesce(n.revenue, 0)::numeric
        / nullif((select s.rooms from sellable s), 0)),
      0
    )::bigint,
    coalesce(n.revenue, 0)::bigint,
    coalesce(e.net, 0)::bigint,
    (coalesce(n.revenue, 0) + coalesce(e.net, 0))::bigint,
    coalesce(t.paid, 0)::bigint,
    m.arrivals,
    m.departures
  from moves m
  left join nights n on n.d = m.d
  left join extras e on e.d = m.d
  left join taken t on t.d = m.d
  order by m.d;
end;
$function$;


/* -------------------------------------------------------------------------- */
/* 2. Folio report                                                            */
/* -------------------------------------------------------------------------- */

/*
 * Every folio touched in the range, with what was charged, what was paid and
 * what is left. The debtors report answers "who owes us"; this one answers
 * "what happened on this account", including the ones that balance to nothing.
 *
 * Meeting room folios are included. A folio belongs to a booking OR a meeting
 * room booking since 0029, and a folio list that silently dropped half of them
 * would be the same mistake the debtors report made until 0042.
 */
create function public.folio_report(p_from date, p_to date)
returns table (
  folio_id uuid,
  folio_number bigint,
  kind text,
  status text,
  reference text,
  guest_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  charges_cents bigint,
  payments_cents bigint,
  balance_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
begin
  perform public.require_money_reports();

  return query
  with activity as (
    -- A folio is "in the range" if anything happened on it in the range --
    -- a charge or a payment. Ranging on `opened_at` would drop a long stay
    -- that was opened in March and settled in June.
    select l.folio_id from public.folio_item_lines l
    where l.property_id = public.current_property_id()
      and l.business_date between p_from and p_to
    union
    select p.folio_id from public.payments p
    where p.property_id = public.current_property_id()
      and p.business_date between p_from and p_to
  ),
  charges as (
    select l.folio_id, sum(l.signed_amount_cents) as total
    from public.folio_item_lines l
    where l.property_id = public.current_property_id()
    group by l.folio_id
  ),
  paid as (
    select p.folio_id, sum(p.signed_amount_cents) as total
    from public.payments p
    where p.property_id = public.current_property_id()
    group by p.folio_id
  )
  select
    f.id,
    f.folio_number,
    f.kind::text,
    f.status::text,
    -- A meeting room folio has no booking reference; its event name is the
    -- nearest thing, and saying "--" would lose which folio it was.
    coalesce(b.reference, 'Meeting room'),
    coalesce(public.customer_display_name(c), 'No guest on this folio'),
    f.opened_at,
    f.closed_at,
    coalesce(ch.total, 0)::bigint,
    coalesce(pd.total, 0)::bigint,
    -- The house convention: charges less payments, positive means owing.
    (coalesce(ch.total, 0) - coalesce(pd.total, 0))::bigint
  from public.folios f
  join activity a on a.folio_id = f.id
  left join public.bookings b
    on b.id = f.booking_id and b.property_id = f.property_id
  left join public.customers c
    on c.id = f.customer_id and c.property_id = f.property_id
  left join charges ch on ch.folio_id = f.id
  left join paid pd on pd.folio_id = f.id
  where f.property_id = public.current_property_id()
  order by (coalesce(ch.total, 0) - coalesce(pd.total, 0)) desc, f.folio_number;
end;
$function$;


/* -------------------------------------------------------------------------- */
/* 3. Immigration report                                                      */
/* -------------------------------------------------------------------------- */

/*
 * The return a hotel files with the police or the border force: who slept here,
 * on what document, born when, of what nationality.
 *
 * RANGED ON THE NIGHT STAYED, not on arrival. A return is filed for a date, and
 * "who was in the building on the 5th" includes a guest who arrived on the 1st.
 *
 * Every identity field can be null, and the screen says how many rows are
 * incomplete rather than hiding them. A guest whose passport was never recorded
 * is exactly who this report exists to surface; dropping them would make an
 * empty report look like a complete one.
 */
create function public.immigration_report(p_from date, p_to date)
returns table (
  booking_id uuid,
  reference text,
  guest_name text,
  room_number text,
  nationality text,
  country text,
  passport_number text,
  passport_expiry date,
  national_id_number text,
  date_of_birth date,
  check_in date,
  check_out date,
  nights bigint,
  is_complete boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
begin
  perform public.require_guest_identity_reports();

  return query
  select
    b.id,
    b.reference,
    coalesce(public.customer_display_name(c), 'No name recorded'),
    -- No room is assigned until check-in, so a booking that never arrived has
    -- none. That is a fact about the stay, not a missing value to paper over.
    coalesce(r.number, '—'),
    c.nationality,
    c.country,
    c.passport_number,
    c.passport_expiry,
    c.national_id_number,
    c.date_of_birth,
    b.check_in,
    b.check_out,
    count(n.id),
    -- What an immigration return actually requires: a document and a birth
    -- date. Nationality is part of it; a residence country is not.
    (c.passport_number is not null or c.national_id_number is not null)
      and c.date_of_birth is not null
      and c.nationality is not null
  from public.booking_room_nights n
  join public.booking_rooms br
    on br.id = n.booking_room_id and br.property_id = n.property_id
  join public.bookings b
    on b.id = br.booking_id and b.property_id = br.property_id
  join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  left join public.rooms r
    on r.id = br.room_id and r.property_id = br.property_id
  where n.property_id = public.current_property_id()
    and n.stay_date between p_from and p_to
    -- Somebody who cancelled or never turned up did not sleep here, so they are
    -- not on the return.
    and n.status not in ('canceled', 'no_show')
  group by b.id, b.reference, c.id, c.kind, c.first_name, c.last_name,
           c.company_name, r.number, c.nationality, c.country,
           c.passport_number, c.passport_expiry, c.national_id_number,
           c.date_of_birth, b.check_in, b.check_out
  order by b.check_in, b.reference;
end;
$function$;


/* -------------------------------------------------------------------------- */
/* 4. Country report                                                          */
/* -------------------------------------------------------------------------- */

/*
 * Where the hotel's guests come from, counted in room nights rather than
 * bookings: a family staying a fortnight is worth more to the picture than a
 * one-night business stay, and counting bookings says otherwise.
 *
 * READS `country`, THE RESIDENCE, NOT `nationality`. A German passport holder
 * living in Paris is a French booking -- which is the answer a marketing
 * question wants. The two columns exist precisely so this report does not have
 * to choose.
 */
create function public.country_report(p_from date, p_to date)
returns table (
  country text,
  bookings bigint,
  guests bigint,
  room_nights bigint,
  revenue_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
begin
  perform public.require_money_reports();

  return query
  select
    -- Null is a real answer here and gets its own row. Dropping the unknowns
    -- would make the percentages add up to 100% of a number that is not the
    -- total, which is the quiet way a report lies.
    coalesce(c.country, 'Unknown'),
    count(distinct b.id),
    sum(br.adults + br.children)::bigint,
    count(n.id),
    sum(n.room_rate_cents - n.discount_cents)::bigint
  from public.booking_room_nights n
  join public.booking_rooms br
    on br.id = n.booking_room_id and br.property_id = n.property_id
  join public.bookings b
    on b.id = br.booking_id and b.property_id = br.property_id
  join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  where n.property_id = public.current_property_id()
    and n.stay_date between p_from and p_to
    and n.status not in ('canceled', 'no_show')
  group by coalesce(c.country, 'Unknown')
  order by count(n.id) desc, 1;
end;
$function$;


/* -------------------------------------------------------------------------- */
/* 5. Deposit report                                                          */
/* -------------------------------------------------------------------------- */

/*
 * Money the hotel is holding against stays that have not happened yet.
 *
 * DERIVED, NOT STORED. There is no `is_deposit` flag on a payment and this does
 * not add one: a deposit is not a kind of payment, it is any payment taken
 * before the guest arrives, and that is a fact about the booking's status
 * rather than about the money. A flag would be a second thing to set correctly
 * and a new way for the drawer and this report to disagree.
 *
 * So: bookings not yet checked in, with payments against their folio. A stay
 * that has started is no longer a deposit -- it is a part-paid folio, which is
 * the debtors report's question.
 */
create function public.deposit_report()
returns table (
  booking_id uuid,
  reference text,
  guest_name text,
  status text,
  check_in date,
  check_out date,
  nights integer,
  charges_cents bigint,
  deposit_cents bigint,
  stay_value_cents bigint,
  days_to_arrival integer
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_today date;
begin
  perform public.require_money_reports();

  -- The open business date, never now()::date. A deposit report run at one in
  -- the morning must not decide the day has moved on when the hotel says it
  -- has not.
  select bd.business_date into v_today
  from public.business_dates bd
  where bd.property_id = public.current_property_id() and bd.status = 'open';

  return query
  with paid as (
    select f.booking_id, sum(p.signed_amount_cents) as total
    from public.payments p
    join public.folios f
      on f.id = p.folio_id and f.property_id = p.property_id
    where p.property_id = public.current_property_id()
      and f.booking_id is not null
    group by f.booking_id
  ),
  charged as (
    select l.booking_id, sum(l.signed_amount_cents) as total
    from public.folio_item_lines l
    where l.property_id = public.current_property_id()
      and l.booking_id is not null
    group by l.booking_id
  ),
  -- What the stay is worth, off the nights, so a deposit can be read against
  -- the whole booking rather than against the nothing charged so far.
  value as (
    select br.booking_id,
           sum(n.room_rate_cents - n.discount_cents + n.tax_cents) as total
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
    group by br.booking_id
  )
  select
    b.id,
    b.reference,
    coalesce(public.customer_display_name(c), 'No name recorded'),
    b.status::text,
    b.check_in,
    b.check_out,
    (b.check_out - b.check_in),
    coalesce(ch.total, 0)::bigint,
    coalesce(pd.total, 0)::bigint,
    coalesce(v.total, 0)::bigint,
    (b.check_in - v_today)
  from public.bookings b
  join public.customers c
    on c.id = b.customer_id and c.property_id = b.property_id
  join paid pd on pd.booking_id = b.id
  left join charged ch on ch.booking_id = b.id
  left join value v on v.booking_id = b.id
  where b.property_id = public.current_property_id()
    -- Not yet arrived. A cancelled booking holding a deposit is a real thing,
    -- and it is a refund question rather than a deposit the hotel expects to
    -- turn into a stay, so it is left to the debtors report.
    and b.status in ('pending', 'confirmed')
    and coalesce(pd.total, 0) <> 0
  order by b.check_in, b.reference;
end;
$function$;


/* -------------------------------------------------------------------------- */
/* 6. Rate plan report                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Which rate plans are actually selling, and at what average.
 *
 * `booking_rooms.rate_plan_id` arrived in 0037, so anything sold before that
 * has no plan against it. Those nights are counted under "Not recorded" rather
 * than dropped -- the totals have to tie to the occupancy report, and a report
 * that quietly excludes a year of history is worse than one that labels it.
 */
create function public.rate_plan_report(p_from date, p_to date)
returns table (
  rate_plan_id uuid,
  plan_name text,
  is_public boolean,
  bookings bigint,
  room_nights bigint,
  gross_cents bigint,
  discount_cents bigint,
  net_cents bigint,
  adr_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
begin
  perform public.require_money_reports();

  return query
  select
    rp.id,
    coalesce(rp.name, 'Not recorded'),
    coalesce(rp.is_public, false),
    count(distinct br.booking_id),
    count(n.id),
    sum(n.room_rate_cents)::bigint,
    sum(n.discount_cents)::bigint,
    sum(n.room_rate_cents - n.discount_cents)::bigint,
    -- Net of discount, like every other ADR in this application. An ADR taken
    -- before the discount flatters a promotion into looking like full rate.
    coalesce(
      round(sum(n.room_rate_cents - n.discount_cents)::numeric
        / nullif(count(n.id), 0)),
      0
    )::bigint
  from public.booking_room_nights n
  join public.booking_rooms br
    on br.id = n.booking_room_id and br.property_id = n.property_id
  left join public.rate_plans rp
    on rp.id = br.rate_plan_id and rp.property_id = br.property_id
  where n.property_id = public.current_property_id()
    and n.stay_date between p_from and p_to
    and n.status not in ('canceled', 'no_show')
  group by rp.id, rp.name, rp.is_public
  order by count(n.id) desc, coalesce(rp.name, 'Not recorded');
end;
$function$;


/* -------------------------------------------------------------------------- */
/* 7. Accounting report                                                       */
/* -------------------------------------------------------------------------- */

/*
 * What a bookkeeper posts to the ledger: revenue by category with its tax
 * separated, and the money received against it by method.
 *
 * ONE FUNCTION, TWO SECTIONS, because they are read together and a bookkeeper
 * checking one against the other should not have to run two reports over two
 * date pickers and hope they used the same range. `section` says which half a
 * row belongs to.
 *
 * Revenue and payments DO NOT have to agree, and the screen says so. Revenue is
 * what was earned in the range; payments are what was collected in it. A guest
 * who checks out in April having paid in March moves the two apart, correctly.
 */
create function public.accounting_report(p_from date, p_to date)
returns table (
  section text,
  code text,
  label text,
  net_cents bigint,
  tax_cents bigint,
  gross_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
begin
  perform public.require_money_reports();

  return query
  -- Revenue, by what the line effectively is rather than what was posted.
  select
    'revenue'::text,
    l.effective_item_type::text,
    initcap(replace(l.effective_item_type::text, '_', ' ')),
    sum(l.signed_net_amount_cents)::bigint,
    sum(l.signed_tax_amount_cents)::bigint,
    sum(l.signed_amount_cents)::bigint
  from public.folio_item_lines l
  where l.property_id = public.current_property_id()
    and l.business_date between p_from and p_to
    -- `tax` is not a revenue category; it is the tax column of the others, and
    -- counting it as its own line would double the tax in the totals.
    and l.effective_item_type <> 'tax'
  group by l.effective_item_type

  union all

  -- Payments, by method. Net and gross are the same figure: money received
  -- carries no tax of its own, the tax was on the charge it settles.
  select
    'payments'::text,
    pm.kind::text,
    pm.name,
    sum(p.signed_amount_cents)::bigint,
    0::bigint,
    sum(p.signed_amount_cents)::bigint
  from public.payments p
  join public.payment_methods pm
    on pm.id = p.payment_method_id and pm.property_id = p.property_id
  where p.property_id = public.current_property_id()
    and p.business_date between p_from and p_to
  group by pm.kind, pm.name

  order by 1, 6 desc;
end;
$function$;


/* -------------------------------------------------------------------------- */
/* 8. End of day report                                                       */
/* -------------------------------------------------------------------------- */

/*
 * One date, the way the night audit left it. What the duty manager signs off.
 *
 * ONE DATE AND NOT A RANGE, because that is the unit the thing describes: the
 * audit closes a day at a time and this is the record of one closing. A range
 * of them is the manager report.
 */
create function public.end_of_day_report(p_date date)
returns table (
  business_date date,
  date_status text,
  closed_at timestamptz,
  closed_by text,
  arrivals bigint,
  departures bigint,
  in_house bigint,
  no_shows bigint,
  rooms_sold bigint,
  sellable_rooms bigint,
  occupancy_pct numeric,
  room_revenue_cents bigint,
  other_revenue_cents bigint,
  tax_cents bigint,
  payments_cents bigint,
  drawer_cents bigint,
  shifts_open bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
begin
  perform public.require_money_reports();

  return query
  with prop as (select public.current_property_id() as id),
  nights as (
    select count(*) as sold,
           sum(n.room_rate_cents - n.discount_cents) as revenue
    from public.booking_room_nights n
    where n.property_id = (select id from prop)
      and n.stay_date = p_date
      and n.status not in ('canceled', 'no_show')
  ),
  lines as (
    select
      sum(l.signed_net_amount_cents)
        filter (where l.effective_item_type not in ('room_charge', 'tax', 'discount'))
        as other_net,
      sum(l.signed_tax_amount_cents) as tax
    from public.folio_item_lines l
    where l.property_id = (select id from prop)
      and l.business_date = p_date
  ),
  money as (
    select
      sum(p.signed_amount_cents) as paid,
      -- Only cash moves the drawer, and `affects_drawer` is the one column
      -- that decides it -- derived from the method's kind by check constraint,
      -- never set by hand.
      sum(p.signed_amount_cents) filter (where pm.affects_drawer) as drawer
    from public.payments p
    join public.payment_methods pm
      on pm.id = p.payment_method_id and pm.property_id = p.property_id
    where p.property_id = (select id from prop)
      and p.business_date = p_date
  )
  select
    p_date,
    coalesce(bd.status::text, 'not opened'),
    bd.closed_at,
    su.full_name,
    (select count(*) from public.bookings b
      where b.property_id = (select id from prop) and b.check_in = p_date
        and b.status in ('confirmed', 'checked_in', 'checked_out')),
    (select count(*) from public.bookings b
      where b.property_id = (select id from prop) and b.check_out = p_date
        and b.status in ('checked_in', 'checked_out')),
    -- In house that night: arrived on or before it, leaving after it.
    (select count(*) from public.bookings b
      where b.property_id = (select id from prop)
        and b.check_in <= p_date and b.check_out > p_date
        and b.status in ('checked_in', 'checked_out')),
    (select count(*) from public.bookings b
      where b.property_id = (select id from prop)
        and b.check_in = p_date and b.status = 'no_show'),
    coalesce((select sold from nights), 0),
    (select count(*) filter (where r.status <> 'ooo')
      from public.rooms r where r.property_id = (select id from prop)),
    least(
      coalesce(
        round(
          coalesce((select sold from nights), 0)::numeric * 100
            / nullif((select count(*) filter (where r.status <> 'ooo')
                      from public.rooms r
                      where r.property_id = (select id from prop)), 0),
          1
        ),
        0
      ),
      100
    ),
    coalesce((select revenue from nights), 0)::bigint,
    coalesce((select other_net from lines), 0)::bigint,
    coalesce((select tax from lines), 0)::bigint,
    coalesce((select paid from money), 0)::bigint,
    coalesce((select drawer from money), 0)::bigint,
    -- A day with a shift still open has not really finished, whatever the
    -- audit says, and the audit refuses to close over one.
    (select count(*) from public.cashier_shifts cs
      join public.business_dates b2
        on b2.id = cs.business_date_id and b2.property_id = cs.property_id
      where cs.property_id = (select id from prop)
        and b2.business_date = p_date and cs.status = 'open')
  from (select 1) one
  left join public.business_dates bd
    on bd.property_id = (select id from prop) and bd.business_date = p_date
  left join public.staff_users su
    on su.id = bd.closed_by and su.property_id = bd.property_id;
end;
$function$;


/* -------------------------------------------------------------------------- */
/* 9. Booking waitlist report                                                 */
/* -------------------------------------------------------------------------- */

/*
 * The list 0051 made possible: who is waiting, for what, and whether anything
 * came of it.
 *
 * Ranged on the ARRIVAL they asked for, because that is the date somebody
 * works the list against -- "who wanted a room this weekend" -- not the date
 * they rang.
 */
create function public.booking_waitlist_report(
  p_from date,
  p_to date,
  p_status public.waitlist_status default null
)
returns table (
  id uuid,
  guest_name text,
  contact_email text,
  contact_phone text,
  room_type_name text,
  check_in date,
  check_out date,
  nights integer,
  adults smallint,
  children smallint,
  status text,
  converted_reference text,
  notes text,
  created_at timestamptz,
  created_by_name text
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
begin
  -- The same front-office gate the immigration report uses. This one carries
  -- guest email addresses and phone numbers, which is personal data even
  -- though it is not a travel document, and housekeeping has no call for it.
  perform public.require_guest_identity_reports();

  return query
  select
    w.id,
    -- The linked customer's name wins over the loose one: if somebody has since
    -- been made a customer, that record is the one being kept up to date.
    coalesce(public.customer_display_name(c), w.contact_name, 'No name recorded'),
    coalesce(c.email, w.contact_email),
    coalesce(c.phone, w.contact_phone),
    coalesce(rt.name, 'Any room type'),
    w.check_in,
    w.check_out,
    (w.check_out - w.check_in),
    w.adults,
    w.children,
    w.status::text,
    b.reference,
    w.notes,
    w.created_at,
    su.full_name
  from public.booking_waitlist w
  left join public.customers c
    on c.id = w.customer_id and c.property_id = w.property_id
  left join public.room_types rt
    on rt.id = w.room_type_id and rt.property_id = w.property_id
  left join public.bookings b
    on b.id = w.converted_booking_id and b.property_id = w.property_id
  left join public.staff_users su
    on su.id = w.created_by and su.property_id = w.property_id
  where w.property_id = public.current_property_id()
    and w.check_in <= p_to
    and w.check_out >= p_from
    -- Null means every status. A default that filtered to `waiting` would hide
    -- the conversions, which are the only evidence the list is worth keeping.
    and (p_status is null or w.status = p_status)
  order by w.check_in, w.created_at;
end;
$function$;


/* -------------------------------------------------------------------------- */
/* Grants                                                                     */
/* -------------------------------------------------------------------------- */

-- `revoke ... from public` does NOT take the grant off `anon`: the hosted
-- project carries `alter default privileges ... grant execute on functions to
-- anon`, so every one of these comes out executable by `anon` unless it is
-- named. 0047 found thirteen that had drifted exactly this way.
revoke all on function public.require_guest_identity_reports() from public, anon;
revoke all on function public.manager_report(date, date) from public, anon;
revoke all on function public.folio_report(date, date) from public, anon;
revoke all on function public.immigration_report(date, date) from public, anon;
revoke all on function public.country_report(date, date) from public, anon;
revoke all on function public.deposit_report() from public, anon;
revoke all on function public.rate_plan_report(date, date) from public, anon;
revoke all on function public.accounting_report(date, date) from public, anon;
revoke all on function public.end_of_day_report(date) from public, anon;
revoke all on function public.booking_waitlist_report(date, date, public.waitlist_status)
  from public, anon;

grant execute on function public.require_guest_identity_reports() to authenticated;
grant execute on function public.manager_report(date, date) to authenticated;
grant execute on function public.folio_report(date, date) to authenticated;
grant execute on function public.immigration_report(date, date) to authenticated;
grant execute on function public.country_report(date, date) to authenticated;
grant execute on function public.deposit_report() to authenticated;
grant execute on function public.rate_plan_report(date, date) to authenticated;
grant execute on function public.accounting_report(date, date) to authenticated;
grant execute on function public.end_of_day_report(date) to authenticated;
grant execute on function public.booking_waitlist_report(date, date, public.waitlist_status)
  to authenticated;
