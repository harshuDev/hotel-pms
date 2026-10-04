-- 0124: an occupancy row can be removed on a plan priced PER PERSON, too.
--
-- The client, on Room Rate Combinations: "Add a remove option for Guest
-- basis." 0120's x removes a row from a per-occupancy plan by clearing its
-- typed price, so that party pays the standard price. A per-person plan has
-- nothing typed to clear: its rows are worked out from the standard price
-- (rate_plan_occupancy_rate()), so a removal has to be stored.
--
-- 1. rate_plans.standard_occupancies, jsonb: room type id -> the numbers of
--    adults that pay the plan's STANDARD price on that room type, exactly as
--    a removed per-occupancy row does. A column on the plan rather than a
--    table, because it is part of the plan's terms and every reader of a plan
--    already selects the row.
-- 2. rate_plan_occupancy_is_standard() decides it, reading a derived plan's
--    parent as well -- a derived plan prices its parties off its parent's.
-- 3. rate_plan_night_rate() and rate_plan_occupancy_rate() price such a party
--    as the room type's base occupancy: the standard price, plus any children,
--    and never a stored per-night occupancy price. So create_booking(), the
--    guest page and booking_quote() all follow with no change to any of them.
-- 4. set_rate_plan_standard_occupancy(plan, room type, adults, on) removes or
--    restores a row. Revenue staff, refused by name on a derived plan (its
--    rows follow its parent) and on the base occupancy (that row IS the
--    standard price).
-- 5. remove_rate_combination() drops the pair's entry, so a combination added
--    again starts with every row.

alter table public.rate_plans
  add column standard_occupancies jsonb not null default '{}'::jsonb;

alter table public.rate_plans
  add constraint rate_plans_standard_occupancies_object
  check (jsonb_typeof(standard_occupancies) = 'object');

