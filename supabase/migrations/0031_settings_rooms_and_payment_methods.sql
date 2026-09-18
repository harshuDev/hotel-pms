-- Layer 19b: the two things 0030 left half-done.
--
-- save_room() shipped in 0030 and nothing called it: rooms could be created in
-- runs but never corrected afterwards, so a typo in a number or a room on the
-- wrong type meant going back to SQL — which is the exact problem 0030 set out
-- to remove. This adds the read the list needs.
--
-- payment_methods had no screen at all. They are seeded once and nothing in the
-- application could add, rename or retire one, so a property that takes a
-- payment type nobody thought to seed has no way to record it, and a method it
-- has stopped accepting stays on the cashier's list forever.

-- Rooms, for the settings list ------------------------------------------------
--
-- rooms_page() is the house board's read and returns derived state — who is in
-- the room tonight, how many nights are left. Settings needs the other half:
-- the type it belongs to and the floor it is on, which are what get corrected.
-- Paginated all the same, because a property may hold ~1,800 rooms.

create function public.rooms_for_settings(
  p_q text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  room_id uuid,
  number text,
  floor integer,
  room_type_id uuid,
  room_type_name text,
  status public.room_status,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select r.id, r.number, r.floor, r.room_type_id, rt.name as room_type_name, r.status
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
    count(*) over ()::bigint
  from filtered f
  order by
    f.floor nulls last,
    nullif(regexp_replace(f.number, '\D', '', 'g'), '')::bigint nulls last,
    f.number
  limit greatest(coalesce(p_limit, 100), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;


-- save_room() raised the raw unique-violation on (property_id, number), which
-- reaches the screen as "duplicate key value violates unique constraint". The
-- number is the thing being typed, so it is the thing the message has to name.
-- Everything else about the function is unchanged; note in particular that
-- moving a room to another type is safe, because booking_rooms carries its own
-- room_type_id and no booking, rate or night row is rewritten by the move.

create or replace function public.save_room(
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

  if exists (
    select 1 from public.rooms r
    where r.property_id = v_property
      and r.number = btrim(p_number)
      and (p_id is null or r.id is distinct from p_id)
  ) then
    raise exception 'Room % already exists on this property', btrim(p_number);
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


-- Payment methods --------------------------------------------------------------
--
-- Two constraints from 0003 shape this and are not worked around:
--
--   unique (property_id, kind)      one method per kind, so the screen is a
--                                   fixed list of the eight kinds, each either
--                                   configured or not — never a free-form list.
--   payment_methods_cash_drawer_consistency
--                                   affects_drawer is decided entirely by the
--                                   kind: cash true, everything else false.
--
-- So affects_drawer is not a parameter. Taking one would offer a choice the
-- database refuses, and the screen would be lying about what it controls. What
-- IS a choice is the kind, and that is frozen once money has come in through
-- the method: every past blind count separated cash from the rest by this
-- column, and moving a method across that line would restate all of them.

create function public.save_payment_method(
  p_name text,
  p_kind public.payment_method_kind,
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
  v_current_kind public.payment_method_kind;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up payment methods';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'A payment method needs a name';
  end if;

  if p_kind is null then
    raise exception 'A payment method needs a kind';
  end if;

  if exists (
    select 1 from public.payment_methods pm
    where pm.property_id = v_property
      and pm.kind = p_kind
      and (p_id is null or pm.id is distinct from p_id)
  ) then
    raise exception
      'This property already has a % method. Rename that one rather than adding a second.', p_kind;
  end if;

  if p_id is null then
    insert into public.payment_methods (property_id, name, kind, affects_drawer, is_active)
    values (v_property, btrim(p_name), p_kind, p_kind = 'cash', coalesce(p_is_active, true))
    returning id into v_id;
    return v_id;
  end if;

  select pm.kind into v_current_kind
  from public.payment_methods pm
  where pm.id = p_id and pm.property_id = v_property;

  if v_current_kind is null then
    raise exception 'That payment method is not on this property';
  end if;

  if v_current_kind is distinct from p_kind and exists (
    select 1 from public.payments p
    where p.payment_method_id = p_id and p.property_id = v_property
  ) then
    raise exception
      'Payments have already been taken by this method, so its kind is fixed. Retire it and add a new one.';
  end if;

  update public.payment_methods set
    name = btrim(p_name),
    kind = p_kind,
    affects_drawer = p_kind = 'cash',
    is_active = coalesce(p_is_active, true)
  where id = p_id and property_id = v_property
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.rooms_for_settings(text, integer, integer) from public, anon;
revoke all on function public.save_payment_method(
  text, public.payment_method_kind, uuid, boolean
) from public, anon;

grant execute on function public.rooms_for_settings(text, integer, integer) to authenticated;
grant execute on function public.save_payment_method(
  text, public.payment_method_kind, uuid, boolean
) to authenticated;
