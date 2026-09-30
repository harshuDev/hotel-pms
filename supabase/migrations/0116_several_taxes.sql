-- 0116: a rate, and a booking, can carry SEVERAL taxes.
--
-- The client: "there could be an option where client can put two taxes at the
-- same time so the system should be flexible for this" -- a Mexican hotel
-- charges IVA and the state lodging tax (ISH) on the same night, and their
-- reference's rate form shows both as chips. Until now a night carried one
-- tax figure worked out from ONE rate.
--
-- 1. tax_split_multi(property, rates[], amount): the one place a set of rates
--    is applied. Inclusive rates are taken out of the amount together (the net
--    is amount / (1 + their sum)), and shared between them by their size;
--    exclusive rates go on top of that net. With one rate it gives exactly
--    what apply_tax_rate() gave, penny for penny. Every rate is a percentage
--    of the net -- no tax on tax.
-- 2. The per-tax split is KEPT: booking_room_nights.tax_breakdown and
--    folio_items.tax_breakdown hold {tax_rate_id: cents}. tax_cents and
--    tax_amount_cents stay the total, so every report, the folio balance and
--    the calendar read exactly what they read before. The invoice reads the
--    breakdown to list each tax, and a hotel can see what it owes each
--    authority.
-- 3. rate_plan_taxes replaces rate_plans.tax_rate_id (moved across, then
--    dropped): set_rate_plan_terms() takes p_tax_rate_ids uuid[], and the
--    guest page's quote and booking charge the plan's whole set.
-- 4. create_booking() and set_booking_room_rate() take p_tax_rate_ids uuid[]
--    in place of p_tax_rate_id -- dropped and recreated, the overload trap.
-- 5. A tax counts as used, and is frozen and undeletable, once any posted
--    charge carries it in its breakdown or a plan carries it -- room charges
--    never set folio_items.tax_rate_id, so until now a room charge never
--    froze its rate at all.
-- 6. post_room_charge(), post_charge() and reverse_charge() carry the
--    breakdown onto what they post; the meal split shares it by net.

-- ---------------------------------------------------------------------------
-- Columns and the plan's tax set
-- ---------------------------------------------------------------------------

alter table public.booking_room_nights add column tax_breakdown jsonb;
alter table public.folio_items add column tax_breakdown jsonb;

comment on column public.booking_room_nights.tax_breakdown is
  'Per-tax split of tax_cents, {tax_rate_id: cents} (0116). Null: no tax, or taken before 0116.';
comment on column public.folio_items.tax_breakdown is
  'Per-tax split of tax_amount_cents, {tax_rate_id: cents} (0116). Carries the reversal sign through reverses_id like every amount.';

