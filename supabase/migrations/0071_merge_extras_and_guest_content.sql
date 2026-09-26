-- Two things the client settled after seeing Hotel Content:
--
-- 1. MERGE on an extra. Their extras list carries a third icon, "merge", which
--    opens "Merge <extra> to:" with a picker of the others. It is how a hotel
--    folds a duplicate -- "Champagne" and "Champagne bottle", or a row somebody
--    saved with a number for a name -- into the one it means to keep.
--
-- 2. The guest booking page shows the hotel's policies and each room type's
--    facilities. The client: "if it's for guest, we should let them know" --
--    the hotel set them, so the hotel already knows; the guest is who needs
--    telling.

/* -------------------------------------------------------------------------
 * merge_extra
 *
 * What a merge has to move here is less than it sounds. A charged extra is a
 * folio item that COPIED its title, type and price when it was posted and
 * holds no reference back (0069), so no posted charge points at either extra
 * and nothing in the ledger moves -- `folio_items` is append-only and must
 * not. The Extras report groups by accounting category, not by catalog row.
 * So merging A into B is: B stays, A leaves the catalog, and every future
 * charge that would have been A is B.
 *
 * It is still its own act rather than Delete wearing another label, because
 * it says WHICH extra A was folded into and writes that to the activity log,
 * the way merge_customers() does. security definer for that log write, so the
 * role and property checks are explicit here rather than left to RLS.
 * ---------------------------------------------------------------------- */

create or replace function public.merge_extra(p_source_id uuid, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_source public.extras;
  v_target public.extras;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the extras';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_source_id is null or p_target_id is null then
    raise exception 'Choose the extra to merge into';
  end if;
  if p_source_id = p_target_id then
    raise exception 'An extra cannot be merged into itself';
  end if;

  select * into v_source from public.extras
  where id = p_source_id and property_id = v_property
  for update;
  if not found then
    raise exception 'That extra no longer exists';
  end if;

  select * into v_target from public.extras
  where id = p_target_id and property_id = v_property;
  if not found then
    raise exception 'The extra to merge into no longer exists';
  end if;

  delete from public.extras where id = v_source.id;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'extra', v_target.id, 'extras_merged',
    format('Extra %s merged into %s', v_source.title, v_target.title),
    jsonb_build_object(
      'kept_id', v_target.id,
      'kept_title', v_target.title,
      'merged_id', v_source.id,
      'merged_title', v_source.title,
      'merged_price_cents', v_source.price_cents,
      'merged_item_type', v_source.item_type
    )
  );
end;
$$;

revoke execute on function public.merge_extra(uuid, uuid) from public, anon;
grant execute on function public.merge_extra(uuid, uuid) to authenticated;

/* -------------------------------------------------------------------------
 * The guest booking page's two new reads.
 *
 * Same shape as public_property(): security definer, the property named in
 * the call because a guest has no staff row, and nothing returned for an
 * unknown or inactive property. They return what a guest is meant to read
 * and nothing else -- no ids of who saved it, no timestamps.
 * ---------------------------------------------------------------------- */

create or replace function public.public_hotel_policies(p_property_id uuid)
returns table (
  children text,
  children_custom text,
  pets text,
  pets_custom text,
  smoking text,
  smoking_custom text,
  internet text,
  internet_custom text,
  parking text,
  parking_custom text,
  other_policies text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pp.children, pp.children_custom,
    pp.pets, pp.pets_custom,
    pp.smoking, pp.smoking_custom,
    pp.internet, pp.internet_custom,
    pp.parking, pp.parking_custom,
    pp.other_policies
  from public.property_policies pp
  join public.properties p on p.id = pp.property_id
  where pp.property_id = p_property_id and p.is_active;
$$;

create or replace function public.public_room_type_facilities(p_property_id uuid)
returns table (
  room_type_id uuid,
  title text,
  icon text
)
language sql
stable
security definer
set search_path = public
as $$
  select rtf.room_type_id, f.title, f.icon
  from public.room_type_facilities rtf
  join public.facilities f on f.id = rtf.facility_id
  join public.properties p on p.id = rtf.property_id
  where rtf.property_id = p_property_id and p.is_active
  order by f.created_at, f.title;
$$;

revoke all on function public.public_hotel_policies(uuid) from public;
revoke all on function public.public_room_type_facilities(uuid) from public;
grant execute on function public.public_hotel_policies(uuid) to anon, authenticated;
grant execute on function public.public_room_type_facilities(uuid) to anon, authenticated;
