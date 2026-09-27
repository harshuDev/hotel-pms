-- 0109: what a rate plan is, beyond its price.
--
-- The client's reference video shows a rate plan form with booking
-- conditions (days in advance, adults and children per room, an active date
-- range), a derived rate (a parent plan plus or minus a percentage or an
-- amount), occupancy pricing (one price for every occupancy, or an
-- automatic increase or decrease per adult and per child), attached taxes,
-- an accounting category and the channels the plan may be sold through.
--
-- Everything that already existed stays where it is and is reused:
--   * the nightly price and the six stay rules    rate_plan_days (0025)
--   * the weekly template per season              rate_plan_week_rates (0096)
--   * seasons and their date ranges               season_types / seasons (0095)
--   * cancellation policies                       cancellation_policies (0060, 0093)
--   * meal inclusion                              rate_plan_meals (0037, 0041)
--   * taxes                                       tax_rates + apply_tax_rate()
--   * ledger accounts                             accounting_categories (0085)
--   * sales channels                              channels
-- so this migration adds columns to rate_plans, one link table
-- (rate_plan_channels), and teaches the two booking paths the new rules.
--
-- NOTHING HERE ADDS A rate_plan_room_types TABLE. A plan is sold on a room
-- type exactly when that pair has prices loaded (CLAUDE.md, "Rates is a
-- nested grid"); rate_plan_coverage() below reports that link rather than
-- storing a second copy of it.
--
-- Every rule is live, none is decorative:
--   * conditions, channels   -> rate_plan_condition_violation(), refused with
--                               HP002 by create_booking() (overridable, like
--                               every stay rule) and by the guest page.
--   * derived rate           -> rate_plan_days triggers keep the child's
--                               nightly price equal to the parent's, adjusted,
--                               so every reader of rate_plan_days (bookings,
--                               the guest page, the inventory grids, the
--                               public API) sees the derived price unchanged.
--   * occupancy pricing      -> rate_plan_occupancy_rate(), applied wherever a
--                               night is priced from the plan.
--   * attached tax           -> the guest page's bookings (which carried no
--                               tax at all until now); the staff form seeds its
--                               tax field with it.
--   * accounting category    -> accounting_room_revenue(), the Accounting
--                               report's room split.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.rate_plans
  add column min_days_advance integer,
  add column max_days_advance integer,
  add column min_adults integer,
  add column max_adults integer,
  add column min_children integer,
  add column max_children integer,
  add column valid_from date,
  add column valid_to date,
  add column parent_rate_plan_id uuid references public.rate_plans (id) on delete restrict,
  add column derived_kind text,
  add column derived_percent_bps integer,
  add column derived_amount_cents bigint,
  add column occupancy_pricing text not null default 'single',
  add column adult_adjust_cents bigint,
  add column child_adjust_cents bigint,
  add column tax_rate_id uuid references public.tax_rates (id) on delete restrict,
  add column accounting_category_id uuid references public.accounting_categories (id) on delete restrict;

alter table public.rate_plans
  add constraint rate_plans_days_advance_range check (
    (min_days_advance is null or min_days_advance between 0 and 1000)
    and (max_days_advance is null or max_days_advance between 0 and 1000)
    and (min_days_advance is null or max_days_advance is null or min_days_advance <= max_days_advance)
  ),
  add constraint rate_plans_adults_range check (
    (min_adults is null or min_adults between 1 and 50)
    and (max_adults is null or max_adults between 1 and 50)
    and (min_adults is null or max_adults is null or min_adults <= max_adults)
  ),
  add constraint rate_plans_children_range check (
    (min_children is null or min_children between 0 and 50)
    and (max_children is null or max_children between 0 and 50)
    and (min_children is null or max_children is null or min_children <= max_children)
  ),
  add constraint rate_plans_valid_range check (
    valid_from is null or valid_to is null or valid_from <= valid_to
  ),
  -- A derived plan names its parent and exactly one adjustment; a plan that
  -- is not derived carries none of the three.
  add constraint rate_plans_derivation_shape check (
    (parent_rate_plan_id is null and derived_kind is null
      and derived_percent_bps is null and derived_amount_cents is null)
    or (parent_rate_plan_id is not null and parent_rate_plan_id <> id and (
      (derived_kind = 'percent' and derived_percent_bps between -10000 and 100000
        and derived_amount_cents is null)
      or (derived_kind = 'amount' and derived_amount_cents between -100000000 and 100000000
        and derived_percent_bps is null)
    ))
  ),
  -- One price for every occupancy, or the automatic calculation: both
  -- adjustments present (either may be zero), signed, in pence.
  add constraint rate_plans_occupancy_shape check (
    (occupancy_pricing = 'single' and adult_adjust_cents is null and child_adjust_cents is null)
    or (occupancy_pricing = 'per_person'
      and adult_adjust_cents between -100000000 and 100000000
      and child_adjust_cents between -100000000 and 100000000)
  );

