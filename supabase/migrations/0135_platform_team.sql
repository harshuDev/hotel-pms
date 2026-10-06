-- 0135: the platform team onboards hotels.
--
-- The client: "I want to be the one (my support team also) that onboard the
-- hotel. We will send the hotel invitation once we've created the profile
-- and populated it with the hotel information ... Can we add properties to
-- my user?"
--
-- * platform_admins: the client's own team. Granted by migration or the SQL
--   editor only -- no policy lets anybody write it, so no hotel admin can
--   ever make themselves one.
-- * A platform member keeps ONE staff_users row and switches which hotel it
--   points at (switch_property). current_property_id(), the root of every
--   RLS policy, reads that row, so every screen follows the switch with no
--   policy changed. 0134 is what lets the row move.
-- * create_property(): a new hotel, its first open business date, and the
--   caller switched into it. The accounting categories come from the
--   existing trigger on properties; everything else the team sets up in
--   Settings, as the client wants -- the hotel only gets a login when it is
--   ready.
-- * add_staff_by_email(): links an existing login to the current hotel. The
--   login itself is still created by an invitation from Supabase Auth.
-- * The team is invisible to a hotel: left out of its Staff list, and a
--   hotel administrator can neither edit, deactivate, delete nor re-add one.

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

create policy platform_admins_select_self on public.platform_admins
  for select using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_member(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user is not null
     and exists (select 1 from public.platform_admins where user_id = p_user);
$$;

revoke all on function public.is_platform_member(uuid) from public;
revoke execute on function public.is_platform_member(uuid) from anon;
grant execute on function public.is_platform_member(uuid) to authenticated;

-- A hotel administrator manages the hotel's staff, never the platform team.
alter policy staff_users_update_admin on public.staff_users
  using (property_id = current_property_id() and public.current_role() = 'admin'
         and not public.is_platform_member(id))
  with check (property_id = current_property_id() and public.current_role() = 'admin'
              and not public.is_platform_member(id));

alter policy staff_users_delete_admin on public.staff_users
  using (property_id = current_property_id() and public.current_role() = 'admin'
         and not public.is_platform_member(id));

alter policy staff_users_insert_admin on public.staff_users
  with check (property_id = current_property_id() and public.current_role() = 'admin'
              and not public.is_platform_member(id));

-- The hotel's own staff, for Settings -> Staff: the team is left out.
create or replace function public.staff_settings_list()
returns table (id uuid, full_name text, role staff_role, is_active boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.full_name, s.role, s.is_active
  from public.staff_users s
  where s.property_id = public.current_property_id()
    and not public.is_platform_member(s.id)
  order by s.is_active desc, s.full_name;
$$;

revoke all on function public.staff_settings_list() from public;
revoke execute on function public.staff_settings_list() from anon;
grant execute on function public.staff_settings_list() to authenticated;

-- Every hotel, for the switcher and Settings -> Hotel Properties. Empty for
-- anybody not on the platform team.
create or replace function public.platform_properties()
returns table (
  id uuid,
  name text,
  country text,
  city text,
  currency text,
  timezone text,
  is_active boolean,
  created_at timestamptz,
  room_count bigint,
  staff_count bigint,
  is_current boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.country::text, p.city, btrim(p.currency::text), p.timezone,
         p.is_active, p.created_at,
         (select count(*) from public.rooms r where r.property_id = p.id),
         (select count(*) from public.staff_users s
           where s.property_id = p.id and s.is_active
             and not public.is_platform_member(s.id)),
         p.id = public.current_property_id()
  from public.properties p
  where public.is_platform_member(auth.uid())
  order by lower(p.name);
$$;

revoke all on function public.platform_properties() from public;
revoke execute on function public.platform_properties() from anon;
grant execute on function public.platform_properties() to authenticated;

create or replace function public.switch_property(p_property_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_name text;
begin
  if not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can move between hotels';
  end if;

  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'That hotel does not exist';
  end if;

  update public.staff_users
  set property_id = p_property_id, role = 'admin', is_active = true
  where id = auth.uid();

  if not found then
    select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), u.email)
      into v_name
    from auth.users u where u.id = auth.uid();

    insert into public.staff_users (id, property_id, full_name, role, is_active)
    values (auth.uid(), p_property_id, coalesce(v_name, 'Platform team'), 'admin', true);
  end if;

  return p_property_id;
end;
$$;

revoke all on function public.switch_property(uuid) from public;
revoke execute on function public.switch_property(uuid) from anon;
grant execute on function public.switch_property(uuid) to authenticated;

create or replace function public.create_property(
  p_name text,
  p_country text,
  p_currency text,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_country text := nullif(upper(btrim(coalesce(p_country, ''))), '');
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_timezone text := btrim(coalesce(p_timezone, ''));
  v_today date;
  v_id uuid;
begin
  if not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can add a hotel';
  end if;

  if v_name = '' then
    raise exception 'A hotel needs a name';
  end if;

  if exists (select 1 from public.properties where lower(name) = lower(v_name)) then
    raise exception 'There is already a hotel called %', v_name;
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose the hotel''s currency';
  end if;

  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'Choose the hotel''s country';
  end if;

  -- The first business date is the hotel's own today, in its own zone.
  begin
    v_today := (now() at time zone v_timezone)::date;
  exception when others then
    raise exception 'Choose the hotel''s time zone';
  end;

  insert into public.properties (name, country, currency, timezone, check_in_time, check_out_time)
  values (v_name, v_country, v_currency, v_timezone, time '15:00', time '11:00')
  returning id into v_id;

  perform public.switch_property(v_id);

  insert into public.business_dates (property_id, business_date, status, opened_by)
  values (v_id, v_today, 'open', auth.uid());

  return v_id;
end;
$$;

revoke all on function public.create_property(text, text, text, text) from public;
revoke execute on function public.create_property(text, text, text, text) from anon;
grant execute on function public.create_property(text, text, text, text) to authenticated;

create or replace function public.add_staff_by_email(
  p_email text,
  p_full_name text,
  p_role staff_role
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid := public.current_property_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_user uuid;
  v_existing uuid;
begin
  if not coalesce(public.current_role() = 'admin', false) or v_property is null then
    raise exception 'Only administrators can add a member of staff';
  end if;

  if v_email = '' then
    raise exception 'Enter the person''s email';
  end if;

  if v_name = '' then
    raise exception 'A member of staff needs a name';
  end if;

  if p_role is null then
    raise exception 'Choose a role';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = v_email;

  if v_user is null then
    raise exception 'There is no login for %. Send them an invitation first.', v_email;
  end if;

  if public.is_platform_member(v_user) then
    raise exception '% is on the platform team and cannot be added to a hotel', v_email;
  end if;

  select s.property_id into v_existing from public.staff_users s where s.id = v_user;

  if v_existing = v_property then
    raise exception '% is already on this hotel''s staff', v_email;
  elsif v_existing is not null then
    raise exception '% already works at another hotel', v_email;
  end if;

  insert into public.staff_users (id, property_id, full_name, role, is_active)
  values (v_user, v_property, v_name, p_role, true);

  return v_user;
end;
$$;

revoke all on function public.add_staff_by_email(text, text, staff_role) from public;
revoke execute on function public.add_staff_by_email(text, text, staff_role) from anon;
grant execute on function public.add_staff_by_email(text, text, staff_role) to authenticated;
