-- Layer 19: setting a property up.
--
-- Everything this module writes had to be inserted by hand in SQL until now.
-- The app could take a booking but not create the room to put it in, the
-- channel it came from or the tax to charge on it — so a fresh property could
-- not be made usable from the application at all, and the hosted database sat
-- empty with every screen correctly showing nothing.
--
-- Two things are deliberately not here:
--
--   Creating a login. staff_users.id references auth.users, so a new member of
--   staff needs an auth account before a row can point at one. That is an
--   invite flow with its own decisions about who may send one. What is here is
--   managing the staff who already exist, which is the part that matters
--   operationally: 0016 made deactivation withdraw access everywhere, and
--   until now nothing could set the flag.
--
--   Deleting anything. Rooms, channels and tax rates are referenced by
--   bookings and posted money, and a delete would either fail on a foreign key
--   or orphan history. Everything retires with is_active instead.

-- Marking a room clean -------------------------------------------------------
--
-- rooms.status was only ever set by check-in and check-out, so a room went
-- dirty on departure and stayed dirty for ever. The housekeeping report showed
-- the work with no way to record it done, which made the whole board drift
-- further from the truth every day.
--
-- Housekeeping can do this one. They are the people holding the vacuum.

create function public.set_room_status(
  p_room_id uuid,
  p_status public.room_status
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_room public.rooms;
begin
  if not coalesce(
    public.current_role() in ('admin', 'manager', 'front_desk', 'housekeeping'),
    false
  ) then
    raise exception 'Your role cannot change a room''s status';
  end if;

  v_property := public.current_property_id();

  select * into v_room from public.rooms
  where id = p_room_id and property_id = v_property;
  if not found then
    raise exception 'That room is not on this property';
  end if;

  -- An occupied room is occupied because somebody is in it. Saying otherwise
  -- here would put the room and the booking out of step; check the guest out
  -- instead.
  if v_room.status = 'occupied' and p_status <> 'occupied' then
    raise exception
      'Room % has a guest in it. Check them out rather than changing the room.',
      v_room.number;
  end if;

  if p_status = 'occupied' and v_room.status <> 'occupied' then
    raise exception
      'Room % is made occupied by checking a guest in, not by setting it.',
      v_room.number;
  end if;

  -- The audit trigger on rooms records the change, so nothing is logged here.
  update public.rooms set status = p_status
  where id = p_room_id and property_id = v_property;
end;
$$;


-- Room types ------------------------------------------------------------------

create function public.save_room_type(
  p_code text,
  p_name text,
  p_id uuid default null,
  p_base_occupancy integer default 2,
  p_max_occupancy integer default 2,
  p_sort_order integer default null
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
    raise exception 'Only managers and administrators can set up room types';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_code, '')) = '' or btrim(coalesce(p_name, '')) = '' then
    raise exception 'A room type needs a code and a name';
  end if;

  if coalesce(p_base_occupancy, 0) < 1
     or coalesce(p_max_occupancy, 0) < coalesce(p_base_occupancy, 0) then
    raise exception 'Occupancy must be at least one, and the maximum at least the base';
  end if;

  if p_id is null then
    insert into public.room_types (
      property_id, code, name, base_occupancy, max_occupancy, sort_order
    ) values (
      v_property, upper(btrim(p_code)), btrim(p_name),
      p_base_occupancy, p_max_occupancy,
      coalesce(
        p_sort_order,
        (select coalesce(max(sort_order) + 1, 0) from public.room_types where property_id = v_property)
      )
    )
    returning id into v_id;
  else
    update public.room_types set
      code = upper(btrim(p_code)),
      name = btrim(p_name),
      base_occupancy = p_base_occupancy,
      max_occupancy = p_max_occupancy,
      sort_order = coalesce(p_sort_order, sort_order)
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That room type is not on this property';
    end if;
  end if;

  return v_id;
end;
$$;


-- Rooms -----------------------------------------------------------------------
--
-- Created in runs, because the client operates properties with up to ~1,800
-- rooms and entering those one at a time is not a thing anyone would do. A run
-- is a floor's worth: "Deluxe, floor 1, 101 to 120".

