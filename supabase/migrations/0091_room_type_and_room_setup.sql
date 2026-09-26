-- Settings -> Inventory -> Room Type and Room Setup, cloned from the client's
-- reference.
--
-- ROOM TYPE: Display Name (with the code), Room Type, Occupancy, a drag
-- handle, a pencil and a cross, "+ Add Room Type"; then a Virtual Room Types
-- card (Display Name, Parent Room Type, "+ Add Virtual Room Type").
--   * `room_types.display_name` is what a GUEST reads -- the booking page's
--     room name -- while `name` stays the staff name every screen, report and
--     rate grid uses. Null falls back to the name, so nothing changes for a
--     hotel that never sets one. `public_room_types()` returns it in its
--     existing `name` column: same shape, so the booking flow is untouched.
--   * The drag order is `room_types.sort_order`, which the calendar, the
--     inventory grids and the guest page already sort by.
--   * A ROOM TYPE CAN BE DELETED IF NOTHING WAS EVER BUILT ON IT: no room, no
--     booked room, no waitlist entry, no virtual type. Its prices,
--     restrictions, offer links and facility ticks go with it -- those
--     describe a type nobody can sell. A type in use is refused by name, and
--     stays, exactly as before.
--   * VIRTUAL ROOM TYPES ARE STORED, NOT YET SOLD. A virtual type is a second
--     name a parent is sold under (e.g. "Double for single use") that takes
--     its availability from the parent. Selling one means a booking, a rate
--     grid row and an availability rule that all resolve to the parent -- a
--     change to how inventory is counted, raised rather than slipped in.
--
-- ROOM SETUP: Name/Number, Room Type, Property, Priority, Available Online,
-- Enabled, Key Code, Common Door Name, Color, Divider, a pencil and a cross,
-- "+ Add Room", and "Use Booking Room id as Key Code".
--   * AVAILABLE ONLINE IS LIVE: a room unticked is held back from the guest
--     booking page. `public_room_types()` counts only rooms available online
--     as sellable there; staff still sell every room.
--   * ENABLED IS LIVE, AND A DISABLED ROOM IS LOCKED OUT OF ORDER. Disabling
--     sets the room `ooo` -- which every availability, occupancy and house
--     count already excludes, so no report needed rewriting -- and a trigger
--     keeps it there: nothing (check-in, the housekeeping menu or report,
--     `set_room_status()`) can move a disabled room off `ooo`, and a trigger on
--     `booking_rooms` refuses putting a booking in one. Disabling is refused
--     while a guest is in the room or a live booking is assigned to it from
--     the business date on. Enabling brings it back as dirty, to be cleaned.
--   * COLOR AND DIVIDER ARE LIVE ON THE CALENDAR: the colour marks the room's
--     number in the rail, and a divider draws a heavier rule under the room.
--     `calendar_rooms()` returns both.
--   * PRIORITY, KEY CODE, COMMON DOOR NAME and the key-code setting are
--     STORED: there is no automatic room allocation for a priority to order,
--     and no door-lock system to hand a key code to.

/* -- Room types ------------------------------------------------------------ */

alter table public.room_types
  add column display_name text
    check (display_name is null or (btrim(display_name) <> '' and char_length(display_name) <= 120));

create or replace function public.set_room_type_display_name(p_room_type_id uuid, p_display_name text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up room types';
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) > 120 then
    raise exception 'Keep the display name to 120 characters';
  end if;
  update public.room_types
  set display_name = nullif(btrim(coalesce(p_display_name, '')), '')
  where id = p_room_type_id and property_id = public.current_property_id()
  returning id into v_id;
  if v_id is null then
    raise exception 'That room type is not on this property';
  end if;
end;
$$;

revoke execute on function public.set_room_type_display_name(uuid, text) from public, anon;
grant execute on function public.set_room_type_display_name(uuid, text) to authenticated;

