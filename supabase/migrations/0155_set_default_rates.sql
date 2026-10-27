-- 0155: Inventory -> Rates prices a per-person plan from its DEFAULT occupancy.
--
-- The Rates grid drew each plan's main row at the room type's Sleeps figure
-- and wrote it to rate_cents. Since 0136 a per-person plan's default
-- occupancy can be below Sleeps, and the plan's own form and Room Rate
-- Combinations type the price there and work every other party out from it.
-- The grid did neither: Shitaye's Four Bedroom Apartment (Sleeps 8, default
-- 4) showed its plans as "8 adults", and typing a new 4-adult price changed
-- that one party while 5-8 kept their old prices. The client: "The default
-- rate/occupancy should be 4Pax. Instead it's showing 8Pax ... now we cannot
-- change the rate."
--
-- set_default_rates() takes the DEFAULT party's price and writes what the
-- plan's form would: the Sleeps price into rate_plan_days.rate_cents and
-- every other party that is not removed (0124) into rate_plan_occupancy_days,
-- each worked out per person from the default. Where the default IS Sleeps,
-- or the plan is not per person, it is set_rates() exactly. It calls
-- set_rates() and set_occupancy_rates(), so the role check, the derived-plan
-- refusal and the past-night rules are theirs, and runs in one transaction.

create or replace function public.set_default_rates(
  p_rate_plan_id uuid,
  p_room_type_ids uuid[],
  p_from date,
  p_to date,
  p_days_of_week integer[] default null,
  p_rate_cents bigint default null
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_plan public.rate_plans;
  v_type record;
  v_def integer;
  v_up bigint;
  v_down bigint;
  v_count integer := 0;
  v_n integer;
  v_a integer;
  v_price bigint;
begin
  if p_rate_cents is not null and p_rate_cents < 0 then
    raise exception 'A nightly rate cannot be negative';
  end if;
  select * into v_plan from public.rate_plans where id = p_rate_plan_id;
  if v_plan.id is null then
    -- Not a plan this caller can see: set_rates() says so in its own words.
    return public.set_rates(p_rate_plan_id, p_room_type_ids, p_from, p_to, p_days_of_week, p_rate_cents);
  end if;

  for v_type in
    select rt.id, coalesce(rt.base_occupancy, 1) as base, rt.max_occupancy
    from unnest(p_room_type_ids) as t(room_type_id)
    join public.room_types rt on rt.id = t.room_type_id and rt.property_id = v_plan.property_id
  loop
    v_def := v_type.base;
    -- The plan's default occupancy, as rate_plan_standard_adults() reads it
    -- (a derived plan is refused by set_rates(), so the parent's is not
    -- needed). Worked out from the row here: that helper is granted to nobody.
    if v_plan.occupancy_pricing = 'per_person' and v_plan.parent_rate_plan_id is null
       and (v_plan.default_occupancies ->> v_type.id::text) is not null then
      v_def := least(greatest((v_plan.default_occupancies ->> v_type.id::text)::integer, 1),
                     greatest(v_type.max_occupancy, 1));
      if coalesce(v_plan.standard_occupancies -> v_type.id::text @> to_jsonb(v_def), false) then
        v_def := v_type.base;
      end if;
    end if;

    if v_def is null or v_def = v_type.base then
      v_count := v_count + public.set_rates(
        p_rate_plan_id, array[v_type.id], p_from, p_to, p_days_of_week, p_rate_cents);
      continue;
    end if;

    v_up := coalesce(v_plan.adult_adjust_cents, 0);
    v_down := coalesce(v_plan.adult_decrease_cents, v_up);
    for v_a in 1 .. greatest(v_type.max_occupancy, 1) loop
      if v_a <> v_type.base
         and coalesce(v_plan.standard_occupancies -> v_type.id::text @> to_jsonb(v_a), false) then
        continue;
      end if;
      v_price := case
        when p_rate_cents is null then null
        when v_a >= v_def then greatest(0, p_rate_cents + (v_a - v_def) * v_up)
        else greatest(0, p_rate_cents - (v_def - v_a) * v_down)
      end;
      if v_a = v_type.base then
        v_n := public.set_rates(p_rate_plan_id, array[v_type.id], p_from, p_to, p_days_of_week, v_price);
        v_count := v_count + v_n;
      else
        perform public.set_occupancy_rates(
          p_rate_plan_id, array[v_type.id], p_from, p_to, p_days_of_week, v_a, v_price);
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.set_default_rates(uuid, uuid[], date, date, integer[], bigint) from public;
revoke execute on function public.set_default_rates(uuid, uuid[], date, date, integer[], bigint) from anon;
grant execute on function public.set_default_rates(uuid, uuid[], date, date, integer[], bigint) to authenticated;
