-- 0140: a login can move between a chosen set of hotels.
--
-- The client: "Please add the following properties to Leadwise Demo Hotel
-- account" -- a group whose one login runs eight hotels. Until now a login
-- belonged to ONE hotel, and only the platform team (0135) could move, to
-- EVERY hotel. Making the group's login a platform member would have shown
-- it every other client's hotel.
--
-- * property_access: (login, hotel, role). Granted by migration or the SQL
--   editor only, like platform_admins -- no policy lets anybody write it, so
--   no hotel administrator can grant themselves another hotel.
-- * switch_property(): a login with a grant on the hotel moves its ONE
--   staff_users row there, as the role the grant names -- the platform
--   team's mechanism, so every screen and policy follows with nothing else
--   changed. A deactivated login stays deactivated.
-- * platform_properties() also returns the hotels a login is granted, so the
--   top bar's switcher appears for it. The team still sees every hotel.

create table if not exists public.property_access (
  user_id     uuid not null references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  role        staff_role not null default 'admin',
  created_at  timestamptz not null default now(),
  primary key (user_id, property_id)
);

alter table public.property_access enable row level security;

create policy property_access_select_self on public.property_access
  for select using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.property_access from anon, authenticated;

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
     or exists (select 1 from public.property_access a
                where a.user_id = auth.uid() and a.property_id = p.id)
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
  v_role staff_role;
begin
  if not public.is_platform_member(auth.uid()) then
    select a.role into v_role
    from public.property_access a
    where a.user_id = auth.uid() and a.property_id = p_property_id;

    if v_role is null then
      raise exception 'Only the platform team can move between hotels';
    end if;

    update public.staff_users
    set property_id = p_property_id, role = v_role
    where id = auth.uid() and is_active;

    if not found then
      raise exception 'Only the platform team can move between hotels';
    end if;

    return p_property_id;
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
