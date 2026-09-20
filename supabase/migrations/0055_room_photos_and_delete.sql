-- 0055: a hotel can delete a room, and put a photograph on one.
--
-- The client: "the rooms, I want hotels to be able to delete rooms and add
-- pictures ... at the moment they cannot". Both are true. Rooms could be
-- created in runs and corrected one at a time since 0031, and that was the
-- whole of it.

/* -------------------------------------------------------------------------- */
/* Deleting a room                                                            */
/* -------------------------------------------------------------------------- */

/*
 * CLAUDE.md has said since 0030 that there is no delete for a room. That was
 * right about the constraint and wrong as a blanket rule, and the difference
 * matters: TWO tables point at `rooms`, and they are not the same kind of
 * thing.
 *
 *   booking_rooms.room_id        A guest stayed in that room. Real history,
 *                                on delete restrict, and the reason a room
 *                                that has ever been slept in must stay.
 *
 *   room_status_history.room_id  A housekeeping log ABOUT the room. It records
 *                                that 118 went dirty and was cleaned again.
 *                                Once 118 does not exist, neither does
 *                                anything that log is evidence of.
 *
 * So a room nobody has ever booked is genuinely deletable, and that is the
 * case that matters: a run of 60 typed as 50, a number entered wrong, a store
 * cupboard somebody counted as sellable. Those are exactly the rooms a hotel
 * wants gone, and `ooo` is the wrong answer for them -- an out-of-order room
 * still shows on the board, still sits in the rail, and still reads as a room
 * the hotel owns.
 *
 * A room WITH bookings is still refused, by name, and still becomes `ooo`.
 * That has not changed and must not: deleting it would take a reservation's
 * room out from under it.
 */
create function public.delete_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_property uuid;
  v_room public.rooms;
  v_bookings integer;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can delete a room';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  -- security definer, so there is no RLS behind this. The property check is
  -- the whole of the isolation and is not optional.
  select * into v_room
  from public.rooms
  where id = p_room_id and property_id = v_property;

  if not found then
    raise exception 'That room is not on this property';
  end if;

  select count(*) into v_bookings
  from public.booking_rooms br
  where br.room_id = v_room.id and br.property_id = v_property;

  if v_bookings > 0 then
    raise exception
      'Room % has % booking(s) against it and cannot be deleted. Put it out of order instead.',
      v_room.number, v_bookings;
  end if;

  -- The room's own housekeeping trail goes with it. Nothing else reads it, and
  -- keeping orphan rows about a room that no longer exists is not history --
  -- it is a table nobody can join.
  delete from public.room_status_history
  where room_id = v_room.id and property_id = v_property;

  delete from public.rooms where id = v_room.id and property_id = v_property;
end;
$function$;

comment on function public.delete_room(uuid) is
  'Delete a room that has never been booked. Refuses by name once booking_rooms points at it -- that room becomes ooo instead.';


/* -------------------------------------------------------------------------- */
/* A photograph of the room                                                   */
/* -------------------------------------------------------------------------- */

/*
 * WHAT IS STORED IS A PATH IN SUPABASE STORAGE, NOT A URL.
 *
 * A url column would take whatever the browser sent, and the screen then
 * renders an <img> pointing wherever that says. The path is resolved against
 * one known bucket, so the worst a bad value can do is fail to load.
 *
 * Nullable, and null on every existing row: a hotel that never uploads one
 * carries on exactly as before.
 */
alter table public.rooms
  add column if not exists photo_path text;

comment on column public.rooms.photo_path is
  'Object path inside the room-photos bucket, as <property_id>/<room_id>/<file>. Null means no photograph.';

/*
 * The bucket.
 *
 * PUBLIC READ, and that is a decision rather than a shortcut. A photograph of
 * a hotel bedroom is marketing material -- the same picture is on the hotel's
 * own website -- and the guest booking page is a plausible next home for it.
 * What a public bucket does NOT do is make it writable: every write goes
 * through the policies below, under the uploader's own session.
 *
 * Capped at 5MB and image types only, in the bucket itself rather than in the
 * form. An accept attribute on a file input is a hint to a file picker and
 * nothing more; the storage endpoint is reachable without one.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-photos',
  'room-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * THE FIRST PATH SEGMENT IS THE PROPERTY, and every policy below turns on it.
 * That is what keeps one property's staff out of another's photographs, and it
 * is the same rule `current_property_id()` enforces on every table.
 *
 * Writes are revenue staff only, matching `save_room()`: the people who may
 * rename a room are the people who may illustrate it.
 */
