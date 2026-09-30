-- 0115: the rate plan form's Meal Type and Sell With Extras, as the reference's.
--
-- The client sent their reference's rate plan popup and asked for ours to
-- match it field for field.
--
-- 1. MEAL TYPE IS ONE CHOICE OF EIGHT: Room only, Bed and breakfast, Bed
--    only, Half board, Full board, All inclusive, Custom Meal Plan, Self
--    Catering -- `rate_plans.meal_plan`. It used to be three tickboxes
--    (breakfast, lunch, dinner), which cannot say "bed only" or "all
--    inclusive" at all.
--    - `rate_plan_meals` stays what the MEALS are, because the meal report
--      and the night audit's meal split read it. The choice decides the
--      rows: none for room only, bed only and self catering; breakfast for
--      bed and breakfast; breakfast and dinner for half board; all three for
--      full board and all inclusive; the ticked ones for Custom Meal Plan.
--      So the two can never disagree, and a meal's value (0041) is kept when
--      the meal stays.
--    - Existing plans are given the choice their meals already say; a set
--      no named board matches (lunch alone, say) becomes Custom.
-- 2. SELL WITH EXTRAS is `rate_plan_extras`: which catalog extras are sold
--    with the rate. STORED, NOT YET CHARGED -- nothing posts an extra because
--    of a rate. Deciding when that would post (at booking, per night, at
--    check-in) and at what price is a money rule to be asked for.
--    - An extra that is deleted comes off every plan; one MERGED into
--      another hands its plans to the extra it was merged into.

-- ---------------------------------------------------------------------------
-- 1. Meal type
-- ---------------------------------------------------------------------------

alter table public.rate_plans
  add column meal_plan text not null default 'room_only'
    constraint rate_plans_meal_plan_known check (meal_plan in (
      'room_only', 'bed_and_breakfast', 'bed_only', 'half_board',
      'full_board', 'all_inclusive', 'custom', 'self_catering'
    ));

comment on column public.rate_plans.meal_plan is
  'The reference''s Meal Type (0115). rate_plan_meals holds the meals it means.';

update public.rate_plans rp
set meal_plan = case
  when not m.b and not m.l and not m.d then 'room_only'
  when m.b and not m.l and not m.d then 'bed_and_breakfast'
  when m.b and not m.l and m.d then 'half_board'
  when m.b and m.l and m.d then 'full_board'
  else 'custom'
end
from (
  select p.id,
    coalesce(bool_or(rpm.meal = 'breakfast'), false) as b,
    coalesce(bool_or(rpm.meal = 'lunch'), false) as l,
    coalesce(bool_or(rpm.meal = 'dinner'), false) as d
  from public.rate_plans p
  left join public.rate_plan_meals rpm on rpm.rate_plan_id = p.id
  group by p.id
) m
where m.id = rp.id;

