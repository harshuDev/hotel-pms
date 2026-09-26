-- Settings -> Connectivity Settings -> Booking Engine Settings, cloned from
-- the client's reference: Booking Engine Profiles (Title, Slug, Link) with
-- ADD NEW PROFILE, then the booking engine's Privacy Policy and its Terms &
-- Conditions under one SAVE.
--
-- READERS, all on the guest booking page (/book/[propertyId]):
--   * `?profile=<slug>` opens the page on that profile's room types only.
--     Default is the page as it is. Every room type also has a profile of its
--     own that nobody creates -- `__room_type_<8 hex of its id>`, as the
--     reference lists them -- so a hotel can link straight to one room type.
--     A profile narrows what is SHOWN; it is not a security boundary, and
--     `create_public_booking()` is unchanged.
--   * The privacy policy and terms are linked beside the agreement tickbox.
--     Null privacy text is the DEFAULT policy, which lives in
--     `src/lib/booking-engine.ts` with the {{hotel_*}} placeholders; the
--     page fills those from the property. Null terms is none.
--
-- Text is plain, as the registration card's terms are: the reference's
-- rich-text editor would mean storing browser-typed HTML and serving it to
-- guests with no sanitiser in this codebase. "## " starts a heading and "- " a
-- bullet, drawn as React elements, never as HTML.
--
-- ONE NEW FUNCTION ON THE PUBLIC SURFACE, `public_booking_engine()`, read
-- only, like `public_hotel_policies()`.

create table public.booking_engine_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  privacy_policy text check (char_length(privacy_policy) <= 100000),
  terms text check (char_length(terms) <= 100000),
  updated_at timestamptz not null default now()
);

alter table public.booking_engine_settings enable row level security;

create policy booking_engine_settings_select_current_property on public.booking_engine_settings
  for select using (property_id = public.current_property_id());
create policy booking_engine_settings_insert_revenue_staff on public.booking_engine_settings
  for insert with check (property_id = public.current_property_id() and public.is_revenue_staff());
create policy booking_engine_settings_update_revenue_staff on public.booking_engine_settings
  for update using (property_id = public.current_property_id() and public.is_revenue_staff())
  with check (property_id = public.current_property_id() and public.is_revenue_staff());

grant select, insert, update on public.booking_engine_settings to authenticated;
revoke all on public.booking_engine_settings from anon;

create table public.booking_engine_profiles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null check (btrim(title) <> '' and char_length(title) <= 80),
  -- Lower case, digits, - and _. "__" is kept for the room-type profiles.
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  created_at timestamptz not null default now(),
  unique (property_id, slug),
  unique (id, property_id)
);

create table public.booking_engine_profile_room_types (
  profile_id uuid not null,
  room_type_id uuid not null,
  property_id uuid not null,
  primary key (profile_id, room_type_id),
  foreign key (profile_id, property_id)
    references public.booking_engine_profiles (id, property_id) on delete cascade,
  foreign key (room_type_id, property_id)
    references public.room_types (id, property_id) on delete cascade
);

alter table public.booking_engine_profiles enable row level security;
alter table public.booking_engine_profile_room_types enable row level security;

create policy booking_engine_profiles_select_current_property on public.booking_engine_profiles
  for select using (property_id = public.current_property_id());
create policy booking_engine_profiles_write_revenue_staff on public.booking_engine_profiles
  for all using (property_id = public.current_property_id() and public.is_revenue_staff())
  with check (property_id = public.current_property_id() and public.is_revenue_staff());

create policy booking_engine_profile_room_types_select_current_property on public.booking_engine_profile_room_types
  for select using (property_id = public.current_property_id());
create policy booking_engine_profile_room_types_write_revenue_staff on public.booking_engine_profile_room_types
  for all using (property_id = public.current_property_id() and public.is_revenue_staff())
  with check (property_id = public.current_property_id() and public.is_revenue_staff());

grant select, insert, update, delete on public.booking_engine_profiles to authenticated;
grant select, insert, update, delete on public.booking_engine_profile_room_types to authenticated;
revoke all on public.booking_engine_profiles from anon;
revoke all on public.booking_engine_profile_room_types from anon;

/* -- Writes -------------------------------------------------------------- */

