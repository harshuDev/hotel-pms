-- 0157: a number of guests removed from a rate plan is not sent to Channex.
--
-- Removing an occupancy row in Room Rate Combinations (0124) stores it in
-- rate_plans.standard_occupancies, and every screen of this PMS leaves it out
-- (0153-0154, 0156). The Channex card did not: it listed every number of
-- guests from Min to Max Adults, ticked, and Send gave Channex an option for
-- each -- so a removed 1-adult price kept showing up on Channex and the OTAs.
-- The client: removed occupancy rates "keep showing up". On Shitaye
-- and Tierra Buena the team had been unticking them by hand on every plan;
-- on Leadwise's Double Room with Balcony the removed 1 adult was still sent.
--
-- A removed number of guests (the plan's own list or its parent's, as
-- rate_plan_occupancy_is_standard() reads it) now comes off the card and off
-- the pick Send builds a Channex plan from. A Channex plan still holding one
-- reads "occupancies out of date" and the next Send rebuilds it -- unless an
-- OTA is mapped to it, which Send never touches (0151). Nothing reaches
-- Channex until Send is pressed.

create or replace function public.channex_removed_occupancies(
  p_rate_plan_id uuid,
  p_room_type_id uuid
) returns integer[]
language sql stable security definer
set search_path = public
as $$
  select array(
    select distinct v::integer
    from public.rate_plans rp
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(rp.standard_occupancies -> p_room_type_id::text) = 'array'
        then rp.standard_occupancies -> p_room_type_id::text else '[]'::jsonb end) v
    where rp.id in (
      p_rate_plan_id,
      (select parent_rate_plan_id from public.rate_plans where id = p_rate_plan_id)
    )
    order by 1
  );
$$;

-- The pick with removed numbers of guests taken out: none chosen means every
-- one left, and a pick left empty means every one left too, never a removed
-- one. With nothing left at all (Min/Max Adults narrowing past every party
-- not removed) the pick is unchanged and channex_pick_occupancies() decides.
create or replace function public.channex_keep_occupancies(
  p_lo integer,
  p_hi integer,
  p_chosen integer[],
  p_removed integer[]
) returns integer[]
language sql immutable
set search_path = public
as $$
  with keep as (
    select array(
      select g from generate_series(p_lo, p_hi) g
      where not (g = any (coalesce(p_removed, '{}'::integer[])))
      order by g
    ) as k
  ),
  picked as (
    select array(
      select g from unnest(keep.k) g
      where p_chosen is null or g = any (p_chosen)
      order by g
    ) as a
    from keep
  )
  select case
    when coalesce(cardinality(p_removed), 0) = 0 or cardinality(keep.k) = 0 then p_chosen
    when cardinality(picked.a) = 0 then keep.k
    else picked.a
  end
  from keep, picked;
$$;

revoke all on function public.channex_removed_occupancies(uuid, uuid) from public;
revoke execute on function public.channex_removed_occupancies(uuid, uuid) from anon, authenticated;
revoke all on function public.channex_keep_occupancies(integer, integer, integer[], integer[]) from public;
revoke execute on function public.channex_keep_occupancies(integer, integer, integer[], integer[]) from anon, authenticated;

create or replace function public.channex_desired_options_for(
  p_property uuid,
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_chosen integer[]
) returns table(lo integer, hi integer, primary_occ integer, occs integer[], options jsonb)
language sql stable security definer
set search_path = public
as $$
  select o.lo, o.hi, k.primary_occ, k.occs,
    (select jsonb_agg(jsonb_build_object('occupancy', g, 'is_primary', g = k.primary_occ, 'rate', 0) order by g)
       from unnest(k.occs) g)
  from public.channex_plan_occupancy(p_property) o
  cross join lateral public.channex_pick_occupancies(
    o.lo, o.hi, o.primary_occ,
    public.channex_keep_occupancies(o.lo, o.hi, p_chosen,
      public.channex_removed_occupancies(o.rate_plan_id, o.room_type_id))) k
  where o.rate_plan_id = p_rate_plan_id and o.room_type_id = p_room_type_id;
$$;

create or replace function public.channex_plan_occupancy_choices()
returns table(room_type_id uuid, rate_plan_id uuid, adults integer, rate_cents bigint, is_default boolean, chosen boolean, in_channex boolean, is_current boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_cx text;
  v_today date;
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = v_property;
  v_today := public.open_business_date(v_property);

  return query
  select o.room_type_id, o.rate_plan_id, n.n, pr.rate_cents, n.n = o.primary_occ,
    n.n = any (k.occs),
    m.channex_rate_plan_id is not null
      and n.n = any (coalesce(m.channex_occupancies, array[greatest(coalesce(rt.max_occupancy, 1), 1)])),
    m.channex_rate_plan_id is null or public.channex_plan_matches(
      coalesce(m.channex_sell_mode, 'per_room'),
      coalesce(m.channex_occupancies, array[greatest(coalesce(rt.max_occupancy, 1), 1)]),
      coalesce(m.channex_primary, m.channex_occupancies[1], greatest(coalesce(rt.max_occupancy, 1), 1)),
      k.occs, k.primary_occ)
  from public.channex_plan_occupancy(v_property) o
  join public.room_types rt on rt.id = o.room_type_id
  left join public.channex_rate_plan_map m
    on m.rate_plan_id = o.rate_plan_id and m.room_type_id = o.room_type_id
   and m.channex_property_id = v_cx and not m.removed
  cross join lateral (
    select public.channex_removed_occupancies(o.rate_plan_id, o.room_type_id) as r
  ) rm
  cross join lateral public.channex_pick_occupancies(
    o.lo, o.hi, o.primary_occ,
    public.channex_keep_occupancies(o.lo, o.hi, m.chosen_occupancies, rm.r)) k
  cross join lateral generate_series(o.lo, o.hi) n(n)
  left join public.channex_occupancy_prices(v_property, v_today, 1) pr
    on pr.rate_plan_id = o.rate_plan_id and pr.room_type_id = o.room_type_id and pr.adults = n.n
  -- A removed number of guests is not drawn, unless nothing else is left.
  where not (n.n = any (rm.r)) or n.n = any (k.occs)
  order by rt.sort_order, o.room_type_id, o.rate_plan_id, n.n;
end;
$$;