create function public.create_rooms(
  p_room_type_id uuid,
  p_first integer,
  p_last integer,
  p_floor integer default null,
  p_prefix text default ''
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_count integer;
  v_existing text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can add rooms';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if not exists (
    select 1 from public.room_types rt
    where rt.id = p_room_type_id and rt.property_id = v_property
  ) then
    raise exception 'That room type is not on this property';
  end if;

  if p_first is null or p_last is null or p_last < p_first then
    raise exception 'Give a run of room numbers, lowest first';
  end if;

  -- 500 at a time. A property of 1,800 is four or five runs; a run of 100,000
  -- is a mistyped number and would lock the table while it wrote.
  if p_last - p_first >= 500 then
    raise exception 'Add at most 500 rooms at a time';
  end if;

  -- Named before writing, because a partial run leaves somebody guessing which
  -- half arrived.
  select string_agg(r.number, ', ' order by r.number) into v_existing
  from public.rooms r
  where r.property_id = v_property
    and r.number in (
      select coalesce(btrim(p_prefix), '') || n::text
      from generate_series(p_first, p_last) as n
    );

  if v_existing is not null then
    raise exception 'These rooms already exist: %', v_existing;
  end if;

  insert into public.rooms (property_id, room_type_id, number, floor, status)
  select
    v_property,
    p_room_type_id,
    coalesce(btrim(p_prefix), '') || n::text,
    p_floor,
    'vacant_clean'
  from generate_series(p_first, p_last) as n;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.save_room(
  p_number text,
  p_room_type_id uuid,
  p_id uuid default null,
  p_floor integer default null
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
    raise exception 'Only managers and administrators can change a room';
  end if;

  v_property := public.current_property_id();

  if btrim(coalesce(p_number, '')) = '' then
    raise exception 'A room needs a number';
  end if;

  if not exists (
    select 1 from public.room_types rt
    where rt.id = p_room_type_id and rt.property_id = v_property
  ) then
    raise exception 'That room type is not on this property';
  end if;

  if p_id is null then
    insert into public.rooms (property_id, room_type_id, number, floor, status)
    values (v_property, p_room_type_id, btrim(p_number), p_floor, 'vacant_clean')
    returning id into v_id;
  else
    update public.rooms set
      number = btrim(p_number),
      room_type_id = p_room_type_id,
      floor = p_floor
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That room is not on this property';
    end if;
  end if;

  return v_id;
end;
$$;


-- Channels, tax rates, staff and the property itself --------------------------

create function public.save_channel(
  p_code text,
  p_name text,
  p_kind public.channel_kind,
  p_id uuid default null,
  p_commission_bps integer default 0,
  p_is_active boolean default true
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
    raise exception 'Only managers and administrators can set up booking sources';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_code, '')) = '' or btrim(coalesce(p_name, '')) = '' then
    raise exception 'A booking source needs a code and a name';
  end if;

  -- Basis points, like every other rate here: 1500 is 15%.
  if coalesce(p_commission_bps, 0) < 0 or coalesce(p_commission_bps, 0) > 10000 then
    raise exception 'Commission must be between 0 and 100 percent';
  end if;

  if p_id is null then
    insert into public.channels (property_id, code, name, kind, commission_bps, is_active)
    values (
      v_property, upper(btrim(p_code)), btrim(p_name), p_kind,
      coalesce(p_commission_bps, 0), coalesce(p_is_active, true)
    )
    returning id into v_id;
  else
    update public.channels set
      code = upper(btrim(p_code)),
      name = btrim(p_name),
      kind = p_kind,
      commission_bps = coalesce(p_commission_bps, 0),
      is_active = coalesce(p_is_active, true)
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That booking source is not on this property';
    end if;
  end if;

  return v_id;
end;
$$;