create or replace function public.set_room_type_order(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up room types';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  update public.room_types t set sort_order = o.i
  from unnest(coalesce(p_ids, '{}')) with ordinality as o(id, i)
  where t.id = o.id and t.property_id = v_property;
end;
$$;

revoke execute on function public.set_room_type_order(uuid[]) from public, anon;
grant execute on function public.set_room_type_order(uuid[]) to authenticated;

/* -- Virtual room types (stored) ----------------------------------------- */

create table public.virtual_room_types (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  display_name text not null check (btrim(display_name) <> '' and char_length(display_name) <= 120),
  parent_room_type_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (parent_room_type_id, property_id)
    references public.room_types(id, property_id) on delete restrict
);

create unique index virtual_room_types_name_unique
  on public.virtual_room_types (property_id, lower(btrim(display_name)));

alter table public.virtual_room_types enable row level security;

create policy virtual_room_types_select_current_property on public.virtual_room_types
  for select using (property_id = public.current_property_id());
create policy virtual_room_types_insert_revenue_staff on public.virtual_room_types
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy virtual_room_types_update_revenue_staff on public.virtual_room_types
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy virtual_room_types_delete_revenue_staff on public.virtual_room_types
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.virtual_room_types to authenticated;
revoke all on public.virtual_room_types from anon;

create or replace function public.save_virtual_room_type(
  p_id uuid,
  p_display_name text,
  p_parent_room_type_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up room types';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if v_name = '' then
    raise exception 'Write the display name';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Keep the display name to 120 characters';
  end if;
  if not exists (
    select 1 from public.room_types rt
    where rt.id = p_parent_room_type_id and rt.property_id = v_property
  ) then
    raise exception 'Choose the parent room type';
  end if;
  if exists (
    select 1 from public.virtual_room_types v
    where v.property_id = v_property and lower(btrim(v.display_name)) = lower(v_name)
      and (p_id is null or v.id <> p_id)
  ) then
    raise exception 'There is already a virtual room type called %', v_name;
  end if;

  if p_id is null then
    insert into public.virtual_room_types (property_id, display_name, parent_room_type_id)
    values (v_property, v_name, p_parent_room_type_id)
    returning id into v_id;
    return v_id;
  end if;

  update public.virtual_room_types set
    display_name = v_name,
    parent_room_type_id = p_parent_room_type_id
  where id = p_id and property_id = v_property
  returning id into v_id;
  if v_id is null then
    raise exception 'That virtual room type is not on this property';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_virtual_room_type(uuid, text, uuid) from public, anon;
grant execute on function public.save_virtual_room_type(uuid, text, uuid) to authenticated;

create or replace function public.delete_virtual_room_type(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up room types';
  end if;
  delete from public.virtual_room_types
  where id = p_id and property_id = public.current_property_id();
end;
$$;

revoke execute on function public.delete_virtual_room_type(uuid) from public, anon;
grant execute on function public.delete_virtual_room_type(uuid) to authenticated;

/* -- Deleting a room type nothing was built on --------------------------- */

-- security definer: room_types has no delete policy, and its dependants'
-- rows (prices, restrictions, offer links, facility ticks) go with it by
-- cascade. The property check is the whole of the isolation.
create or replace function public.delete_room_type(p_room_type_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_type public.room_types;
  v_n bigint;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up room types';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  select * into v_type from public.room_types
  where id = p_room_type_id and property_id = v_property;
  if not found then
    raise exception 'That room type is not on this property';
  end if;

  select count(*) into v_n from public.rooms
  where room_type_id = v_type.id and property_id = v_property;
  if v_n > 0 then
    raise exception '% has % room%. Move or delete them first.',
      v_type.name, v_n, case when v_n = 1 then '' else 's' end;
  end if;

  select count(*) into v_n from public.booking_rooms
  where room_type_id = v_type.id and property_id = v_property;
  if v_n > 0 then
    raise exception '% has been booked, so it stays on the record and cannot be deleted.',
      v_type.name;
  end if;

  select count(*) into v_n from public.booking_waitlist
  where room_type_id = v_type.id and property_id = v_property;
  if v_n > 0 then
    raise exception '% is on the booking waitlist and cannot be deleted.', v_type.name;
  end if;

  select count(*) into v_n from public.virtual_room_types
  where parent_room_type_id = v_type.id and property_id = v_property;
  if v_n > 0 then
    raise exception '% is the parent of a virtual room type. Delete that first.', v_type.name;
  end if;

  delete from public.room_types where id = v_type.id and property_id = v_property;
end;
$$;

revoke execute on function public.delete_room_type(uuid) from public, anon;
grant execute on function public.delete_room_type(uuid) to authenticated;

/* -- Rooms --------------------------------------------------------------- */

alter table public.rooms
  add column priority integer not null default 1 check (priority between 0 and 999),
  add column available_online boolean not null default true,
  add column is_enabled boolean not null default true,
  add column key_code text check (key_code is null or char_length(key_code) <= 60),
  add column door_name text check (door_name is null or char_length(door_name) <= 60),
  add column color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  add column has_divider boolean not null default false,
  add constraint rooms_disabled_is_out_of_order check (is_enabled or status = 'ooo');

-- A disabled room stays out of order whatever tries to move it: check-in,
-- the housekeeping menu, the housekeeping report and set_room_status() all
-- write rooms.status, and this is the one place that covers them all.
create or replace function public.rooms_disabled_stays_ooo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not new.is_enabled and not old.is_enabled and new.status <> 'ooo' then
    raise exception 'Room % is disabled in Room Setup. Enable it first.', new.number;
  end if;
  return new;
end;
$$;

revoke execute on function public.rooms_disabled_stays_ooo() from public, anon;

create trigger rooms_disabled_stays_ooo
  before update on public.rooms
  for each row execute function public.rooms_disabled_stays_ooo();

-- ...and nobody is put in one. Covers assign_room() and anything else that
-- sets a booked room's room_id.
create or replace function public.booking_rooms_not_in_disabled_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
begin
  if new.room_id is not null
     and (tg_op = 'INSERT' or new.room_id is distinct from old.room_id) then
    select * into v_room from public.rooms
    where id = new.room_id and property_id = new.property_id;
    if found and not v_room.is_enabled then
      raise exception 'Room % is disabled in Room Setup, so nobody can be put in it.', v_room.number;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.booking_rooms_not_in_disabled_room() from public, anon, authenticated;

create trigger booking_rooms_not_in_disabled_room
  before insert or update of room_id on public.booking_rooms
  for each row execute function public.booking_rooms_not_in_disabled_room();

create or replace function public.set_room_setup(
  p_room_id uuid,
  p_priority integer,
  p_available_online boolean,
  p_key_code text,
  p_door_name text,
  p_color text,
  p_has_divider boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_color text := nullif(btrim(coalesce(p_color, '')), '');
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change a room';
  end if;
  if p_priority is null or p_priority < 0 or p_priority > 999 then
    raise exception 'Priority is a whole number from 0 to 999';
  end if;
  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Pick the colour from the picker';
  end if;
  if char_length(btrim(coalesce(p_key_code, ''))) > 60
     or char_length(btrim(coalesce(p_door_name, ''))) > 60 then
    raise exception 'Keep the key code and the door name to 60 characters';
  end if;
  update public.rooms set
    priority = p_priority,
    available_online = coalesce(p_available_online, true),
    key_code = nullif(btrim(coalesce(p_key_code, '')), ''),
    door_name = nullif(btrim(coalesce(p_door_name, '')), ''),
    color = lower(v_color),
    has_divider = coalesce(p_has_divider, false)
  where id = p_room_id and property_id = public.current_property_id()
  returning id into v_id;
  if v_id is null then
    raise exception 'That room is not on this property';
  end if;
end;
$$;

revoke execute on function public.set_room_setup(uuid, integer, boolean, text, text, text, boolean) from public, anon;
grant execute on function public.set_room_setup(uuid, integer, boolean, text, text, text, boolean) to authenticated;

create or replace function public.set_room_enabled(p_room_id uuid, p_enabled boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_room public.rooms;
  v_open date;
  v_from date;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change a room';
  end if;
  select * into v_room from public.rooms
  where id = p_room_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That room is not on this property';
  end if;

  if coalesce(p_enabled, true) then
    if v_room.is_enabled then return; end if;
    -- Back into service as dirty: it has been out of use, so it is cleaned
    -- before anybody sleeps in it.
    update public.rooms set is_enabled = true, status = 'vacant_dirty'
    where id = v_room.id and property_id = v_room.property_id;
    return;
  end if;

  if not v_room.is_enabled then return; end if;

  if v_room.status = 'occupied' then
    raise exception 'Room % has a guest in it. Check them out before disabling it.', v_room.number;
  end if;

  select b.business_date into v_open
  from public.business_dates b
  where b.property_id = v_room.property_id and b.status = 'open';

  select min(br.check_in) into v_from
  from public.booking_rooms br
  where br.room_id = v_room.id and br.property_id = v_room.property_id
    and br.status not in ('canceled', 'no_show', 'checked_out')
    and br.check_out > coalesce(v_open, current_date);
  if v_from is not null then
    raise exception 'Room % has a booking assigned from %. Move it to another room first.',
      v_room.number, to_char(v_from, 'FMDD Mon YYYY');
  end if;

  update public.rooms set
    is_enabled = false,
    status = 'ooo',
    is_inspected = false,
    do_not_disturb = false
  where id = v_room.id and property_id = v_room.property_id;
end;
$$;

revoke execute on function public.set_room_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_room_enabled(uuid, boolean) to authenticated;

-- "Use Booking Room id as Key Code" -- stored, like the key codes it governs.
alter table public.inventory_settings
  add column key_code_from_booking_room boolean not null default false;

create or replace function public.save_key_code_setting(p_on boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.inventory_settings_row();
begin
  update public.inventory_settings set
    key_code_from_booking_room = coalesce(p_on, false),
    updated_at = now()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_key_code_setting(boolean) from public, anon;
grant execute on function public.save_key_code_setting(boolean) to authenticated;

/* -- Reads --------------------------------------------------------------- */

drop function public.rooms_for_settings(text, integer, integer);

create function public.rooms_for_settings(p_q text default null, p_limit integer default 100, p_offset integer default 0)
returns table (
  room_id uuid, number text, floor integer, room_type_id uuid, room_type_name text,
  status room_status, photo_path text, has_bookings boolean,
  priority integer, available_online boolean, is_enabled boolean,
  key_code text, door_name text, color text, has_divider boolean,
  total_count bigint
)
language sql
stable
set search_path = public
as $$
  with filtered as (
    select
      r.id, r.number, r.floor, r.room_type_id, rt.name as room_type_name,
      r.status, r.photo_path,
      exists (
        select 1 from public.booking_rooms br
        where br.room_id = r.id and br.property_id = r.property_id
      ) as has_bookings,
      r.priority, r.available_online, r.is_enabled, r.key_code, r.door_name,
      r.color, r.has_divider
    from public.rooms r
    join public.room_types rt
      on rt.id = r.room_type_id and rt.property_id = r.property_id
    where r.property_id = public.current_property_id()
      and (
        p_q is null
        or btrim(p_q) = ''
        -- strpos rather than ilike: the needle is user input and must not be
        -- read as a LIKE pattern.
        or strpos(lower(r.number), lower(btrim(p_q))) > 0
        or strpos(lower(rt.name), lower(btrim(p_q))) > 0
      )
  )
  select
    f.id, f.number, f.floor, f.room_type_id, f.room_type_name, f.status,
    f.photo_path, f.has_bookings,
    f.priority, f.available_online, f.is_enabled, f.key_code, f.door_name,
    f.color, f.has_divider,
    count(*) over ()::bigint
  from filtered f
  order by
    f.floor nulls last,
    nullif(regexp_replace(f.number, '\D', '', 'g'), '')::bigint nulls last,
    f.number
  limit greatest(coalesce(p_limit, 100), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.rooms_for_settings(text, integer, integer) from public, anon;
grant execute on function public.rooms_for_settings(text, integer, integer) to authenticated;

drop function public.calendar_rooms();

create function public.calendar_rooms()
returns table (
  room_id uuid, room_number text, floor text, room_type_id uuid, room_type_name text,
  room_status room_status, is_inspected boolean, do_not_disturb boolean, sort_order integer,
  color text, has_divider boolean
)
language sql
stable
set search_path = public
as $$
  select
    r.id,
    r.number,
    r.floor::text,
    rt.id,
    rt.name,
    r.status,
    r.is_inspected,
    r.do_not_disturb,
    rt.sort_order,
    r.color,
    r.has_divider
  from public.rooms r
  join public.room_types rt
    on rt.id = r.room_type_id and rt.property_id = r.property_id
  where r.property_id = public.current_property_id()
  order by rt.sort_order, rt.name,
           nullif(regexp_replace(r.number, '\D', '', 'g'), '')::bigint
             nulls last,
           r.number;
$$;

revoke execute on function public.calendar_rooms() from public, anon;
grant execute on function public.calendar_rooms() to authenticated;

-- The guest page: the display name in `name`, and only rooms available online
-- counted as sellable. Otherwise exactly 0088's.
create or replace function public.public_room_types(p_property_id uuid, p_rate_plan_id uuid, p_from date, p_to date)
 returns table(room_type_id uuid, code text, name text, base_occupancy integer, max_occupancy integer, available bigint, nights integer, total_cents bigint, unavailable_reason text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with plan as (
    select rp.id
    from public.rate_plans rp
    join public.properties p on p.id = rp.property_id and p.is_active
    where rp.id = p_rate_plan_id
      and rp.property_id = p_property_id
      and rp.is_active
      and rp.is_public
  ),
  nights as (
    select d::date as stay_date
    from generate_series(p_from, greatest(p_to - 1, p_from), interval '1 day') as d
  ),
  types as (
    select
      rt.id, rt.code, coalesce(rt.display_name, rt.name) as name,
      rt.base_occupancy, rt.max_occupancy, rt.sort_order,
      count(r.id) filter (where r.status <> 'ooo' and r.available_online) as sellable
    from public.room_types rt
    left join public.rooms r
      on r.room_type_id = rt.id and r.property_id = rt.property_id
    where rt.property_id = p_property_id
    group by rt.id, rt.code, rt.display_name, rt.name, rt.sort_order
  ),
  sold as (
    select n.stay_date, coalesce(r.room_type_id, br.room_type_id) as room_type_id, count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    left join public.rooms r
      on r.id = br.room_id and r.property_id = br.property_id
    where n.property_id = p_property_id
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_to
    group by n.stay_date, coalesce(r.room_type_id, br.room_type_id)
  ),
  priced as (
    select
      types.id,
      types.code,
      types.name,
      types.base_occupancy,
      types.max_occupancy,
      types.sort_order,
      coalesce(
        min(
          case
            when coalesce(rtd.close_out, false) then 0
            else least(types.sellable, coalesce(rtd.allotment, types.sellable))
                 - coalesce(sold.sold, 0)
          end
        ),
        types.sellable
      )::bigint as available,
      (p_to - p_from)::integer as nights,
      case
        when bool_or(rpd.rate_cents is null) then null
        else sum(rpd.rate_cents)::bigint
      end as total_cents
    from types
    cross join nights
    left join public.room_type_days rtd
      on rtd.room_type_id = types.id
     and rtd.stay_date = nights.stay_date
     and rtd.property_id = p_property_id
    left join public.rate_plan_days rpd
      on rpd.room_type_id = types.id
     and rpd.stay_date = nights.stay_date
     and rpd.property_id = p_property_id
     and rpd.rate_plan_id = (select id from plan)
    left join sold
      on sold.stay_date = nights.stay_date and sold.room_type_id = types.id
    group by types.id, types.code, types.name, types.base_occupancy,
             types.max_occupancy, types.sort_order, types.sellable
  )
  select
    priced.id,
    priced.code,
    priced.name,
    priced.base_occupancy,
    priced.max_occupancy,
    greatest(priced.available, 0)::bigint,
    priced.nights,
    priced.total_cents,
    coalesce(
      public.public_booking_cutoff_reason(p_property_id, p_from, p_to),
      public.stay_rule_violation_for(
        p_property_id, (select id from plan), priced.id, p_from, p_to
      )
    )
  from priced
  where exists (select 1 from plan)
  order by priced.sort_order, priced.name;
$function$;
