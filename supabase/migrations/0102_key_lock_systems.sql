-- Settings -> Connectivity Settings -> Key Lock Systems, cloned from the
-- client's reference: a list ("No Data" when empty) and Add offering
-- Flexipass or Remotelock.
--
-- STORED, NOT YET CONNECTED -- the same standing as Channel Manager (0097).
-- Nothing here talks to a lock: no door code is sent and none is issued.
-- What a connection will use when one lands is already on the rooms: Key
-- Code, Common Door Name and "Use Booking Room id as Key Code" (0091).
--
-- THE FORMS WERE NOT SEEN, so the fields are PROVISIONAL and ordinary for
-- each provider: RemoteLock authenticates with an OAuth client id and client
-- secret; Flexipass with an account and an API key. One connection per
-- provider per property.
--
-- THE SECRET IS WRITE-ONLY, IN SUPABASE VAULT, exactly as a channel manager's
-- password is: the row keeps the vault id and nothing else, staff and anon
-- cannot read the vault, and the writes are `security definer` so that they
-- can reach it, checking the role and the property themselves.

create table public.key_lock_systems (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  provider text not null check (provider in ('flexipass', 'remotelock')),
  name text not null check (btrim(name) <> '' and char_length(name) <= 80),
  is_active boolean not null default false,
  -- RemoteLock client id / Flexipass account.
  account_id text check (char_length(account_id) <= 200),
  -- Vault secret id: RemoteLock client secret / Flexipass API key.
  secret_id uuid,
  created_at timestamptz not null default now(),
  unique (property_id, provider)
);

alter table public.key_lock_systems enable row level security;

create policy key_lock_systems_select_current_property on public.key_lock_systems
  for select using (property_id = public.current_property_id());

-- Reads only; every write goes through the functions, which reach the vault.
grant select on public.key_lock_systems to authenticated;
revoke insert, update, delete on public.key_lock_systems from authenticated;
revoke all on public.key_lock_systems from anon;

/*
 * p_id null adds one. p_secret null or blank keeps the saved secret;
 * anything else replaces it.
 */
create or replace function public.save_key_lock_system(
  p_id uuid,
  p_provider text,
  p_name text,
  p_is_active boolean,
  p_account_id text,
  p_secret text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_row public.key_lock_systems;
  v_name text := btrim(coalesce(p_name, ''));
  v_secret uuid;
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change key lock systems';
  end if;
  if coalesce(p_provider, '') not in ('flexipass', 'remotelock') then
    raise exception 'Choose Flexipass or Remotelock';
  end if;
  if v_name = '' then
    raise exception 'Write the name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the name to 80 characters';
  end if;
  if char_length(coalesce(p_account_id, '')) > 200 or char_length(coalesce(p_secret, '')) > 500 then
    raise exception 'That value is too long';
  end if;

  if p_id is null then
    if exists (
      select 1 from public.key_lock_systems k
      where k.property_id = v_property and k.provider = p_provider
    ) then
      raise exception '% is already added', case when p_provider = 'flexipass' then 'Flexipass' else 'Remotelock' end;
    end if;
    insert into public.key_lock_systems (property_id, provider, name)
    values (v_property, p_provider, v_name)
    returning * into v_row;
  else
    select * into v_row from public.key_lock_systems
    where id = p_id and property_id = v_property
    for update;
    if not found then
      raise exception 'That key lock system is not on this property';
    end if;
    if v_row.provider <> p_provider then
      raise exception 'A connection cannot change provider';
    end if;
  end if;

  v_secret := v_row.secret_id;
  if nullif(p_secret, '') is not null then
    if v_secret is null then
      v_secret := vault.create_secret(p_secret, 'key_lock_system:' || v_row.id::text, 'Key lock system secret');
    else
      perform vault.update_secret(v_secret, p_secret);
    end if;
  end if;

  update public.key_lock_systems set
    name = v_name,
    is_active = coalesce(p_is_active, false),
    account_id = nullif(btrim(coalesce(p_account_id, '')), ''),
    secret_id = v_secret
  where id = v_row.id;

  return v_row.id;
end;
$$;

revoke execute on function public.save_key_lock_system(uuid, text, text, boolean, text, text) from public, anon;
grant execute on function public.save_key_lock_system(uuid, text, text, boolean, text, text) to authenticated;

-- Genuinely deleted, with its secret: nothing points at a connection.
create or replace function public.delete_key_lock_system(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret uuid;
begin
  if not coalesce(public.is_revenue_staff(), false) or public.current_property_id() is null then
    raise exception 'Only managers and administrators can change key lock systems';
  end if;
  delete from public.key_lock_systems
  where id = p_id and property_id = public.current_property_id()
  returning secret_id into v_secret;
  if not found then
    raise exception 'That key lock system is not on this property';
  end if;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

revoke execute on function public.delete_key_lock_system(uuid) from public, anon;
grant execute on function public.delete_key_lock_system(uuid) to authenticated;
