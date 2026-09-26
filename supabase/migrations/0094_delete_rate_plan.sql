-- Settings -> Inventory -> Rate Plans: the reference's red bin.
--
-- A RATE PLAN CAN BE DELETED IF NOTHING WAS SOLD ON IT, and it is not the
-- default. `booking_rooms` points at a plan under `on delete restrict`, so a
-- plan a booking was sold on stays -- a reservation keeps saying what it was
-- sold as -- and is refused by name; the default is refused because a booking
-- naming no plan falls back to it. Anything else goes with its nightly prices
-- and restrictions (`rate_plan_days`, by cascade), its offer links (cascade)
-- and its meal inclusions (deleted here: that link is `on delete restrict`).
--
-- security definer, like delete_room(): the property check is the whole of
-- the isolation and is not optional.

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

  delete from public.rate_plan_meals where rate_plan_id = v_plan.id and property_id = v_property;
  delete from public.rate_plans where id = v_plan.id and property_id = v_property;
end;
$$;

revoke execute on function public.delete_rate_plan(uuid) from public, anon;
grant execute on function public.delete_rate_plan(uuid) to authenticated;
