-- 0153: a removed occupancy pays the plan's DEFAULT occupancy price.
--
-- 0124 let a hotel remove an occupancy row from a per-person plan: "that
-- party pays the standard price". The standard price was `rate_cents`, the
-- room type's Sleeps figure. 0136 then let a plan's default occupancy differ
-- from Sleeps, and the main row the hotel types became the DEFAULT party's
-- price -- but a removed party went on paying the Sleeps price.
--
-- Shitaye Suite Hotel, NR-B&B, Four Bedroom Apartment: sleeps 8, default 4,
-- 1-3 removed. 4 adults paid 520.00 and 1, 2 or 3 adults 640.00, the
-- 8-adult price -- on bookings, on the guest page and on what Channex was
-- sent for Expedia's 1-3 occupancies.
--
-- The standard price is now the default occupancy's price: that party's own
-- price on the night if one is stored, else worked out from Sleeps, exactly
-- as the default party itself is priced. Where the default IS Sleeps --
-- every plan before 0136 and most since -- nothing changes.

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
    select least(
      greatest(
        coalesce(rp.default_occupancies ->> rt.id::text, par.default_occupancies ->> rt.id::text)::integer,
        1),
      greatest(coalesce(rt.max_occupancy, 1), 1)
    ) as dflt
  ) df
  where rp.id = p_rate_plan_id;
$$;

revoke all on function public.rate_plan_standard_adults(uuid, uuid) from public;
revoke execute on function public.rate_plan_standard_adults(uuid, uuid) from anon;
revoke execute on function public.rate_plan_standard_adults(uuid, uuid) from authenticated;

create or replace function public.rate_plan_occupancy_rate(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_rate_cents bigint,
  p_adults integer,
  p_children integer
) returns bigint
language plpgsql stable security definer
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
  -- A removed row (0124) pays the standard price: the default party's (0153).
  if public.rate_plan_occupancy_is_standard(p_rate_plan_id, p_room_type_id, v_adults) then
    v_adults := coalesce(public.rate_plan_standard_adults(p_rate_plan_id, p_room_type_id), v_base);
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
) returns bigint
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_plan public.rate_plans;
  v_cents bigint;
  v_adults integer := p_adults;
begin
  if p_rate_plan_id is null or p_base_cents is null then
    return p_base_cents;
  end if;
  select * into v_plan from public.rate_plans where id = p_rate_plan_id;
  if not found then
    return p_base_cents;
  end if;
  -- A removed row (0124) is priced as the default party (0153), its own
  -- stored price included.
  if v_adults is not null and v_plan.occupancy_pricing <> 'single'
     and public.rate_plan_occupancy_is_standard(p_rate_plan_id, p_room_type_id, v_adults) then
    v_adults := public.rate_plan_standard_adults(p_rate_plan_id, p_room_type_id);
  end if;
  if v_adults is not null and v_plan.occupancy_pricing <> 'single' then
    select o.rate_cents into v_cents
    from public.rate_plan_occupancy_days o
    where o.rate_plan_id = coalesce(v_plan.parent_rate_plan_id, v_plan.id)
      and o.room_type_id = p_room_type_id
      and o.stay_date = p_stay_date
      and o.adults = v_adults;
    if found then
      if v_plan.parent_rate_plan_id is not null then
        v_cents := public.rate_plan_derived_rate(
          v_cents, v_plan.derived_kind, v_plan.derived_percent_bps, v_plan.derived_amount_cents
        );
      end if;
      if v_plan.occupancy_pricing = 'per_person' then
        v_cents := v_cents + greatest(coalesce(p_children, 0), 0) * v_plan.child_adjust_cents;
      end if;
      return public.rate_plan_to_base(p_rate_plan_id, greatest(v_cents, 0));
    end if;
  end if;
  return public.rate_plan_to_base(
    p_rate_plan_id,
    public.rate_plan_occupancy_rate(p_rate_plan_id, p_room_type_id, p_base_cents, v_adults, p_children)
  );
end;
$$;

-- Channex's per-occupancy prices (0151) are rate_plan_night_rate() without the
-- currency conversion, set-wise. Change one, change both: a removed party is
-- looked up and worked out as the standard party, the expression above.
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
    select least(
      greatest(
        coalesce(rp.default_occupancies ->> rt.id::text, par.default_occupancies ->> rt.id::text)::integer,
        1),
      greatest(coalesce(rt.max_occupancy, 1), 1)
    ) as dflt
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

-- The default party IS the standard price, so it cannot be removed; and a
-- party made the default is priced again.
create or replace function public.set_rate_plan_standard_occupancy(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_adults integer,
  p_standard boolean
) returns void
language plpgsql security definer
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
  if p_standard and (
       p_adults = least(greatest(v_type.base_occupancy, 1), v_type.max_occupancy)
       or p_adults = public.rate_plan_standard_adults(v_plan.id, v_type.id)
     ) then
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

create or replace function public.set_rate_plan_default_occupancy(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_adults integer
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_property uuid;
  v_plan public.rate_plans;
  v_type public.room_types;
  v_key text := p_room_type_id::text;
  v_list jsonb;
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

  if p_adults is not null and (p_adults < 1 or p_adults > v_type.max_occupancy) then
    raise exception '% sleeps % at most', coalesce(v_type.display_name, v_type.name), v_type.max_occupancy;
  end if;

  -- The default party is priced, so it comes off the removed list.
  select coalesce(jsonb_agg(value::integer order by value::integer), '[]'::jsonb) into v_list
  from jsonb_array_elements_text(coalesce(v_plan.standard_occupancies -> v_key, '[]'::jsonb))
  where p_adults is null or value::integer <> p_adults;

  update public.rate_plans
  set default_occupancies = case
        when p_adults is null
          or p_adults = least(greatest(v_type.base_occupancy, 1), v_type.max_occupancy)
          then default_occupancies - v_key
        else jsonb_set(default_occupancies, array[v_key], to_jsonb(p_adults))
      end,
      standard_occupancies = case
        when jsonb_array_length(v_list) = 0 then standard_occupancies - v_key
        else jsonb_set(standard_occupancies, array[v_key], v_list)
      end
  where id = v_plan.id;
end;
$$;
