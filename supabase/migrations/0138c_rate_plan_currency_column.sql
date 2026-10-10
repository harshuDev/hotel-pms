-- 0138, part c: conversion, the plan's currency column, and choosing it.

-- ---------------------------------------------------------------------------
-- Conversion
-- ---------------------------------------------------------------------------

-- The smallest amount a currency is written in, in our integer hundredths:
-- the CFA francs have no cents (money.ts says the same).
create or replace function public.currency_minor_step(p_currency text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case when upper(btrim(p_currency)) in ('XOF', 'XAF') then 100 else 1 end::bigint;
$$;

-- How many of `p_currency` one unit of the hotel's own currency buys. A fixed
-- rate set in Settings -> Currencies wins ("1 USD = 17.25 MXN" is base per
-- unit, so inverted here); otherwise the live rates, crossed through the
-- euro. Null when there is no rate at all.
create or replace function public.currency_per_base(p_property_id uuid, p_currency text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base text;
  v_cur text := upper(btrim(coalesce(p_currency, '')));
  v_fixed bigint;
  v_kind text;
  v_base_eur bigint;
  v_cur_eur bigint;
begin
  select btrim(p.currency) into v_base from public.properties p where p.id = p_property_id;
  if v_base is null then
    return null;
  end if;
  if v_cur = '' or v_cur = v_base then
    return 1;
  end if;
  select cp.rate_kind, cp.fixed_rate_micros into v_kind, v_fixed
  from public.currency_profiles cp
  where cp.property_id = p_property_id and cp.currency = v_cur;
  if v_kind = 'fixed' and v_fixed is not null and v_fixed > 0 then
    return 1000000::numeric / v_fixed;
  end if;
  select per_eur_micros into v_base_eur from public.exchange_rates where currency = v_base;
  select per_eur_micros into v_cur_eur from public.exchange_rates where currency = v_cur;
  if v_base_eur is null or v_cur_eur is null then
    return null;
  end if;
  return v_cur_eur::numeric / v_base_eur;
end;
$$;

-- An amount in one of the hotel's currencies, in another, rounded once to
-- the target's smallest unit (half away from zero). Null without a rate.
create or replace function public.convert_currency_cents(
  p_property_id uuid,
  p_cents bigint,
  p_from text,
  p_to text
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from numeric;
  v_to numeric;
  v_step bigint;
begin
  if p_cents is null then
    return null;
  end if;
  v_from := public.currency_per_base(p_property_id, p_from);
  v_to := public.currency_per_base(p_property_id, p_to);
  if v_from is null or v_to is null then
    return null;
  end if;
  if v_from = v_to then
    return p_cents;
  end if;
  v_step := public.currency_minor_step(coalesce(nullif(btrim(p_to), ''),
    (select btrim(currency) from public.properties where id = p_property_id)));
  return (round(p_cents::numeric * v_to / v_from / v_step) * v_step)::bigint;
end;
$$;

-- A plan's price in the hotel's currency. The only conversion on the booking
-- path: rate_plan_night_rate() and promotion_night_discounts() call it.
create or replace function public.rate_plan_to_base(p_rate_plan_id uuid, p_cents bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_out bigint;
begin
  if p_cents is null or p_rate_plan_id is null then
    return p_cents;
  end if;
  select rp.currency, rp.property_id, rp.name, btrim(p.currency) as base
    into v_plan
  from public.rate_plans rp
  join public.properties p on p.id = rp.property_id
  where rp.id = p_rate_plan_id;
  if not found or v_plan.currency is null or btrim(v_plan.currency) = v_plan.base then
    return p_cents;
  end if;
  v_out := public.convert_currency_cents(v_plan.property_id, p_cents, v_plan.currency, v_plan.base);
  if v_out is null then
    raise exception 'There is no exchange rate for % yet. Set a fixed rate for it in Settings -> Currencies.',
      btrim(v_plan.currency);
  end if;
  return v_out;
end;
$$;

revoke all on function public.currency_minor_step(text) from public;
revoke all on function public.currency_per_base(uuid, text) from public;
revoke all on function public.convert_currency_cents(uuid, bigint, text, text) from public;
revoke all on function public.rate_plan_to_base(uuid, bigint) from public;
revoke execute on function public.currency_per_base(uuid, text) from anon, authenticated;
revoke execute on function public.convert_currency_cents(uuid, bigint, text, text) from anon, authenticated;
revoke execute on function public.rate_plan_to_base(uuid, bigint) from anon;
revoke execute on function public.currency_minor_step(text) from anon;
-- promotion_night_discounts() runs as the caller, so staff need it.
grant execute on function public.rate_plan_to_base(uuid, bigint) to authenticated;
grant execute on function public.currency_minor_step(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The column, and a derived plan's currency follows its parent's
-- ---------------------------------------------------------------------------

alter table public.rate_plans
  add column currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$');

comment on column public.rate_plans.currency is
  'The currency the plan''s prices are typed and stored in (0138). Null is the hotel''s own. Bookings convert to the hotel''s currency.';

-- A derived plan's price is the parent's, adjusted, so it is in the parent's
-- currency -- its amount adjustment included.
create or replace function public.rate_plans_currency_follows_parent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_rate_plan_id is not null then
    select rp.currency into new.currency from public.rate_plans rp where rp.id = new.parent_rate_plan_id;
  end if;
  return new;
end;
$$;

create trigger rate_plans_currency_follows_parent
  before insert or update of parent_rate_plan_id, currency on public.rate_plans
  for each row execute function public.rate_plans_currency_follows_parent();

create or replace function public.rate_plans_currency_push_to_children()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.rate_plans set currency = new.currency
  where parent_rate_plan_id = new.id and currency is distinct from new.currency;
  return null;
end;
$$;

create trigger rate_plans_currency_push_to_children
  after update of currency on public.rate_plans
  for each row when (old.currency is distinct from new.currency)
  execute function public.rate_plans_currency_push_to_children();

-- ---------------------------------------------------------------------------
-- Choosing a plan's currency
-- ---------------------------------------------------------------------------

-- Its own function, like set_rate_plan_cancellation_policy(): a parameter on
-- save_rate_plan() would be an overload for PostgREST to choose between.
-- The currency must be the hotel's or one in Settings -> Currencies. Prices
-- already stored are converted at today's rate, plan and derived plans alike,
-- so a price keeps its value rather than its digits.
create or replace function public.set_rate_plan_currency(p_rate_plan_id uuid, p_currency text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_plan public.rate_plans;
  v_base text;
  v_new text := upper(btrim(coalesce(p_currency, '')));
  v_old text;
  v_plans uuid[];
  v_test bigint;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change rates';
  end if;
  select * into v_plan from public.rate_plans where id = p_rate_plan_id and property_id = v_property;
  if not found then
    raise exception 'That rate plan is not on this property';
  end if;
  if v_plan.parent_rate_plan_id is not null then
    raise exception '% takes its currency from the rate it is derived from', v_plan.name;
  end if;
  select btrim(currency) into v_base from public.properties where id = v_property;
  if v_new = '' then
    v_new := v_base;
  end if;
  if v_new <> v_base and not exists (
    select 1 from public.currency_profiles cp where cp.property_id = v_property and cp.currency = v_new
  ) then
    raise exception '% is not one of the hotel''s currencies. Add it in Settings -> Currencies first.', v_new;
  end if;
  v_old := coalesce(btrim(v_plan.currency), v_base);
  if v_old = v_new then
    -- Normalise: the hotel's own currency is stored as null.
    update public.rate_plans set currency = null
    where id = p_rate_plan_id and v_new = v_base and currency is not null;
    return;
  end if;

  v_test := public.convert_currency_cents(v_property, 100000, v_new, v_base);
  if v_test is null then
    raise exception 'There is no exchange rate for % yet. Set a fixed rate for it in Settings -> Currencies.', v_new;
  end if;
  v_test := public.convert_currency_cents(v_property, 100000, v_old, v_new);
  if v_test is null then
    raise exception 'There is no exchange rate for % yet. Set a fixed rate for it in Settings -> Currencies.', v_old;
  end if;

  v_plans := array(
    select id from public.rate_plans where id = p_rate_plan_id or parent_rate_plan_id = p_rate_plan_id
  );

  -- Amounts on the plans first: a child's amount adjustment is applied when
  -- the parent's nights change below.
  update public.rate_plans rp set
    adult_adjust_cents = public.convert_currency_cents(v_property, rp.adult_adjust_cents, v_old, v_new),
    child_adjust_cents = public.convert_currency_cents(v_property, rp.child_adjust_cents, v_old, v_new),
    adult_decrease_cents = public.convert_currency_cents(v_property, rp.adult_decrease_cents, v_old, v_new),
    derived_amount_cents = public.convert_currency_cents(v_property, rp.derived_amount_cents, v_old, v_new)
  where rp.id = any(v_plans);

  update public.rate_plan_week_rates w set
    rate_cents = public.convert_currency_cents(v_property, w.rate_cents, v_old, v_new),
    occupancy_rates = case
      when w.occupancy_rates is null or jsonb_typeof(w.occupancy_rates) <> 'object' then w.occupancy_rates
      else coalesce((
        select jsonb_object_agg(e.key, public.convert_currency_cents(v_property, (e.value::text)::bigint, v_old, v_new))
        from jsonb_each(w.occupancy_rates) e
        where jsonb_typeof(e.value) = 'number'
      ), '{}'::jsonb)
    end
  where w.rate_plan_id = any(v_plans) and w.property_id = v_property;

  update public.rate_plan_occupancy_days o set
    rate_cents = public.convert_currency_cents(v_property, o.rate_cents, v_old, v_new)
  where o.rate_plan_id = any(v_plans) and o.property_id = v_property and o.rate_cents is not null;

  -- The parent's nights; each derived plan's follow by trigger.
  update public.rate_plan_days d set
    rate_cents = public.convert_currency_cents(v_property, d.rate_cents, v_old, v_new)
  where d.rate_plan_id = p_rate_plan_id and d.property_id = v_property and d.rate_cents is not null;

  update public.rate_plans set currency = case when v_new = v_base then null else v_new end
  where id = p_rate_plan_id;
end;
$$;

revoke all on function public.set_rate_plan_currency(uuid, text) from public;
revoke execute on function public.set_rate_plan_currency(uuid, text) from anon;
grant execute on function public.set_rate_plan_currency(uuid, text) to authenticated;