drop policy if exists "room photos are readable" on storage.objects;
create policy "room photos are readable"
  on storage.objects for select
  using (bucket_id = 'room-photos');

drop policy if exists "room photos are written by revenue staff" on storage.objects;
create policy "room photos are written by revenue staff"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'room-photos'
    and public.is_revenue_staff()
    and (storage.foldername(name))[1] = public.current_property_id()::text
  );

drop policy if exists "room photos are replaced by revenue staff" on storage.objects;
create policy "room photos are replaced by revenue staff"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'room-photos'
    and public.is_revenue_staff()
    and (storage.foldername(name))[1] = public.current_property_id()::text
  );

drop policy if exists "room photos are removed by revenue staff" on storage.objects;
create policy "room photos are removed by revenue staff"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'room-photos'
    and public.is_revenue_staff()
    and (storage.foldername(name))[1] = public.current_property_id()::text
  );

/*
 * Putting the photograph on the room.
 *
 * A SEPARATE FUNCTION RATHER THAN A PARAMETER ON `save_room()`, for two
 * reasons. Adding an optional parameter there would create an overload and
 * leave PostgREST choosing between two `save_room`s; and, worse, a form that
 * saves a number and a floor without mentioning the photograph would then be
 * saying "no photograph" every time somebody corrected a room number.
 *
 * Here null is unambiguous because it is the only thing being said: passing
 * null takes the photograph off.
 *
 * THE PATH IS CHECKED, not trusted. It has to start with this property's id
 * and this room's id, which is the same prefix the storage policy enforces on
 * the upload -- so a value invented in the browser cannot point the room at a
 * file belonging to somebody else.
 */
create function public.set_room_photo(
  p_room_id uuid,
  p_photo_path text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_property uuid;
  v_path text;
  v_prefix text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change a room photograph';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if not exists (
    select 1 from public.rooms r
    where r.id = p_room_id and r.property_id = v_property
  ) then
    raise exception 'That room is not on this property';
  end if;

  v_path := nullif(btrim(coalesce(p_photo_path, '')), '');

  if v_path is not null then
    v_prefix := v_property::text || '/' || p_room_id::text || '/';
    if left(v_path, length(v_prefix)) <> v_prefix then
      raise exception 'That file does not belong to this room';
    end if;
  end if;

  update public.rooms set photo_path = v_path
  where id = p_room_id and property_id = v_property;
end;
$function$;

comment on function public.set_room_photo(uuid, text) is
  'Attach a room-photos object to a room, or pass null to take it off. The path must be under <property_id>/<room_id>/.';


/* -------------------------------------------------------------------------- */
/* The settings list carries the photograph                                   */
/* -------------------------------------------------------------------------- */

/*
 * Dropped and recreated rather than replaced: the return type gains a column,
 * and `create or replace function` cannot change one.
 *
 * Still paged in Postgres. A photograph per row does not change that a
 * property may hold ~1,800 rooms.
 */
drop function if exists public.rooms_for_settings(text, integer, integer);

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
  photo_path text,
  /* Whether anything has ever been booked into it, which is what decides
     if it can be deleted. Counted here so the list does not have to ask
     per row. */
  has_bookings boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $function$
  with filtered as (
    select
      r.id, r.number, r.floor, r.room_type_id, rt.name as room_type_name,
      r.status, r.photo_path,
      exists (
        select 1 from public.booking_rooms br
        where br.room_id = r.id and br.property_id = r.property_id
      ) as has_bookings
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
    count(*) over ()::bigint
  from filtered f
  order by
    f.floor nulls last,
    nullif(regexp_replace(f.number, '\D', '', 'g'), '')::bigint nulls last,
    f.number
  limit greatest(coalesce(p_limit, 100), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;


/* -------------------------------------------------------------------------- */
/* Grants                                                                     */
/* -------------------------------------------------------------------------- */

revoke all on function public.delete_room(uuid) from public, anon;
revoke all on function public.set_room_photo(uuid, text) from public, anon;
revoke all on function public.rooms_for_settings(text, integer, integer) from public, anon;

grant execute on function public.delete_room(uuid) to authenticated;
grant execute on function public.set_room_photo(uuid, text) to authenticated;
grant execute on function public.rooms_for_settings(text, integer, integer) to authenticated;
