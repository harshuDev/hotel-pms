-- Settings -> Connectivity Settings -> Channel Manager, cloned from the
-- client's reference: a list (Title, Is Active, Is Synced, Synced At) and
-- ADD CHANNEL offering SiteMinder or Vertical Booking, each with its own form.
--
-- STORED, NOT YET CONNECTED. Nothing here talks to SiteMinder or Vertical
-- Booking: there is no sync job, and OTA bookings are still entered by hand
-- (open decision 2). `is_synced` and `synced_at` exist for the day a sync
-- lands and read "No" until then, which is true.
--
-- THE PASSWORD NEVER SITS IN A ROW STAFF CAN READ. The reference asks for the
-- channel manager's login, and a table every member of staff can select is
-- no place for a third party's password -- the rule the payment gateway
-- table already keeps. So:
--   * it goes to Supabase Vault (`vault.create_secret`), encrypted at rest;
--   * the row keeps only the secret's id;
--   * `authenticated` and `anon` have no access to the vault schema, so no
--     browser and no staff session can read it back -- it is WRITE-ONLY from
--     the application. A form shows whether one is saved, never what it is;
--   * a sync job, when one exists, reads it on the server, never the browser.
-- That is why the writes are `security definer`: the vault is reachable only
-- by the function owner. Each checks the role and the property itself.
--
-- The CSV configuration files (room and rate mapping) are kept as text on
-- the row, capped, with the file name. They are configuration, not secrets.

create table public.channel_managers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  provider text not null check (provider in ('site_minder', 'vertical_booking')),
  connection_name text not null check (btrim(connection_name) <> '' and char_length(connection_name) <= 80),
  is_active boolean not null default false,
  username text check (char_length(username) <= 120),
  -- Vault secret id. The password itself is never on this table.
  password_secret_id uuid,
  -- SiteMinder "Hotel Code" / Vertical Booking "Hotel ID".
  hotel_code text check (char_length(hotel_code) <= 60),
  -- Vertical Booking only.
  requestor_id text check (char_length(requestor_id) <= 60),
  -- SiteMinder only. PROVISIONAL list: the reference's dropdown was not seen open.
  region text check (region in ('emea', 'apac', 'americas')),
  days_to_sync integer not null default 400 check (days_to_sync in (90, 180, 365, 400, 500, 730)),
  -- Vertical Booking only.
  sync_multi_occupancy boolean not null default false,
  -- SiteMinder's single "Room & Rate configuration", or Vertical Booking's
  -- "Room CVS configuration".
  room_config_name text check (char_length(room_config_name) <= 200),
  room_config_csv text check (char_length(room_config_csv) <= 262144),
  -- Vertical Booking's "Rate CVS configuration".
  rate_config_name text check (char_length(rate_config_name) <= 200),
  rate_config_csv text check (char_length(rate_config_csv) <= 262144),
  is_synced boolean not null default false,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  -- One connection per channel manager per property.
  unique (property_id, provider),
  check ((room_config_name is null) = (room_config_csv is null)),
  check ((rate_config_name is null) = (rate_config_csv is null))
);

alter table public.channel_managers enable row level security;

create policy channel_managers_select_current_property on public.channel_managers
  for select using (property_id = public.current_property_id());

-- Reads only. Every write goes through the functions below, because the
-- password has to reach the vault and only the function owner can.
grant select on public.channel_managers to authenticated;
revoke insert, update, delete on public.channel_managers from authenticated;
revoke all on public.channel_managers from anon;

/*
 * Save a connection. Nullable arguments mean:
 *   p_id               null adds one;
 *   p_password         null or blank keeps the saved password; anything else replaces it;
 *   p_*_config_name    null keeps the saved file; '' removes it; otherwise
 *                      the file (name and text) replaces it.
 * Fields that belong to the other provider are cleared.
 */
