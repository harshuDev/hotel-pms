-- 0160: the shift history can be narrowed to a range of dates.
--
-- The client, 30 Oct: a filter on Cashier "such that client can find out on
-- what date he closed the previous shifts". The history (0141) was every
-- closed shift, 20 a page, newest first, so finding one from three weeks ago
-- meant paging back through all of them.
--
-- A shift has two dates and they disagree more often than not: 18 of the 28
-- closed shifts on the hosted database closed on a later day, on the hotel's
-- clock, than the business date they belong to (a night shift, or a drawer
-- counted the next morning). So the range is on either, chosen by the caller:
-- 'business' is the business date, the day the audit closes, which every
-- report reads; 'closed' is the day the drawer was counted, on the hotel's
-- clock (properties.timezone), never the server's. Both ends are optional and
-- inclusive.
--
-- A new function rather than parameters on cashier_shift_history(): a changed
-- parameter list is a second function beside the first, and PostgREST would
-- refuse to choose between them. The old one is left in place and called by
-- nothing. Same guard, same rows, same order.

create or replace function public.cashier_shift_history_between(
  p_from date default null,
  p_to date default null,
  p_by text default 'business',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(shift_id uuid, cashier_name text, business_date date, opened_at timestamp with time zone, closed_at timestamp with time zone, opening_balance_cents bigint, expected_cash_cents bigint, counted_cash_cents bigint, variance_cents bigint, cash_payments_cents bigint, other_payments_cents bigint, payments_count bigint, paid_outs_cents bigint, paid_outs_count bigint, closing_notes text, total_count bigint)
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_by text := coalesce(p_by, 'business');
  v_tz text;
begin
  if v_property is null or not coalesce(public.can_see_drawer_total(), false) then
    raise exception 'Only managers and administrators can see the shift history';
  end if;
  if v_by not in ('business', 'closed') then
    raise exception 'Filter the shift history by business date or by the date it closed';
  end if;

  select p.timezone into v_tz from public.properties p where p.id = v_property;

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
  cross join lateral (
    select case when v_by = 'closed'
      then (s.closed_at at time zone coalesce(v_tz, 'UTC'))::date
      else bd.business_date end as on_date
  ) d
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
    and (p_from is null or d.on_date >= p_from)
    and (p_to is null or d.on_date <= p_to)
  order by s.closed_at desc, s.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.cashier_shift_history_between(date, date, text, integer, integer) from public;
revoke execute on function public.cashier_shift_history_between(date, date, text, integer, integer) from anon;
grant execute on function public.cashier_shift_history_between(date, date, text, integer, integer) to authenticated;
