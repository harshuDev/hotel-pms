-- Layer 11: the first reports.
--
-- The nav has promised thirteen since the front end was built. These are the
-- two a manager actually opens: what the house did, and who owes money.
-- Everything aggregates here rather than in the browser, so the figures are
-- computed once, in pence, by the database that holds them.
--
-- One honest limitation, stated rather than hidden: sellable rooms is the
-- current count of rooms that are not out of order. room_status_history could
-- reconstruct what was sellable on a past night, but it would have to be
-- replayed per night, and no report here is worth that yet. A room taken out
-- of order today therefore shifts the occupancy of every past night in the
-- range. Fine at this scale, wrong at audit scale.

create function public.occupancy_report(p_from date, p_to date)
returns table (
  stay_date date,
  rooms_sold bigint,
  sellable_rooms bigint,
  occupancy_pct numeric,
  room_revenue_cents bigint,
  adr_cents bigint,
  revpar_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with sellable as (
    select count(*) filter (where r.status <> 'ooo') as rooms
    from public.rooms r
    where r.property_id = public.current_property_id()
  ),
  nights as (
    select
      n.stay_date,
      count(*) as rooms_sold,
      sum(n.room_rate_cents - n.discount_cents) as revenue
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date between p_from and p_to
    group by n.stay_date
  )
  select
    d::date,
    coalesce(nights.rooms_sold, 0),
    (select rooms from sellable),
    coalesce(
      round(
        least(
          coalesce(nights.rooms_sold, 0)::numeric * 100
            / nullif((select rooms from sellable), 0),
          100
        ), 1),
      0
    ),
    coalesce(nights.revenue, 0)::bigint,
    -- Average rate of the rooms that actually sold; zero nights, zero ADR.
    coalesce(
      round(nights.revenue::numeric / nullif(nights.rooms_sold, 0)),
      0
    )::bigint,
    -- Revenue per available room: the same money spread over the whole house.
    coalesce(
      round(
        coalesce(nights.revenue, 0)::numeric
          / nullif((select rooms from sellable), 0)
      ),
      0
    )::bigint
  from generate_series(p_from, p_to, interval '1 day') as d
  left join nights on nights.stay_date = d::date
  order by d;
$$;

comment on function public.occupancy_report(date, date) is
  'Rooms sold, occupancy, ADR and RevPAR per night. Room revenue is rate less discount, excluding tax.';

-- The totals are not the averages of the rows. ADR over a period is total
-- revenue over total rooms sold, never the mean of each night's ADR, and
-- RevPAR spreads revenue across every available room-night in the range.
create function public.occupancy_report_summary(p_from date, p_to date)
returns table (
  nights integer,
  rooms_sold bigint,
  room_nights_available bigint,
  occupancy_pct numeric,
  room_revenue_cents bigint,
  adr_cents bigint,
  revpar_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with sellable as (
    select count(*) filter (where r.status <> 'ooo') as rooms
    from public.rooms r
    where r.property_id = public.current_property_id()
  ),
  span as (
    select (p_to - p_from + 1) as nights
  ),
  sold as (
    select
      count(*) as rooms_sold,
      coalesce(sum(n.room_rate_cents - n.discount_cents), 0) as revenue
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date between p_from and p_to
  )
  select
    span.nights::integer,
    sold.rooms_sold,
    (span.nights * (select rooms from sellable))::bigint,
    coalesce(
      round(
        least(
          sold.rooms_sold::numeric * 100
            / nullif(span.nights * (select rooms from sellable), 0),
          100
        ), 1),
      0
    ),
    sold.revenue::bigint,
    coalesce(round(sold.revenue::numeric / nullif(sold.rooms_sold, 0)), 0)::bigint,
    coalesce(
      round(
        sold.revenue::numeric
          / nullif(span.nights * (select rooms from sellable), 0)
      ),
      0
    )::bigint
  from span cross join sold;
$$;

comment on function public.occupancy_report_summary(date, date) is
  'Period totals for the occupancy report. ADR is total revenue over total rooms sold, not the mean of daily ADRs.';

-- Who owes money, worst first. Aggregated per booking rather than per folio:
-- a guest with a split folio is still one debt to chase, and a credit on one
-- folio does not quietly cancel a debt on another.
create function public.debtors_report()
returns table (
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
security invoker
set search_path = public
as $$
  with today as (
    select bd.business_date
    from public.business_dates bd
    where bd.property_id = public.current_property_id()
      and bd.status = 'open'
  )
  select
    b.id,
    b.reference,
    public.customer_display_name(c),
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
    )::integer
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
  order by owed.outstanding_cents desc, b.check_out;
$$;

comment on function public.debtors_report() is
  'Bookings with money still owed, largest first. Aggregated per booking so a split folio is one debt.';

revoke all on function
  public.occupancy_report(date, date),
  public.occupancy_report_summary(date, date),
  public.debtors_report()
from public, anon;

grant execute on function
  public.occupancy_report(date, date),
  public.occupancy_report_summary(date, date),
  public.debtors_report()
to authenticated;
