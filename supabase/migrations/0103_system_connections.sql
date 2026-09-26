-- Settings -> Connectivity Settings -> Housekeeping Systems, cloned from the
-- client's reference: "No Data" and Add offering Sweeply -- the same screen as
-- Key Lock Systems (0102) with another provider list.
--
-- SO 0102'S TABLE BECOMES THE ONE TABLE FOR BOTH, rather than a second copy
-- of the table, its policy and its two vault-touching functions:
--   * `key_lock_systems` is renamed `system_connections` and gains
--     `category` (key_lock | housekeeping), which the provider decides -- a
--     check constraint says which providers belong to which category, so the
--     two can never disagree.
--   * `save_key_lock_system()` / `delete_key_lock_system()` become
--     `save_system_connection()` / `delete_system_connection()`; the old ones
--     are dropped, not left beside the new ones.
-- Everything 0102 said still holds: STORED, NOT YET CONNECTED; the secret is
-- write-only in Supabase Vault; one connection per provider per property.
--
-- Sweeply's form was not seen either: Property ID + API key, PROVISIONAL.

alter table public.key_lock_systems rename to system_connections;
alter policy key_lock_systems_select_current_property on public.system_connections
  rename to system_connections_select_current_property;

alter table public.system_connections add column category text;
update public.system_connections set category = 'key_lock';
alter table public.system_connections
  alter column category set not null,
  drop constraint key_lock_systems_provider_check,
  add constraint system_connections_provider_check check (
    (category = 'key_lock' and provider in ('flexipass', 'remotelock'))
    or (category = 'housekeeping' and provider in ('sweeply'))
  );

drop function public.save_key_lock_system(uuid, text, text, boolean, text, text);
drop function public.delete_key_lock_system(uuid);

/*
 * p_id null adds one. p_secret null or blank keeps the saved secret;
 * anything else replaces it. The category follows from the provider.
 */
create or replace function public.save_system_connection(
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
  v_row public.system_connections;
  v_name text := btrim(coalesce(p_name, ''));
  v_category text := case
    when p_provider in ('flexipass', 'remotelock') then 'key_lock'
    when p_provider in ('sweeply') then 'housekeeping'
  end;
  v_label text := case p_provider
    when 'flexipass' then 'Flexipass' when 'remotelock' then 'Remotelock' when 'sweeply' then 'Sweeply'
  end;
  v_secret uuid;
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change connected systems';
  end if;
  if v_category is null then
    raise exception 'Choose a system from the list';
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
      select 1 from public.system_connections c
      where c.property_id = v_property and c.provider = p_provider
    ) then
      raise exception '% is already added', v_label;
    end if;
    insert into public.system_connections (property_id, category, provider, name)
    values (v_property, v_category, p_provider, v_name)
    returning * into v_row;
  else
    select * into v_row from public.system_connections
    where id = p_id and property_id = v_property
    for update;
    if not found then
      raise exception 'That connection is not on this property';
    end if;
    if v_row.provider <> p_provider then
      raise exception 'A connection cannot change system';
    end if;
  end if;

  v_secret := v_row.secret_id;
  if nullif(p_secret, '') is not null then
    if v_secret is null then
      v_secret := vault.create_secret(p_secret, 'system_connection:' || v_row.id::text, v_label || ' secret');
    else
      perform vault.update_secret(v_secret, p_secret);
    end if;
  end if;

  update public.system_connections set
    name = v_name,
    is_active = coalesce(p_is_active, false),
    account_id = nullif(btrim(coalesce(p_account_id, '')), ''),
    secret_id = v_secret
  where id = v_row.id;

  return v_row.id;
end;
$$;

revoke execute on function public.save_system_connection(uuid, text, text, boolean, text, text) from public, anon;
grant execute on function public.save_system_connection(uuid, text, text, boolean, text, text) to authenticated;

-- Genuinely deleted, with its secret: nothing points at a connection.
create or replace function public.delete_system_connection(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret uuid;
begin
  if not coalesce(public.is_revenue_staff(), false) or public.current_property_id() is null then
    raise exception 'Only managers and administrators can change connected systems';
  end if;
  delete from public.system_connections
  where id = p_id and property_id = public.current_property_id()
  returning secret_id into v_secret;
  if not found then
    raise exception 'That connection is not on this property';
  end if;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

revoke execute on function public.delete_system_connection(uuid) from public, anon;
grant execute on function public.delete_system_connection(uuid) to authenticated;
