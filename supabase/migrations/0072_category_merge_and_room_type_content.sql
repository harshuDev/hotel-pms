-- 1. MERGE on an extra CATEGORY, which the client asked for after extras got
--    theirs: their categories table carries the same arrows icon.
--
-- 2. What the rebuilt guest booking page shows about a room type beyond its
--    name and price: a description and photographs, as the client's current
--    booking engine does ("Nuestra encantadora y amplia habitación...", and a
--    carousel on every room card).

/* -------------------------------------------------------------------------
 * merge_extra_category
 *
 * Unlike merging two extras, this one moves something: every extra in the
 * source category goes to the target, and then the source goes. One
 * transaction, so no moment exists where extras point at a category being
 * deleted -- the foreign key is `on delete restrict` and would refuse anyway.
 *
 * A moved extra that names no tax rate of its own is taxed at its NEW
 * category's rate from then on, since that is what "no rate of its own"
 * means. Nothing already posted changes: charges carry their own tax.
 * ---------------------------------------------------------------------- */

create or replace function public.merge_extra_category(p_source_id uuid, p_target_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_source public.extra_categories;
  v_target public.extra_categories;
  v_moved integer;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the extras';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_source_id is null or p_target_id is null then
    raise exception 'Choose the category to merge into';
  end if;
  if p_source_id = p_target_id then
    raise exception 'A category cannot be merged into itself';
  end if;

  select * into v_source from public.extra_categories
  where id = p_source_id and property_id = v_property
  for update;
  if not found then
    raise exception 'That category no longer exists';
  end if;

  select * into v_target from public.extra_categories
  where id = p_target_id and property_id = v_property;
  if not found then
    raise exception 'The category to merge into no longer exists';
  end if;

  update public.extras
  set category_id = v_target.id
  where category_id = v_source.id and property_id = v_property;
  get diagnostics v_moved = row_count;

  delete from public.extra_categories where id = v_source.id;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'extra_category', v_target.id, 'extra_categories_merged',
    format('Extra category %s merged into %s (%s extra%s moved)',
      v_source.title, v_target.title, v_moved, case when v_moved = 1 then '' else 's' end),
    jsonb_build_object(
      'kept_id', v_target.id,
      'kept_title', v_target.title,
      'merged_id', v_source.id,
      'merged_title', v_source.title,
      'extras_moved', v_moved
    )
  );

  return v_moved;
end;
$$;

revoke execute on function public.merge_extra_category(uuid, uuid) from public, anon;
grant execute on function public.merge_extra_category(uuid, uuid) to authenticated;

/* -------------------------------------------------------------------------
 * room_types.description
 *
 * Its own setter rather than a parameter on save_room_type(): a changed
 * parameter list is a second function for PostgREST to choose between, and a
 * form fixing a room type's code would be saying "and no description" every
 * time. The same reason set_room_photo() stands apart from save_room().
 * ---------------------------------------------------------------------- */

alter table public.room_types add column description text;

create or replace function public.set_room_type_description(
  p_room_type_id uuid,
  p_description text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change room types';
  end if;

  update public.room_types
  set description = nullif(btrim(coalesce(p_description, '')), '')
  where id = p_room_type_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That room type no longer exists';
  end if;
end;
$$;

revoke execute on function public.set_room_type_description(uuid, text) from public, anon;
grant execute on function public.set_room_type_description(uuid, text) to authenticated;

/* -------------------------------------------------------------------------
 * public_room_type_content
 *
 * A room type's description and its photographs, for the guest page. There
 * is no room TYPE photograph: photos have been per room since 0055, in the
 * public `room-photos` bucket. So a type shows the photographs of its own
 * rooms -- which is what the guest will actually sleep in -- up to eight,
 * in room number order. Paths, never URLs: the page builds the public URL,
 * the same way Settings does.
 *
 * Same shape as the other public reads: security definer, the property named
 * in the call, nothing for an unknown or inactive property.
 * ---------------------------------------------------------------------- */

create or replace function public.public_room_type_content(p_property_id uuid)
returns table (
  room_type_id uuid,
  description text,
  photo_paths text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rt.id,
    rt.description,
    coalesce(
      (
        select array_agg(x.photo_path order by x.number)
        from (
          select r.photo_path, r.number
          from public.rooms r
          where r.room_type_id = rt.id
            and r.property_id = rt.property_id
            and r.photo_path is not null
          order by r.number
          limit 8
        ) x
      ),
      '{}'::text[]
    )
  from public.room_types rt
  join public.properties p on p.id = rt.property_id
  where rt.property_id = p_property_id and p.is_active;
$$;

revoke all on function public.public_room_type_content(uuid) from public;
grant execute on function public.public_room_type_content(uuid) to anon, authenticated;
