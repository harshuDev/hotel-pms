-- 0054: the hotel creates its own rate plans, and the Rates grid shows them
-- all under each room type.
--
-- The client: "the hotels have different rates. Let's say bed and breakfast,
-- room only, non-refundable ... the hotel have to be able to create the rates,
-- and this rate will be linked with the different room types ... when you click
-- on rates you will see the room and then below the room all the rates and then
-- you will be able to change the price on those rates."
--
-- THE LINK THEY DESCRIBE ALREADY EXISTS. `rate_plan_days` is keyed (plan, room
-- type, night), so a plan has always been priced per room type per date. What
-- was missing is on top of it:
--
--   * A plan could be CREATED but never edited. `create_rate_plan()` has no
--     rename, no retire, no reorder, and lives in a corner of the Inventory
--     screen rather than anywhere a hotel would look to set one up.
--   * The Rates grid took ONE plan at a time behind a picker, with room types
--     down the side. So a hotel with Room Only, B&B and Non-refundable had to
--     visit the screen three times to price one room type, and could never see
--     the three prices next to each other -- which is the comparison anybody
--     setting rates is actually making.
--
-- NOTE ON "NON-REFUNDABLE": that is a cancellation policy attached to a plan,
-- and there is no cancellation policy table yet. A plan can be NAMED
-- Non-refundable today and priced like one; the rule that actually refuses a
-- refund needs the Cancellation Policy screen, which is still to build. Not
-- smuggled in here.

/* -------------------------------------------------------------------------- */
/* Creating and correcting a rate plan                                        */
/* -------------------------------------------------------------------------- */

/*
 * One function for both, like `save_customer()` and `save_room()`: a null id
 * creates, an id corrects. Two functions would be two places to keep the
 * one-default rule in step.
 *
 * `create_rate_plan()` is left in place and still works. It is what the
 * Inventory screen calls today, and breaking it to rename it would be churn
 * for no user-visible gain.
 */
create function public.save_rate_plan(
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

comment on function public.save_rate_plan(text, text, text, boolean, boolean, uuid) is
  'Create or correct a rate plan. Revenue staff only. There is no delete: rate_plan_days and bookings point at a plan, so a plan no longer sold is is_active = false.';


/* -------------------------------------------------------------------------- */
/* The Rates grid: every plan, under every room type                          */
/* -------------------------------------------------------------------------- */

/*
 * `inventory_grid()` takes one plan and returns room types. This returns the
 * cross of both, so the screen can draw a room type and then every plan under
 * it with the price on each.
 *
 * WHY A SECOND FUNCTION rather than relaxing the first: `inventory_grid()`
 * feeds nine other screens that are each about ONE field across room types,
 * and every one of them would have to grow a plan dimension it has no use for.
 * This one is about one field -- the rate -- across two dimensions. They are
 * different questions.
 *
 * ONLY THE RATE COMES BACK, not the stay rules. The restrictions have their own
 * screens and a cell here showing six values would be unreadable; "All" already
 * exists for seeing everything at once on one plan.
 *
 * A NULL RATE IS NOT ZERO. It means this plan is not loaded for that room type
 * on that night, and `create_booking()` refuses a stay against it. That is also
 * how a hotel says "this plan is not sold on this room type" -- which is the
 * linkage between plans and room types the client described, expressed as the
 * absence of a price rather than as a second table nobody would remember to
 * fill in.
 */
create function public.inventory_rates_grid(
  p_from date,
  p_days integer default 28
)
returns table (
  rate_plan_id uuid,
  rate_plan_code text,
  rate_plan_name text,
  rate_plan_is_default boolean,
  rate_plan_sort integer,
  room_type_id uuid,
  room_type_code text,
  room_type_name text,
  room_type_sort integer,
  date date,
  rate_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $function$
  with days as (
    select d::date as day
    from generate_series(
      p_from,
      p_from + (greatest(coalesce(p_days, 28), 1) - 1),
      interval '1 day'
    ) as d
  ),
  plans as (
    select rp.id, rp.code, rp.name, rp.is_default, rp.sort_order
    from public.rate_plans rp
    where rp.property_id = public.current_property_id()
      and rp.is_active
  ),
  types as (
    select rt.id, rt.code, rt.name, rt.sort_order
    from public.room_types rt
    where rt.property_id = public.current_property_id()
  )
  select
    p.id,
    p.code,
    p.name,
    p.is_default,
    p.sort_order,
    t.id,
    t.code,
    t.name,
    t.sort_order,
    d.day,
    rpd.rate_cents
  from types t
  cross join plans p
  cross join days d
  left join public.rate_plan_days rpd
    on rpd.property_id = public.current_property_id()
   and rpd.rate_plan_id = p.id
   and rpd.room_type_id = t.id
   and rpd.stay_date = d.day
  -- Room type first, because that is the grouping the screen draws.
  order by t.sort_order, t.name, p.sort_order, p.name, d.day;
$function$;

comment on function public.inventory_rates_grid(date, integer) is
  'Every active rate plan crossed with every room type and night, with the rate on each. Feeds the Rates screen, which nests plans under room types.';


/* -------------------------------------------------------------------------- */
/* Grants                                                                     */
/* -------------------------------------------------------------------------- */

revoke all on function public.save_rate_plan(text, text, text, boolean, boolean, uuid)
  from public, anon;
revoke all on function public.inventory_rates_grid(date, integer) from public, anon;

grant execute on function public.save_rate_plan(text, text, text, boolean, boolean, uuid)
  to authenticated;
grant execute on function public.inventory_rates_grid(date, integer) to authenticated;
