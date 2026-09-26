-- Hotel Content -> Room Type Facilities, cloned from the client's reference:
-- the list of things a room can have -- a queen bed, a balcony, free wifi, a
-- flat-screen television -- each with an icon and a title.
--
-- The reference's name says what the list is for: facilities belong to ROOM
-- TYPES. A list attached to nothing would be a screen whose only effect is
-- itself, so this migration also adds the link, and the Room Types form
-- carries a tick per facility.
--
-- The icon is one of a short fixed set, checked here, because the browser
-- draws it from a matching list in `src/lib/facilities.ts`; a name the
-- browser cannot draw would show as an empty square. Adding an icon is both:
-- a line there and this constraint.

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  title text not null,
  icon text not null default 'check',
  created_at timestamptz not null default now(),
  constraint facilities_title_present check (btrim(title) <> ''),
  constraint facilities_icon_known check (
    icon in (
      'check', 'bed', 'wifi', 'desktop', 'bath', 'car',
      'snowflake', 'coffee', 'utensils', 'key'
    )
  )
);

create unique index facilities_title_key
  on public.facilities (property_id, lower(btrim(title)));

-- Which room types have which facilities. Content rather than history, so a
-- facility that is deleted simply comes off every room type it was on.
create table public.room_type_facilities (
  property_id uuid not null references public.properties(id) on delete restrict,
  room_type_id uuid not null references public.room_types(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  primary key (room_type_id, facility_id)
);

create index room_type_facilities_facility_idx on public.room_type_facilities (facility_id);

alter table public.facilities enable row level security;
alter table public.room_type_facilities enable row level security;

create policy facilities_select_current_property on public.facilities
  for select using (property_id = public.current_property_id());
create policy facilities_write_revenue_staff on public.facilities
  for all using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create policy room_type_facilities_select_current_property on public.room_type_facilities
  for select using (property_id = public.current_property_id());
create policy room_type_facilities_write_revenue_staff on public.room_type_facilities
  for all using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.facilities, public.room_type_facilities to authenticated;
revoke all on public.facilities, public.room_type_facilities from anon;

create or replace function public.save_facility(
  p_id uuid,
  p_title text,
  p_icon text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the facilities';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'A facility needs a title';
  end if;

  if exists (
    select 1 from public.facilities
    where property_id = v_property
      and lower(btrim(title)) = lower(btrim(p_title))
      and id is distinct from p_id
  ) then
    raise exception 'There is already a facility called %', btrim(p_title);
  end if;

  if p_id is null then
    insert into public.facilities (property_id, title, icon)
    values (v_property, btrim(p_title), coalesce(p_icon, 'check'))
    returning id into v_id;
  else
    update public.facilities
    set title = btrim(p_title), icon = coalesce(p_icon, 'check')
    where id = p_id and property_id = v_property
    returning id into v_id;
    if v_id is null then
      raise exception 'That facility no longer exists';
    end if;
  end if;

  return v_id;
end;
$$;

-- A real delete: a facility is a description of a room, not a record of
-- anything that happened. It comes off every room type it was on.
create or replace function public.delete_facility(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the facilities';
  end if;

  delete from public.facilities
  where id = p_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That facility no longer exists';
  end if;
end;
$$;

-- The whole set for one room type at once, because "the Suite has these"
-- is one decision -- the same reason set_rate_plan_meals() takes the set.
create or replace function public.set_room_type_facilities(
  p_room_type_id uuid,
  p_facility_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_ids uuid[] := coalesce(p_facility_ids, '{}');
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the facilities';
  end if;
  v_property := public.current_property_id();

  if not exists (
    select 1 from public.room_types where id = p_room_type_id and property_id = v_property
  ) then
    raise exception 'That room type no longer exists';
  end if;

  if exists (
    select 1 from unnest(v_ids) as f(id)
    where not exists (
      select 1 from public.facilities x where x.id = f.id and x.property_id = v_property
    )
  ) then
    raise exception 'One of those facilities no longer exists';
  end if;

  delete from public.room_type_facilities
  where room_type_id = p_room_type_id
    and not (facility_id = any (v_ids));

  insert into public.room_type_facilities (property_id, room_type_id, facility_id)
  select distinct v_property, p_room_type_id, f.id
  from unnest(v_ids) as f(id)
  on conflict do nothing;
end;
$$;

revoke execute on function public.save_facility(uuid, text, text) from public, anon;
revoke execute on function public.delete_facility(uuid) from public, anon;
revoke execute on function public.set_room_type_facilities(uuid, uuid[]) from public, anon;

grant execute on function public.save_facility(uuid, text, text) to authenticated;
grant execute on function public.delete_facility(uuid) to authenticated;
grant execute on function public.set_room_type_facilities(uuid, uuid[]) to authenticated;