create or replace function public.save_channel_manager(
  p_id uuid,
  p_provider text,
  p_connection_name text,
  p_is_active boolean,
  p_username text,
  p_password text,
  p_hotel_code text,
  p_requestor_id text,
  p_region text,
  p_days_to_sync integer,
  p_sync_multi_occupancy boolean,
  p_room_config_name text,
  p_room_config_csv text,
  p_rate_config_name text,
  p_rate_config_csv text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_row public.channel_managers;
  v_name text := btrim(coalesce(p_connection_name, ''));
  v_vb boolean := p_provider = 'vertical_booking';
  v_secret uuid;
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change channel managers';
  end if;
  if coalesce(p_provider, '') not in ('site_minder', 'vertical_booking') then
    raise exception 'Choose SiteMinder or Vertical Booking';
  end if;
  if v_name = '' then
    raise exception 'Write the connection name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the connection name to 80 characters';
  end if;
  if coalesce(p_days_to_sync, 0) not in (90, 180, 365, 400, 500, 730) then
    raise exception 'Choose how many days to sync';
  end if;
  if not v_vb and p_region is not null and p_region not in ('emea', 'apac', 'americas') then
    raise exception 'Choose the region from the list';
  end if;
  if char_length(coalesce(p_password, '')) > 200 then
    raise exception 'That password is too long';
  end if;
  if char_length(coalesce(p_room_config_csv, '')) > 262144
     or char_length(coalesce(p_rate_config_csv, '')) > 262144 then
    raise exception 'A configuration file can be at most 256 KB';
  end if;
  if (p_room_config_name <> '' and p_room_config_csv is null)
     or (p_rate_config_name <> '' and p_rate_config_csv is null) then
    raise exception 'The configuration file did not arrive; choose it again';
  end if;

  if p_id is null then
    if exists (
      select 1 from public.channel_managers c
      where c.property_id = v_property and c.provider = p_provider
    ) then
      raise exception '% is already added', case when v_vb then 'Vertical Booking' else 'SiteMinder' end;
    end if;
    insert into public.channel_managers (property_id, provider, connection_name)
    values (v_property, p_provider, v_name)
    returning * into v_row;
  else
    select * into v_row from public.channel_managers
    where id = p_id and property_id = v_property
    for update;
    if not found then
      raise exception 'That channel manager is not on this property';
    end if;
    if v_row.provider <> p_provider then
      raise exception 'A connection cannot change channel manager';
    end if;
  end if;

  -- The password: to the vault, never to the row.
  v_secret := v_row.password_secret_id;
  if nullif(p_password, '') is not null then
    if v_secret is null then
      v_secret := vault.create_secret(
        p_password, 'channel_manager:' || v_row.id::text, 'Channel manager password'
      );
    else
      perform vault.update_secret(v_secret, p_password);
    end if;
  end if;

  update public.channel_managers set
    connection_name = v_name,
    is_active = coalesce(p_is_active, false),
    username = nullif(btrim(coalesce(p_username, '')), ''),
    password_secret_id = v_secret,
    hotel_code = nullif(btrim(coalesce(p_hotel_code, '')), ''),
    requestor_id = case when v_vb then nullif(btrim(coalesce(p_requestor_id, '')), '') end,
    region = case when v_vb then null else p_region end,
    days_to_sync = p_days_to_sync,
    sync_multi_occupancy = v_vb and coalesce(p_sync_multi_occupancy, false),
    room_config_name = case
      when p_room_config_name is null then room_config_name
      when p_room_config_name = '' then null
      else left(p_room_config_name, 200) end,
    room_config_csv = case
      when p_room_config_name is null then room_config_csv
      when p_room_config_name = '' then null
      else p_room_config_csv end,
    rate_config_name = case
      when not v_vb then null
      when p_rate_config_name is null then rate_config_name
      when p_rate_config_name = '' then null
      else left(p_rate_config_name, 200) end,
    rate_config_csv = case
      when not v_vb then null
      when p_rate_config_name is null then rate_config_csv
      when p_rate_config_name = '' then null
      else p_rate_config_csv end
  where id = v_row.id;

  return v_row.id;
end;
$$;

revoke execute on function public.save_channel_manager(
  uuid, text, text, boolean, text, text, text, text, text, integer, boolean, text, text, text, text
) from public, anon;
grant execute on function public.save_channel_manager(
  uuid, text, text, boolean, text, text, text, text, text, integer, boolean, text, text, text, text
) to authenticated;

-- Genuinely deleted, with its password: nothing points at a connection.
create or replace function public.delete_channel_manager(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret uuid;
begin
  if not coalesce(public.is_revenue_staff(), false) or public.current_property_id() is null then
    raise exception 'Only managers and administrators can change channel managers';
  end if;
  delete from public.channel_managers
  where id = p_id and property_id = public.current_property_id()
  returning password_secret_id into v_secret;
  if not found then
    raise exception 'That channel manager is not on this property';
  end if;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

revoke execute on function public.delete_channel_manager(uuid) from public, anon;
grant execute on function public.delete_channel_manager(uuid) to authenticated;