create table public.rate_plan_taxes (
  property_id uuid not null references public.properties (id) on delete restrict,
  rate_plan_id uuid not null references public.rate_plans (id) on delete cascade,
  tax_rate_id uuid not null references public.tax_rates (id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (rate_plan_id, tax_rate_id)
);
create index rate_plan_taxes_tax_idx on public.rate_plan_taxes (tax_rate_id);
create index rate_plan_taxes_property_idx on public.rate_plan_taxes (property_id);
alter table public.rate_plan_taxes enable row level security;
-- Read by anyone on the property; written only through set_rate_plan_terms().
create policy rate_plan_taxes_select_same_property on public.rate_plan_taxes
  for select using (property_id = public.current_property_id());

insert into public.rate_plan_taxes (property_id, rate_plan_id, tax_rate_id, sort_order)
select rp.property_id, rp.id, rp.tax_rate_id, 0
from public.rate_plans rp where rp.tax_rate_id is not null;

-- ---------------------------------------------------------------------------
-- 1. Applying a set of rates
-- ---------------------------------------------------------------------------

create or replace function public.tax_split_multi(
  p_property_id uuid,
  p_tax_rate_ids uuid[],
  p_amount_cents bigint,
  p_refuse_retired boolean default false
)
returns table (net_cents bigint, tax_cents bigint, gross_cents bigint, breakdown jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_name text;
  v_rate record;
  v_incl_bps bigint;
  v_incl_total bigint := 0;
  v_net bigint;
  v_share bigint;
  v_given bigint := 0;
  v_first uuid;
  v_excl bigint := 0;
  v_breakdown jsonb := '{}'::jsonb;
begin
  if p_amount_cents is null then
    return query select null::bigint, null::bigint, null::bigint, null::jsonb;
    return;
  end if;
  if p_amount_cents < 0 then
    raise exception 'Tax cannot be applied to a negative amount';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_tax_rate_ids, '{}'::uuid[])) as x where x is not null;

  if (select count(*) from public.tax_rates t
      where t.id = any(v_ids) and t.property_id = p_property_id) <> cardinality(v_ids) then
    raise exception 'That tax rate does not belong to this property';
  end if;

  if p_refuse_retired then
    select t.name into v_name from public.tax_rates t
    where t.id = any(v_ids) and not t.is_active order by t.name limit 1;
    if v_name is not null then
      raise exception 'Tax rate % is retired and cannot be applied to a new charge', v_name;
    end if;
  end if;

  -- Inclusive rates come out of the amount together; a retired rate a guest
  -- path still names is left out rather than charged.
  select coalesce(sum(t.rate_bps), 0) into v_incl_bps
  from public.tax_rates t
  where t.id = any(v_ids) and t.is_active and t.inclusion = 'inclusive';

  if v_incl_bps > 0 then
    v_incl_total := round(p_amount_cents::numeric * v_incl_bps / (10000 + v_incl_bps))::bigint;
    for v_rate in
      select t.id, t.rate_bps from public.tax_rates t
      where t.id = any(v_ids) and t.is_active and t.inclusion = 'inclusive'
      order by t.rate_bps desc, t.id
    loop
      v_first := coalesce(v_first, v_rate.id);
      v_share := (v_incl_total * v_rate.rate_bps) / v_incl_bps;
      v_given := v_given + v_share;
      v_breakdown := v_breakdown || jsonb_build_object(v_rate.id::text, v_share);
    end loop;
    -- The pennies integer division leaves go to the largest rate, so the
    -- shares always add up to the inclusive total exactly.
    if v_given <> v_incl_total then
      v_breakdown := jsonb_set(v_breakdown, array[v_first::text],
        to_jsonb((v_breakdown ->> v_first::text)::bigint + (v_incl_total - v_given)));
    end if;
  end if;

  v_net := p_amount_cents - v_incl_total;

  for v_rate in
    select t.id, t.rate_bps from public.tax_rates t
    where t.id = any(v_ids) and t.is_active and t.inclusion = 'exclusive'
    order by t.rate_bps desc, t.id
  loop
    v_share := round(v_net::numeric * v_rate.rate_bps / 10000)::bigint;
    v_excl := v_excl + v_share;
    v_breakdown := v_breakdown || jsonb_build_object(v_rate.id::text, v_share);
  end loop;

  return query select
    v_net,
    v_incl_total + v_excl,
    p_amount_cents + v_excl,
    case when v_breakdown = '{}'::jsonb then null else v_breakdown end;
end;
$$;
revoke all on function public.tax_split_multi(uuid, uuid[], bigint, boolean) from public, anon;
grant execute on function public.tax_split_multi(uuid, uuid[], bigint, boolean) to authenticated;
-- ---------------------------------------------------------------------------
-- 3. The plan's taxes are a set
-- ---------------------------------------------------------------------------

drop function public.set_rate_plan_terms(uuid, integer, integer, integer, integer, integer, integer, date, date, uuid, text, integer, bigint, text, bigint, bigint, bigint, uuid, uuid, uuid[]);

