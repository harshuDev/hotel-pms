-- 0045: housekeeping state per room type, for the calendar rail's dot.
--
-- The dot beside each room type on the board showed availability pressure. The
-- client pointed at their reference system, where hovering it says "Room clean
-- status is: Dirty" — so it is housekeeping, not availability. Availability is
-- already the figure in every cell, and having the dot say the same thing twice
-- was a waste of the one mark on the rail.
--
-- Their rail rows appear to be individual rooms, so one room has one clean
-- status. Ours are room types and must stay that way — a property may run
-- ~1,800 rooms and a row each is the key-board grid again. So the dot
-- aggregates: how many rooms of this type are waiting to be cleaned.
--
-- Counts, not a room list. Six integers per type is the same size at 40 rooms
-- and at 1,800, which is the whole point of `house_summary()` on the dashboard.

create or replace function public.room_status_by_type()
returns table(
  room_type_id uuid,
  total_rooms integer,
  vacant_clean integer,
  vacant_dirty integer,
  occupied integer,
  out_of_order integer
)
language sql
stable
set search_path to 'public'
as $function$
  select
    rt.id as room_type_id,
    count(r.id)::integer as total_rooms,
    count(r.id) filter (where r.status = 'vacant_clean')::integer,
    count(r.id) filter (where r.status = 'vacant_dirty')::integer,
    count(r.id) filter (where r.status = 'occupied')::integer,
    count(r.id) filter (where r.status = 'ooo')::integer
  from public.room_types rt
  left join public.rooms r
    on r.room_type_id = rt.id and r.property_id = rt.property_id
  where rt.property_id = public.current_property_id()
  group by rt.id;
$function$;

revoke all on function public.room_status_by_type() from public;
grant execute on function public.room_status_by_type() to authenticated;