create index rate_plans_parent_idx on public.rate_plans (parent_rate_plan_id)
  where parent_rate_plan_id is not null;
create index rate_plans_tax_rate_idx on public.rate_plans (tax_rate_id)
  where tax_rate_id is not null;
create index rate_plans_accounting_category_idx on public.rate_plans (accounting_category_id)
  where accounting_category_id is not null;

comment on column public.rate_plans.valid_from is
  'First night the plan may be sold for (0109). Null is no limit.';
comment on column public.rate_plans.valid_to is
  'Last night the plan may be sold for, inclusive (0109). Null is no limit.';
comment on column public.rate_plans.parent_rate_plan_id is
  'A derived plan (0109): its nightly price is the parent''s, adjusted. Kept in step by trigger.';
comment on column public.rate_plans.occupancy_pricing is
  'single: one price whatever the party. per_person: price + (adults - base occupancy) * adult_adjust_cents + children * child_adjust_cents (0109).';
comment on column public.rate_plans.tax_rate_id is
  'The tax the plan is sold with (0109): applied to guest-page bookings, and seeded into the staff booking form.';
comment on column public.rate_plans.accounting_category_id is
  'The ledger account the plan''s room revenue posts to (0109); ahead of the room type''s and the default.';

-- ---------------------------------------------------------------------------
-- 2. Channels a plan may be sold through. No rows = every channel.
-- ---------------------------------------------------------------------------

