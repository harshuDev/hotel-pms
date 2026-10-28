-- 0159: rate_plan_coverage() reads the open business date once, not per row.
--
-- The client, 28 Oct: Settings crashed twice in a day -- "Application error
-- ... Digest: 3094255094". That digest is "Failed to load the rate plan
-- coverage: canceling statement due to statement timeout", 45 times since
-- 9 Oct, every one on /settings. The function looked the open business date
-- up in a subquery correlated on each row of rate_plan_days, so on Adjana
-- Resort (two plans x 46 villas, ~35,000 priced nights) it ran 35,409 times,
-- each through business_dates' RLS policy: 1.1-2.7 s on a quiet database,
-- and past the 8 s statement_timeout once Settings' forty-odd reads ran
-- beside it.
--
-- The property and its open date are now worked out once and joined. Same
-- signature, same rows (tested rolled back on Adjana: 96 rows, none apart),
-- 30 ms instead of 1,118.

create or replace function public.rate_plan_coverage()
returns table(rate_plan_id uuid, room_type_id uuid, priced_nights bigint, first_night date, last_night date)
language sql stable
set search_path = public
as $$
  with p as materialized (
    select pid.id, coalesce(
      (select bd.business_date from public.business_dates bd
       where bd.property_id = pid.id and bd.status = 'open'),
      current_date) as from_date
    from (select public.current_property_id() as id) pid
  )
  select d.rate_plan_id, d.room_type_id, count(*)::bigint, min(d.stay_date), max(d.stay_date)
  from p
  join public.rate_plan_days d
    on d.property_id = p.id and d.stay_date >= p.from_date
  where d.rate_cents is not null
  group by d.rate_plan_id, d.room_type_id;
$$;
