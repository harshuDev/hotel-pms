-- 0141: the cashier's shift history.
--
-- The client: "the cashier is good, but when it is closed, it should appear
-- in the history." A closed shift was kept in full -- float, expected,
-- counted, variance, its payments and paid-outs -- but nothing showed it
-- again: the Cashier screen went back to "Open a shift" and the only trace
-- was one line in the dashboard's activity feed.
--
-- * cashier_shift_history(): the closed shifts of the current property,
--   newest close first, paged in Postgres, each with who ran it, its times
--   and figures, and the totals of its payments and paid-outs. Read only;
--   closed shifts are immutable (protect_cashier_shift) and stay so.
-- * MANAGERS AND ADMINISTRATORS ONLY -- can_see_drawer_total(), the same
--   test that already decides who may see the expected drawer figure. A
--   receptionist counts blind; showing them every other shift's expected
--   figure and variance would undo that.
-- * security definer, so the cashier's name is read even after their login
--   moved to another hotel (0134-0135, 0140) and staff_users' policy no
--   longer shows the row here. The property is still current_property_id().
-- * Payment totals come from cashier_shift_payments(), the same read the
--   open shift's screen and the detail use, so the row and its detail can
--   never disagree.

create or replace function public.cashier_shift_history(
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  shift_id uuid,
  cashier_name text,
  business_date date,
  opened_at timestamptz,
  closed_at timestamptz,
  opening_balance_cents bigint,
  expected_cash_cents bigint,
  counted_cash_cents bigint,
  variance_cents bigint,
  cash_payments_cents bigint,
  other_payments_cents bigint,
  payments_count bigint,
  paid_outs_cents bigint,
  paid_outs_count bigint,
  closing_notes text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
begin
  if v_property is null or not coalesce(public.can_see_drawer_total(), false) then
    raise exception 'Only managers and administrators can see the shift history';
  end if;

  return query
  select
    s.id,
    u.full_name,
    bd.business_date,
    s.opened_at,
    s.closed_at,
    s.opening_balance_cents,
    s.expected_cash_at_close_cents,
    s.counted_cash_cents,
    s.variance_cents,
    coalesce(pay.cash_cents, 0)::bigint,
    coalesce(pay.other_cents, 0)::bigint,
    coalesce(pay.n, 0)::bigint,
    coalesce(po.total_cents, 0)::bigint,
    coalesce(po.n, 0)::bigint,
    s.closing_notes,
    count(*) over ()
  from public.cashier_shifts s
  join public.business_dates bd
    on bd.id = s.business_date_id and bd.property_id = s.property_id
  left join public.staff_users u on u.id = s.cashier_id
  left join lateral (
    select
      sum(x.amount_cents) filter (where x.affects_drawer) as cash_cents,
      sum(x.amount_cents) filter (where not x.affects_drawer) as other_cents,
      count(*) as n
    from public.cashier_shift_payments(s.id) x
  ) pay on true
  left join lateral (
    select sum(m.amount_cents) as total_cents, count(*) as n
    from public.cash_movements m
    where m.shift_id = s.id
      and m.property_id = s.property_id
      and m.movement_type = 'paid_out'
  ) po on true
  where s.property_id = v_property
    and s.status = 'closed'
  order by s.closed_at desc, s.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.cashier_shift_history(integer, integer) from public;
revoke execute on function public.cashier_shift_history(integer, integer) from anon;
grant execute on function public.cashier_shift_history(integer, integer) to authenticated;
