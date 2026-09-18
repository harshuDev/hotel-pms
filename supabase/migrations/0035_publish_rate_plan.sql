-- Publishing a rate plan.
--
-- 0034 added rate_plans.is_public and nothing could set it, so the guest
-- booking page had no way to ever show anything: public_rate_plans() returns
-- only published plans, and the page is a 404 when there are none. A flag with
-- no path to it is the same bug as save_room() being shipped uncalled.
--
-- Deliberately its own function rather than a general rate plan editor. What
-- this changes is who can see a price, which is a different kind of decision
-- from renaming a plan, and it reads as one line at the call site: publish, or
-- do not.

create function public.set_rate_plan_public(
  p_rate_plan_id uuid,
  p_is_public boolean
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can publish a rate';
  end if;

  if p_is_public is null then
    raise exception 'Say whether this rate is published or not';
  end if;

  v_property := public.current_property_id();

  update public.rate_plans set
    is_public = p_is_public
  where id = p_rate_plan_id and property_id = v_property
  returning id into v_id;

  if v_id is null then
    raise exception 'That rate plan is not on this property';
  end if;

  return p_is_public;
end;
$$;

revoke all on function public.set_rate_plan_public(uuid, boolean) from public, anon;
grant execute on function public.set_rate_plan_public(uuid, boolean) to authenticated;