create or replace function public.set_rate_plan_meal_plan(
  p_rate_plan_id uuid,
  p_meal_plan text,
  p_meals public.meal_type[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid;
  v_meals public.meal_type[];
begin
  if not coalesce(public.is_revenue_staff(), false) then
    raise exception 'Only managers and administrators can change what a rate includes';
  end if;
  v_property := public.current_property_id();

  if not exists (
    select 1 from public.rate_plans rp
    where rp.id = p_rate_plan_id and rp.property_id = v_property
  ) then
    raise exception 'That rate plan is not on this property';
  end if;

  v_meals := case p_meal_plan
    when 'room_only' then '{}'::public.meal_type[]
    when 'bed_only' then '{}'::public.meal_type[]
    when 'self_catering' then '{}'::public.meal_type[]
    when 'bed_and_breakfast' then array['breakfast']::public.meal_type[]
    when 'half_board' then array['breakfast', 'dinner']::public.meal_type[]
    when 'full_board' then array['breakfast', 'lunch', 'dinner']::public.meal_type[]
    when 'all_inclusive' then array['breakfast', 'lunch', 'dinner']::public.meal_type[]
    when 'custom' then coalesce(p_meals, '{}'::public.meal_type[])
  end;
  if v_meals is null then
    raise exception 'Choose a meal type';
  end if;

  -- The same writes as set_rate_plan_meals(): a meal that stays keeps its
  -- value, one that goes is removed, one that arrives has none yet.
  delete from public.rate_plan_meals
  where rate_plan_id = p_rate_plan_id
    and property_id = v_property
    and not (meal = any (v_meals));

  insert into public.rate_plan_meals (property_id, rate_plan_id, meal)
  select v_property, p_rate_plan_id, m
  from unnest(v_meals) as m
  on conflict do nothing;

  update public.rate_plans
  set meal_plan = p_meal_plan, updated_at = now()
  where id = p_rate_plan_id and property_id = v_property;
end;
$$;

revoke all on function public.set_rate_plan_meal_plan(uuid, text, public.meal_type[]) from public, anon;
grant execute on function public.set_rate_plan_meal_plan(uuid, text, public.meal_type[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Sell With Extras
-- ---------------------------------------------------------------------------

create table public.rate_plan_extras (
  property_id uuid not null references public.properties (id) on delete restrict,
  rate_plan_id uuid not null references public.rate_plans (id) on delete cascade,
  extra_id uuid not null references public.extras (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (rate_plan_id, extra_id)
);

create index rate_plan_extras_extra_idx on public.rate_plan_extras (extra_id);
create index rate_plan_extras_property_idx on public.rate_plan_extras (property_id);

alter table public.rate_plan_extras enable row level security;

-- Read by anyone on the property; written only through
-- set_rate_plan_extras(), so there is no write policy and RLS refuses them.
create policy rate_plan_extras_select_same_property on public.rate_plan_extras
  for select using (property_id = public.current_property_id());

-- The whole set at once, like set_rate_plan_meals(): "this rate is sold with
-- these" is one decision.
create or replace function public.set_rate_plan_extras(
  p_rate_plan_id uuid,
  p_extra_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid;
  v_ids uuid[] := coalesce(p_extra_ids, '{}'::uuid[]);
begin
  if not coalesce(public.is_revenue_staff(), false) then
    raise exception 'Only managers and administrators can change what a rate includes';
  end if;
  v_property := public.current_property_id();

  if not exists (
    select 1 from public.rate_plans rp
    where rp.id = p_rate_plan_id and rp.property_id = v_property
  ) then
    raise exception 'That rate plan is not on this property';
  end if;

  if exists (
    select 1 from unnest(v_ids) as x(id)
    where not exists (
      select 1 from public.extras e where e.id = x.id and e.property_id = v_property
    )
  ) then
    raise exception 'That extra is not on this property';
  end if;

  delete from public.rate_plan_extras
  where rate_plan_id = p_rate_plan_id
    and not (extra_id = any (v_ids));

  insert into public.rate_plan_extras (property_id, rate_plan_id, extra_id)
  select v_property, p_rate_plan_id, x
  from unnest(v_ids) as x
  on conflict do nothing;
end;
$$;

revoke all on function public.set_rate_plan_extras(uuid, uuid[]) from public, anon;
grant execute on function public.set_rate_plan_extras(uuid, uuid[]) to authenticated;

-- merge_extra(): the merged-away extra's plans move to the one kept, before
-- the delete would cascade them away. Otherwise as 0071.
create or replace function public.merge_extra(p_source_id uuid, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_source public.extras;
  v_target public.extras;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the extras';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_source_id is null or p_target_id is null then
    raise exception 'Choose the extra to merge into';
  end if;
  if p_source_id = p_target_id then
    raise exception 'An extra cannot be merged into itself';
  end if;

  select * into v_source from public.extras
  where id = p_source_id and property_id = v_property
  for update;
  if not found then
    raise exception 'That extra no longer exists';
  end if;

  select * into v_target from public.extras
  where id = p_target_id and property_id = v_property;
  if not found then
    raise exception 'The extra to merge into no longer exists';
  end if;

  insert into public.rate_plan_extras (property_id, rate_plan_id, extra_id)
  select rpe.property_id, rpe.rate_plan_id, v_target.id
  from public.rate_plan_extras rpe
  where rpe.extra_id = v_source.id
  on conflict do nothing;

  delete from public.extras where id = v_source.id;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'extra', v_target.id, 'extras_merged',
    format('Extra %s merged into %s', v_source.title, v_target.title),
    jsonb_build_object(
      'kept_id', v_target.id,
      'kept_title', v_target.title,
      'merged_id', v_source.id,
      'merged_title', v_source.title,
      'merged_price_cents', v_source.price_cents,
      'merged_item_type', v_source.item_type
    )
  );
end;
$$;
revoke execute on function public.merge_extra(uuid, uuid) from public, anon;
grant execute on function public.merge_extra(uuid, uuid) to authenticated;
