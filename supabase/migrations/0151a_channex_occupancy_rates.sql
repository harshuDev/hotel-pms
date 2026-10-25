-- 0151a: Channex gets a price for every number of guests, not one price.
--
-- The client, mapping Tierra Buena: "the system is taking the lowest
-- occupancy ... it's for four people, but it's taking the price for one ...
-- Booking we send one, the default price. But Expedia has to send the price
-- for one, two, three, four ... the default is 6, but it's sending the price
-- for 12 people."
--
-- Until now every Channex rate plan was `per_room` with ONE occupancy option,
-- the room type's maximum, and the push sent `rate_cents` -- the price for
-- the room type's base occupancy -- as that option's price. So a room that
-- sleeps four but is priced for two went to Channex as "four people, the
-- two-person price", and the plan's default occupancy never reached it.
--
-- * A Channex rate plan is now `per_person` with one option per number of
--   adults the plan sells (1 to the room type's maximum, narrowed by the
--   plan's Min/Max Adults), and the PRIMARY option is the plan's default
--   occupancy (0136, else the room type's base). Booking.com reads the
--   primary; Expedia maps every occupancy.
-- * The push sends `rates: [{occupancy, rate}]` per night, each the price this
--   PMS charges that many adults (`channex_occupancy_prices()`).
-- * A CHANNEX PLAN'S OPTIONS ARE FIXED WHEN IT IS MADE. Tried on staging:
--   "sell_mode can't be changed", "primary occupancy can't be changed", and an
--   update that adds or takes away an option answers 200 and changes nothing.
--   So Send REBUILDS a plan whose options differ (every per_room plan made
--   before 0151) -- deletes it and creates it again under the same title --
--   but only when no channel is mapped to it: Channex's channel list is read
--   first, and Channex itself refuses the delete of a mapped plan. A mapped
--   plan is never forced off its channel: it stays as it is, and the push
--   sends what its options say -- for a per_room plan, the price for the
--   occupancy its one option is for (it sent the base occupancy's price).
-- * `channex_rate_plan_map` records what Channex has: sell mode, the
--   occupancies and the primary. Null is a plan made before 0151: per_room at
--   the room type's maximum, which is what 0145 created.

alter table public.channex_rate_plan_map
  add column if not exists channex_sell_mode text,
  add column if not exists channex_occupancies integer[],
  add column if not exists channex_primary integer;

alter table public.channex_rate_plan_map
  add constraint channex_rate_plan_map_sell_mode_known
    check (channex_sell_mode is null or channex_sell_mode in ('per_room', 'per_person'));

-- What a plan sells on a room type, in adults: lo..hi, and the primary.
create or replace function public.channex_plan_occupancy(p_property uuid)
returns table (rate_plan_id uuid, room_type_id uuid, lo integer, hi integer, primary_occ integer)
language sql
stable
security definer
set search_path = public
as $$
  select rp.id, rt.id, c.lo, c.hi, least(greatest(d.def, c.lo), c.hi)
  from public.rate_plans rp
  join public.room_types rt on rt.property_id = rp.property_id
  left join public.rate_plans par on par.id = rp.parent_rate_plan_id
  cross join lateral (select greatest(coalesce(rt.max_occupancy, 1), 1) as mx) a
  cross join lateral (
    select greatest(1, coalesce(rp.min_adults, 1)) as lo0,
           least(a.mx, coalesce(rp.max_adults, a.mx)) as hi0
  ) b
  cross join lateral (
    select case when b.lo0 <= b.hi0 then b.lo0 else 1 end as lo,
           case when b.lo0 <= b.hi0 then b.hi0 else a.mx end as hi
  ) c
  cross join lateral (
    select coalesce(
      (rp.default_occupancies ->> rt.id::text)::integer,
      (par.default_occupancies ->> rt.id::text)::integer,
      rt.base_occupancy,
      1
    ) as def
  ) d
  where rp.property_id = p_property;
$$;

-- The price of each night for each number of adults, in the PLAN'S OWN
-- currency (what Channex is sent), from p_from for p_days nights.
--
-- THIS IS rate_plan_night_rate(plan, type, night, rate_cents, adults, 0)
-- WITHOUT rate_plan_to_base(), done for a whole hotel in one query: the push
-- runs every minute, and calling the function per night per occupancy took
-- 2.6 s for one hotel. The two must agree -- 0151 was checked against it on
-- every hotel, every pair and every occupancy over 120 nights. Change one,
-- change both.
create or replace function public.channex_occupancy_prices(p_property uuid, p_from date, p_days integer)
returns table (rate_plan_id uuid, room_type_id uuid, stay_date date, adults integer, rate_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select d.rate_plan_id, d.room_type_id, d.stay_date, o.n,
    case
      when d.rate_cents is null then null
      when rp.occupancy_pricing <> 'single' and not s.std and od.rate_cents is not null then
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
    select coalesce(rt.base_occupancy, 1) as b,
           case when s.std then coalesce(rt.base_occupancy, 1) else o.n end as ad
  ) a
  left join public.rate_plan_occupancy_days od
    on od.rate_plan_id = coalesce(rp.parent_rate_plan_id, rp.id)
   and od.room_type_id = d.room_type_id
   and od.stay_date = d.stay_date
   and od.adults = o.n
   and od.property_id = p_property
   and od.stay_date between p_from and p_from + p_days - 1
  where d.property_id = p_property
    and d.stay_date between p_from and p_from + p_days - 1;
$$;

revoke all on function public.channex_plan_occupancy(uuid) from public;
revoke execute on function public.channex_plan_occupancy(uuid) from anon, authenticated;
revoke all on function public.channex_occupancy_prices(uuid, date, integer) from public;
revoke execute on function public.channex_occupancy_prices(uuid, date, integer) from anon, authenticated;

-- The push: a per_person plan gets `rates`, one per occupancy Channex holds;
-- a per_room plan (one made before 0151, or kept because a channel is mapped
-- to it) gets `rate` -- the price for the occupancy its one option is for.
-- A night with no price for the primary occupancy, or a price of 0, goes as
-- stop sell, as before.
create or replace function public.channex_ari_changes(p_property uuid, p_full boolean)
returns table (kind text, channex_id text, date_from date, date_to date, value jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cx text;
  v_from date;
  v_currency text;
  v_zone text;
begin
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = p_property;
  select btrim(p.currency), p.timezone into v_currency, v_zone from public.properties p where p.id = p_property;
  v_from := greatest(
    public.open_business_date(p_property),
    (now() at time zone coalesce(v_zone, 'UTC'))::date
  );
  if v_cx is null or v_from is null then
    return;
  end if;

  return query
  with span as (
    select gs::date as sd from generate_series(v_from, v_from + 499, interval '1 day') gs
  ),
  avail as (
    select 'availability'::text as k, m.channex_room_type_id as cx, g.stay_date as sd,
      jsonb_build_object('availability', greatest(g.sellable - g.sold, 0)) as val
    from public.inventory_grid_for(p_property, null, v_from, 500) g
    join public.channex_room_type_map m
      on m.room_type_id = g.room_type_id and m.channex_property_id = v_cx
  ),
  maps as (
    select m.rate_plan_id, m.room_type_id, m.channex_rate_plan_id, m.withdrawn_at,
      rp.is_active,
      coalesce(btrim(rp.currency), v_currency) as currency,
      coalesce(m.channex_sell_mode, 'per_room') as sell_mode,
      coalesce(m.channex_occupancies, array[greatest(coalesce(rt.max_occupancy, 1), 1)]) as occs,
      coalesce(m.channex_primary, m.channex_occupancies[1], greatest(coalesce(rt.max_occupancy, 1), 1)) as primary_occ
    from public.channex_rate_plan_map m
    join public.rate_plans rp on rp.id = m.rate_plan_id
    join public.room_types rt on rt.id = m.room_type_id
    where m.property_id = p_property and m.channex_property_id = v_cx
      and not m.removed
  ),
  prices as materialized (
    select x.*, mp.currency
    from public.channex_occupancy_prices(p_property, v_from, 500) x
    join maps mp on mp.rate_plan_id = x.rate_plan_id and mp.room_type_id = x.room_type_id
    where x.adults = any (mp.occs)
  ),
  -- Each price written once: a hotel has a few dozen distinct prices and
  -- tens of thousands of nights times occupancies.
  texts as materialized (
    select v.rate_cents, v.currency, public.channex_rate_text(v.rate_cents, v.currency) as txt
    from (select distinct pr.rate_cents, pr.currency from prices pr where pr.rate_cents > 0) v
  ),
  -- Every night of every plan once (the span), plus its prices, GROUPED
  -- rather than joined: a join of the span to the prices was planned as a
  -- nested loop (100 million comparisons, 16 s for one hotel).
  nights as (
    select pr.rate_plan_id, pr.room_type_id, pr.stay_date as sd, pr.adults, pr.rate_cents, t.txt
    from prices pr
    left join texts t on t.rate_cents = pr.rate_cents and t.currency = pr.currency
    union all
    select mp.rate_plan_id, mp.room_type_id, s.sd, null, null, null
    from maps mp cross join span s
  ),
  per_night as (
    select nt.rate_plan_id, nt.room_type_id, nt.sd,
      max(nt.rate_cents) filter (where nt.adults = mp.primary_occ) as primary_cents,
      max(nt.txt) filter (where nt.adults = mp.primary_occ) as primary_txt,
      jsonb_agg(jsonb_build_object('occupancy', nt.adults, 'rate', nt.txt) order by nt.adults)
        filter (where nt.rate_cents > 0) as rates
    from nights nt
    join maps mp on mp.rate_plan_id = nt.rate_plan_id and mp.room_type_id = nt.room_type_id
    group by nt.rate_plan_id, nt.room_type_id, nt.sd
  ),
  restr as (
    select 'restrictions'::text as k, mp.channex_rate_plan_id as cx, n.sd,
      case
        when mp.withdrawn_at is not null then jsonb_build_object('stop_sell', true)
        when n.primary_cents is null or n.primary_cents <= 0 then jsonb_build_object('stop_sell', true)
        else
          case when mp.sell_mode = 'per_person'
            then jsonb_build_object('rates', n.rates)
            else jsonb_build_object('rate', n.primary_txt)
          end
          || jsonb_build_object(
            'min_stay_arrival', greatest(coalesce(d.min_stay_arrival, 1), 1),
            'min_stay_through', greatest(coalesce(d.min_stay_through, 1), 1),
            'max_stay', greatest(coalesce(d.max_stay, 0), 0),
            'closed_to_arrival', coalesce(d.closed_to_arrival, false),
            'closed_to_departure', coalesce(d.closed_to_departure, false),
            'stop_sell', coalesce(d.stop_sell, false) or not mp.is_active
          )
      end as val
    from per_night n
    join maps mp on mp.rate_plan_id = n.rate_plan_id and mp.room_type_id = n.room_type_id
    left join public.rate_plan_days d
      on d.rate_plan_id = n.rate_plan_id and d.room_type_id = n.room_type_id
     and d.stay_date = n.sd and d.property_id = p_property
  ),
  now_values as (
    select * from avail
    union all
    select * from restr
  ),
  changed as (
    select nv.k, nv.cx, nv.sd, nv.val
    from now_values nv
    left join public.channex_ari_sent x
      on x.channex_property_id = v_cx and x.kind = nv.k
     and x.channex_id = nv.cx and x.stay_date = nv.sd
    where p_full or x.value is distinct from nv.val
  ),
  runs as (
    select c.*, c.sd - (row_number() over (partition by c.k, c.cx, c.val order by c.sd))::integer as run
    from changed c
  )
  select r.k, r.cx, min(r.sd), max(r.sd), r.val
  from runs r
  group by r.k, r.cx, r.val, r.run
  order by r.k, r.cx, min(r.sd);
end;
$$;

notify pgrst, 'reload schema';