create or replace function public.rate_plan_occupancy_is_standard(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_adults integer
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(bool_or(rp.standard_occupancies -> p_room_type_id::text @> to_jsonb(p_adults)), false)
  from public.rate_plans rp
  where p_adults is not null
    and rp.id in (
      p_rate_plan_id,
      (select parent_rate_plan_id from public.rate_plans where id = p_rate_plan_id)
    );
$$;

revoke all on function public.rate_plan_occupancy_is_standard(uuid, uuid, integer) from public;
revoke execute on function public.rate_plan_occupancy_is_standard(uuid, uuid, integer) from anon, authenticated;

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
  -- A removed row (0124): this party pays the standard price.
  if public.rate_plan_occupancy_is_standard(p_rate_plan_id, p_room_type_id, v_adults) then
    v_adults := v_base;
  end if;
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
      return greatest(v_cents, 0);
    end if;
  end if;
  return public.rate_plan_occupancy_rate(p_rate_plan_id, p_room_type_id, p_base_cents, p_adults, p_children);
end;
$$;

create or replace function public.set_rate_plan_standard_occupancy(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_adults integer,
  p_standard boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_plan public.rate_plans;
  v_type public.room_types;
  v_list jsonb;
  v_key text := p_room_type_id::text;
begin
  if not coalesce(public.is_revenue_staff(), false) then
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
  select * into v_type from public.room_types
  where id = p_room_type_id and property_id = v_property;
  if not found then
    raise exception 'That room type is not on this property';
  end if;

  if v_plan.parent_rate_plan_id is not null then
    raise exception '% is derived from another rate plan, so its occupancy prices follow that plan', v_plan.name;
  end if;
  if p_adults is null or p_adults < 1 or p_adults > v_type.max_occupancy then
    raise exception '% sleeps % at most', coalesce(v_type.display_name, v_type.name), v_type.max_occupancy;
  end if;
  if p_adults = least(greatest(v_type.base_occupancy, 1), v_type.max_occupancy) then
    raise exception 'The price for % adults is the standard price on %, so it cannot be removed',
      p_adults, coalesce(v_type.display_name, v_type.name);
  end if;

  select coalesce(jsonb_agg(a order by a), '[]'::jsonb) into v_list
  from (
    select distinct value::integer as a
    from jsonb_array_elements_text(coalesce(v_plan.standard_occupancies -> v_key, '[]'::jsonb))
    where value::integer <> p_adults
    union
    select p_adults where p_standard
  ) s;

  update public.rate_plans
  set standard_occupancies = case
        when jsonb_array_length(v_list) = 0 then standard_occupancies - v_key
        else jsonb_set(standard_occupancies, array[v_key], v_list)
      end
  where id = v_plan.id;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'rate_plan', v_plan.id,
    case when p_standard then 'occupancy_removed' else 'occupancy_restored' end,
    case when p_standard
      then format('Rate plan %s: the %s adults price removed on %s', v_plan.name, p_adults, coalesce(v_type.display_name, v_type.name))
      else format('Rate plan %s: the %s adults price restored on %s', v_plan.name, p_adults, coalesce(v_type.display_name, v_type.name))
    end,
    jsonb_build_object('room_type_id', p_room_type_id, 'adults', p_adults)
  );
end;
$$;

revoke all on function public.set_rate_plan_standard_occupancy(uuid, uuid, integer, boolean) from public;
revoke execute on function public.set_rate_plan_standard_occupancy(uuid, uuid, integer, boolean) from anon;
grant execute on function public.set_rate_plan_standard_occupancy(uuid, uuid, integer, boolean) to authenticated;

-- 5. A combination removed and added again starts with every row.
create or replace function public.remove_rate_combination(
  p_rate_plan_id uuid,
  p_room_type_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_plan public.rate_plans;
  v_parent text;
  v_type text;
  v_today date;
  v_nights integer;
begin
  if not coalesce(public.is_revenue_staff(), false) then
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

  select coalesce(display_name, name) into v_type from public.room_types
  where id = p_room_type_id and property_id = v_property;
  if v_type is null then
    raise exception 'That room type is not on this property';
  end if;

  if v_plan.parent_rate_plan_id is not null then
    select name into v_parent from public.rate_plans where id = v_plan.parent_rate_plan_id;
    raise exception '% is derived from %, so it is sold on every room type % is. Remove % from % instead.',
      v_plan.name, v_parent, v_parent, v_parent, v_type;
  end if;

  v_today := public.open_business_date(v_property);
  if v_today is null then
    raise exception 'There is no open business date';
  end if;

  -- The price first, on its own: the push trigger fires on rate_cents and
  -- clears the same nights on every derived plan.
  update public.rate_plan_days
  set rate_cents = null,
      min_stay_through = null,
      min_stay_arrival = null,
      max_stay = null,
      closed_to_arrival = false,
      closed_to_departure = false,
      stop_sell = false,
      updated_by = auth.uid()
  where property_id = v_property
    and rate_plan_id = v_plan.id
    and room_type_id = p_room_type_id
    and stay_date >= v_today;
  get diagnostics v_nights = row_count;

  -- Now empty rows: nothing left on them to keep.
  delete from public.rate_plan_days
  where property_id = v_property
    and rate_plan_id = v_plan.id
    and room_type_id = p_room_type_id
    and stay_date >= v_today;

  delete from public.rate_plan_occupancy_days
  where property_id = v_property
    and rate_plan_id = v_plan.id
    and room_type_id = p_room_type_id
    and stay_date >= v_today;

  delete from public.rate_plan_week_rates
  where property_id = v_property
    and rate_plan_id = v_plan.id
    and room_type_id = p_room_type_id;

  -- 0124: a combination added again starts with every occupancy row.
  update public.rate_plans
  set standard_occupancies = standard_occupancies - p_room_type_id::text
  where id = v_plan.id;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'rate_plan', v_plan.id, 'rate_combination_removed',
    format('Rate plan %s removed from %s', v_plan.name, v_type),
    jsonb_build_object('room_type_id', p_room_type_id, 'from', v_today, 'nights_cleared', v_nights)
  );

  return v_nights;
end;
$$;
