-- 0066  The tax list says how many charges have been posted at each rate.
--
-- WHY THIS EXISTS. `save_tax_rate()` refuses to move a rate or its inclusion
-- once any `folio_items` row records it:
--
--   'Charges have already been posted at this rate. Retire it and add a new
--    one rather than changing it.'
--
-- That rule is right — a folio item records which rate it used, and moving the
-- rate underneath it would silently restate money already billed. But the
-- Settings screen could not see it coming: it read `tax_rates` directly, so
-- the first anybody knew was the refusal, after typing a new figure.
--
-- **This is the shape `cancellation_policies_list()` already uses**, where the
-- count of rate plans using each policy makes retiring a live one visible
-- before it happens. Same idea, same reason.
--
-- `security invoker`, so RLS decides what the caller counts rather than a
-- second copy of the property rule living in here.

create or replace function public.tax_rates_list()
returns table (
  id uuid,
  name text,
  rate_bps integer,
  inclusion public.tax_inclusion,
  is_active boolean,
  charge_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.id, t.name, t.rate_bps, t.inclusion, t.is_active,
    coalesce(c.charges, 0)::bigint
  from public.tax_rates t
  left join lateral (
    select count(*) as charges
    from public.folio_items fi
    where fi.tax_rate_id = t.id
      and fi.property_id = t.property_id
  ) c on true
  where t.property_id = public.current_property_id()
  -- Active first, then by name: the same order the screen read before, so the
  -- list does not reshuffle under anybody as a side effect of this change.
  order by t.is_active desc, t.name;
$$;

revoke execute on function public.tax_rates_list() from public, anon;
grant execute on function public.tax_rates_list() to authenticated;
