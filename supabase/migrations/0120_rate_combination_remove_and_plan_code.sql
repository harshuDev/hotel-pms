-- 0120: a room rate combination can be REMOVED, and a rate plan's code is the
-- hotel's to set.
--
-- 1. remove_rate_combination(plan, room type). A room type is sold on a rate
--    plan exactly when that pair has prices loaded (the Rates grid's rule, and
--    why there is no link table). "Add New Room Rate Combination" and the plan
--    form could connect a pair; nothing could disconnect one -- the only way
--    was clearing a price night by night in Inventory, and re-saving a season
--    would put them straight back from the saved week.
--    - From the open business date on, the pair's nights lose their price and
--      every restriction, and their per-occupancy prices go. Nights before it
--      are history and are left exactly as they were.
--    - The pair's saved weeks go too, in every season and the Default Season,
--      or the next season Save would re-price the nights just cleared.
--    - A derived plan follows the price: clearing the parent's rate clears
--      the child's through the existing push trigger, so a combination
--      removed from a parent is removed from its derived plans as well.
--    - A DERIVED plan cannot be removed on its own and is refused by name:
--      its prices are recomputed from its parent's on every change, so the
--      next parent edit would bring them straight back.
--    - Bookings are untouched. A booked night carries its own rate on
--      booking_room_nights, so nothing already sold is restated.
-- 2. save_rate_plan() refuses a code another plan already uses, by name,
--    rather than surfacing the unique index's raw text, and caps it at 20
--    characters. The form now shows the code; blank still means "the title's
--    initials", worked out in the browser as before.

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
revoke all on function public.remove_rate_combination(uuid, uuid) from public, anon;
grant execute on function public.remove_rate_combination(uuid, uuid) to authenticated;

-- save_rate_plan(): a taken code is refused by name. Otherwise as 0054.
create or replace function public.save_rate_plan(
  p_code text,
  p_name text,
  p_description text default null,
  p_is_default boolean default false,
  p_is_active boolean default true,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_property uuid;
  v_id uuid;
  v_code text;
  v_name text;
  v_taken text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change a rate plan';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  v_code := upper(nullif(btrim(coalesce(p_code, '')), ''));
  v_name := nullif(btrim(coalesce(p_name, '')), '');

  if v_code is null or v_name is null then
    raise exception 'A rate plan needs a code and a name';
  end if;

  if length(v_code) > 20 then
    raise exception 'A rate plan code is 20 characters at most';
  end if;

  select name into v_taken from public.rate_plans
  where property_id = v_property and code = v_code
    and (p_id is null or id <> p_id);
  if v_taken is not null then
    raise exception 'The code % is already used by %', v_code, v_taken;
  end if;

  -- One default per property, enforced by a partial unique index. Standing the
  -- old one down here rather than letting the index refuse the write.
  if coalesce(p_is_default, false) then
    update public.rate_plans set is_default = false
    where property_id = v_property and is_default
      and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into public.rate_plans (
      property_id, code, name, description, is_default, is_active, sort_order
    ) values (
      v_property, v_code, v_name,
      nullif(btrim(coalesce(p_description, '')), ''),
      coalesce(p_is_default, false),
      coalesce(p_is_active, true),
      coalesce((select max(sort_order) + 1 from public.rate_plans
                 where property_id = v_property), 0)
    )
    returning id into v_id;
  else
    update public.rate_plans
    set code = v_code,
        name = v_name,
        description = nullif(btrim(coalesce(p_description, '')), ''),
        is_default = coalesce(p_is_default, false),
        is_active = coalesce(p_is_active, true),
        updated_at = now()
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That rate plan is not on this property';
    end if;
  end if;

  -- A property with no default plan has nowhere to fall back to when a booking
  -- names none, so the last one standing keeps the flag whatever was asked for.
  if not exists (
    select 1 from public.rate_plans
    where property_id = v_property and is_default and is_active
  ) then
    update public.rate_plans set is_default = true
    where id = (
      select id from public.rate_plans
      where property_id = v_property and is_active
      order by sort_order, name
      limit 1
    );
  end if;

  return v_id;
end;
$function$;
