-- 0138, part d: the booking path converts; the API, the rate reads and
-- Settings -> Currencies know about plan currencies.

-- ---------------------------------------------------------------------------
-- The booking path converts
-- ---------------------------------------------------------------------------

create or replace function public.rate_plan_night_rate(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_stay_date date,
  p_base_cents bigint,
  p_adults integer,
  p_children integer
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan public.rate_plans;
  v_cents bigint;
begin
  if p_rate_plan_id is null or p_base_cents is null then
    return p_base_cents;
  end if;
  select * into v_plan from public.rate_plans where id = p_rate_plan_id;
  if not found then
    return p_base_cents;
  end if;
  -- A removed row (0124) never reads a stored per-night occupancy price: the
  -- party pays the standard price, which rate_plan_occupancy_rate() gives.
  if p_adults is not null and v_plan.occupancy_pricing <> 'single'
     and not public.rate_plan_occupancy_is_standard(p_rate_plan_id, p_room_type_id, p_adults) then
    select o.rate_cents into v_cents
    from public.rate_plan_occupancy_days o
    where o.rate_plan_id = coalesce(v_plan.parent_rate_plan_id, v_plan.id)
      and o.room_type_id = p_room_type_id
      and o.stay_date = p_stay_date
      and o.adults = p_adults;
    if found then
      if v_plan.parent_rate_plan_id is not null then
        v_cents := public.rate_plan_derived_rate(
          v_cents, v_plan.derived_kind, v_plan.derived_percent_bps, v_plan.derived_amount_cents
        );
      end if;
      if v_plan.occupancy_pricing = 'per_person' then
        v_cents := v_cents + greatest(coalesce(p_children, 0), 0) * v_plan.child_adjust_cents;
      end if;
      -- 0138: the plan's currency, then the hotel's.
      return public.rate_plan_to_base(p_rate_plan_id, greatest(v_cents, 0));
    end if;
  end if;
  return public.rate_plan_to_base(
    p_rate_plan_id,
    public.rate_plan_occupancy_rate(p_rate_plan_id, p_room_type_id, p_base_cents, p_adults, p_children)
  );
end;
$$;

-- The offer is worked out on the night's price in the hotel's currency, so
-- an amount-off offer (written in the hotel's currency) and the night it
-- comes off are one currency.
create or replace function public.promotion_night_discounts(
  p_promotion_id uuid,
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date
)
returns table(stay_date date, rate_cents bigint, discount_cents bigint)
language sql
stable
set search_path = public
as $$
  with promo as (
    select * from public.promotions
    where id = p_promotion_id and property_id = public.current_property_id()
  ),
  nights as (
    select
      d::date as stay_date,
      coalesce(public.rate_plan_to_base(p_rate_plan_id, rpd.rate_cents), 0)::bigint as rate_cents,
      -- A night outside the promotion's stay window stays at full price.
      (promo.stay_from is null or d::date >= promo.stay_from)
        and (promo.stay_to is null or d::date <= promo.stay_to) as covered
    from promo
    cross join generate_series(p_check_in, p_check_out - 1, interval '1 day') as d
    left join public.rate_plan_days rpd
      on rpd.property_id = public.current_property_id()
     and rpd.rate_plan_id = p_rate_plan_id
     and rpd.room_type_id = p_room_type_id
     and rpd.stay_date = d::date
  ),
  -- For free_nights, the cheapest covered nights are the ones given away: a
  -- "stay 3 pay 2" handing back the most expensive night would cost the hotel
  -- more than the offer says, and every hotel gives the cheapest.
  ranked as (
    select
      nights.*,
      -- Ranked within the covered nights only, so an uncovered night never
      -- takes a free slot from one the promotion actually reaches.
      case when nights.covered
        then rank() over (
          partition by nights.covered
          order by nights.rate_cents, nights.stay_date
        )
      end as cheapness,
      count(*) filter (where nights.covered) over () as covered_nights
    from nights
  )
  select
    ranked.stay_date,
    ranked.rate_cents,
    case
      when not ranked.covered then 0::bigint
      when promo.kind = 'percent_off' then
        least(
          round(ranked.rate_cents * promo.percent_bps / 10000.0),
          ranked.rate_cents
        )::bigint
      when promo.kind = 'amount_off' then
        least(promo.amount_off_cents, ranked.rate_cents)::bigint
      when promo.kind = 'free_nights' then
        case
          when ranked.cheapness <= (
            (ranked.covered_nights / (promo.paid_nights + promo.free_nights))
            * promo.free_nights
          )
          then ranked.rate_cents
          else 0::bigint
        end
      else 0::bigint
    end as discount_cents
  from ranked
  cross join promo
  order by ranked.stay_date;
$$;

-- The API sends each plan's prices in the plan's own currency, which is what
-- a channel manager pushes to the OTA.
create or replace function public.api_rates(
  p_property_id uuid,
  p_key text,
  p_rate_plan_id uuid,
  p_from date,
  p_to date
)
returns table(
  stay_date date, room_type_id uuid, room_type_code text, rate_plan_id uuid, rate_cents bigint,
  currency text, min_stay_through integer, min_stay_arrival integer, max_stay integer,
  closed_to_arrival boolean, closed_to_departure boolean, stop_sell boolean, close_out boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_plan uuid;
  v_currency text;
begin
  perform public.api_authorize(p_property_id, p_key, 'rates');
  v_days := public.api_check_range(p_from, p_to);
  select rp.id, btrim(coalesce(rp.currency, p.currency)) into v_plan, v_currency
  from public.rate_plans rp
  join public.properties p on p.id = rp.property_id
  where rp.property_id = p_property_id and rp.is_active
    and (case when p_rate_plan_id is null then rp.is_default else rp.id = p_rate_plan_id end)
  limit 1;
  if v_plan is null then
    raise exception 'API_BAD_REQUEST: no such active rate plan' using errcode = 'HA400';
  end if;
  return query
  select g.stay_date, g.room_type_id, g.room_type_code, v_plan, g.rate_cents, v_currency,
    g.min_stay_through, g.min_stay_arrival, g.max_stay, g.closed_to_arrival,
    g.closed_to_departure, g.stop_sell, g.close_out
  from public.inventory_grid_for(p_property_id, v_plan, p_from, v_days) g;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the screens show
-- ---------------------------------------------------------------------------

-- The hotel's other currencies with the rate in use: units of the hotel's
-- currency per one of each, in millionths, and the day a live rate is from.
create or replace function public.currency_rates()
returns table(currency text, rate_micros bigint, rate_date date)
language sql
stable
security definer
set search_path = public
as $$
  select cp.currency::text,
    case when per.v is null or per.v = 0 then null else round(1000000 / per.v)::bigint end,
    case when cp.rate_kind = 'fixed' then null else er.rate_date end
  from public.currency_profiles cp
  cross join lateral (select public.currency_per_base(cp.property_id, cp.currency) as v) per
  left join public.exchange_rates er on er.currency = cp.currency and er.source = 'feed'
  where cp.property_id = public.current_property_id()
  order by cp.created_at, cp.id;
$$;

revoke all on function public.currency_rates() from public;
revoke execute on function public.currency_rates() from anon;
grant execute on function public.currency_rates() to authenticated;

-- The guest page's "≈" figures, with the live rate where there is one. It
-- replaces public_display_currencies() (0137), which knew only fixed rates
-- and the CFA peg; that one is withdrawn from anon so the public surface
-- does not grow.
create or replace function public.public_currency_rates(p_property_id uuid)
returns table(currency text, rate_micros bigint)
language sql
stable
security definer
set search_path = public
as $$
  select cp.currency::text, round(1000000 / per.v)::bigint
  from public.currency_profiles cp
  join public.properties p on p.id = cp.property_id and p.is_active
  cross join lateral (select public.currency_per_base(cp.property_id, cp.currency) as v) per
  where cp.property_id = p_property_id and per.v is not null and per.v > 0
    and round(1000000 / per.v) > 0
  order by cp.created_at, cp.id;
$$;

revoke all on function public.public_currency_rates(uuid) from public;
grant execute on function public.public_currency_rates(uuid) to anon, authenticated;
revoke execute on function public.public_display_currencies(uuid) from anon;

-- ---------------------------------------------------------------------------
-- A currency a plan is priced in cannot be taken away from under it
-- ---------------------------------------------------------------------------

create or replace function public.save_currency_profile(
  p_id uuid,
  p_currency text,
  p_rate_kind text,
  p_fixed_rate_micros bigint
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_property uuid;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_default text;
  v_id uuid;
  v_was text;
  v_plan text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the currencies';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Pick a currency';
  end if;
  select btrim(currency) into v_default from public.properties where id = v_property;
  if v_currency = v_default then
    raise exception '% is already the hotel''s default currency', v_currency;
  end if;
  if coalesce(p_rate_kind, '') not in ('live', 'fixed') then
    raise exception 'Pick the rate';
  end if;
  if p_rate_kind = 'fixed' and coalesce(p_fixed_rate_micros, 0) <= 0 then
    raise exception 'Write the fixed rate, above zero';
  end if;
  if exists (
    select 1 from public.currency_profiles c
    where c.property_id = v_property and c.currency = v_currency
      and (p_id is null or c.id <> p_id)
  ) then
    raise exception '% is already one of the hotel''s currencies', v_currency;
  end if;

  if p_id is not null then
    select btrim(currency) into v_was from public.currency_profiles
    where id = p_id and property_id = v_property;
    select rp.name into v_plan from public.rate_plans rp
    where rp.property_id = v_property and btrim(rp.currency) = v_was
    order by rp.name limit 1;
    if v_plan is not null and v_was <> v_currency then
      raise exception '% is priced in %, so that currency cannot be changed', v_plan, v_was;
    end if;
    if v_plan is not null and p_rate_kind = 'live' and (
      not exists (select 1 from public.exchange_rates where currency = v_currency)
      or not exists (select 1 from public.exchange_rates where currency = v_default)
    ) then
      raise exception 'There is no live rate for % yet, and % is priced in it. Keep the fixed rate for now.',
        v_currency, v_plan;
    end if;
  end if;

  if p_id is null then
    insert into public.currency_profiles (property_id, currency, rate_kind, fixed_rate_micros)
    values (
      v_property, v_currency, p_rate_kind,
      case when p_rate_kind = 'fixed' then p_fixed_rate_micros end
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.currency_profiles set
    currency = v_currency,
    rate_kind = p_rate_kind,
    fixed_rate_micros = case when p_rate_kind = 'fixed' then p_fixed_rate_micros end
  where id = p_id and property_id = v_property
  returning id into v_id;
  if v_id is null then
    raise exception 'That currency is not on this property';
  end if;
  return v_id;
end;
$$;

