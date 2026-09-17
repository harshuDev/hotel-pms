-- Two pieces of housekeeping the database linter and the customers screen
-- have both been asking for.

-- 1. Every SELECT on tax_rates and payment_methods was evaluating two
--    permissive policies.
--
-- The `for all` manage policy covers SELECT as well as writes, so it stacked
-- on top of the select policy and both ran for every read. Splitting the
-- manage policy into the three commands it actually means leaves exactly one
-- policy per command. Who may do what does not change: anyone in the property
-- reads, administrators and managers write.
--
-- A policy's command cannot be altered, so these are dropped and recreated.

drop policy tax_rates_manage_finance on public.tax_rates;

create policy tax_rates_insert_finance on public.tax_rates
  for insert with check (
    property_id = public.current_property_id()
    and public.current_role() in ('admin', 'manager')
  );
create policy tax_rates_update_finance on public.tax_rates
  for update using (
    property_id = public.current_property_id()
    and public.current_role() in ('admin', 'manager')
  ) with check (
    property_id = public.current_property_id()
    and public.current_role() in ('admin', 'manager')
  );
create policy tax_rates_delete_finance on public.tax_rates
  for delete using (
    property_id = public.current_property_id()
    and public.current_role() in ('admin', 'manager')
  );

drop policy payment_methods_manage_finance on public.payment_methods;

create policy payment_methods_insert_finance on public.payment_methods
  for insert with check (
    property_id = public.current_property_id()
    and public.current_role() in ('admin', 'manager')
  );
create policy payment_methods_update_finance on public.payment_methods
  for update using (
    property_id = public.current_property_id()
    and public.current_role() in ('admin', 'manager')
  ) with check (
    property_id = public.current_property_id()
    and public.current_role() in ('admin', 'manager')
  );
create policy payment_methods_delete_finance on public.payment_methods
  for delete using (
    property_id = public.current_property_id()
    and public.current_role() in ('admin', 'manager')
  );

-- 2. Customers had no number anyone could quote.
--
-- The customers screen shows "Id:" against each profile, and the only
-- identifier available was the head of a uuid — stable and unique, but not
-- something a receptionist can read down a phone. This mirrors folio_number
-- exactly: one sequence, unique per property.
--
-- Done now because customers is still empty. Adding a not-null numbered
-- column to a populated table is a different and more careful job.

create sequence public.customer_number_seq as bigint;

alter table public.customers
  add column customer_number bigint not null default nextval('public.customer_number_seq');

alter table public.customers
  add constraint customers_number_unique unique (property_id, customer_number);

-- Surface it on the read model. Both are dropped rather than replaced:
-- create or replace cannot insert a column into the middle of a view, nor
-- change a function's return type. Dropping loses the grants, so they are
-- restored at the bottom.
drop function public.customers_page(text, public.customer_kind, integer, integer);
drop view public.customer_stats;

create view public.customer_stats with (security_invoker = true) as
select
  c.property_id,
  c.id as customer_id,
  c.customer_number,
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
where c.merged_into_id is null;

create function public.customers_page(
  p_q text default null,
  p_kind public.customer_kind default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  customer_id uuid,
  customer_number bigint,
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
        or strpos(lower(coalesce(s.name, '')), lower(btrim(p_q))) > 0
        or strpos(lower(coalesce(s.email, '')), lower(btrim(p_q))) > 0
        or strpos(coalesce(s.phone, ''), btrim(p_q)) > 0
        -- Quoting the number back at us should find them.
        or s.customer_number::text = btrim(p_q)
      )
  )
  select
    f.customer_id, f.customer_number, f.kind, f.name, f.national_id_number,
    f.email, f.phone, f.exclude_from_email, f.booking_count,
    f.last_booking_date, f.total_revenue_cents, f.balance_cents,
    count(*) over ()::bigint as total_count
  from filtered f
  order by f.name, f.customer_id
  limit greatest(coalesce(p_limit, 25), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on view public.customer_stats is
  'Customer profiles with booking counts and ledger-derived revenue and balance. Merged-away customers are excluded.';
comment on function public.customers_page(text, public.customer_kind, integer, integer) is
  'Filtered, paginated customer profiles. total_count is the size of the full filtered set.';

grant select on public.customer_stats to authenticated;

revoke all on function
  public.customers_page(text, public.customer_kind, integer, integer)
from public, anon;

grant execute on function
  public.customers_page(text, public.customer_kind, integer, integer)
to authenticated;