create table public.rate_plan_channels (
  property_id uuid not null references public.properties (id) on delete restrict,
  rate_plan_id uuid not null references public.rate_plans (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (rate_plan_id, channel_id)
);

create index rate_plan_channels_channel_idx on public.rate_plan_channels (channel_id);
create index rate_plan_channels_property_idx on public.rate_plan_channels (property_id);

alter table public.rate_plan_channels enable row level security;

-- Read by anyone on the property; written only through set_rate_plan_terms(),
-- so there is no insert, update or delete policy and RLS refuses them.
create policy rate_plan_channels_select_same_property on public.rate_plan_channels
  for select using (property_id = public.current_property_id());

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- The derived price: the parent's, plus or minus a percentage or an amount,
-- never below zero. Percent in basis points (1000 = 10%), rounded half away
-- from zero to the penny. Null in, null out: a parent night with no price
-- loaded gives the child no price either, which is "not sold", never free.
create or replace function public.rate_plan_derived_rate(
  p_parent_cents bigint,
  p_kind text,
  p_percent_bps integer,
  p_amount_cents bigint
)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case
    when p_parent_cents is null then null
    when p_kind = 'percent' then
      greatest(0, p_parent_cents + round(p_parent_cents::numeric * p_percent_bps / 10000)::bigint)
    when p_kind = 'amount' then greatest(0, p_parent_cents + p_amount_cents)
    else p_parent_cents
  end;
$$;

-- A night's price for a party, on a plan that prices per person. The loaded
-- price is for the room type's base occupancy in adults; each adult above
-- or below it moves the price by the adult adjustment, each child adds the
-- child adjustment. Never below zero. A 'single' plan, or no plan, returns
-- the price untouched.
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
begin
  if p_rate_cents is null or p_rate_plan_id is null then
    return p_rate_cents;
  end if;

  select rp.occupancy_pricing, rp.adult_adjust_cents, rp.child_adjust_cents, rp.property_id
    into v_plan
  from public.rate_plans rp where rp.id = p_rate_plan_id;

  if not found or v_plan.occupancy_pricing <> 'per_person' then
    return p_rate_cents;
  end if;

  select rt.base_occupancy into v_base
  from public.room_types rt
  where rt.id = p_room_type_id and rt.property_id = v_plan.property_id;

  return greatest(
    0,
    p_rate_cents
      + (greatest(coalesce(p_adults, v_base), 1) - coalesce(v_base, 1)) * v_plan.adult_adjust_cents
      + greatest(coalesce(p_children, 0), 0) * v_plan.child_adjust_cents
  );
end;
$$;

-- apply_tax_rate() without current_property_id(), for the guest page, which
-- has no staff session. Same arithmetic, so a guest booking and a staff one
-- at the same price split identically.
create or replace function public.tax_split_for(
  p_property_id uuid,
  p_tax_rate_id uuid,
  p_amount_cents bigint
)
returns table (net_cents bigint, tax_cents bigint, gross_cents bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rate public.tax_rates;
  v_tax bigint;
begin
  if p_amount_cents is null then
    return query select null::bigint, null::bigint, null::bigint;
    return;
  end if;

  select * into v_rate from public.tax_rates
  where id = p_tax_rate_id and property_id = p_property_id;

  if not found then
    return query select p_amount_cents, 0::bigint, p_amount_cents;
    return;
  end if;

  if v_rate.inclusion = 'exclusive' then
    v_tax := round(p_amount_cents::numeric * v_rate.rate_bps / 10000)::bigint;
    return query select p_amount_cents, v_tax, p_amount_cents + v_tax;
  else
    v_tax := round(p_amount_cents::numeric * v_rate.rate_bps / (10000 + v_rate.rate_bps))::bigint;
    return query select p_amount_cents - v_tax, v_tax, p_amount_cents;
  end if;
end;
$$;

-- The channel the guest page books through: the property's first active
-- direct channel, as create_public_booking() has always chosen it.
create or replace function public.public_direct_channel(p_property_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.channels c
  where c.property_id = p_property_id and c.kind = 'direct' and c.is_active
  order by c.code
  limit 1;
$$;

-- Why a plan may not be sold for this stay, or null. The plan-level rules;
-- the per-night stay rules stay in stay_rule_violation_for(). Null adults or
-- children skip the occupancy checks (a search before the party is known),
-- a null channel skips the channel check.
create or replace function public.rate_plan_condition_violation(
  p_property_id uuid,
  p_rate_plan_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_channel_id uuid,
  p_today date
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan public.rate_plans;
  v_lead integer;
  v_channel text;
begin
  if p_rate_plan_id is null then
    return null;
  end if;

  select * into v_plan from public.rate_plans
  where id = p_rate_plan_id and property_id = p_property_id;
  if not found then
    return null;
  end if;

  if v_plan.valid_from is not null and v_plan.valid_to is not null
     and (p_check_in < v_plan.valid_from or p_check_out - 1 > v_plan.valid_to) then
    return format('%s is sold only for stays from %s to %s.', v_plan.name,
      to_char(v_plan.valid_from, 'FMDD Mon YYYY'), to_char(v_plan.valid_to, 'FMDD Mon YYYY'));
  end if;
  if v_plan.valid_from is not null and p_check_in < v_plan.valid_from then
    return format('%s is sold only for stays from %s.', v_plan.name,
      to_char(v_plan.valid_from, 'FMDD Mon YYYY'));
  end if;
  if v_plan.valid_to is not null and p_check_out - 1 > v_plan.valid_to then
    return format('%s is sold only for stays up to %s.', v_plan.name,
      to_char(v_plan.valid_to, 'FMDD Mon YYYY'));
  end if;

  if p_today is not null then
    v_lead := p_check_in - p_today;
    if v_plan.min_days_advance is not null and v_lead < v_plan.min_days_advance then
      return format('%s must be booked at least %s days before arrival.', v_plan.name, v_plan.min_days_advance);
    end if;
    if v_plan.max_days_advance is not null and v_lead > v_plan.max_days_advance then
      return format('%s can be booked at most %s days before arrival.', v_plan.name, v_plan.max_days_advance);
    end if;
  end if;

  if p_adults is not null then
    if v_plan.min_adults is not null and p_adults < v_plan.min_adults then
      return format('%s needs at least %s adults in a room.', v_plan.name, v_plan.min_adults);
    end if;
    if v_plan.max_adults is not null and p_adults > v_plan.max_adults then
      return format('%s takes at most %s adults in a room.', v_plan.name, v_plan.max_adults);
    end if;
  end if;
  if p_children is not null then
    if v_plan.min_children is not null and p_children < v_plan.min_children then
      return format('%s needs at least %s children in a room.', v_plan.name, v_plan.min_children);
    end if;
    if v_plan.max_children is not null and p_children > v_plan.max_children then
      return format('%s takes at most %s children in a room.', v_plan.name, v_plan.max_children);
    end if;
  end if;

  if p_channel_id is not null
     and exists (select 1 from public.rate_plan_channels rc where rc.rate_plan_id = v_plan.id)
     and not exists (
       select 1 from public.rate_plan_channels rc
       where rc.rate_plan_id = v_plan.id and rc.channel_id = p_channel_id
     ) then
    select name into v_channel from public.channels where id = p_channel_id;
    return format('%s is not sold through %s.', v_plan.name, coalesce(v_channel, 'this channel'));
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Derived rates follow their parent
-- ---------------------------------------------------------------------------

-- Before any write of a derived plan's night, its price is recomputed from
-- the parent's night. Whatever the write carried for rate_cents is replaced,
-- so nothing -- a bulk setter, the weekly grid, the API -- can put a derived
-- plan out of step with its parent. Restrictions are the plan's own.
create or replace function public.rate_plan_days_follow_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_parent_cents bigint;
begin
  select parent_rate_plan_id, derived_kind, derived_percent_bps, derived_amount_cents
    into v_plan
  from public.rate_plans where id = new.rate_plan_id;

  if v_plan.parent_rate_plan_id is not null then
    select d.rate_cents into v_parent_cents
    from public.rate_plan_days d
    where d.rate_plan_id = v_plan.parent_rate_plan_id
      and d.room_type_id = new.room_type_id
      and d.stay_date = new.stay_date;
    new.rate_cents := public.rate_plan_derived_rate(
      v_parent_cents, v_plan.derived_kind, v_plan.derived_percent_bps, v_plan.derived_amount_cents
    );
  end if;
  return new;
end;
$$;

create trigger rate_plan_days_follow_parent
  before insert or update on public.rate_plan_days
  for each row execute function public.rate_plan_days_follow_parent();

-- After a parent's night changes price, touch the same night on every plan
-- derived from it; the trigger above does the arithmetic. One level only:
-- set_rate_plan_terms() refuses a parent that is itself derived, so this
-- cannot recurse past its children.
create or replace function public.rate_plan_days_push_to_children()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.rate_cents is not distinct from old.rate_cents then
    return null;
  end if;

  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date, updated_by)
  select new.property_id, c.id, new.room_type_id, new.stay_date, new.updated_by
  from public.rate_plans c
  where c.parent_rate_plan_id = new.rate_plan_id
    and c.property_id = new.property_id
  on conflict (rate_plan_id, room_type_id, stay_date) do update
    set updated_at = now(), updated_by = excluded.updated_by;

  return null;
end;
$$;

create trigger rate_plan_days_push_to_children
  after insert or update of rate_cents on public.rate_plan_days
  for each row execute function public.rate_plan_days_push_to_children();

-- Recompute a derived plan's nights from the business date on, and give it a
-- row wherever the parent has one. Called when a derivation is set or
-- changed; past nights are left as they were, like every rate change here.
create or replace function public.rate_plan_rederive(p_rate_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.rate_plans;
  v_from date;
  v_count integer := 0;
  v_n integer;
begin
  select * into v_plan from public.rate_plans where id = p_rate_plan_id;
  if not found or v_plan.parent_rate_plan_id is null then
    return 0;
  end if;

  v_from := coalesce(public.open_business_date(v_plan.property_id), current_date);

  -- Nights the child already has: touching them re-runs the before trigger.
  update public.rate_plan_days
  set updated_at = now()
  where rate_plan_id = v_plan.id and property_id = v_plan.property_id and stay_date >= v_from;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;

  -- Nights only the parent has.
  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date)
  select p.property_id, v_plan.id, p.room_type_id, p.stay_date
  from public.rate_plan_days p
  where p.rate_plan_id = v_plan.parent_rate_plan_id
    and p.property_id = v_plan.property_id
    and p.stay_date >= v_from
  on conflict (rate_plan_id, room_type_id, stay_date) do nothing;
  get diagnostics v_n = row_count;
  return v_count + v_n;
end;
$$;

-- The bulk price setter refuses a derived plan by name rather than letting
-- the trigger silently throw the typed price away.
create or replace function public.set_rates(
  p_rate_plan_id uuid,
  p_room_type_ids uuid[],
  p_from date,
  p_to date,
  p_days_of_week integer[] default null,
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
begin
  v_property := public.inventory_guard(p_rate_plan_id, p_from, p_to);
  if p_rate_plan_id is null then
    raise exception 'Pick a rate plan before setting this';
  end if;

  select rp.name, parent.name into v_name, v_parent
  from public.rate_plans rp
  join public.rate_plans parent on parent.id = rp.parent_rate_plan_id
  where rp.id = p_rate_plan_id and rp.property_id = v_property;
  if v_parent is not null then
    raise exception '% is derived from %, so its price follows that plan. Change the price on % instead.',
      v_name, v_parent, v_parent;
  end if;

  insert into public.rate_plan_days (property_id, rate_plan_id, room_type_id, stay_date, rate_cents, updated_by)
  select v_property, p_rate_plan_id, rt.id, d.stay_date, p_rate_cents, auth.uid()
  from unnest(p_room_type_ids) as t(room_type_id)
  join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_property
  cross join public.inventory_target_dates(p_from, p_to, p_days_of_week) as d(stay_date)
  on conflict (rate_plan_id, room_type_id, stay_date) do update
    set rate_cents = excluded.rate_cents, updated_by = excluded.updated_by;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Saving a plan's terms
-- ---------------------------------------------------------------------------

-- Everything on the rate plan form beyond code, name, description, the main
-- rate tick and "still selling" (save_rate_plan) and the cancellation policy
-- (set_rate_plan_cancellation_policy) and meals (set_rate_plan_meals). Its
-- own function for the reason those are: an optional parameter on
-- save_rate_plan() would be an overload for PostgREST to choose between.
-- It takes the whole set every time, so the form says what it means.
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

  if coalesce(p_occupancy_pricing, 'single') not in ('single', 'per_person') then
    raise exception 'Unknown occupancy pricing: %', p_occupancy_pricing;
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

-- Which room types a plan is sold on: the pairs with a price loaded from the
-- business date on. This IS the plan-to-room-type link -- a blank price is
-- how a hotel says "not sold on this room" -- reported, not stored twice.
create or replace function public.rate_plan_coverage()
returns table (
  rate_plan_id uuid,
  room_type_id uuid,
  priced_nights bigint,
  first_night date,
  last_night date
)
language sql
stable
security invoker
set search_path = public
as $$
  select d.rate_plan_id, d.room_type_id, count(*)::bigint, min(d.stay_date), max(d.stay_date)
  from public.rate_plan_days d
  where d.property_id = public.current_property_id()
    and d.rate_cents is not null
    and d.stay_date >= coalesce(
      (select bd.business_date from public.business_dates bd
       where bd.property_id = d.property_id and bd.status = 'open'),
      current_date)
  group by d.rate_plan_id, d.room_type_id;
$$;

-- ---------------------------------------------------------------------------
-- 6. The staff booking path
-- ---------------------------------------------------------------------------

-- create_booking(), as 0028 left it, with two additions and nothing else
-- changed: the plan's conditions and channels are checked with the stay
-- rules (HP002, overridden by the same p_ignore_restrictions), and a night
-- priced from the plan is adjusted for the room's party when the plan
-- prices per person. A hand-typed room rate is never adjusted.
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
            public.rate_plan_occupancy_rate(
              p_rate_plan_id, v_line.room_type_id, d.rate_cents, v_room_adults, v_room_children
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

-- ---------------------------------------------------------------------------
-- 7. The guest page
-- ---------------------------------------------------------------------------

-- A plan the hotel has restricted to other channels is not offered online.
create or replace function public.public_rate_plans(p_property_id uuid)
returns table (
  rate_plan_id uuid, code text, name text, description text,
  cancellation_name text, cancellation_kind public.cancellation_policy_kind,
  cancellation_free_days integer, cancellation_description text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rp.id, rp.code, rp.name, rp.description,
    c.name, c.kind, c.free_cancellation_days, c.description
  from public.rate_plans rp
  join public.properties p on p.id = rp.property_id and p.is_active
  left join public.cancellation_policies c
    on c.id = rp.cancellation_policy_id
   and c.property_id = rp.property_id
   and c.is_active
  where rp.property_id = p_property_id
    and rp.is_active
    and rp.is_public
    and (
      not exists (select 1 from public.rate_plan_channels rc where rc.rate_plan_id = rp.id)
      or exists (
        select 1 from public.rate_plan_channels rc
        where rc.rate_plan_id = rp.id
          and rc.channel_id = public.public_direct_channel(p_property_id)
      )
    )
  order by rp.sort_order, rp.name;
$$;

-- public_room_types() takes the party now, so a plan that prices per person
-- quotes the price that will be charged, and its total includes the plan's
-- tax where that tax is exclusive (inclusive tax is already in the price).
-- DROPPED first: a changed parameter list is a new function, and two
-- public_room_types would be the overload trap.
drop function public.public_room_types(uuid, uuid, date, date);

create function public.public_room_types(
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
             public.rate_plan_occupancy_rate(
               (select id from plan), types.id, rpd.rate_cents, p_adults, p_children
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

-- create_public_booking(), as 0037 left it, with three changes: it asks
-- public_room_types() with the party, so the plan's conditions and the per
-- person price are the ones the guest was shown; it prices each night for
-- the party; and it splits each night with the plan's tax. Until now a
-- guest-page booking carried no tax at all.
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
    select public.rate_plan_occupancy_rate(
             p_rate_plan_id, p_room_type_id, d.rate_cents, p_adults, coalesce(p_children, 0)
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
-- 8. Things that point at a plan's new references
-- ---------------------------------------------------------------------------

-- A tax a plan is sold with is in use.
create or replace function public.tax_rates_list()
returns table (
  id uuid, name text, rate_bps integer, inclusion public.tax_inclusion,
  is_active boolean, charge_count bigint, sort_order integer, in_use boolean
)
language sql
stable
set search_path = public
as $$
  select
    t.id, t.name, t.rate_bps, t.inclusion, t.is_active,
    coalesce(c.charges, 0)::bigint,
    t.sort_order,
    (
      coalesce(c.charges, 0) > 0
      or exists (select 1 from public.extras e where e.tax_rate_id = t.id)
      or exists (select 1 from public.extra_categories ec where ec.tax_rate_id = t.id)
      or exists (select 1 from public.rate_plans rp where rp.tax_rate_id = t.id)
    )
  from public.tax_rates t
  left join lateral (
    select count(*) as charges
    from public.folio_items fi
    where fi.tax_rate_id = t.id
      and fi.property_id = t.property_id
  ) c on true
  where t.property_id = public.current_property_id()
  order by t.sort_order, t.name;
$$;

create or replace function public.delete_tax_rate(p_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_property uuid;
  v_name text;
  v_plan text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the taxes';
  end if;
  v_property := public.current_property_id();
  select name into v_name from public.tax_rates where id = p_id and property_id = v_property;
  if v_name is null then
    raise exception 'That tax is not on this property';
  end if;

  if exists (select 1 from public.folio_items fi where fi.tax_rate_id = p_id) then
    raise exception 'Charges have been posted with %, so it cannot be deleted. Untick Active to retire it.', v_name;
  end if;
  if exists (select 1 from public.extras e where e.tax_rate_id = p_id)
     or exists (select 1 from public.extra_categories c where c.tax_rate_id = p_id) then
    raise exception '% is set on an extra or an extras category. Change those first, or untick Active to retire it.', v_name;
  end if;
  select rp.name into v_plan from public.rate_plans rp
  where rp.tax_rate_id = p_id and rp.property_id = v_property
  order by rp.sort_order limit 1;
  if v_plan is not null then
    raise exception '% is the tax of the rate plan %. Change that first, or untick Active to retire it.', v_name, v_plan;
  end if;

  delete from public.tax_rates where id = p_id and property_id = v_property;
end;
$$;

create or replace function public.delete_accounting_category(p_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_property uuid;
  v_name text;
  v_default text;
  v_type text;
  v_plan text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the accounting categories';
  end if;
  v_property := public.current_property_id();
  select name into v_name from public.accounting_categories
  where id = p_id and property_id = v_property;
  if v_name is null then
    raise exception 'That accounting category is not on this property';
  end if;

  select case
    when d.accommodation_id = p_id then 'accommodation'
    when d.extras_id = p_id then 'extras'
    when d.taxes_id = p_id then 'taxes'
    when d.payments_id = p_id then 'payments'
  end into v_default
  from public.accounting_defaults d
  where d.property_id = v_property;
  if v_default is not null then
    raise exception '% is the default for %. Choose another default first.', v_name, v_default;
  end if;

  select rt.name into v_type from public.room_types rt
  where rt.accounting_category_id = p_id and rt.property_id = v_property
  order by rt.sort_order limit 1;
  if v_type is not null then
    raise exception '% is the accounting category of %. Choose another for that room type first.', v_name, v_type;
  end if;

  select rp.name into v_plan from public.rate_plans rp
  where rp.accounting_category_id = p_id and rp.property_id = v_property
  order by rp.sort_order limit 1;
  if v_plan is not null then
    raise exception '% is the accounting category of the rate plan %. Choose another for that plan first.', v_name, v_plan;
  end if;

  delete from public.accounting_categories
  where id = p_id and property_id = v_property;
end;
$$;

-- A parent plan cannot be deleted from under the plans derived from it.
create or replace function public.delete_rate_plan(p_rate_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_plan public.rate_plans;
  v_booked bigint;
  v_child text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change a rate plan';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  select * into v_plan from public.rate_plans
  where id = p_rate_plan_id and property_id = v_property;
  if not found then
    raise exception 'That rate plan is not on this property';
  end if;

  if v_plan.is_default then
    raise exception '% is the main rate. Make another plan the main rate first.', v_plan.name;
  end if;

  select count(*) into v_booked from public.booking_rooms
  where rate_plan_id = v_plan.id and property_id = v_property;
  if v_booked > 0 then
    raise exception '% has been sold, so it stays on the record. Untick Still selling instead.', v_plan.name;
  end if;

  select name into v_child from public.rate_plans
  where parent_rate_plan_id = v_plan.id and property_id = v_property
  order by sort_order, name limit 1;
  if v_child is not null then
    raise exception '% is derived from %. Stop deriving it first.', v_child, v_plan.name;
  end if;

  delete from public.rate_plan_meals where rate_plan_id = v_plan.id and property_id = v_property;
  delete from public.rate_plans where id = v_plan.id and property_id = v_property;
end;
$$;

-- Merging sales channels: a plan restricted to a merged-away channel is
-- restricted to the channel kept instead, rather than silently opening up to
-- every channel when the row cascades away.
create or replace function public.merge_channels(p_keep_id uuid, p_merge_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid := public.current_property_id();
  v_ids uuid[];
  v_keep public.channels;
  v_moved integer := 0;
  v_names text;
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can merge sales channels';
  end if;
  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_merge_ids, '{}'::uuid[])) as x
  where x is not null and x <> p_keep_id;
  if v_ids is null then
    raise exception 'Choose at least one other sales channel to merge in';
  end if;
  select * into v_keep from public.channels
  where id = p_keep_id and property_id = v_property
  for update;
  if not found then
    raise exception 'The sales channel to keep is not on this property';
  end if;
  if (select count(*) from public.channels where id = any(v_ids) and property_id = v_property)
     <> array_length(v_ids, 1) then
    raise exception 'One of the sales channels to merge is not on this property';
  end if;

  select string_agg(name, ', ' order by name) into v_names
  from public.channels where id = any(v_ids) and property_id = v_property;

  update public.bookings set channel_id = p_keep_id
  where channel_id = any(v_ids) and property_id = v_property;
  get diagnostics v_moved = row_count;

  insert into public.rate_plan_channels (property_id, rate_plan_id, channel_id)
  select v_property, rc.rate_plan_id, p_keep_id
  from public.rate_plan_channels rc
  where rc.channel_id = any(v_ids) and rc.property_id = v_property
  on conflict do nothing;

  delete from public.channels where id = any(v_ids) and property_id = v_property;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'channel', p_keep_id, 'channels_merged',
    format('Sales channel(s) %s merged into %s', v_names, v_keep.name),
    jsonb_build_object('kept_id', p_keep_id, 'merged_ids', to_jsonb(v_ids), 'bookings_moved', v_moved)
  );
  return v_moved;
end;
$$;

-- The Accounting report's room split: a plan's own account ahead of the room
-- type's; the page falls back to the accommodation default. A row names the
-- plan only when the plan has an account of its own, so a hotel that uses
-- none sees exactly the per-type rows 0108 drew.
drop function public.accounting_room_revenue(date, date);

create function public.accounting_room_revenue(p_from date, p_to date)
returns table (
  room_type_id uuid,
  room_type_name text,
  rate_plan_name text,
  accounting_category_id uuid,
  net_cents bigint,
  tax_cents bigint,
  gross_cents bigint
)
language plpgsql
stable
set search_path = public
as $$
begin
  perform public.require_money_reports();

  return query
  select
    rt.id,
    rt.name,
    case when rp.accounting_category_id is not null then rp.name end,
    coalesce(rp.accounting_category_id, rt.accounting_category_id),
    sum(l.signed_net_amount_cents)::bigint,
    sum(l.signed_tax_amount_cents)::bigint,
    sum(l.signed_amount_cents)::bigint
  from public.folio_item_lines l
  join public.folio_items fi on fi.id = l.id and fi.property_id = l.property_id
  left join public.folio_items orig on orig.id = fi.reverses_id and orig.property_id = fi.property_id
  left join public.booking_room_nights n
    on n.id = coalesce(fi.booking_room_night_id, orig.booking_room_night_id)
  left join public.booking_rooms br on br.id = n.booking_room_id
  left join public.room_types rt on rt.id = br.room_type_id
  left join public.rate_plans rp on rp.id = br.rate_plan_id
  where l.property_id = public.current_property_id()
    and l.business_date between p_from and p_to
    and l.effective_item_type = 'room_charge'
  group by rt.id, rt.name, rt.sort_order,
           case when rp.accounting_category_id is not null then rp.name end,
           coalesce(rp.accounting_category_id, rt.accounting_category_id)
  order by rt.sort_order nulls last, rt.name, 3 nulls first;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------

-- Internal helpers: called only from inside other functions, never over RPC.
revoke all on function public.rate_plan_derived_rate(bigint, text, integer, bigint) from public, anon, authenticated;
revoke all on function public.rate_plan_occupancy_rate(uuid, uuid, bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.tax_split_for(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.public_direct_channel(uuid) from public, anon, authenticated;
revoke all on function public.rate_plan_condition_violation(uuid, uuid, date, date, integer, integer, uuid, date) from public, anon, authenticated;
revoke all on function public.rate_plan_days_follow_parent() from public, anon, authenticated;
revoke all on function public.rate_plan_days_push_to_children() from public, anon, authenticated;
revoke all on function public.rate_plan_rederive(uuid) from public, anon, authenticated;

-- Staff functions.
revoke all on function public.set_rate_plan_terms(uuid, integer, integer, integer, integer, integer, integer, date, date, uuid, text, integer, bigint, text, bigint, bigint, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.set_rate_plan_terms(uuid, integer, integer, integer, integer, integer, integer, date, date, uuid, text, integer, bigint, text, bigint, bigint, uuid, uuid, uuid[]) to authenticated;
revoke all on function public.rate_plan_coverage() from public, anon;
grant execute on function public.rate_plan_coverage() to authenticated;
revoke all on function public.accounting_room_revenue(date, date) from public, anon;
grant execute on function public.accounting_room_revenue(date, date) to authenticated;
revoke execute on function public.set_rates(uuid, uuid[], date, date, integer[], bigint) from anon;
revoke execute on function public.create_booking(date, date, jsonb, uuid, uuid, jsonb, integer, integer, public.booking_status, public.booking_settlement, uuid, text, text, text, boolean, uuid, boolean, text) from anon;
revoke execute on function public.tax_rates_list() from anon;
revoke execute on function public.delete_tax_rate(uuid) from anon;
revoke execute on function public.delete_accounting_category(uuid) from anon;
revoke execute on function public.delete_rate_plan(uuid) from anon;
revoke execute on function public.merge_channels(uuid, uuid[]) from anon;

-- The public booking surface: recreated, so granted again; still ten functions.
revoke all on function public.public_room_types(uuid, uuid, date, date, integer, integer) from public;
grant execute on function public.public_room_types(uuid, uuid, date, date, integer, integer) to anon, authenticated;
grant execute on function public.public_rate_plans(uuid) to anon, authenticated;
grant execute on function public.create_public_booking(uuid, uuid, uuid, date, date, text, text, text, text, integer, integer, text) to anon, authenticated;
