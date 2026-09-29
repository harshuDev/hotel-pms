-- 0110: rates per day, per occupancy, and seasons that actually price.
--
-- The client, on the rates section: "Pricing should be set per day not year
-- as it is now", "We cannot create different pricing per occupancy", "Hotels
-- have to be able to change the rates per day", "Season does not work", and
-- "it is very important to have the rates PER DAY".
--
-- What the hosted data showed before anything was written:
--   * The only price edits since 0109 went through the weekly template (Room
--     Rate Combinations, Default Season), which writes a year of nights at a
--     time. The per-night grid (Inventory -> Rates) was a bulk editor with no
--     way to click one day and type its price -- that is the screen side of
--     this, not the database.
--   * A season "TEST" (27-30 Sep) had been made and no rate ever saved for it.
--     Had one been, the template only FILLED empty nights, and every night was
--     already priced, so a season changed nothing. That is the "does not work".
--
-- So this migration:
--   1. `rate_plan_occupancy_days`: a price per plan, room type, NIGHT and
--      number of adults. The standard price in `rate_plan_days` stays the
--      price for the room; an occupancy price, where one is set, is what that
--      many adults pay that night instead.
--   2. `rate_plan_night_rate()`: the one place a night is priced for a party
--      -- the occupancy price if set (a derived plan reads its parent's,
--      adjusted), else the 0109 per-person / single rule. `create_booking()`,
--      `create_public_booking()` and `public_room_types()` call it.
--   3. `set_occupancy_rates()` (bulk, like `set_rates()`) and
--      `inventory_occupancy_grid()` for the screen.
--   4. A SEASON'S RATES WIN ON THE SEASON'S OWN DATES. `save_week_rates()`
--      now replaces the rate on a season's nights (the Default Season still
--      only fills, unless "Replace" is ticked), and `add_season_range()`
--      applies a season's saved week rates to the dates just added.

-- ---------------------------------------------------------------------------
-- 0. Three ways to price occupancy, as the reference's form has them
-- ---------------------------------------------------------------------------
-- "One Price For All Occupancies" is 'single'. Unticked, the hotel types a
-- price per number of adults: 'per_occupancy' (new). With "Automatic
-- Calculation" it is 'per_person' (0109), which now takes a separate DECREASE
-- per adult below the base occupancy, as the reference's does. Null decrease
-- keeps 0109's rule: the adult amount both ways.

alter table public.rate_plans drop constraint rate_plans_occupancy_shape;
alter table public.rate_plans add column adult_decrease_cents bigint;
alter table public.rate_plans add constraint rate_plans_occupancy_shape check (
  (occupancy_pricing in ('single', 'per_occupancy')
    and adult_adjust_cents is null and child_adjust_cents is null and adult_decrease_cents is null)
  or (occupancy_pricing = 'per_person'
    and adult_adjust_cents between -100000000 and 100000000
    and child_adjust_cents between -100000000 and 100000000
    and (adult_decrease_cents is null or adult_decrease_cents between 0 and 100000000))
);

comment on column public.rate_plans.occupancy_pricing is
  'single: one price whatever the party. per_occupancy: a price per number of adults, typed (0110). per_person: the base occupancy''s price, plus adult_adjust_cents per adult above it, less adult_decrease_cents (else adult_adjust_cents) per adult below, plus child_adjust_cents per child.';

-- The weekly template carries the per-occupancy prices beside the standard
-- one: {"1": 9000, "3": 13000} -- adults to pence. Null is "none sent".
alter table public.rate_plan_week_rates add column occupancy_rates jsonb;
alter table public.rate_plan_week_rates add constraint rate_plan_week_rates_occupancy_shape
  check (occupancy_rates is null or jsonb_typeof(occupancy_rates) = 'object');