create function public.save_tax_rate(
  p_name text,
  p_rate_bps integer,
  p_inclusion public.tax_inclusion,
  p_id uuid default null,
  p_is_active boolean default true
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
    raise exception 'Only managers and administrators can set up tax rates';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'A tax rate needs a name';
  end if;

  if p_rate_bps is null or p_rate_bps < 0 or p_rate_bps > 10000 then
    raise exception 'A tax rate must be between 0 and 100 percent';
  end if;

  if p_id is null then
    insert into public.tax_rates (property_id, name, rate_bps, inclusion, is_active)
    values (v_property, btrim(p_name), p_rate_bps, p_inclusion, coalesce(p_is_active, true))
    returning id into v_id;
  else
    -- The rate itself is not changed in place once charges have been posted
    -- against it: a folio item records which rate it used, and moving that
    -- rate underneath it would silently restate history.
    if exists (
      select 1 from public.folio_items fi
      where fi.tax_rate_id = p_id and fi.property_id = v_property
    ) and (
      select t.rate_bps <> p_rate_bps or t.inclusion <> p_inclusion
      from public.tax_rates t where t.id = p_id and t.property_id = v_property
    ) then
      raise exception
        'Charges have already been posted at this rate. Retire it and add a new one rather than changing it.';
    end if;

    update public.tax_rates set
      name = btrim(p_name),
      rate_bps = p_rate_bps,
      inclusion = p_inclusion,
      is_active = coalesce(p_is_active, true)
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That tax rate is not on this property';
    end if;
  end if;

  return v_id;
end;
$$;

-- Managing the staff who already have a login. Creating one is an auth invite
-- with its own decisions, and is deliberately not here.
create function public.save_staff_user(
  p_id uuid,
  p_full_name text,
  p_role public.staff_role,
  p_is_active boolean default true
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
  if not coalesce(public.current_role() = 'admin', false) then
    raise exception 'Only administrators can change a member of staff';
  end if;

  v_property := public.current_property_id();

  if btrim(coalesce(p_full_name, '')) = '' then
    raise exception 'A member of staff needs a name';
  end if;

  -- An administrator who removes their own admin rights, or deactivates
  -- themselves, locks the property out of its own settings.
  if p_id = auth.uid() and (p_role <> 'admin' or not coalesce(p_is_active, true)) then
    raise exception
      'That would remove your own access. Have another administrator do it.';
  end if;

  update public.staff_users set
    full_name = btrim(p_full_name),
    role = p_role,
    is_active = coalesce(p_is_active, true)
  where id = p_id and property_id = v_property
  returning id into v_id;

  if v_id is null then
    raise exception 'That member of staff is not on this property';
  end if;

  return v_id;
end;
$$;

create function public.save_property(
  p_name text,
  p_timezone text,
  p_currency char(3),
  p_check_in_time time,
  p_check_out_time time
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the property';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'The property needs a name';
  end if;

  -- now() at time zone raises on an unknown zone, which is the cheapest way to
  -- refuse one before it becomes every business date this property computes.
  perform now() at time zone p_timezone;

  update public.properties set
    name = btrim(p_name),
    timezone = p_timezone,
    currency = upper(p_currency),
    check_in_time = p_check_in_time,
    check_out_time = p_check_out_time
  where id = v_property;
end;
$$;

-- properties had no update policy at all, because nothing ever changed it.
create policy properties_update_revenue on public.properties
  for update using (
    id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    id = public.current_property_id() and public.is_revenue_staff()
  );

revoke all on function public.set_room_status(uuid, public.room_status) from public, anon;
revoke all on function public.save_room_type(text, text, uuid, integer, integer, integer) from public, anon;
revoke all on function public.create_rooms(uuid, integer, integer, integer, text) from public, anon;
revoke all on function public.save_room(text, uuid, uuid, integer) from public, anon;
revoke all on function public.save_channel(text, text, public.channel_kind, uuid, integer, boolean) from public, anon;
revoke all on function public.save_tax_rate(text, integer, public.tax_inclusion, uuid, boolean) from public, anon;
revoke all on function public.save_staff_user(uuid, text, public.staff_role, boolean) from public, anon;
revoke all on function public.save_property(text, text, char(3), time, time) from public, anon;

grant execute on function public.set_room_status(uuid, public.room_status) to authenticated;
grant execute on function public.save_room_type(text, text, uuid, integer, integer, integer) to authenticated;
grant execute on function public.create_rooms(uuid, integer, integer, integer, text) to authenticated;
grant execute on function public.save_room(text, uuid, uuid, integer) to authenticated;
grant execute on function public.save_channel(text, text, public.channel_kind, uuid, integer, boolean) to authenticated;
grant execute on function public.save_tax_rate(text, integer, public.tax_inclusion, uuid, boolean) to authenticated;
grant execute on function public.save_staff_user(uuid, text, public.staff_role, boolean) to authenticated;
grant execute on function public.save_property(text, text, char(3), time, time) to authenticated;
