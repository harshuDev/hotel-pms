-- 0137: the guest booking page shows a price in the hotel's other currencies
-- too, beside its own. Adjana Resort (XOF, Senegal) asked for euros: most of
-- its guests think in EUR. DISPLAY ONLY -- the booking is still priced,
-- stored, invoiced and paid in the hotel's currency, and nothing converts
-- money anywhere it is posted.
--
-- The rates are Settings -> Currencies (0083), which RLS keeps from `anon`.
-- This is the one read the guest page needs of it: the currency, how its rate
-- is kept, and a fixed rate if one was typed. The page works out a legal peg
-- (XOF/XAF -> EUR at 655.957) for a "Live Exchange" row itself, and shows
-- nothing for any other live rate, which would need a feed.
--
-- An unknown or inactive property returns no rows, like the other public
-- reads, so a stranger guessing ids learns nothing.

create or replace function public.public_display_currencies(p_property_id uuid)
returns table (currency text, rate_kind text, fixed_rate_micros bigint)
language sql
stable
security definer
set search_path = public
as $$
  select cp.currency::text, cp.rate_kind, cp.fixed_rate_micros
  from public.currency_profiles cp
  join public.properties p on p.id = cp.property_id and p.is_active
  where cp.property_id = p_property_id
  order by cp.created_at, cp.id;
$$;

revoke all on function public.public_display_currencies(uuid) from public;
grant execute on function public.public_display_currencies(uuid) to anon, authenticated;