create or replace function public.rate_plan_occupancy_rate(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_rate_cents bigint,
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
  v_plan record;
  v_base integer;
  v_adults integer;
begin
  if p_rate_cents is null or p_rate_plan_id is null then
    return p_rate_cents;
  end if;

  select rp.occupancy_pricing, rp.adult_adjust_cents, rp.child_adjust_cents,
         rp.adult_decrease_cents, rp.property_id
    into v_plan
  from public.rate_plans rp where rp.id = p_rate_plan_id;

  if not found or v_plan.occupancy_pricing <> 'per_person' then
    return p_rate_cents;
  end if;

  select rt.base_occupancy into v_base
  from public.room_types rt
  where rt.id = p_room_type_id and rt.property_id = v_plan.property_id;
  v_base := coalesce(v_base, 1);
  v_adults := greatest(coalesce(p_adults, v_base), 1);

  return greatest(
    0,
    p_rate_cents
      + case
          when v_adults >= v_base then (v_adults - v_base) * v_plan.adult_adjust_cents
          when v_plan.adult_decrease_cents is not null then -(v_base - v_adults) * v_plan.adult_decrease_cents
          else (v_adults - v_base) * v_plan.adult_adjust_cents
        end
      + greatest(coalesce(p_children, 0), 0) * v_plan.child_adjust_cents
  );
end;
$$;

-- set_rate_plan_terms() gains p_adult_decrease_cents and 'per_occupancy'.
-- DROPPED first: a changed parameter list is a new function, and two side by
-- side is the overload PostgREST refuses to choose between.
drop function public.set_rate_plan_terms(uuid, integer, integer, integer, integer, integer, integer, date, date, uuid, text, integer, bigint, text, bigint, bigint, uuid, uuid, uuid[]);

create or replace function public.set_rate_plan_terms(
  p_rate_plan_id uuid,
  p_min_days_advance integer default null,
  p_max_days_advance integer default null,
  p_min_adults integer default null,
  p_max_adults integer default null,
  p_min_children integer default null,
  p_max_children integer default null,
  p_valid_from date default null,
  p_valid_to date default null,
  p_parent_rate_plan_id uuid default null,
  p_derived_kind text default null,
  p_derived_percent_bps integer default null,
  p_derived_amount_cents bigint default null,
  p_occupancy_pricing text default 'single',
  p_adult_adjust_cents bigint default null,
  p_child_adjust_cents bigint default null,
  p_adult_decrease_cents bigint default null,
  p_tax_rate_id uuid default null,
  p_accounting_category_id uuid default null,
  p_channel_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_plan public.rate_plans;
  v_parent public.rate_plans;
  v_child text;
  v_channels uuid[];
  v_rederived integer := 0;
  v_derivation_changed boolean;
begin
  if not coalesce(public.is_revenue_staff(), false) then
    raise exception 'Only managers and administrators can change a rate plan';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  select * into v_plan from public.rate_plans
  where id = p_rate_plan_id and property_id = v_property
  for update;
  if not found then
    raise exception 'That rate plan is not on this property';
  end if;

  -- Named refusals ahead of the check constraints.
  if p_min_days_advance < 0 or p_max_days_advance < 0 then
    raise exception 'Days in advance cannot be negative';
  end if;
  if p_min_days_advance > p_max_days_advance then
    raise exception 'The minimum days in advance is more than the maximum';
  end if;
  if p_min_adults < 1 then
    raise exception 'A room needs at least one adult';
  end if;
  if p_min_adults > p_max_adults then
    raise exception 'The minimum number of adults is more than the maximum';
  end if;
  if p_min_children < 0 or p_max_children < 0 then
    raise exception 'The number of children cannot be negative';
  end if;
  if p_min_children > p_max_children then
    raise exception 'The minimum number of children is more than the maximum';
  end if;
  if p_valid_from > p_valid_to then
    raise exception 'The active date range ends before it starts';
  end if;

  if p_parent_rate_plan_id is not null then
    if p_parent_rate_plan_id = v_plan.id then
      raise exception 'A rate plan cannot be derived from itself';
    end if;
    select * into v_parent from public.rate_plans
    where id = p_parent_rate_plan_id and property_id = v_property;
    if not found then
      raise exception 'The parent rate plan is not on this property';
    end if;
    if v_parent.parent_rate_plan_id is not null then
      raise exception '% is itself derived from another plan. Derive from a plan with its own prices.', v_parent.name;
    end if;
    select name into v_child from public.rate_plans
    where parent_rate_plan_id = v_plan.id and property_id = v_property
    order by sort_order, name limit 1;
    if v_child is not null then
      raise exception '% is derived from %, so % cannot be derived from another plan.', v_child, v_plan.name, v_plan.name;
    end if;
    if p_derived_kind is null or p_derived_kind not in ('percent', 'amount') then
      raise exception 'Choose whether the derived rate moves by a percentage or by an amount';
    end if;
    if p_derived_kind = 'percent' and (p_derived_percent_bps is null or p_derived_percent_bps not between -10000 and 100000) then
      raise exception 'Give the percentage the derived rate moves by, between -100 and 1000';
    end if;
    if p_derived_kind = 'amount' and p_derived_amount_cents is null then
      raise exception 'Give the amount the derived rate moves by';
    end if;
  end if;

  if coalesce(p_occupancy_pricing, 'single') not in ('single', 'per_occupancy', 'per_person') then
    raise exception 'Unknown occupancy pricing: %', p_occupancy_pricing;
  end if;

  if p_occupancy_pricing = 'per_person' and (
    p_adult_adjust_cents < 0 or p_child_adjust_cents < 0 or p_adult_decrease_cents < 0
  ) then
    raise exception 'Write the increases and the decrease as amounts of zero or more';
  end if;

  if p_tax_rate_id is not null and not exists (
    select 1 from public.tax_rates where id = p_tax_rate_id and property_id = v_property and is_active
  ) then
    raise exception 'That tax is not an active tax on this property';
  end if;

  if p_accounting_category_id is not null and not exists (
    select 1 from public.accounting_categories where id = p_accounting_category_id and property_id = v_property
  ) then
    raise exception 'That accounting category is not on this property';
  end if;

  select array_agg(distinct x) into v_channels
  from unnest(coalesce(p_channel_ids, '{}'::uuid[])) as x where x is not null;
  if v_channels is not null and (
    select count(*) from public.channels where id = any(v_channels) and property_id = v_property
  ) <> array_length(v_channels, 1) then
    raise exception 'One of those sales channels is not on this property';
  end if;

  v_derivation_changed :=
    v_plan.parent_rate_plan_id is distinct from p_parent_rate_plan_id
    or v_plan.derived_kind is distinct from (case when p_parent_rate_plan_id is null then null else p_derived_kind end)
    or v_plan.derived_percent_bps is distinct from (case when p_parent_rate_plan_id is not null and p_derived_kind = 'percent' then p_derived_percent_bps end)
    or v_plan.derived_amount_cents is distinct from (case when p_parent_rate_plan_id is not null and p_derived_kind = 'amount' then p_derived_amount_cents end);

  update public.rate_plans
  set min_days_advance = p_min_days_advance,
      max_days_advance = p_max_days_advance,
      min_adults = p_min_adults,
      max_adults = p_max_adults,
      min_children = p_min_children,
      max_children = p_max_children,
      valid_from = p_valid_from,
      valid_to = p_valid_to,
      parent_rate_plan_id = p_parent_rate_plan_id,
      derived_kind = case when p_parent_rate_plan_id is null then null else p_derived_kind end,
      derived_percent_bps = case when p_parent_rate_plan_id is not null and p_derived_kind = 'percent' then p_derived_percent_bps end,
      derived_amount_cents = case when p_parent_rate_plan_id is not null and p_derived_kind = 'amount' then p_derived_amount_cents end,
      occupancy_pricing = coalesce(p_occupancy_pricing, 'single'),
      adult_adjust_cents = case when p_occupancy_pricing = 'per_person' then coalesce(p_adult_adjust_cents, 0) end,
      child_adjust_cents = case when p_occupancy_pricing = 'per_person' then coalesce(p_child_adjust_cents, 0) end,
      adult_decrease_cents = case when p_occupancy_pricing = 'per_person' then p_adult_decrease_cents end,
      tax_rate_id = p_tax_rate_id,
      accounting_category_id = p_accounting_category_id,
      updated_at = now()
  where id = v_plan.id;

  delete from public.rate_plan_channels
  where rate_plan_id = v_plan.id
    and (v_channels is null or not (channel_id = any(v_channels)));
  if v_channels is not null then
    insert into public.rate_plan_channels (property_id, rate_plan_id, channel_id)
    select v_property, v_plan.id, c from unnest(v_channels) as c
    on conflict do nothing;
  end if;

  -- A new or changed derivation takes effect on every future night now,
  -- not only on the next night somebody happens to reprice.
  if p_parent_rate_plan_id is not null and v_derivation_changed then
    v_rederived := public.rate_plan_rederive(v_plan.id);
  end if;

  return v_rederived;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Per-occupancy prices, per night
-- ---------------------------------------------------------------------------

create table public.rate_plan_occupancy_days (
  property_id uuid not null references public.properties (id) on delete restrict,
  rate_plan_id uuid not null references public.rate_plans (id) on delete cascade,
  room_type_id uuid not null references public.room_types (id) on delete cascade,
  stay_date date not null,
  adults smallint not null check (adults between 1 and 50),
  rate_cents bigint not null check (rate_cents >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (rate_plan_id, room_type_id, stay_date, adults)
);

create index rate_plan_occupancy_days_property_date_idx
  on public.rate_plan_occupancy_days (property_id, stay_date);
create index rate_plan_occupancy_days_room_type_idx
  on public.rate_plan_occupancy_days (room_type_id);

alter table public.rate_plan_occupancy_days enable row level security;

-- The same four policies as rate_plan_days: anyone on the property reads,
-- revenue staff write.
create policy rate_plan_occupancy_days_select_same_property on public.rate_plan_occupancy_days
  for select using (property_id = public.current_property_id());
create policy rate_plan_occupancy_days_insert_revenue on public.rate_plan_occupancy_days
  for insert with check (property_id = public.current_property_id() and public.is_revenue_staff());
create policy rate_plan_occupancy_days_update_revenue on public.rate_plan_occupancy_days
  for update using (property_id = public.current_property_id() and public.is_revenue_staff())
  with check (property_id = public.current_property_id() and public.is_revenue_staff());
create policy rate_plan_occupancy_days_delete_revenue on public.rate_plan_occupancy_days
  for delete using (property_id = public.current_property_id() and public.is_revenue_staff());

grant select, insert, update, delete on public.rate_plan_occupancy_days to authenticated;
revoke all on public.rate_plan_occupancy_days from anon;

comment on table public.rate_plan_occupancy_days is
  'A night''s price for a given number of adults (0110). Where set it replaces the standard price in rate_plan_days for that party; the standard price must still be loaded for the night to sell.';

-- ---------------------------------------------------------------------------
-- 2. One place a night is priced for a party
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

  -- One price for every occupancy means exactly that: a per-occupancy price
  -- left over from before the plan was switched is not used.
  if p_adults is not null and v_plan.occupancy_pricing <> 'single' then
    select o.rate_cents into v_cents
    from public.rate_plan_occupancy_days o
    where o.rate_plan_id = coalesce(v_plan.parent_rate_plan_id, v_plan.id)
      and o.room_type_id = p_room_type_id
      and o.stay_date = p_stay_date
      and o.adults = p_adults;

    if found then
      -- A derived plan follows its parent's occupancy price, adjusted the way
      -- its standard price is.
      if v_plan.parent_rate_plan_id is not null then
        v_cents := public.rate_plan_derived_rate(
          v_cents, v_plan.derived_kind, v_plan.derived_percent_bps, v_plan.derived_amount_cents
        );
      end if;
      -- The occupancy price is for the adults; children still add the child
      -- amount on a plan that prices per person.
      if v_plan.occupancy_pricing = 'per_person' then
        v_cents := v_cents + greatest(coalesce(p_children, 0), 0) * v_plan.child_adjust_cents;
      end if;
      return greatest(v_cents, 0);
    end if;
  end if;

  return public.rate_plan_occupancy_rate(p_rate_plan_id, p_room_type_id, p_base_cents, p_adults, p_children);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The screen's read and write
-- ---------------------------------------------------------------------------

create or replace function public.inventory_occupancy_grid(p_from date, p_days integer)
returns table (
  rate_plan_id uuid,
  room_type_id uuid,
  stay_date date,
  adults smallint,
  rate_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select o.rate_plan_id, o.room_type_id, o.stay_date, o.adults, o.rate_cents
  from public.rate_plan_occupancy_days o
  where o.property_id = public.current_property_id()
    and o.stay_date >= p_from
    and o.stay_date < p_from + least(greatest(coalesce(p_days, 0), 0), 400)
  order by o.rate_plan_id, o.room_type_id, o.adults, o.stay_date;
$$;

-- Bulk, like set_rates(): a date range, room types, optional weekdays. Null
-- clears the occupancy price, which puts that party back on the standard
-- price -- not "not sold", which only the standard price can say.
create or replace function public.set_occupancy_rates(
  p_rate_plan_id uuid,
  p_room_type_ids uuid[],
  p_from date,
  p_to date,
  p_days_of_week integer[] default null,
  p_adults integer default null,
  p_rate_cents bigint default null
)
returns integer
language plpgsql
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_count integer;
  v_name text;
  v_parent text;
  v_type text;
  v_max integer;
begin
  v_property := public.inventory_guard(p_rate_plan_id, p_from, p_to);
  if p_rate_plan_id is null then
    raise exception 'Pick a rate plan before setting this';
  end if;
  if p_adults is null or p_adults < 1 or p_adults > 50 then
    raise exception 'Choose how many adults this price is for';
  end if;
  if p_rate_cents is not null and p_rate_cents < 0 then
    raise exception 'A nightly rate cannot be negative';
  end if;

  select rp.name, parent.name into v_name, v_parent
  from public.rate_plans rp
  join public.rate_plans parent on parent.id = rp.parent_rate_plan_id
  where rp.id = p_rate_plan_id and rp.property_id = v_property;
  if v_parent is not null then
    raise exception '% is derived from %, so its price follows that plan. Change the price on % instead.',
      v_name, v_parent, v_parent;
  end if;

  select rt.name, rt.max_occupancy into v_type, v_max
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  where rt.max_occupancy < p_adults
  limit 1;
  if v_type is not null then
    raise exception '% sleeps at most %, so it has no price for % adults.', v_type, v_max, p_adults;
  end if;

  if p_rate_cents is null then
    delete from public.rate_plan_occupancy_days o
    using unnest(p_room_type_ids) as t(room_type_id),
          public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
    where o.property_id = v_property
      and o.rate_plan_id = p_rate_plan_id
      and o.room_type_id = t.room_type_id
      and o.stay_date = d.stay_date
      and o.adults = p_adults;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  insert into public.rate_plan_occupancy_days (
    property_id, rate_plan_id, room_type_id, stay_date, adults, rate_cents, updated_by
  )
  select v_property, p_rate_plan_id, rt.id, d.stay_date, p_adults, p_rate_cents, auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (rate_plan_id, room_type_id, stay_date, adults) do update
    set rate_cents = excluded.rate_cents, updated_at = now(), updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The booking paths price each night through rate_plan_night_rate()
-- ---------------------------------------------------------------------------
-- The three functions below are 0109's, with the one call changed from
-- rate_plan_occupancy_rate() to rate_plan_night_rate(), which needs the night.

create or replace function public.create_booking(
  p_check_in date,
  p_check_out date,
  p_rooms jsonb,
  p_channel_id uuid,
  p_customer_id uuid default null,
  p_customer jsonb default null,
  p_adults integer default 1,
  p_children integer default 0,
  p_status public.booking_status default 'confirmed',
  p_settlement public.booking_settlement default 'at_property',
  p_tax_rate_id uuid default null,
  p_guest_notes text default null,
  p_internal_notes text default null,
  p_external_reference text default null,
  p_allow_overbook boolean default false,
  p_rate_plan_id uuid default null,
  p_ignore_restrictions boolean default false,
  p_promotion_code text default null
)
returns table (booking_id uuid, reference text, promotion_name text, discount_cents bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_customer uuid;
  v_booking uuid;
  v_reference text;
  v_booking_room uuid;
  v_line record;
  v_available bigint;
  v_type_name text;
  v_violation text;
  v_net_cents bigint;
  v_tax_cents bigint;
  v_missing date;
  v_night record;
  v_promo record;
  v_promotion_id uuid;
  v_promotion_name text;
  v_discount_total bigint := 0;
  v_room_adults integer;
  v_room_children integer;
  v_today date;
  i integer;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can take a booking';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_check_out <= p_check_in then
    raise exception 'The departure date must be after the arrival date';
  end if;

  if p_status not in ('pending', 'confirmed') then
    raise exception 'A new booking can only be taken as pending or confirmed';
  end if;

  if p_adults is null or p_adults < 1 then
    raise exception 'A booking needs at least one adult';
  end if;

  if p_rooms is null or jsonb_typeof(p_rooms) <> 'array'
     or jsonb_array_length(p_rooms) = 0 then
    raise exception 'A booking needs at least one room';
  end if;

  if p_rate_plan_id is not null and not exists (
    select 1 from public.rate_plans rp
    where rp.id = p_rate_plan_id and rp.property_id = v_property and rp.is_active
  ) then
    raise exception 'That rate plan is not available on this property';
  end if;

  if p_customer_id is not null then
    select c.id into v_customer
    from public.customers c
    where c.id = p_customer_id and c.property_id = v_property;
    if v_customer is null then
      raise exception 'That customer is not on this property';
    end if;
  elsif p_customer is not null then
    insert into public.customers (
      property_id, kind, first_name, last_name, company_name, email, phone
    ) values (
      v_property,
      coalesce((p_customer ->> 'kind')::public.customer_kind, 'personal'),
      nullif(btrim(coalesce(p_customer ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'last_name', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'company_name', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
      nullif(btrim(coalesce(p_customer ->> 'phone', '')), '')
    )
    returning id into v_customer;
  else
    raise exception 'A booking needs a guest: pick an existing customer or enter a new one';
  end if;

  if not exists (
    select 1 from public.channels ch
    where ch.id = p_channel_id and ch.property_id = v_property and ch.is_active
  ) then
    raise exception 'That booking source is not available on this property';
  end if;

  if nullif(btrim(coalesce(p_promotion_code, '')), '') is not null
     and not exists (
       select 1 from public.promotions p
       where p.property_id = v_property
         and p.is_active
         and p.code is not null
         and upper(p.code) = upper(btrim(p_promotion_code))
     ) then
    raise exception 'There is no live promotion with the code %', upper(btrim(p_promotion_code));
  end if;

  if not p_ignore_restrictions then
    v_today := public.open_business_date(v_property);
    for v_line in
      select
        (line ->> 'room_type_id')::uuid as room_type_id,
        (line ->> 'adults')::integer as adults,
        (line ->> 'children')::integer as children
      from jsonb_array_elements(p_rooms) as line
    loop
      v_violation := public.rate_plan_condition_violation(
        v_property, p_rate_plan_id, p_check_in, p_check_out,
        greatest(coalesce(v_line.adults, p_adults), 1),
        greatest(coalesce(v_line.children, coalesce(p_children, 0)), 0),
        p_channel_id, v_today
      );
      if v_violation is null then
        v_violation := public.stay_rule_violation(
          p_rate_plan_id, v_line.room_type_id, p_check_in, p_check_out
        );
      end if;
      if v_violation is not null then
        raise exception '%', v_violation using errcode = 'HP002';
      end if;
    end loop;
  end if;

  if not p_allow_overbook then
    for v_line in
      select
        (line ->> 'room_type_id')::uuid as room_type_id,
        coalesce((line ->> 'quantity')::integer, 1) as quantity
      from jsonb_array_elements(p_rooms) as line
    loop
      select b.available, b.name into v_available, v_type_name
      from public.bookable_room_types(p_check_in, p_check_out) b
      where b.room_type_id = v_line.room_type_id;

      if v_available is null then
        raise exception 'That room type is not on this property';
      end if;

      if v_line.quantity > greatest(v_available, 0) then
        raise exception
          'Only % of % free for these dates, and % asked for.',
          greatest(v_available, 0), v_type_name, v_line.quantity
          using errcode = 'HP001';
      end if;
    end loop;
  end if;

  v_reference := public.next_booking_reference();

  insert into public.bookings (
    property_id, reference, customer_id, channel_id, status, settlement,
    check_in, check_out, adults, children, guest_notes, internal_notes,
    external_reference, created_by
  ) values (
    v_property, v_reference, v_customer, p_channel_id, p_status, p_settlement,
    p_check_in, p_check_out, p_adults, coalesce(p_children, 0),
    nullif(btrim(coalesce(p_guest_notes, '')), ''),
    nullif(btrim(coalesce(p_internal_notes, '')), ''),
    nullif(btrim(coalesce(p_external_reference, '')), ''),
    auth.uid()
  )
  returning id into v_booking;

  for v_line in
    select
      (line ->> 'room_type_id')::uuid as room_type_id,
      coalesce((line ->> 'quantity')::integer, 1) as quantity,
      (line ->> 'rate_cents')::bigint as rate_cents,
      (line ->> 'adults')::integer as adults,
      (line ->> 'children')::integer as children
    from jsonb_array_elements(p_rooms) as line
  loop
    if v_line.quantity < 1 or v_line.quantity > 50 then
      raise exception 'A room line must be for between one and fifty rooms';
    end if;
    if v_line.rate_cents is not null and v_line.rate_cents < 0 then
      raise exception 'A nightly rate cannot be negative';
    end if;

    if not exists (
      select 1 from public.room_types rt
      where rt.id = v_line.room_type_id and rt.property_id = v_property
    ) then
      raise exception 'That room type is not on this property';
    end if;

    if v_line.rate_cents is null then
      if p_rate_plan_id is null then
        raise exception
          'Give a nightly rate, or pick a rate plan that has one loaded for these dates';
      end if;

      select gs::date into v_missing
      from generate_series(p_check_in, p_check_out - 1, interval '1 day') as gs
      where not exists (
        select 1 from public.rate_plan_days d
        where d.property_id = v_property
          and d.rate_plan_id = p_rate_plan_id
          and d.room_type_id = v_line.room_type_id
          and d.stay_date = gs::date
          and d.rate_cents is not null
      )
      order by gs
      limit 1;

      if v_missing is not null then
        raise exception
          'No rate is loaded for % on this plan. Load one, or give a rate for the booking.',
          to_char(v_missing, 'FMDay FMDD Mon YYYY');
      end if;
    end if;

    v_promotion_id := null;
    if v_line.rate_cents is null and p_rate_plan_id is not null then
      select bp.promotion_id, bp.name into v_promo
      from public.best_promotion(
        p_rate_plan_id, v_line.room_type_id, p_check_in, p_check_out,
        current_date, p_promotion_code
      ) bp;
      if found then
        v_promotion_id := v_promo.promotion_id;
        v_promotion_name := v_promo.name;
      end if;
    end if;

    v_room_adults := greatest(coalesce(v_line.adults, p_adults), 1);
    v_room_children := greatest(coalesce(v_line.children, coalesce(p_children, 0)), 0);

    for i in 1 .. v_line.quantity loop
      insert into public.booking_rooms (
        property_id, booking_id, room_type_id, rate_plan_id, status,
        check_in, check_out, adults, children
      ) values (
        v_property, v_booking, v_line.room_type_id, p_rate_plan_id, p_status,
        p_check_in, p_check_out, v_room_adults, v_room_children
      )
      returning id into v_booking_room;

      for v_night in
        select
          bn.id,
          bn.stay_date,
          coalesce(
            v_line.rate_cents,
            public.rate_plan_night_rate(
              p_rate_plan_id, v_line.room_type_id, bn.stay_date, d.rate_cents,
              v_room_adults, v_room_children
            )
          ) as rate_cents,
          coalesce(pd.discount_cents, 0) as discount_cents
        from public.booking_room_nights bn
        left join public.rate_plan_days d
          on d.property_id = v_property
         and d.rate_plan_id = p_rate_plan_id
         and d.room_type_id = v_line.room_type_id
         and d.stay_date = bn.stay_date
        left join lateral (
          select n.discount_cents
          from public.promotion_night_discounts(
            v_promotion_id, p_rate_plan_id, v_line.room_type_id,
            p_check_in, p_check_out
          ) n
          where v_promotion_id is not null and n.stay_date = bn.stay_date
        ) pd on true
        where bn.booking_room_id = v_booking_room
          and bn.property_id = v_property
      loop
        if p_tax_rate_id is not null then
          select t.net_cents, t.tax_cents into v_net_cents, v_tax_cents
          from public.apply_tax_rate(
            p_tax_rate_id, greatest(v_night.rate_cents - v_night.discount_cents, 0)
          ) t;
          v_net_cents := v_net_cents + v_night.discount_cents;
        else
          v_net_cents := v_night.rate_cents;
          v_tax_cents := 0;
        end if;

        update public.booking_room_nights
        set room_rate_cents = v_net_cents,
            tax_cents = v_tax_cents,
            discount_cents = least(v_night.discount_cents, v_net_cents)
        where id = v_night.id;

        v_discount_total := v_discount_total + least(v_night.discount_cents, v_net_cents);
      end loop;
    end loop;
  end loop;

  if v_promotion_id is not null then
    update public.bookings set promotion_id = v_promotion_id
    where id = v_booking and property_id = v_property;
  end if;

  return query select v_booking, v_reference, v_promotion_name, v_discount_total;
end;
$$;

create or replace function public.public_room_types(
  p_property_id uuid,
  p_rate_plan_id uuid,
  p_from date,
  p_to date,
  p_adults integer default null,
  p_children integer default null
)
returns table (
  room_type_id uuid, code text, name text, base_occupancy integer,
  max_occupancy integer, available bigint, nights integer,
  total_cents bigint, unavailable_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  with plan as (
    select rp.id, rp.tax_rate_id
    from public.rate_plans rp
    join public.properties p on p.id = rp.property_id and p.is_active
    where rp.id = p_rate_plan_id
      and rp.property_id = p_property_id
      and rp.is_active
      and rp.is_public
  ),
  nights as (
    select d::date as stay_date
    from generate_series(p_from, greatest(p_to - 1, p_from), interval '1 day') as d
  ),
  types as (
    select
      rt.id, rt.code, coalesce(rt.display_name, rt.name) as name,
      rt.base_occupancy, rt.max_occupancy, rt.sort_order,
      count(r.id) filter (where r.status <> 'ooo' and r.available_online) as sellable
    from public.room_types rt
    left join public.rooms r
      on r.room_type_id = rt.id and r.property_id = rt.property_id
    where rt.property_id = p_property_id
    group by rt.id, rt.code, rt.display_name, rt.name, rt.sort_order
  ),
  sold as (
    select n.stay_date, coalesce(r.room_type_id, br.room_type_id) as room_type_id, count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    left join public.rooms r
      on r.id = br.room_id and r.property_id = br.property_id
    where n.property_id = p_property_id
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_to
    group by n.stay_date, coalesce(r.room_type_id, br.room_type_id)
  ),
  priced as (
    select
      types.id,
      types.code,
      types.name,
      types.base_occupancy,
      types.max_occupancy,
      types.sort_order,
      coalesce(
        min(
          case
            when coalesce(rtd.close_out, false) then 0
            else least(types.sellable, coalesce(rtd.allotment, types.sellable))
                 - coalesce(sold.sold, 0)
          end
        ),
        types.sellable
      )::bigint as available,
      (p_to - p_from)::integer as nights,
      case
        when bool_or(rpd.rate_cents is null) then null
        else sum(
          (select t.gross_cents from public.tax_split_for(
             p_property_id,
             (select tax_rate_id from plan),
             public.rate_plan_night_rate(
               (select id from plan), types.id, nights.stay_date, rpd.rate_cents,
               p_adults, p_children
             )
           ) t)
        )::bigint
      end as total_cents
    from types
    cross join nights
    left join public.room_type_days rtd
      on rtd.room_type_id = types.id
     and rtd.stay_date = nights.stay_date
     and rtd.property_id = p_property_id
    left join public.rate_plan_days rpd
      on rpd.room_type_id = types.id
     and rpd.stay_date = nights.stay_date
     and rpd.property_id = p_property_id
     and rpd.rate_plan_id = (select id from plan)
    left join sold
      on sold.stay_date = nights.stay_date and sold.room_type_id = types.id
    group by types.id, types.code, types.name, types.base_occupancy,
             types.max_occupancy, types.sort_order, types.sellable
  )
  select
    priced.id,
    priced.code,
    priced.name,
    priced.base_occupancy,
    priced.max_occupancy,
    greatest(priced.available, 0)::bigint,
    priced.nights,
    priced.total_cents,
    coalesce(
      public.public_booking_cutoff_reason(p_property_id, p_from, p_to),
      public.rate_plan_condition_violation(
        p_property_id, (select id from plan), p_from, p_to, p_adults, p_children,
        public.public_direct_channel(p_property_id),
        public.open_business_date(p_property_id)
      ),
      public.stay_rule_violation_for(
        p_property_id, (select id from plan), priced.id, p_from, p_to
      )
    )
  from priced
  where exists (select 1 from plan)
  order by priced.sort_order, priced.name;
$$;

create or replace function public.create_public_booking(
  p_property_id uuid,
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_check_in date,
  p_check_out date,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text default null,
  p_adults integer default 2,
  p_children integer default 0,
  p_notes text default null
)
returns table (booking_id uuid, reference text)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_nights constant integer := 30;
  c_max_days_ahead constant integer := 500;
  c_max_pending constant integer := 5;

  v_channel uuid;
  v_customer uuid;
  v_booking uuid;
  v_booking_room uuid;
  v_reference text;
  v_available bigint;
  v_total bigint;
  v_reason text;
  v_max_occupancy integer;
  v_pending integer;
  v_night record;
  v_rate bigint;
  v_tax_rate uuid;
  v_net bigint;
  v_tax bigint;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception 'Choose a departure date after the arrival date';
  end if;

  if p_check_in < current_date then
    raise exception 'That arrival date has passed';
  end if;

  if p_check_out - p_check_in > c_max_nights then
    raise exception
      'Stays longer than % nights cannot be booked online. Please contact the hotel.',
      c_max_nights;
  end if;

  if p_check_in > current_date + c_max_days_ahead then
    raise exception 'That date is too far ahead to book online yet';
  end if;

  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'A booking needs a first and last name';
  end if;

  if btrim(coalesce(p_email, '')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That email address does not look right';
  end if;

  if coalesce(p_adults, 0) < 1 then
    raise exception 'A booking needs at least one adult';
  end if;

  if coalesce(p_children, 0) < 0 then
    raise exception 'That is not a number of children';
  end if;

  select c.id into v_channel
  from public.channels c
  join public.properties p on p.id = c.property_id and p.is_active
  where c.property_id = p_property_id and c.kind = 'direct' and c.is_active
  order by c.code
  limit 1;

  if v_channel is null then
    raise exception 'This property is not set up to take bookings online';
  end if;

  select rt.max_occupancy into v_max_occupancy
  from public.room_types rt
  where rt.id = p_room_type_id and rt.property_id = p_property_id;

  if v_max_occupancy is null then
    raise exception 'That room is not available on this rate';
  end if;

  if p_adults + coalesce(p_children, 0) > v_max_occupancy then
    raise exception 'That room sleeps % people', v_max_occupancy;
  end if;

  select t.available, t.total_cents, t.unavailable_reason
    into v_available, v_total, v_reason
  from public.public_room_types(
    p_property_id, p_rate_plan_id, p_check_in, p_check_out,
    p_adults, coalesce(p_children, 0)
  ) t
  where t.room_type_id = p_room_type_id;

  if not found then
    raise exception 'That room is not available on this rate';
  end if;

  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'HP002';
  end if;

  if coalesce(v_available, 0) < 1 then
    raise exception 'That room is fully booked for those dates' using errcode = 'HP001';
  end if;

  if v_total is null then
    raise exception 'That room has no price loaded for those dates' using errcode = 'HP002';
  end if;

  select c.id into v_customer
  from public.customers c
  where c.property_id = p_property_id
    and lower(c.email) = lower(btrim(p_email))
  limit 1;

  if v_customer is not null then
    select count(*) into v_pending
    from public.bookings b
    where b.property_id = p_property_id
      and b.customer_id = v_customer
      and b.status = 'pending';

    if v_pending >= c_max_pending then
      raise exception
        'There are already % unconfirmed bookings on this email. The hotel will be in touch about those first.',
        v_pending;
    end if;
  end if;

  if v_customer is null then
    insert into public.customers (
      property_id, kind, first_name, last_name, email, phone
    )
    values (
      p_property_id, 'personal', btrim(p_first_name), btrim(p_last_name),
      lower(btrim(p_email)), nullif(btrim(coalesce(p_phone, '')), '')
    )
    returning id into v_customer;
  end if;

  v_reference := public.next_booking_reference();

  insert into public.bookings (
    property_id, reference, customer_id, channel_id, status, settlement,
    check_in, check_out, adults, children, guest_notes, booked_at
  )
  values (
    p_property_id, v_reference, v_customer, v_channel, 'pending', 'at_property',
    p_check_in, p_check_out, p_adults, coalesce(p_children, 0),
    nullif(btrim(coalesce(p_notes, '')), ''), now()
  )
  returning id into v_booking;

  insert into public.booking_rooms (
    property_id, booking_id, room_type_id, rate_plan_id, status,
    check_in, check_out, adults, children
  )
  values (
    p_property_id, v_booking, p_room_type_id, p_rate_plan_id, 'pending',
    p_check_in, p_check_out, p_adults, coalesce(p_children, 0)
  )
  returning id into v_booking_room;

  select rp.tax_rate_id into v_tax_rate
  from public.rate_plans rp
  where rp.id = p_rate_plan_id and rp.property_id = p_property_id;

  for v_night in
    select n.id, n.stay_date
    from public.booking_room_nights n
    where n.booking_room_id = v_booking_room
  loop
    select public.rate_plan_night_rate(
             p_rate_plan_id, p_room_type_id, v_night.stay_date, d.rate_cents,
             p_adults, coalesce(p_children, 0)
           )
      into v_rate
    from public.rate_plan_days d
    where d.property_id = p_property_id
      and d.rate_plan_id = p_rate_plan_id
      and d.room_type_id = p_room_type_id
      and d.stay_date = v_night.stay_date;

    select t.net_cents, t.tax_cents into v_net, v_tax
    from public.tax_split_for(p_property_id, v_tax_rate, v_rate) t;

    update public.booking_room_nights
    set room_rate_cents = v_net,
        tax_cents = coalesce(v_tax, 0)
    where id = v_night.id;
  end loop;

  return query select v_booking, v_reference;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Seasons that price
-- ---------------------------------------------------------------------------

-- save_week_rates(), as 0108 left it, with one change: a SEASON's rates
-- replace the rate on the season's own nights. The Default Season still only
-- fills empty nights unless "Replace prices" is ticked, so re-saving the
-- year's template never wipes a price somebody set by hand. A season is the
-- opposite case -- the hotel is saying "these dates cost this" -- and filling
-- only empty nights made it change nothing on a property already priced.
-- Restrictions stay fill-only either way.
--
-- It also carries the prices per occupancy (0110): each day may send
-- "occupancy_rates": {"1": 9000, "3": 13000}, adults to pence, which go onto
-- the same nights in rate_plan_occupancy_days by the same fill-or-replace
-- rule. Replacing, the day's set IS the set: an occupancy it leaves out goes
-- back to the standard price. A derived plan keeps the template but writes no
-- occupancy price -- it follows its parent's.
create or replace function public.save_week_rates(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_season_type_id uuid,
  p_days jsonb,
  p_replace_rates boolean default false
)
returns integer
language plpgsql
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_open date;
  v_to date;
  v_dates date[];
  v_changed integer;
  v_replace boolean := coalesce(p_replace_rates, false) or p_season_type_id is not null;
  v_max integer;
  v_derived boolean;
begin
  select b.business_date into v_open
  from public.business_dates b
  where b.property_id = public.current_property_id() and b.status = 'open';
  if v_open is null then
    raise exception 'There is no open business date';
  end if;
  v_property := public.inventory_guard(p_rate_plan_id, v_open, v_open);
  if p_rate_plan_id is null then
    raise exception 'Pick a rate plan';
  end if;
  select rt.max_occupancy into v_max
  from public.room_types rt where rt.id = p_room_type_id and rt.property_id = v_property;
  if not found then
    raise exception 'That room type is not on this property';
  end if;
  select rp.parent_rate_plan_id is not null into v_derived
  from public.rate_plans rp where rp.id = p_rate_plan_id;
  if p_season_type_id is not null and not exists (
    select 1 from public.season_types t
    where t.id = p_season_type_id and t.property_id = v_property and t.kind = 'season'
  ) then
    raise exception 'Choose a season, or the Default Season';
  end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 7 then
    raise exception 'Send one entry per weekday';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_days) as d
    cross join lateral jsonb_each(
      case when jsonb_typeof(d->'occupancy_rates') = 'object' then d->'occupancy_rates' else '{}'::jsonb end
    ) as o
    where case when o.key ~ '^[0-9]{1,2}$' then o.key::integer not between 1 and v_max else true end
       or not (jsonb_typeof(o.value) = 'number' and o.value::text ~ '^[0-9]{1,12}$')
  ) then
    raise exception 'A price per occupancy is a whole amount for 1 to % adults', v_max;
  end if;

  insert into public.rate_plan_week_rates (
    property_id, rate_plan_id, room_type_id, season_type_id, weekday,
    rate_cents, min_stay_through, min_stay_arrival, max_stay,
    closed_to_arrival, closed_to_departure, stop_sell, occupancy_rates, updated_at, updated_by
  )
  select
    v_property, p_rate_plan_id, p_room_type_id, p_season_type_id, (d->>'weekday')::smallint,
    (d->>'rate_cents')::bigint, (d->>'min_stay_through')::integer,
    (d->>'min_stay_arrival')::integer, (d->>'max_stay')::integer,
    coalesce((d->>'closed_to_arrival')::boolean, false),
    coalesce((d->>'closed_to_departure')::boolean, false),
    coalesce((d->>'stop_sell')::boolean, false),
    case when jsonb_typeof(d->'occupancy_rates') = 'object' then d->'occupancy_rates' end,
    now(), auth.uid()
  from jsonb_array_elements(p_days) as d
  on conflict (rate_plan_id, room_type_id, season_type_id, weekday) do update set
    rate_cents = excluded.rate_cents,
    min_stay_through = excluded.min_stay_through,
    min_stay_arrival = excluded.min_stay_arrival,
    max_stay = excluded.max_stay,
    closed_to_arrival = excluded.closed_to_arrival,
    closed_to_departure = excluded.closed_to_departure,
    stop_sell = excluded.stop_sell,
    occupancy_rates = excluded.occupancy_rates,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  if p_season_type_id is not null then
    v_to := v_open + 730;
    select coalesce(array_agg(distinct d::date), '{}') into v_dates
    from public.seasons s
    cross join lateral generate_series(greatest(s.starts_on, v_open), least(s.ends_on, v_to), interval '1 day') as d
    where s.property_id = v_property and s.season_type_id = p_season_type_id and s.kind = 'season'
      and s.ends_on >= v_open;
  else
    v_to := v_open + 364;
    select coalesce(array_agg(d::date), '{}') into v_dates
    from generate_series(v_open, v_to, interval '1 day') as d
    where not exists (
      select 1 from public.seasons s
      where s.property_id = v_property and s.kind = 'season'
        and d::date between s.starts_on and s.ends_on
    );
  end if;

  -- The nights whose rate this will set or change.
  select count(*) into v_changed
  from unnest(v_dates) as n(stay_date)
  join public.rate_plan_week_rates w
    on w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
   and w.season_type_id is not distinct from p_season_type_id
   and w.weekday = extract(isodow from n.stay_date)
  left join public.rate_plan_days r
    on r.rate_plan_id = p_rate_plan_id and r.room_type_id = p_room_type_id and r.stay_date = n.stay_date
  where w.rate_cents is not null
    and (r.rate_cents is null or (v_replace and r.rate_cents <> w.rate_cents));

  insert into public.rate_plan_days (
    property_id, rate_plan_id, room_type_id, stay_date, rate_cents,
    min_stay_through, min_stay_arrival, max_stay,
    closed_to_arrival, closed_to_departure, stop_sell, updated_by
  )
  select
    v_property, p_rate_plan_id, p_room_type_id, n.stay_date, w.rate_cents,
    w.min_stay_through, w.min_stay_arrival, w.max_stay,
    w.closed_to_arrival, w.closed_to_departure, w.stop_sell, auth.uid()
  from unnest(v_dates) as n(stay_date)
  join public.rate_plan_week_rates w
    on w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
   and w.season_type_id is not distinct from p_season_type_id
   and w.weekday = extract(isodow from n.stay_date)
  where w.rate_cents is not null or w.min_stay_through is not null
     or w.min_stay_arrival is not null or w.max_stay is not null
     or w.closed_to_arrival or w.closed_to_departure or w.stop_sell
  on conflict (rate_plan_id, room_type_id, stay_date) do update set
    rate_cents = case
      when v_replace and excluded.rate_cents is not null then excluded.rate_cents
      else coalesce(public.rate_plan_days.rate_cents, excluded.rate_cents)
    end,
    min_stay_through = coalesce(public.rate_plan_days.min_stay_through, excluded.min_stay_through),
    min_stay_arrival = coalesce(public.rate_plan_days.min_stay_arrival, excluded.min_stay_arrival),
    max_stay = coalesce(public.rate_plan_days.max_stay, excluded.max_stay),
    closed_to_arrival = public.rate_plan_days.closed_to_arrival or excluded.closed_to_arrival,
    closed_to_departure = public.rate_plan_days.closed_to_departure or excluded.closed_to_departure,
    stop_sell = public.rate_plan_days.stop_sell or excluded.stop_sell,
    updated_by = excluded.updated_by
  where (public.rate_plan_days.rate_cents is null and excluded.rate_cents is not null)
     or (v_replace and excluded.rate_cents is not null
         and public.rate_plan_days.rate_cents is distinct from excluded.rate_cents)
     or (public.rate_plan_days.min_stay_through is null and excluded.min_stay_through is not null)
     or (public.rate_plan_days.min_stay_arrival is null and excluded.min_stay_arrival is not null)
     or (public.rate_plan_days.max_stay is null and excluded.max_stay is not null)
     or (not public.rate_plan_days.closed_to_arrival and excluded.closed_to_arrival)
     or (not public.rate_plan_days.closed_to_departure and excluded.closed_to_departure)
     or (not public.rate_plan_days.stop_sell and excluded.stop_sell);

  if not v_derived then
    if v_replace then
      delete from public.rate_plan_occupancy_days o
      using unnest(v_dates) as n(stay_date), public.rate_plan_week_rates w
      where o.rate_plan_id = p_rate_plan_id and o.room_type_id = p_room_type_id
        and o.stay_date = n.stay_date
        and w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
        and w.season_type_id is not distinct from p_season_type_id
        and w.weekday = extract(isodow from n.stay_date)
        and w.occupancy_rates is not null
        and not (w.occupancy_rates ? o.adults::text);
    end if;

    insert into public.rate_plan_occupancy_days (
      property_id, rate_plan_id, room_type_id, stay_date, adults, rate_cents, updated_by
    )
    select v_property, p_rate_plan_id, p_room_type_id, n.stay_date, o.key::smallint,
           o.value::text::bigint, auth.uid()
    from unnest(v_dates) as n(stay_date)
    join public.rate_plan_week_rates w
      on w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
     and w.season_type_id is not distinct from p_season_type_id
     and w.weekday = extract(isodow from n.stay_date)
     and w.occupancy_rates is not null
    cross join lateral jsonb_each(w.occupancy_rates) as o
    on conflict (rate_plan_id, room_type_id, stay_date, adults) do update
      set rate_cents = excluded.rate_cents, updated_at = now(), updated_by = excluded.updated_by
      where v_replace and public.rate_plan_occupancy_days.rate_cents <> excluded.rate_cents;
  end if;

  return v_changed;
end;
$$;

-- add_season_range(), as 0095 left it, plus: dates added to a season that
-- already has week rates saved get those rates now. Without this a season's
-- rates reached only the ranges it had when they were saved, and dates added
-- later stayed on whatever they had -- a season that silently did nothing on
-- its new dates.
create or replace function public.add_season_range(
  p_season_type_id uuid,
  p_starts_on date,
  p_ends_on date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_property uuid;
  v_type public.season_types;
  v_clash record;
  v_id uuid;
  v_pair record;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change seasons';
  end if;
  v_property := public.current_property_id();
  select * into v_type from public.season_types
  where id = p_season_type_id and property_id = v_property;
  if not found then
    raise exception 'That season or event is not on this property';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'Choose the start and the end';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'It cannot end before it starts';
  end if;

  if v_type.kind = 'season' then
    select t.name, s.starts_on, s.ends_on into v_clash
    from public.seasons s
    join public.season_types t on t.id = s.season_type_id
    where s.property_id = v_property and s.kind = 'season'
      and daterange(s.starts_on, s.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
    order by s.starts_on
    limit 1;
    if found then
      raise exception 'That overlaps % (% - %). Seasons cannot overlap.',
        v_clash.name, to_char(v_clash.starts_on, 'FMDD Mon YYYY'), to_char(v_clash.ends_on, 'FMDD Mon YYYY');
    end if;
  end if;

  insert into public.seasons (property_id, name, starts_on, ends_on, season_type_id, kind)
  values (v_property, v_type.name, p_starts_on, p_ends_on, v_type.id, v_type.kind)
  returning id into v_id;

  if v_type.kind = 'season' then
    for v_pair in
      select w.rate_plan_id, w.room_type_id,
             jsonb_agg(jsonb_build_object(
               'weekday', w.weekday, 'rate_cents', w.rate_cents,
               'min_stay_through', w.min_stay_through, 'min_stay_arrival', w.min_stay_arrival,
               'max_stay', w.max_stay, 'closed_to_arrival', w.closed_to_arrival,
               'closed_to_departure', w.closed_to_departure, 'stop_sell', w.stop_sell,
               'occupancy_rates', w.occupancy_rates
             )) as days
      from public.rate_plan_week_rates w
      join public.rate_plans rp on rp.id = w.rate_plan_id and rp.is_active
      where w.property_id = v_property and w.season_type_id = v_type.id
      group by w.rate_plan_id, w.room_type_id
    loop
      perform public.save_week_rates(v_pair.rate_plan_id, v_pair.room_type_id, v_type.id, v_pair.days, true);
    end loop;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

revoke all on function public.rate_plan_night_rate(uuid, uuid, date, bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.inventory_occupancy_grid(date, integer) from public, anon;
grant execute on function public.inventory_occupancy_grid(date, integer) to authenticated;
revoke all on function public.set_occupancy_rates(uuid, uuid[], date, date, integer[], integer, bigint) from public, anon;
grant execute on function public.set_occupancy_rates(uuid, uuid[], date, date, integer[], integer, bigint) to authenticated;
revoke execute on function public.save_week_rates(uuid, uuid, uuid, jsonb, boolean) from anon;
revoke execute on function public.add_season_range(uuid, date, date) from anon;
revoke execute on function public.create_booking(date, date, jsonb, uuid, uuid, jsonb, integer, integer, public.booking_status, public.booking_settlement, uuid, text, text, text, boolean, uuid, boolean, text) from anon;
grant execute on function public.public_room_types(uuid, uuid, date, date, integer, integer) to anon, authenticated;
grant execute on function public.create_public_booking(uuid, uuid, uuid, date, date, text, text, text, text, integer, integer, text) to anon, authenticated;
revoke all on function public.rate_plan_occupancy_rate(uuid, uuid, bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.set_rate_plan_terms(uuid, integer, integer, integer, integer, integer, integer, date, date, uuid, text, integer, bigint, text, bigint, bigint, bigint, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.set_rate_plan_terms(uuid, integer, integer, integer, integer, integer, integer, date, date, uuid, text, integer, bigint, text, bigint, bigint, bigint, uuid, uuid, uuid[]) to authenticated;
