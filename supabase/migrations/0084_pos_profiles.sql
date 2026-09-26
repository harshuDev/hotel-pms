-- Settings -> Finances -> Pos Profiles, cloned from the client's reference:
-- "You can add up to one profile per each pos type" -- a list of Pos Type and
-- Is Enabled, and an inline Create Pos Profile form (Type, Enabled, Cancel,
-- Save).
--
-- THE TYPE LIST IS PROVISIONAL. The reference's Type dropdown has not been
-- seen open, so `known_pos_types()` holds the outlets a hotel's point of sale
-- ordinarily posts from. It is one function here and one list in
-- `src/lib/pos-profiles.ts`; correcting it is a replacement of both, and any
-- profile already saved under a type that goes is refused by name on its next
-- save rather than silently rewritten.
--
-- STORED, NOT YET LIVE. No point-of-sale system is connected; a profile
-- records that the hotel runs that outlet and whether it is on. Charges from
-- an outlet are still posted from a booking's Extras tab, from the catalog.
--
-- "Up to one per type" is `unique (property_id, pos_type)`.

create table public.pos_profiles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  pos_type text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (property_id, pos_type)
);

alter table public.pos_profiles enable row level security;

create policy pos_profiles_select_current_property on public.pos_profiles
  for select using (property_id = public.current_property_id());
create policy pos_profiles_insert_revenue_staff on public.pos_profiles
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy pos_profiles_update_revenue_staff on public.pos_profiles
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy pos_profiles_delete_revenue_staff on public.pos_profiles
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.pos_profiles to authenticated;
revoke all on public.pos_profiles from anon;

create or replace function public.known_pos_types()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['restaurant', 'bar', 'room_service', 'spa', 'shop'];
$$;

revoke execute on function public.known_pos_types() from public, anon;
grant execute on function public.known_pos_types() to authenticated;

create or replace function public.save_pos_profile(
  p_id uuid,
  p_pos_type text,
  p_is_enabled boolean
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
    raise exception 'Only managers and administrators can change the pos profiles';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if not (coalesce(p_pos_type, '') = any (public.known_pos_types())) then
    raise exception 'Pick the pos type from the list';
  end if;
  if exists (
    select 1 from public.pos_profiles p
    where p.property_id = v_property and p.pos_type = p_pos_type
      and (p_id is null or p.id <> p_id)
  ) then
    raise exception 'There is already a profile for this pos type. Edit that one instead.';
  end if;

  if p_id is null then
    insert into public.pos_profiles (property_id, pos_type, is_enabled)
    values (v_property, p_pos_type, coalesce(p_is_enabled, true))
    returning id into v_id;
    return v_id;
  end if;

  update public.pos_profiles set
    pos_type = p_pos_type,
    is_enabled = coalesce(p_is_enabled, true)
  where id = p_id and property_id = v_property
  returning id into v_id;
  if v_id is null then
    raise exception 'That pos profile is not on this property';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_pos_profile(uuid, text, boolean) from public, anon;
grant execute on function public.save_pos_profile(uuid, text, boolean) to authenticated;

-- Genuinely deleted: nothing points at a profile.
create or replace function public.delete_pos_profile(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the pos profiles';
  end if;
  delete from public.pos_profiles
  where id = p_id and property_id = public.current_property_id();
end;
$$;

revoke execute on function public.delete_pos_profile(uuid) from public, anon;
grant execute on function public.delete_pos_profile(uuid) to authenticated;
