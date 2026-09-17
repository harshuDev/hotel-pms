-- Layer 7: the remaining read models — pace charts, the activity feed, and
-- customer profiles. After this the only mock-backed queries left are the
-- cashier's, which need writes rather than reads.

-- Occupancy for each night in a window, as a percentage of sellable rooms.
-- Sellable is the current room count excluding out-of-order, matching
-- house_summary(); nights with no rooms sold still return a row so the chart
-- keeps a continuous timeline.
create function public.occupancy_forecast(p_from date, p_days integer default 28)
returns table (series_date date, occupancy_pct numeric)
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
    select n.stay_date, count(*) as sold
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_from + greatest(coalesce(p_days, 28), 0)
    group by n.stay_date
  )
  select
    d::date,
    coalesce(
      round(
        least(coalesce(nights.sold, 0)::numeric * 100
                / nullif((select rooms from sellable), 0), 100),
        1
      ),
      0
    )
  from generate_series(
    p_from,
    p_from + greatest(coalesce(p_days, 28), 1) - 1,
    interval '1 day'
  ) as d
  left join nights on nights.stay_date = d::date
  order by d;
$$;

comment on function public.occupancy_forecast(date, integer) is
  'Occupancy percentage per night over a window, against the current sellable room count.';

-- Room revenue per night: the rate the night was sold at, less any discount.
-- Tax is excluded — this is room revenue, not what the guest is billed, so it
-- will not match booking_totals.total_cents, which includes tax.
create function public.revenue_series(p_from date, p_days integer default 28)
returns table (series_date date, revenue_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with nights as (
    select n.stay_date, sum(n.room_rate_cents - n.discount_cents) as revenue
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_from + greatest(coalesce(p_days, 28), 0)
    group by n.stay_date
  )
  select d::date, coalesce(nights.revenue, 0)::bigint
  from generate_series(
    p_from,
    p_from + greatest(coalesce(p_days, 28), 1) - 1,
    interval '1 day'
  ) as d
  left join nights on nights.stay_date = d::date
  order by d;
$$;

comment on function public.revenue_series(date, integer) is
  'Room revenue per night over a window: room rate less discount, excluding tax.';

-- The activity feed. Rows are written only by the audit triggers, so this
-- reads them and classifies each action into one of the six kinds the feed
-- renders. Anything without a specific kind is a modification.
create function public.activity_feed(p_limit integer default 40, p_offset integer default 0)
returns table (
  id uuid,
  kind text,
  summary text,
  emphasis text[],
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.id,
    case a.action
      when 'booking_created' then 'BOOKING'
      when 'booking_cancelled' then 'CANCELLATION'
      when 'guest_checked_in' then 'CHECKIN'
      when 'guest_checked_out' then 'CHECKOUT'
      when 'payment_received' then 'PAYMENT'
      when 'cash_payment_received' then 'PAYMENT'
      when 'payment_reversed' then 'PAYMENT'
      when 'folio_settled' then 'PAYMENT'
      else 'MODIFICATION'
    end as kind,
    a.summary,
    -- Terms the feed bolds inside the summary. The trigger-written summaries
    -- quote these verbatim, and the renderer ignores any that do not appear.
    array_remove(
      array[
        a.metadata ->> 'reference',
        a.metadata ->> 'room_number'
      ],
      null
    ) as emphasis,
    a.created_at
  from public.activity_log a
  where a.property_id = public.current_property_id()
  order by a.created_at desc
  limit greatest(coalesce(p_limit, 40), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.activity_feed(integer, integer) is
  'Most recent activity_log rows, classified into the six kinds the feed renders.';

-- One row per customer, with their booking history and ledger position.
-- Money comes from the ledger rather than from reservation values: revenue is
-- what has actually been posted to their folios, net of reversals and
-- discounts, and the balance is what is still outstanding.
create view public.customer_stats with (security_invoker = true) as
select
  c.property_id,
  c.id as customer_id,
  c.kind,
  public.customer_display_name(c) as name,
  c.national_id_number,
  c.email,
  c.phone,
  c.exclude_from_email,
  coalesce(b.booking_count, 0)::integer as booking_count,
  b.last_booking_date,
  coalesce(money.revenue_cents, 0)::bigint as total_revenue_cents,
  coalesce(money.balance_cents, 0)::bigint as balance_cents
from public.customers c
left join lateral (
  select count(*) as booking_count, max(bk.check_in) as last_booking_date
  from public.bookings bk
  where bk.customer_id = c.id
    and bk.property_id = c.property_id
) b on true
left join lateral (
  select
    sum(fb.total_charges_cents) as revenue_cents,
    sum(greatest(fb.outstanding_cents, 0)) as balance_cents
  from public.folio_balances fb
  join public.bookings bk
    on bk.id = fb.booking_id
   and bk.property_id = fb.property_id
  where bk.customer_id = c.id
    and bk.property_id = c.property_id
) money on true
-- A customer merged into another is no longer their own profile.
where c.merged_into_id is null;

comment on view public.customer_stats is
  'Customer profiles with booking counts and ledger-derived revenue and balance. Merged-away customers are excluded.';

create function public.customers_page(
  p_q text default null,
  p_kind public.customer_kind default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  customer_id uuid,
  kind public.customer_kind,
  name text,
  national_id_number text,
  email text,
  phone text,
  exclude_from_email boolean,
  booking_count integer,
  last_booking_date date,
  total_revenue_cents bigint,
  balance_cents bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select s.*
    from public.customer_stats s
    where s.property_id = public.current_property_id()
      and (p_kind is null or s.kind = p_kind)
      and (
        p_q is null
        or btrim(p_q) = ''
        -- strpos, not ilike: the needle is user input and must never be
        -- read as a LIKE pattern.
        or strpos(lower(coalesce(s.name, '')), lower(btrim(p_q))) > 0
        or strpos(lower(coalesce(s.email, '')), lower(btrim(p_q))) > 0
        or strpos(coalesce(s.phone, ''), btrim(p_q)) > 0
      )
  )
  select
    f.customer_id, f.kind, f.name, f.national_id_number, f.email, f.phone,
    f.exclude_from_email, f.booking_count, f.last_booking_date,
    f.total_revenue_cents, f.balance_cents,
    count(*) over ()::bigint as total_count
  from filtered f
  order by f.name, f.customer_id
  limit greatest(coalesce(p_limit, 25), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.customers_page(text, public.customer_kind, integer, integer) is
  'Filtered, paginated customer profiles. total_count is the size of the full filtered set.';

grant select on public.customer_stats to authenticated;

revoke all on function
  public.occupancy_forecast(date, integer),
  public.revenue_series(date, integer),
  public.activity_feed(integer, integer),
  public.customers_page(text, public.customer_kind, integer, integer)
from public, anon;

grant execute on function
  public.occupancy_forecast(date, integer),
  public.revenue_series(date, integer),
  public.activity_feed(integer, integer),
  public.customers_page(text, public.customer_kind, integer, integer)
to authenticated;
