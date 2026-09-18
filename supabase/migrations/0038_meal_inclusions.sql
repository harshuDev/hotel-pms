-- What a rate includes, and the Meal report.
--
-- The last <ComingSoon /> in the nav. It needed a model of what a rate
-- includes, which is the same piece of work a "rate includes breakfast"
-- promotion would have needed, and 0037 supplied the missing half by recording
-- which plan a stay was sold on.

create type public.meal_type as enum ('breakfast', 'lunch', 'dinner');

-- No board-type enum. "Half board" IS two rows here and "B&B" is one, which
-- handles a hotel that includes dinner but not breakfast without anybody
-- adding an enum value for it.
--
-- No value columns. The decision was that an included meal is worth nothing on
-- the folio, so there is no figure to carry. Reporting F&B revenue separately
-- — a £120 B&B night read as £105 accommodation plus £15 food — would add
-- adult_value_cents and child_value_cents here and change how the night audit
-- posts. That is a different decision and it restates every historic revenue
-- figure, so it is not smuggled in as a nullable column nobody set.

create table public.rate_plan_meals (
  property_id uuid not null references public.properties(id) on delete restrict,
  rate_plan_id uuid not null,
  meal public.meal_type not null,
  created_at timestamptz not null default now(),
  primary key (rate_plan_id, meal),
  foreign key (rate_plan_id, property_id)
    references public.rate_plans (id, property_id) on delete restrict
);

comment on table public.rate_plan_meals is
  'Which meals a rate plan includes. One row per plan per meal; the set is the board type.';

alter table public.rate_plan_meals enable row level security;

-- Read by every member of staff: a kitchen list is not commercially sensitive
-- and the report is the point of it. Changed by revenue staff only, like the
-- rates themselves.
create policy rate_plan_meals_select_same_property on public.rate_plan_meals
  for select using (property_id = public.current_property_id());
create policy rate_plan_meals_insert_revenue on public.rate_plan_meals
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy rate_plan_meals_delete_revenue on public.rate_plan_meals
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );


-- Setting the board for a plan -------------------------------------------------
--
-- Takes the whole set rather than one meal at a time, because "this plan is
-- half board" is one decision and applying it as two calls leaves a moment
-- where the plan is bed and breakfast.

create function public.set_rate_plan_meals(
  p_rate_plan_id uuid,
  p_meals public.meal_type[]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_count integer;
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

  delete from public.rate_plan_meals
  where rate_plan_id = p_rate_plan_id and property_id = v_property;

  insert into public.rate_plan_meals (property_id, rate_plan_id, meal)
  select v_property, p_rate_plan_id, m
  from unnest(coalesce(p_meals, '{}'::public.meal_type[])) as m
  on conflict do nothing;

  select count(*) into v_count
  from public.rate_plan_meals
  where rate_plan_id = p_rate_plan_id and property_id = v_property;

  return v_count;
end;
$$;


-- The report -------------------------------------------------------------------
--
-- Covers per meal per service date, which is what a kitchen orders against.
--
-- Derived from the booking rather than from the folio, deliberately. An
-- included meal is worth nothing, so posting one would put ~650,000 zero-value
-- rows a year into an append-only table to say something the booking already
-- says. More to the point, the night audit only posts nights that have passed,
-- and a chef needs tomorrow's number: reading the booking gives forward dates
-- for free. If meals ever carry a value, the posting starts to matter and this
-- becomes two things rather than one.
--
-- **Breakfast on the 5th is eaten by guests who stayed the night of the 4th.**
-- Lunch and dinner are served on the night's own date. Get that backwards and
-- every arrival and departure day is wrong by exactly one service, which looks
-- fine in testing and annoys a chef every morning.
--
-- Canceled and no-show nights are excluded, as they are everywhere else.
-- Nights on a booking with no rate plan recorded — anything taken before 0037
-- — contribute nothing, because nothing says what those rates included.

create function public.meal_report(p_from date, p_to date)
returns table (
  service_date date,
  meal public.meal_type,
  adult_covers bigint,
  child_covers bigint,
  total_covers bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    served.service_date,
    served.meal,
    sum(served.adults)::bigint,
    sum(served.children)::bigint,
    sum(served.adults + served.children)::bigint
  from (
    select
      case rpm.meal
        when 'breakfast' then n.stay_date + 1
        else n.stay_date
      end as service_date,
      rpm.meal,
      br.adults,
      br.children
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    join public.rate_plan_meals rpm
      on rpm.rate_plan_id = br.rate_plan_id and rpm.property_id = br.property_id
    where n.property_id = public.current_property_id()
      and n.status not in ('canceled', 'no_show')
  ) served
  where served.service_date >= p_from
    and served.service_date <= p_to
  group by served.service_date, served.meal
  order by served.service_date, served.meal;
$$;

comment on function public.meal_report(date, date) is
  'Covers per meal per service date. Breakfast is dated the morning after the night stayed.';

revoke all on function public.set_rate_plan_meals(uuid, public.meal_type[]) from public, anon;
revoke all on function public.meal_report(date, date) from public, anon;

grant execute on function public.set_rate_plan_meals(uuid, public.meal_type[]) to authenticated;
grant execute on function public.meal_report(date, date) to authenticated;
