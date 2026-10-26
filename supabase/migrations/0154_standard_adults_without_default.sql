-- 0154: a plan with no default occupancy stored is priced from Sleeps.
--
-- 0153's rate_plan_standard_adults() clamped the stored default with
-- least(greatest(default, 1), max). greatest() IGNORES nulls, so with no
-- default stored it read 1, not "none", and the standard party became 1
-- adult wherever 1 was not itself removed. The client met it at once:
-- removing the 1-adult row of BAR-B&B on Leadwise's Double Room with
-- Balcony (no default stored, Sleeps 2) was refused as "the standard
-- price". No price was wrong -- every pair with nothing stored and a party
-- removed had 1 among the removed, which sends the standard back to Sleeps
-- -- but the next removal of anything but 1 would have priced it as 1 adult.
--
-- The same expression is in channex_occupancy_prices(), so both change.

create or replace function public.rate_plan_standard_adults(
  p_rate_plan_id uuid,
  p_room_type_id uuid
) returns integer
language sql stable security definer
set search_path = public
as $$
  select case
    when rp.occupancy_pricing = 'per_person'
     and df.dflt is not null
     and not coalesce(rp.standard_occupancies -> rt.id::text @> to_jsonb(df.dflt), false)
     and not coalesce(par.standard_occupancies -> rt.id::text @> to_jsonb(df.dflt), false)
      then df.dflt
    else coalesce(rt.base_occupancy, 1)
  end
  from public.rate_plans rp
  join public.room_types rt on rt.id = p_room_type_id and rt.property_id = rp.property_id
  left join public.rate_plans par on par.id = rp.parent_rate_plan_id
  cross join lateral (
    select coalesce(rp.default_occupancies ->> rt.id::text, par.default_occupancies ->> rt.id::text)::integer as stored
  ) st
  cross join lateral (
    select case
      when st.stored is null then null
      else least(greatest(st.stored, 1), greatest(coalesce(rt.max_occupancy, 1), 1))
    end as dflt
  ) df
  where rp.id = p_rate_plan_id;
$$;

create or replace function public.channex_occupancy_prices(p_property uuid, p_from date, p_days integer)
returns table(rate_plan_id uuid, room_type_id uuid, stay_date date, adults integer, rate_cents bigint)
language sql stable security definer
set search_path = public
as $$
  select d.rate_plan_id, d.room_type_id, d.stay_date, o.n,
    case
      when d.rate_cents is null then null
      when rp.occupancy_pricing <> 'single' and od.rate_cents is not null then
        greatest(
          case when rp.parent_rate_plan_id is not null
            then public.rate_plan_derived_rate(
              od.rate_cents, rp.derived_kind, rp.derived_percent_bps, rp.derived_amount_cents)
            else od.rate_cents
          end, 0)
      when rp.occupancy_pricing <> 'per_person' then d.rate_cents
      else greatest(
        0,
        d.rate_cents
          + case
              when a.ad >= a.b then (a.ad - a.b) * rp.adult_adjust_cents
              when rp.adult_decrease_cents is not null then -(a.b - a.ad) * rp.adult_decrease_cents
              else (a.ad - a.b) * rp.adult_adjust_cents
            end
      )
    end
  from public.rate_plan_days d
  join public.rate_plans rp on rp.id = d.rate_plan_id
  join public.room_types rt on rt.id = d.room_type_id and rt.property_id = rp.property_id
  left join public.rate_plans par on par.id = rp.parent_rate_plan_id
  cross join lateral generate_series(1, greatest(coalesce(rt.max_occupancy, 1), 1)) o(n)
  cross join lateral (
    select coalesce(rp.standard_occupancies -> rt.id::text @> to_jsonb(o.n), false)
        or coalesce(par.standard_occupancies -> rt.id::text @> to_jsonb(o.n), false) as std
  ) s
  cross join lateral (
    select case
      when coalesce(rp.default_occupancies ->> rt.id::text, par.default_occupancies ->> rt.id::text) is null then null
      else least(
        greatest(coalesce(rp.default_occupancies ->> rt.id::text, par.default_occupancies ->> rt.id::text)::integer, 1),
        greatest(coalesce(rt.max_occupancy, 1), 1))
    end as dflt
  ) df
  cross join lateral (
    select coalesce(rt.base_occupancy, 1) as b,
           case
             when not s.std or rp.occupancy_pricing = 'single' then o.n
             when rp.occupancy_pricing = 'per_person'
              and df.dflt is not null
              and not coalesce(rp.standard_occupancies -> rt.id::text @> to_jsonb(df.dflt), false)
              and not coalesce(par.standard_occupancies -> rt.id::text @> to_jsonb(df.dflt), false)
               then df.dflt
             else coalesce(rt.base_occupancy, 1)
           end as ad
  ) a
  left join public.rate_plan_occupancy_days od
    on od.rate_plan_id = coalesce(rp.parent_rate_plan_id, rp.id)
   and od.room_type_id = d.room_type_id
   and od.stay_date = d.stay_date
   and od.adults = a.ad
   and od.property_id = p_property
   and od.stay_date between p_from and p_from + p_days - 1
  where d.property_id = p_property
    and d.stay_date between p_from and p_from + p_days - 1;
$$;
