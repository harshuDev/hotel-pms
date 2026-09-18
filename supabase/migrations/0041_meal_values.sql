-- 0040: an included meal can carry a value, which splits the night's revenue.
--
-- Until now an included meal was worth nothing and nothing was posted, so a
-- £120 bed-and-breakfast night appeared as £120 of accommodation. Some hotels
-- need it read as £105 accommodation plus £15 food, because the kitchen is a
-- separate cost centre and F&B revenue is reported on its own.
--
-- The value is nullable and every row starts null. A null value posts exactly
-- as before — one room charge, one line, nothing about existing behaviour
-- changes — so shipping this migration does nothing at all until somebody sets
-- a figure in Inventory. That is deliberate: the split is a real accounting
-- change and it should start on a date somebody chose.
--
-- Nothing already posted is restated. folio_items is append-only, so every
-- night charged before a value was set stays as it was and the split begins
-- with the next night audit. There is no backfill and there should not be one:
-- rewriting how a historic night was composed would move revenue between two
-- buckets in months that have already been reported.
--
-- The value is per plan per meal, not per guest and not per night, matching how
-- rate_plan_meals is already keyed. A plan that includes breakfast at £15 and
-- dinner at £30 splits £45 out of every night on that plan.
--
-- Note the posting date is the night's own, while meal_report() dates breakfast
-- to stay_date + 1. Both are right and they answer different questions: the
-- folio records what the night's rate was made of, and the report counts who
-- eats when. Do not "fix" one to match the other.

alter table public.rate_plan_meals
  add column value_cents bigint
    check (value_cents is null or value_cents >= 0);

comment on column public.rate_plan_meals.value_cents is
  'What this included meal is worth, in integer minor units. Null means no '
  'value, which posts the night as a single accommodation line exactly as '
  'before. Set it and the night audit splits the room charge into '
  'accommodation and food_beverage.';

/* -------------------------------------------------------------------------- */
/* Setting the value                                                          */
/* -------------------------------------------------------------------------- */

-- One meal at a time, unlike set_rate_plan_meals() which takes the whole set.
-- These are different decisions: "this plan is half board" is one statement
-- about the plan, and "breakfast on it is worth £15" is one statement about one
-- meal. Bundling them would mean re-stating the board type to re-price a
-- breakfast.
create or replace function public.set_rate_plan_meal_value(
  p_rate_plan_id uuid,
  p_meal public.meal_type,
  p_value_cents bigint default null
)
returns bigint
language plpgsql
set search_path to 'public'
as $function$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can price what a rate includes';
  end if;

  v_property := public.current_property_id();

  if p_value_cents is not null and p_value_cents < 0 then
    raise exception 'A meal cannot be worth less than nothing';
  end if;

  update public.rate_plan_meals
  set value_cents = p_value_cents
  where rate_plan_id = p_rate_plan_id
    and meal = p_meal
    and property_id = v_property;

  if not found then
    raise exception
      'That rate plan does not include %. Add the meal before pricing it.',
      p_meal;
  end if;

  return p_value_cents;
end;
$function$;

revoke all on function public.set_rate_plan_meal_value(uuid, public.meal_type, bigint) from public;
grant execute on function public.set_rate_plan_meal_value(uuid, public.meal_type, bigint) to authenticated;

/* -------------------------------------------------------------------------- */
/* Keeping the values across a board-type change                              */
/* -------------------------------------------------------------------------- */

-- set_rate_plan_meals() deleted every row and re-inserted, which was fine when
-- the row held nothing but the meal. It would now throw the values away every
-- time somebody re-stated the board type — turning "add dinner" into "add
-- dinner and silently un-price breakfast".
--
-- It now removes only the meals that left and adds only the ones that arrived,
-- so a meal that was already on the plan keeps its price.
create or replace function public.set_rate_plan_meals(
  p_rate_plan_id uuid,
  p_meals public.meal_type[]
)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_property uuid;
  v_count integer;
  v_meals public.meal_type[];
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change what a rate includes';
  end if;

  v_property := public.current_property_id();

  if not exists (
    select 1 from public.rate_plans rp
    where rp.id = p_rate_plan_id and rp.property_id = v_property
  ) then
    raise exception 'That rate plan is not on this property';
  end if;

  v_meals := coalesce(p_meals, '{}'::public.meal_type[]);

  delete from public.rate_plan_meals
  where rate_plan_id = p_rate_plan_id
    and property_id = v_property
    and not (meal = any (v_meals));

  insert into public.rate_plan_meals (property_id, rate_plan_id, meal)
  select v_property, p_rate_plan_id, m
  from unnest(v_meals) as m
  on conflict do nothing;

  select count(*) into v_count
  from public.rate_plan_meals
  where rate_plan_id = p_rate_plan_id and property_id = v_property;

  return v_count;
end;
$function$;

/* -------------------------------------------------------------------------- */
/* Posting the split                                                          */
/* -------------------------------------------------------------------------- */

-- post_room_charge() now posts two lines when the night's rate plan includes
-- priced meals, and one when it does not.
--
-- The tax follows the money. The night carries a single tax figure, so it is
-- apportioned by net with integer division and the remainder given to
-- accommodation, which makes the two lines add up to exactly what the one line
-- used to be. No rounding is invented and no penny is lost.
--
-- The unique index that stops a night being charged twice is on room_charge
-- alone, so the food_beverage line sits alongside it without loosening that
-- guard, and a retried audit still finds the room charge and skips the night.
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

    insert into public.folio_items(
      property_id, folio_id, booking_id, booking_room_night_id, business_date,
      item_type, description, quantity, unit_amount_cents, net_amount_cents,
      tax_amount_cents, amount_cents, posted_by
    ) values (
      v_folio.property_id, v_folio.id, v_folio.booking_id,
      p_booking_room_night_id, v_date, 'room_charge',
      format('Room charge for %s', v_night.stay_date),
      1, v_acc_net, v_acc_net, v_acc_tax, v_acc_net + v_acc_tax, auth.uid()
    )
    returning id into v_id;

    insert into public.folio_items(
      property_id, folio_id, booking_id, booking_room_night_id, business_date,
      item_type, description, quantity, unit_amount_cents, net_amount_cents,
      tax_amount_cents, amount_cents, posted_by
    ) values (
      v_folio.property_id, v_folio.id, v_folio.booking_id,
      p_booking_room_night_id, v_date, 'food_beverage',
      format('Meals included in the rate for %s', v_night.stay_date),
      1, v_meal_net, v_meal_net, v_meal_tax, v_meal_net + v_meal_tax, auth.uid()
    );

    return v_id;
  end if;

  insert into public.folio_items(
    property_id, folio_id, booking_id, booking_room_night_id, business_date,
    item_type, description, quantity, unit_amount_cents, net_amount_cents,
    tax_amount_cents, amount_cents, posted_by
  ) values (
    v_folio.property_id, v_folio.id, v_folio.booking_id,
    p_booking_room_night_id, v_date, 'room_charge',
    format('Room charge for %s', v_night.stay_date),
    1, v_net, v_net, v_night.tax_cents, v_net + v_night.tax_cents, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;
