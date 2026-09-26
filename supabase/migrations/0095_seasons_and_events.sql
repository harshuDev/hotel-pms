-- Settings -> Inventory -> Seasons and Events, cloned from the client's
-- reference: a year of month grids coloured by season, "Add season or event",
-- and down the right the Seasons, the Events and the Default Season -- each
-- season or event a name and a colour with several date ranges under it.
--
-- THE MODEL. 0044 made a season one named date range. The reference makes a
-- season a NAME AND A COLOUR that owns ranges ("SUPER PEAK SEASON": 16 Dec
-- 2022 - 07 Jan 2023, 15 Dec 2023 - 07 Jan 2024, ...). So:
--   * `season_types` is the named, coloured thing, of kind season or event;
--   * `seasons` stays the ranges, now each pointing at its type, and carrying
--     the type's kind so the no-overlap rule can be scoped to it.
--   * SEASONS STILL CANNOT OVERLAP ONE ANOTHER (the exclusion constraint, now
--     `where kind = 'season'`): one day is in one season, which is what the
--     calendar band and the Default Season need. EVENTS MAY OVERLAP anything
--     -- a festival falls inside a season.
--   * THE DEFAULT SEASON IS NOT A ROW: it is every day no season covers,
--     worked out from the ranges, as the reference lists it.
--
-- READERS. The calendar's season band now fills each season in its own
-- colour (`calendar_seasons()` returns it, seasons only -- events overlap and
-- one band cannot draw two things on one day). The Settings year grid draws
-- seasons and events both. A season still CHANGES NO PRICE: rates stay in
-- `rate_plan_days` (0044's rule is unchanged).
--
-- The one existing range is kept: it becomes a season of its own name.

create table public.season_types (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('season', 'event')),
  name text not null check (btrim(name) <> '' and char_length(name) <= 80),
  color text not null default '#8a9bb0' check (color ~ '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now(),
  unique (id, property_id)
);

create unique index season_types_name_unique
  on public.season_types (property_id, kind, lower(btrim(name)));

alter table public.season_types enable row level security;

create policy season_types_select_current_property on public.season_types
  for select using (property_id = public.current_property_id());
create policy season_types_insert_revenue_staff on public.season_types
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy season_types_update_revenue_staff on public.season_types
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy season_types_delete_revenue_staff on public.season_types
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.season_types to authenticated;
revoke all on public.season_types from anon;

alter table public.seasons
  add column season_type_id uuid,
  add column kind text not null default 'season' check (kind in ('season', 'event'));

-- Each existing range becomes a season of its own name (one type per name).
insert into public.season_types (property_id, kind, name)
select distinct s.property_id, 'season', btrim(s.name)
from public.seasons s
on conflict do nothing;

update public.seasons s set season_type_id = t.id
from public.season_types t
where t.property_id = s.property_id and t.kind = 'season'
  and lower(btrim(t.name)) = lower(btrim(s.name));

alter table public.seasons
  alter column season_type_id set not null,
  add constraint seasons_type_fkey foreign key (season_type_id, property_id)
    references public.season_types (id, property_id) on delete cascade,
  drop constraint seasons_no_overlap,
  add constraint seasons_no_overlap exclude using gist (
    property_id with =, daterange(starts_on, ends_on, '[]') with &&
  ) where (kind = 'season');

-- The name lives on the type now; the column stays for 0044's constraint and
-- is kept in step by the functions below.

/* -- Writes -------------------------------------------------------------- */

drop function public.save_season(text, date, date, uuid);

create or replace function public.save_season_type(
  p_id uuid,
  p_kind text,
  p_name text,
  p_color text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_color text := lower(btrim(coalesce(p_color, '')));
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change seasons';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if coalesce(p_kind, '') not in ('season', 'event') then
    raise exception 'Choose season or event';
  end if;
  if v_name = '' then
    raise exception 'Write the name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the name to 80 characters';
  end if;
  if v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'Pick the colour from the picker';
  end if;
  if exists (
    select 1 from public.season_types t
    where t.property_id = v_property and t.kind = p_kind
      and lower(btrim(t.name)) = lower(v_name)
      and (p_id is null or t.id <> p_id)
  ) then
    raise exception 'There is already % called %', case when p_kind = 'event' then 'an event' else 'a season' end, v_name;
  end if;

  if p_id is null then
    insert into public.season_types (property_id, kind, name, color)
    values (v_property, p_kind, v_name, v_color)
    returning id into v_id;
    return v_id;
  end if;

  -- The kind is fixed once made: turning a season into an event would lift
  -- the no-overlap rule from ranges already checked against it.
  update public.season_types set name = v_name, color = v_color
  where id = p_id and property_id = v_property and kind = p_kind
  returning id into v_id;
  if v_id is null then
    raise exception 'That season or event is not on this property';
  end if;
  update public.seasons set name = v_name
  where season_type_id = v_id and property_id = v_property;
  return v_id;
end;
$$;

revoke execute on function public.save_season_type(uuid, text, text, text) from public, anon;
grant execute on function public.save_season_type(uuid, text, text, text) to authenticated;

-- Genuinely deleted with its ranges, like a season always was: nothing points
-- at one and it changes no price.
create or replace function public.delete_season_type(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change seasons';
  end if;
  delete from public.season_types
  where id = p_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That season or event is not on this property';
  end if;
end;
$$;

revoke execute on function public.delete_season_type(uuid) from public, anon;
grant execute on function public.delete_season_type(uuid) to authenticated;

create or replace function public.add_season_range(
  p_season_type_id uuid,
  p_starts_on date,
  p_ends_on date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_type public.season_types;
  v_clash record;
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change seasons';
  end if;
  v_property := public.current_property_id();
  select * into v_type from public.season_types
  where id = p_season_type_id and property_id = v_property;
  if not found then
    raise exception 'That season or event is not on this property';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'Choose the start and the end';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'It cannot end before it starts';
  end if;

  -- Say which season it overlaps rather than letting the constraint answer.
  if v_type.kind = 'season' then
    select t.name, s.starts_on, s.ends_on into v_clash
    from public.seasons s
    join public.season_types t on t.id = s.season_type_id
    where s.property_id = v_property and s.kind = 'season'
      and daterange(s.starts_on, s.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
    order by s.starts_on
    limit 1;
    if found then
      raise exception 'That overlaps % (% - %). Seasons cannot overlap.',
        v_clash.name, to_char(v_clash.starts_on, 'FMDD Mon YYYY'), to_char(v_clash.ends_on, 'FMDD Mon YYYY');
    end if;
  end if;

  insert into public.seasons (property_id, name, starts_on, ends_on, season_type_id, kind)
  values (v_property, v_type.name, p_starts_on, p_ends_on, v_type.id, v_type.kind)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.add_season_range(uuid, date, date) from public, anon;
grant execute on function public.add_season_range(uuid, date, date) to authenticated;

-- delete_season(uuid) (0044) is unchanged and removes one range.

/* -- Reads --------------------------------------------------------------- */

drop function public.calendar_seasons(date, integer);

create function public.calendar_seasons(p_from date, p_days integer default 14)
returns table (id uuid, name text, starts_on date, ends_on date, color text)
language sql
stable
set search_path = public
as $$
  select s.id, t.name, s.starts_on, s.ends_on, t.color
  from public.seasons s
  join public.season_types t on t.id = s.season_type_id and t.property_id = s.property_id
  where s.property_id = public.current_property_id()
    and s.kind = 'season'
    and s.starts_on < (p_from + greatest(coalesce(p_days, 14), 1))
    and s.ends_on >= p_from
  order by s.starts_on;
$$;

revoke execute on function public.calendar_seasons(date, integer) from public, anon;
grant execute on function public.calendar_seasons(date, integer) to authenticated;