-- Blank privacy text goes back to the default policy; blank terms is none.
create or replace function public.save_booking_engine_texts(p_privacy_policy text, p_terms text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change the booking engine';
  end if;
  if char_length(coalesce(p_privacy_policy, '')) > 100000 or char_length(coalesce(p_terms, '')) > 100000 then
    raise exception 'Keep each text under 100,000 characters';
  end if;
  insert into public.booking_engine_settings (property_id, privacy_policy, terms, updated_at)
  values (v_property, nullif(btrim(p_privacy_policy), ''), nullif(btrim(p_terms), ''), now())
  on conflict (property_id) do update set
    privacy_policy = excluded.privacy_policy,
    terms = excluded.terms,
    updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.save_booking_engine_texts(text, text) from public, anon;
grant execute on function public.save_booking_engine_texts(text, text) to authenticated;

-- A profile and its room types, as one decision. No room types is all of them.
create or replace function public.save_booking_engine_profile(
  p_id uuid,
  p_title text,
  p_slug text,
  p_room_type_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_title text := btrim(coalesce(p_title, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_id uuid;
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change the booking engine';
  end if;
  if v_title = '' then
    raise exception 'Write the title';
  end if;
  if char_length(v_title) > 80 then
    raise exception 'Keep the title to 80 characters';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9_-]{0,59}$' then
    raise exception 'The slug is letters, numbers, - and _, starting with a letter or number';
  end if;
  if exists (
    select 1 from public.booking_engine_profiles p
    where p.property_id = v_property and p.slug = v_slug and (p_id is null or p.id <> p_id)
  ) then
    raise exception 'Another profile already uses the slug %', v_slug;
  end if;
  if exists (
    select 1 from unnest(coalesce(p_room_type_ids, '{}')) as x(id)
    where not exists (select 1 from public.room_types rt where rt.id = x.id and rt.property_id = v_property)
  ) then
    raise exception 'A chosen room type is not on this property';
  end if;

  if p_id is null then
    insert into public.booking_engine_profiles (property_id, title, slug)
    values (v_property, v_title, v_slug)
    returning id into v_id;
  else
    update public.booking_engine_profiles set title = v_title, slug = v_slug
    where id = p_id and property_id = v_property
    returning id into v_id;
    if v_id is null then
      raise exception 'That profile is not on this property';
    end if;
    delete from public.booking_engine_profile_room_types where profile_id = v_id;
  end if;

  insert into public.booking_engine_profile_room_types (profile_id, room_type_id, property_id)
  select distinct v_id, x.id, v_property from unnest(coalesce(p_room_type_ids, '{}')) as x(id);

  return v_id;
end;
$$;

revoke execute on function public.save_booking_engine_profile(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.save_booking_engine_profile(uuid, text, text, uuid[]) to authenticated;

-- Genuinely deleted: a profile is a link, not a record of anything.
create or replace function public.delete_booking_engine_profile(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not coalesce(public.is_revenue_staff(), false) then
    raise exception 'Only managers and administrators can change the booking engine';
  end if;
  delete from public.booking_engine_profiles
  where id = p_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That profile is not on this property';
  end if;
end;
$$;

revoke execute on function public.delete_booking_engine_profile(uuid) from public, anon;
grant execute on function public.delete_booking_engine_profile(uuid) to authenticated;

/* -- The public read ---------------------------------------------------- */

-- The slug a room type's own profile goes by.
create or replace function public.room_type_profile_slug(p_room_type_id uuid)
returns text
language sql
immutable
as $$
  select '__room_type_' || left(replace(p_room_type_id::text, '-', ''), 8);
$$;

revoke execute on function public.room_type_profile_slug(uuid) from public, anon;
grant execute on function public.room_type_profile_slug(uuid) to authenticated;

/*
 * What the guest booking page needs from these settings, for an active
 * property: the privacy policy (null = the default), the terms (null =
 * none), the address the policy's placeholders are filled from, and the room
 * types the profile allows (null = every one, including for an unknown or
 * absent slug).
 */
create or replace function public.public_booking_engine(p_property_id uuid, p_profile text)
returns table (
  privacy_policy text,
  terms text,
  country text,
  postcode text,
  city text,
  region text,
  address text,
  email text,
  phone text,
  room_type_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slug text := lower(btrim(coalesce(p_profile, '')));
  v_ids uuid[];
begin
  if not exists (select 1 from public.properties p where p.id = p_property_id and p.is_active) then
    return;
  end if;

  if v_slug like '\_\_room\_type\_%' then
    select array_agg(rt.id) into v_ids
    from public.room_types rt
    where rt.property_id = p_property_id
      and public.room_type_profile_slug(rt.id) = v_slug;
  elsif v_slug <> '' then
    select coalesce(array_agg(l.room_type_id) filter (where l.room_type_id is not null), '{}') into v_ids
    from public.booking_engine_profiles p
    left join public.booking_engine_profile_room_types l on l.profile_id = p.id
    where p.property_id = p_property_id and p.slug = v_slug
    group by p.id;
    -- A profile with no room types chosen shows them all.
    if v_ids = '{}' then v_ids := null; end if;
  end if;

  return query
  select s.privacy_policy, s.terms,
    p.country::text, p.postcode, p.city, p.region,
    nullif(concat_ws(', ', nullif(p.address_line1, ''), nullif(p.address_line2, '')), ''),
    p.email, p.phone, v_ids
  from public.properties p
  left join public.booking_engine_settings s on s.property_id = p.id
  where p.id = p_property_id;
end;
$$;

revoke execute on function public.public_booking_engine(uuid, text) from public;
grant execute on function public.public_booking_engine(uuid, text) to anon, authenticated;
