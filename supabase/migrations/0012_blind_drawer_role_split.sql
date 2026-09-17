-- The blind count, enforced rather than implied.
--
-- close_cashier_shift() already reveals the expected figure only in the call
-- that commits the count. That was pointless while the same number could be
-- read three other ways:
--
--   * cashier_shift_expected() was granted to anon and authenticated
--   * cashier_shift_summaries exposed expected_cash_cents
--   * house_summary() put it on the dashboard as "In the drawer"
--
-- Anyone who can operate a drawer is now blind to it: admins and managers see
-- the figure, everyone else does not. require_financial_staff() lets front
-- desk and cashier staff take payments, so both are drawer operators and both
-- are blind. Nothing changes after a close — the counted, expected and
-- variance columns on a closed shift stay visible, because that is the
-- receipt.

create function public.can_see_drawer_total()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.current_role() in ('admin', 'manager');
$$;

comment on function public.can_see_drawer_total() is
  'True for staff who may see a drawer''s expected cash before it is counted.';

-- The calculation itself is no longer reachable from the API. The only things
-- that call it are security definer functions, which run as the owner.
revoke all on function public.cashier_shift_expected(uuid)
from public, anon, authenticated;

-- What a viewer is allowed to know about a shift's cash. Security definer so
-- it can still reach the revoked calculation; it returns a row only when that
-- calculation does, which keeps the property isolation already built in.
create function public.cashier_shift_expected_for_viewer(p_shift_id uuid)
returns table (
  opening_balance_cents bigint,
  cash_payments_cents bigint,
  cash_added_cents bigint,
  paid_outs_cents bigint,
  cash_drops_cents bigint,
  adjustments_cents bigint,
  expected_cash_cents bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    case when public.can_see_drawer_total() then e.opening_balance_cents end,
    case when public.can_see_drawer_total() then e.cash_payments_cents end,
    case when public.can_see_drawer_total() then e.cash_added_cents end,
    case when public.can_see_drawer_total() then e.paid_outs_cents end,
    case when public.can_see_drawer_total() then e.cash_drops_cents end,
    case when public.can_see_drawer_total() then e.adjustments_cents end,
    case when public.can_see_drawer_total() then e.expected_cash_cents end
  from public.cashier_shift_expected(p_shift_id) e;
$$;

comment on function public.cashier_shift_expected_for_viewer(uuid) is
  'Shift cash figures, nulled for staff who may not see a drawer total before it is counted.';

-- Same eighteen columns and types as before, sourced through the gate.
create or replace view public.cashier_shift_summaries with (security_invoker = true) as
select
  s.id as shift_id,
  s.property_id,
  s.cashier_id,
  bd.id as business_date_id,
  bd.business_date,
  s.status,
  s.opened_at,
  s.closed_at,
  e.opening_balance_cents,
  e.cash_payments_cents,
  e.cash_added_cents,
  e.paid_outs_cents,
  e.cash_drops_cents,
  e.adjustments_cents,
  e.expected_cash_cents,
  s.counted_cash_cents,
  s.expected_cash_at_close_cents,
  s.variance_cents
from public.cashier_shifts s
join public.business_dates bd
  on bd.id = s.business_date_id and bd.property_id = s.property_id
cross join lateral public.cashier_shift_expected_for_viewer(s.id) e;

create or replace function public.house_summary()
returns table (
  business_date date,
  total_rooms bigint,
  sellable_rooms bigint,
  occupied_rooms bigint,
  due_out_rooms bigint,
  arriving_rooms bigint,
  vacant_clean_rooms bigint,
  vacant_dirty_rooms bigint,
  ooo_rooms bigint,
  expected_arrivals bigint,
  expected_departures bigint,
  occupancy_pct numeric,
  adr_cents bigint,
  drawer_cents bigint,
  outstanding_cents bigint
)
language sql
stable
security invoker
set search_path = public, auth
as $$
  with today as (
    select bd.business_date
    from public.business_dates bd
    where bd.property_id = public.current_property_id()
      and bd.status = 'open'
  ),
  counts as (
    select
      count(*) as total_rooms,
      count(*) filter (where s.state <> 'ooo') as sellable_rooms,
      count(*) filter (where s.state = 'occupied') as occupied_rooms,
      count(*) filter (where s.state = 'due_out') as due_out_rooms,
      count(*) filter (where s.state = 'arriving') as arriving_rooms,
      count(*) filter (where s.state = 'vacant_clean') as vacant_clean_rooms,
      count(*) filter (where s.state = 'vacant_dirty') as vacant_dirty_rooms,
      count(*) filter (where s.state = 'ooo') as ooo_rooms
    from public.room_house_states s
    where s.property_id = public.current_property_id()
  ),
  -- Reservation movements, not room states: most arrivals have no room
  -- assigned yet, so these are counted from booking_rooms.
  movements as (
    select
      count(*) filter (
        where br.check_in = (select business_date from today)
          and br.status in ('pending', 'confirmed')
      ) as expected_arrivals,
      count(*) filter (
        where br.check_out = (select business_date from today)
          and br.status = 'checked_in'
      ) as expected_departures
    from public.booking_rooms br
    where br.property_id = public.current_property_id()
      and (
        br.check_in = (select business_date from today)
        or br.check_out = (select business_date from today)
      )
  ),
  -- ADR is the mean rate of the rooms in house tonight. Rate only: tax and
  -- discount are separate columns and are not part of the average.
  adr as (
    select coalesce(round(avg(n.room_rate_cents)), 0)::bigint as adr_cents
    from public.booking_room_nights n
    where n.property_id = public.current_property_id()
      and n.stay_date = (select business_date from today)
      and n.status = 'checked_in'
  ),
  -- Only the viewer's own open shift, and only when they are allowed to see
  -- it at all. Null means "not yours to see", which the tile renders as a
  -- dash; zero means an empty drawer. Showing a cashier this figure would
  -- hand them the answer to their own blind count.
  drawer as (
    select case
      when public.can_see_drawer_total() then coalesce((
        select sum(css.expected_cash_cents)
        from public.cashier_shift_summaries css
        where css.property_id = public.current_property_id()
          and css.cashier_id = auth.uid()
          and css.status in ('open', 'closing')
      ), 0)::bigint
    end as drawer_cents
  ),
  owed as (
    select coalesce(
      (
        select po.outstanding_cents
        from public.property_outstanding po
        where po.property_id = public.current_property_id()
      ),
      0
    )::bigint as outstanding_cents
  )
  select
    (select business_date from today),
    c.total_rooms,
    c.sellable_rooms,
    c.occupied_rooms,
    c.due_out_rooms,
    c.arriving_rooms,
    c.vacant_clean_rooms,
    c.vacant_dirty_rooms,
    c.ooo_rooms,
    m.expected_arrivals,
    m.expected_departures,
    coalesce(
      round(
        (c.occupied_rooms + c.due_out_rooms)::numeric * 100
          / nullif(c.sellable_rooms, 0),
        1
      ),
      0
    ),
    a.adr_cents,
    d.drawer_cents,
    o.outstanding_cents
  from counts c
  cross join movements m
  cross join adr a
  cross join drawer d
  cross join owed o;
$$;

comment on function public.house_summary() is
  'Single-row dashboard summary for the open business date. Occupancy is physical: (occupied + due out) / sellable. drawer_cents is null when the viewer may not see it.';

revoke all on function
  public.can_see_drawer_total(),
  public.cashier_shift_expected_for_viewer(uuid)
from public, anon;

grant execute on function
  public.can_see_drawer_total(),
  public.cashier_shift_expected_for_viewer(uuid)
to authenticated;