create function public.set_rate_plan_terms(
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
  p_tax_rate_ids uuid[] default null,
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
  v_taxes uuid[];
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

  select coalesce(array_agg(x order by o), '{}') into v_taxes
  from (
    select x, min(o) as o
    from unnest(coalesce(p_tax_rate_ids, '{}'::uuid[])) with ordinality as u(x, o)
    where x is not null group by x
  ) d;
  if (
    select count(*) from public.tax_rates where id = any(v_taxes) and property_id = v_property and is_active
  ) <> cardinality(v_taxes) then
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
      accounting_category_id = p_accounting_category_id,
      updated_at = now()
  where id = v_plan.id;

  -- The plan's taxes, in the order they were chosen.
  delete from public.rate_plan_taxes
  where rate_plan_id = v_plan.id and not (tax_rate_id = any(v_taxes));
  insert into public.rate_plan_taxes (property_id, rate_plan_id, tax_rate_id, sort_order)
  select v_property, v_plan.id, x, o::integer
  from unnest(v_taxes) with ordinality as u(x, o)
  on conflict (rate_plan_id, tax_rate_id) do update set sort_order = excluded.sort_order;

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
revoke all on function public.set_rate_plan_terms(uuid, integer, integer, integer, integer, integer, integer, date, date, uuid, text, integer, bigint, text, bigint, bigint, bigint, uuid[], uuid, uuid[]) from public, anon;
grant execute on function public.set_rate_plan_terms(uuid, integer, integer, integer, integer, integer, integer, date, date, uuid, text, integer, bigint, text, bigint, bigint, bigint, uuid[], uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A booking takes a set of taxes
-- ---------------------------------------------------------------------------

drop function public.create_booking(date, date, jsonb, uuid, uuid, jsonb, integer, integer, public.booking_status, public.booking_settlement, uuid, text, text, text, boolean, uuid, boolean, text);

create function public.create_booking(
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
  p_tax_rate_ids uuid[] default null,
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
  v_breakdown jsonb;
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
        if coalesce(cardinality(p_tax_rate_ids), 0) > 0 then
          select t.net_cents, t.tax_cents, t.breakdown into v_net_cents, v_tax_cents, v_breakdown
          from public.tax_split_multi(
            v_property, p_tax_rate_ids,
            greatest(v_night.rate_cents - v_night.discount_cents, 0), true
          ) t;
          v_net_cents := v_net_cents + v_night.discount_cents;
        else
          v_net_cents := v_night.rate_cents;
          v_tax_cents := 0;
          v_breakdown := null;
        end if;

        update public.booking_room_nights
        set room_rate_cents = v_net_cents,
            tax_cents = v_tax_cents,
            tax_breakdown = v_breakdown,
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
revoke all on function public.create_booking(date, date, jsonb, uuid, uuid, jsonb, integer, integer, public.booking_status, public.booking_settlement, uuid[], text, text, text, boolean, uuid, boolean, text) from public, anon;
grant execute on function public.create_booking(date, date, jsonb, uuid, uuid, jsonb, integer, integer, public.booking_status, public.booking_settlement, uuid[], text, text, text, boolean, uuid, boolean, text) to authenticated;

drop function public.set_booking_room_rate(uuid, bigint, date, date, uuid);

create function public.set_booking_room_rate(
  p_booking_room_id uuid,
  p_rate_cents bigint,
  p_from date default null,
  p_to date default null,
  p_tax_rate_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_room public.booking_rooms;
  v_net bigint;
  v_tax bigint;
  v_breakdown jsonb;
  v_count integer;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can change a rate';
  end if;

  v_property := public.current_property_id();

  select * into v_room from public.booking_rooms
  where id = p_booking_room_id and property_id = v_property;
  if not found then
    raise exception 'That room is not on a booking for this property';
  end if;

  if p_rate_cents is null or p_rate_cents < 0 then
    raise exception 'A nightly rate cannot be negative';
  end if;

  if coalesce(cardinality(p_tax_rate_ids), 0) > 0 then
    select t.net_cents, t.tax_cents, t.breakdown into v_net, v_tax, v_breakdown
    from public.tax_split_multi(v_property, p_tax_rate_ids, p_rate_cents, true) t;
  else
    v_net := p_rate_cents;
    v_tax := 0;
    v_breakdown := null;
  end if;

  -- A night already charged keeps its rate. The folio is what the guest owes,
  -- and changing the night underneath it would put the two out of step.
  update public.booking_room_nights bn
  set room_rate_cents = v_net, tax_cents = v_tax, tax_breakdown = v_breakdown
  where bn.booking_room_id = p_booking_room_id
    and bn.property_id = v_property
    and (p_from is null or bn.stay_date >= p_from)
    and (p_to is null or bn.stay_date <= p_to)
    and not exists (
      select 1 from public.folio_items fi
      where fi.booking_room_night_id = bn.id
        and fi.property_id = bn.property_id
        and fi.reverses_id is null
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.set_booking_room_rate(uuid, bigint, date, date, uuid[]) from public, anon;
grant execute on function public.set_booking_room_rate(uuid, bigint, date, date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The guest page quotes and charges the plan's whole set
-- ---------------------------------------------------------------------------

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
    select rp.id,
      array(select x.tax_rate_id from public.rate_plan_taxes x
            where x.rate_plan_id = rp.id order by x.sort_order) as tax_ids
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
          (select t.gross_cents from public.tax_split_multi(
             p_property_id,
             (select tax_ids from plan),
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
  v_tax_rates uuid[];
  v_breakdown jsonb;
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

  select coalesce(array_agg(x.tax_rate_id order by x.sort_order), '{}') into v_tax_rates
  from public.rate_plan_taxes x
  where x.rate_plan_id = p_rate_plan_id and x.property_id = p_property_id;

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

    select t.net_cents, t.tax_cents, t.breakdown into v_net, v_tax, v_breakdown
    from public.tax_split_multi(p_property_id, v_tax_rates, v_rate) t;

    update public.booking_room_nights
    set room_rate_cents = v_net,
        tax_cents = coalesce(v_tax, 0),
        tax_breakdown = v_breakdown
    where id = v_night.id;
  end loop;

  return query select v_booking, v_reference;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Postings carry the breakdown
-- ---------------------------------------------------------------------------

create or replace function public.post_room_charge(
  p_folio_id uuid,
  p_booking_room_night_id uuid,
  p_business_date date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_folio public.folios;
  v_night record;
  v_date date;
  v_id uuid;
  v_net bigint;
  v_meal_value bigint;
  v_meal_net bigint;
  v_meal_tax bigint;
  v_acc_net bigint;
  v_acc_tax bigint;
  v_meal_breakdown jsonb;
  v_acc_breakdown jsonb;
  v_key text;
  v_part bigint;
  v_given bigint := 0;
  v_top text;
begin
  perform public.require_financial_staff();

  select * into v_folio
  from public.folios
  where id = p_folio_id
    and property_id = public.current_property_id()
    and status = 'open';

  select brn.*, br.booking_id, br.rate_plan_id into v_night
  from public.booking_room_nights brn
  join public.booking_rooms br
    on br.id = brn.booking_room_id and br.property_id = brn.property_id
  where brn.id = p_booking_room_night_id
    and brn.property_id = public.current_property_id();

  if not found or v_night.booking_id <> v_folio.booking_id then
    raise exception 'Room night does not belong to folio booking';
  end if;

  v_date := coalesce(p_business_date, public.open_business_date(v_folio.property_id));
  if v_date is null or v_date <> v_night.stay_date then
    raise exception 'Room charge must post on its open stay business date';
  end if;

  v_net := v_night.room_rate_cents - v_night.discount_cents;
  if v_net < 0 then
    raise exception 'Room night discount exceeds room rate';
  end if;

  -- What this night's rate includes, priced. A stay booked before 0037 has no
  -- rate_plan_id and so never splits: nothing records what those rates
  -- included and a guess would be worse than a single line.
  select coalesce(sum(rpm.value_cents), 0)::bigint into v_meal_value
  from public.rate_plan_meals rpm
  where rpm.rate_plan_id = v_night.rate_plan_id
    and rpm.property_id = v_folio.property_id
    and rpm.value_cents is not null;

  if v_meal_value > 0 and v_net > 0 then
    if v_meal_value > v_net then
      raise exception
        'The meals on this rate are priced at % but the night is worth %. Correct the meal values in Inventory.',
        v_meal_value, v_net;
    end if;

    v_meal_net := v_meal_value;
    v_acc_net := v_net - v_meal_net;
    v_meal_tax := (v_night.tax_cents * v_meal_net) / v_net;
    v_acc_tax := v_night.tax_cents - v_meal_tax;

    -- Each tax shares the split the same way, by net; the meal line's shares
    -- add up to its tax exactly and accommodation keeps the rest.
    if v_night.tax_breakdown is not null and v_night.tax_cents > 0 then
      v_meal_breakdown := '{}'::jsonb;
      for v_key, v_part in
        select k, (v_night.tax_breakdown ->> k)::bigint
        from jsonb_object_keys(v_night.tax_breakdown) as k
        order by (v_night.tax_breakdown ->> k)::bigint desc, k
      loop
        v_top := coalesce(v_top, v_key);
        v_meal_breakdown := v_meal_breakdown
          || jsonb_build_object(v_key, (v_part * v_meal_tax) / v_night.tax_cents);
        v_given := v_given + (v_part * v_meal_tax) / v_night.tax_cents;
      end loop;
      if v_given <> v_meal_tax then
        v_meal_breakdown := jsonb_set(v_meal_breakdown, array[v_top],
          to_jsonb((v_meal_breakdown ->> v_top)::bigint + (v_meal_tax - v_given)));
      end if;
      v_acc_breakdown := '{}'::jsonb;
      for v_key in select jsonb_object_keys(v_night.tax_breakdown) loop
        v_acc_breakdown := v_acc_breakdown || jsonb_build_object(v_key,
          (v_night.tax_breakdown ->> v_key)::bigint - (v_meal_breakdown ->> v_key)::bigint);
      end loop;
    end if;

    insert into public.folio_items(
      property_id, folio_id, booking_id, booking_room_night_id, business_date,
      item_type, description, quantity, unit_amount_cents, net_amount_cents,
      tax_amount_cents, amount_cents, posted_by, tax_breakdown
    ) values (
      v_folio.property_id, v_folio.id, v_folio.booking_id,
      p_booking_room_night_id, v_date, 'room_charge',
      format('Room charge for %s', v_night.stay_date),
      1, v_acc_net, v_acc_net, v_acc_tax, v_acc_net + v_acc_tax, auth.uid(), v_acc_breakdown
    )
    returning id into v_id;

    insert into public.folio_items(
      property_id, folio_id, booking_id, booking_room_night_id, business_date,
      item_type, description, quantity, unit_amount_cents, net_amount_cents,
      tax_amount_cents, amount_cents, posted_by, tax_breakdown
    ) values (
      v_folio.property_id, v_folio.id, v_folio.booking_id,
      p_booking_room_night_id, v_date, 'food_beverage',
      format('Meals included in the rate for %s', v_night.stay_date),
      1, v_meal_net, v_meal_net, v_meal_tax, v_meal_net + v_meal_tax, auth.uid(), v_meal_breakdown
    );

    return v_id;
  end if;

  insert into public.folio_items(
    property_id, folio_id, booking_id, booking_room_night_id, business_date,
    item_type, description, quantity, unit_amount_cents, net_amount_cents,
    tax_amount_cents, amount_cents, posted_by, tax_breakdown
  ) values (
    v_folio.property_id, v_folio.id, v_folio.booking_id,
    p_booking_room_night_id, v_date, 'room_charge',
    format('Room charge for %s', v_night.stay_date),
    1, v_net, v_net, v_night.tax_cents, v_net + v_night.tax_cents, auth.uid(),
    case when v_night.tax_cents > 0 then v_night.tax_breakdown end
  )
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.post_charge(
  p_folio_id uuid,
  p_item_type public.folio_item_type,
  p_description text,
  p_unit_amount_cents bigint,
  p_quantity integer default 1,
  p_tax_amount_cents bigint default null,
  p_tax_rate_id uuid default null,
  p_business_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_folio public.folios;
  v_date date;
  v_id uuid;
  v_base bigint;
  v_net bigint;
  v_tax bigint;
  v_amount bigint;
begin
  perform public.require_financial_staff();

  select * into v_folio
  from public.folios
  where id = p_folio_id and property_id = public.current_property_id() and status = 'open';

  if not found then
    raise exception 'Open folio not found for current property';
  end if;

  v_date := coalesce(p_business_date, public.open_business_date(v_folio.property_id));
  if v_date is null then
    raise exception 'No open business date for property';
  end if;

  if p_item_type in ('room_charge', 'reversal', 'discount')
     or p_unit_amount_cents < 0
     or p_quantity <= 0
     or coalesce(p_tax_amount_cents, 0) < 0 then
    raise exception 'Invalid manual charge values';
  end if;

  v_base := p_unit_amount_cents * p_quantity;

  if p_tax_amount_cents is not null then
    -- Explicit figure wins, and is treated as added on top, exactly as before.
    v_net := v_base;
    v_tax := p_tax_amount_cents;
    v_amount := v_net + v_tax;
  elsif p_tax_rate_id is not null then
    select t.net_cents, t.tax_cents, t.gross_cents
    into v_net, v_tax, v_amount
    from public.apply_tax_rate(p_tax_rate_id, v_base) t;
  else
    v_net := v_base;
    v_tax := 0;
    v_amount := v_base;
  end if;

  insert into public.folio_items (
    property_id, folio_id, booking_id, business_date, item_type, description,
    quantity, unit_amount_cents, net_amount_cents, tax_amount_cents,
    amount_cents, tax_rate_id, posted_by, tax_breakdown
  ) values (
    v_folio.property_id, v_folio.id, v_folio.booking_id, v_date, p_item_type,
    p_description, p_quantity, p_unit_amount_cents, v_net, v_tax,
    v_amount, p_tax_rate_id, auth.uid(),
    case when p_tax_rate_id is not null and v_tax > 0
      then jsonb_build_object(p_tax_rate_id::text, v_tax) end
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.reverse_charge(p_folio_item_id uuid, p_description text default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_item public.folio_items; v_id uuid;
begin
  perform public.require_financial_staff();
  select * into v_item from public.folio_items where id = p_folio_item_id and property_id = public.current_property_id() and reverses_id is null;
  if not found then raise exception 'Original folio item not found or is already a reversal'; end if;
  insert into public.folio_items(property_id, folio_id, booking_id, business_date, item_type, description, quantity,
    unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, tax_rate_id, reverses_id, posted_by, tax_breakdown)
  values (v_item.property_id, v_item.folio_id, v_item.booking_id, public.open_business_date(v_item.property_id), 'reversal',
    coalesce(p_description, 'Reversal: ' || v_item.description), v_item.quantity, v_item.unit_amount_cents, v_item.net_amount_cents,
    v_item.tax_amount_cents, v_item.amount_cents, v_item.tax_rate_id, v_item.id, auth.uid(), v_item.tax_breakdown) returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. In use, frozen and undeletable follow the breakdown and the plan set
-- ---------------------------------------------------------------------------

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
      or exists (select 1 from public.rate_plan_taxes rpt where rpt.tax_rate_id = t.id)
    )
  from public.tax_rates t
  left join lateral (
    select count(*) as charges
    from public.folio_items fi
    where (fi.tax_rate_id = t.id or fi.tax_breakdown ? t.id::text)
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

  if exists (select 1 from public.folio_items fi
             where fi.tax_rate_id = p_id or fi.tax_breakdown ? p_id::text) then
    raise exception 'Charges have been posted with %, so it cannot be deleted. Untick Active to retire it.', v_name;
  end if;
  if exists (select 1 from public.extras e where e.tax_rate_id = p_id)
     or exists (select 1 from public.extra_categories c where c.tax_rate_id = p_id) then
    raise exception '% is set on an extra or an extras category. Change those first, or untick Active to retire it.', v_name;
  end if;
  select rp.name into v_plan from public.rate_plans rp
  join public.rate_plan_taxes rpt on rpt.rate_plan_id = rp.id
  where rpt.tax_rate_id = p_id and rp.property_id = v_property
  order by rp.sort_order limit 1;
  if v_plan is not null then
    raise exception '% is a tax of the rate plan %. Change that first, or untick Active to retire it.', v_name, v_plan;
  end if;

  delete from public.tax_rates where id = p_id and property_id = v_property;
end;
$$;

create or replace function public.save_tax_rate(
  p_name text,
  p_rate_bps integer,
  p_inclusion public.tax_inclusion,
  p_id uuid default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up tax rates';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'A tax rate needs a name';
  end if;

  if p_rate_bps is null or p_rate_bps < 0 or p_rate_bps > 10000 then
    raise exception 'A tax rate must be between 0 and 100 percent';
  end if;

  if p_id is null then
    insert into public.tax_rates (property_id, name, rate_bps, inclusion, is_active)
    values (v_property, btrim(p_name), p_rate_bps, p_inclusion, coalesce(p_is_active, true))
    returning id into v_id;
  else
    -- The rate itself is not changed in place once charges have been posted
    -- against it: a folio item records which rate it used, and moving that
    -- rate underneath it would silently restate history.
    if exists (
      select 1 from public.folio_items fi
      where (fi.tax_rate_id = p_id or fi.tax_breakdown ? p_id::text) and fi.property_id = v_property
    ) and (
      select t.rate_bps <> p_rate_bps or t.inclusion <> p_inclusion
      from public.tax_rates t where t.id = p_id and t.property_id = v_property
    ) then
      raise exception
        'Charges have already been posted at this rate. Retire it and add a new one rather than changing it.';
    end if;

    update public.tax_rates set
      name = btrim(p_name),
      rate_bps = p_rate_bps,
      inclusion = p_inclusion,
      is_active = coalesce(p_is_active, true)
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That tax rate is not on this property';
    end if;
  end if;

  return v_id;
end;
$$;

-- The column the set replaced. Every reader was redefined above.
alter table public.rate_plans drop column tax_rate_id;
