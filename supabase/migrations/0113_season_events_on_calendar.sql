-- 0113: Seasons & Events -- events on the PMS calendar, and a range's dates
-- can be corrected.
--
-- The client asked for a Seasons & Events screen: a season or an event with a
-- name, a colour and From/To dates, listed in Settings, editable, deletable,
-- and visible on the PMS calendar over its dates. 0095 built all of that
-- except two things:
--
--   * EVENTS NEVER REACHED THE CALENDAR. calendar_seasons() returned seasons
--     only, on the grounds that one band cannot draw two things on one day.
--     It now returns events too, with their kind, and the board draws them in
--     a lane of their own under the season band -- so a season still owns the
--     band and an event, which may overlap anything, never has to share it.
--   * A RANGE COULD NOT BE EDITED, only deleted and added again.
--     update_season_range() moves one range's dates in place, with the same
--     checks add_season_range() makes: revenue staff, this property, a start
--     and an end in order, and a season never overlapping another season --
--     now not counting itself, or moving a range by a day would clash with its
--     own old dates.
--
-- A season still changes no price by itself. As add_season_range() does since
-- 0110, a season's saved week rates are applied to its new dates. Nights the
-- range no longer covers keep the prices they have, exactly as deleting a
-- range leaves them: nothing here rewrites a price a person may have set.

-- 1. calendar_seasons(): seasons and events, with the kind. The return shape
--    changes, so drop and recreate.
drop function public.calendar_seasons(date, integer);

create function public.calendar_seasons(p_from date, p_days integer default 14)
returns table (id uuid, name text, starts_on date, ends_on date, color text, kind text)
language sql
stable
set search_path = public
as $$
  select s.id, t.name, s.starts_on, s.ends_on, t.color, s.kind
  from public.seasons s
  join public.season_types t on t.id = s.season_type_id and t.property_id = s.property_id
  where s.property_id = public.current_property_id()
    and s.starts_on < (p_from + greatest(coalesce(p_days, 14), 1))
    and s.ends_on >= p_from
  order by s.kind desc, s.starts_on, t.name;
$$;

revoke execute on function public.calendar_seasons(date, integer) from public, anon;
grant execute on function public.calendar_seasons(date, integer) to authenticated;

-- 2. update_season_range(): one range's dates, in place.
create function public.update_season_range(
  p_id uuid,
  p_starts_on date,
  p_ends_on date
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_property uuid;
  v_range public.seasons;
  v_clash record;
  v_pair record;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change seasons';
  end if;
  v_property := public.current_property_id();
  select * into v_range from public.seasons
  where id = p_id and property_id = v_property;
  if not found then
    raise exception 'Those dates are not on this property';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'Choose the start and the end';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'It cannot end before it starts';
  end if;

  if v_range.kind = 'season' then
    select t.name, s.starts_on, s.ends_on into v_clash
    from public.seasons s
    join public.season_types t on t.id = s.season_type_id
    where s.property_id = v_property and s.kind = 'season'
      and s.id <> v_range.id
      and daterange(s.starts_on, s.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
    order by s.starts_on
    limit 1;
    if found then
      raise exception 'That overlaps % (% - %). Seasons cannot overlap.',
        v_clash.name, to_char(v_clash.starts_on, 'FMDD Mon YYYY'), to_char(v_clash.ends_on, 'FMDD Mon YYYY');
    end if;
  end if;

  update public.seasons
  set starts_on = p_starts_on, ends_on = p_ends_on
  where id = v_range.id and property_id = v_property;

  -- The season's saved week rates follow it onto its new dates (0110's rule
  -- for added dates). save_week_rates() writes every range of the season, so
  -- the unchanged ranges are rewritten with the prices they already carry.
  if v_range.kind = 'season' then
    for v_pair in
      select w.rate_plan_id, w.room_type_id,
             jsonb_agg(jsonb_build_object(
               'weekday', w.weekday, 'rate_cents', w.rate_cents,
               'min_stay_through', w.min_stay_through, 'min_stay_arrival', w.min_stay_arrival,
               'max_stay', w.max_stay, 'closed_to_arrival', w.closed_to_arrival,
               'closed_to_departure', w.closed_to_departure, 'stop_sell', w.stop_sell,
               'occupancy_rates', w.occupancy_rates
             )) as days
      from public.rate_plan_week_rates w
      join public.rate_plans rp on rp.id = w.rate_plan_id and rp.is_active
      where w.property_id = v_property and w.season_type_id = v_range.season_type_id
      group by w.rate_plan_id, w.room_type_id
    loop
      perform public.save_week_rates(v_pair.rate_plan_id, v_pair.room_type_id, v_range.season_type_id, v_pair.days, true);
    end loop;
  end if;
end;
$$;

revoke all on function public.update_season_range(uuid, date, date) from public, anon;
grant execute on function public.update_season_range(uuid, date, date) to authenticated;
