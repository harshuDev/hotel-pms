-- 0146: a Channex API key that is obviously not one is refused on Save.
--
-- On 21 Oct an 8-character value was saved as Reservation Centric Hotel's
-- Channex key; every call after it came back 401 Unauthorized, and a later
-- Test connection kept testing it, because the card tests the SAVED key and
-- the new one had been typed but not saved. A Channex key is about 64
-- characters (docs.channex.io, API Key Access), so anything under 32 is
-- refused by name. The card now saves a newly typed key before testing it.
--
-- save_channex_connection() is replaced whole; its signature is unchanged.

create or replace function public.save_channex_connection(
  p_environment text,
  p_api_key text,
  p_channex_property_id text,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_row public.channex_connections;
  v_secret uuid;
  v_channex text := nullif(btrim(coalesce(p_channex_property_id, '')), '');
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  if coalesce(p_environment, '') not in ('staging', 'production') then
    raise exception 'Pick Staging or Production';
  end if;
  if v_channex is not null and v_channex !~ '^[0-9a-f-]{36}$' then
    raise exception 'That is not a Channex property id';
  end if;

  select * into v_row from public.channex_connections where property_id = v_property;
  if not found then
    insert into public.channex_connections (property_id, environment)
    values (v_property, p_environment)
    returning * into v_row;
  end if;

  v_secret := v_row.api_key_secret_id;
  -- A Channex key is about 64 characters. Anything this short is a key cut
  -- off when copied, a key id or a password, and would only come back as a
  -- 401 later.
  if nullif(btrim(coalesce(p_api_key, '')), '') is not null
     and char_length(btrim(p_api_key)) < 32 then
    raise exception 'That is not a whole Channex API key. Copy the full key from Channex: Profile, then API Keys';
  end if;
  if nullif(btrim(coalesce(p_api_key, '')), '') is not null then
    if v_secret is null then
      v_secret := vault.create_secret(
        btrim(p_api_key), 'channex:' || v_row.id::text, 'Channex API key'
      );
    else
      perform vault.update_secret(v_secret, btrim(p_api_key));
    end if;
  end if;

  if coalesce(p_is_active, false) and v_secret is null then
    raise exception 'Add the Channex API key first';
  end if;

  update public.channex_connections set
    environment = p_environment,
    api_key_secret_id = v_secret,
    channex_property_id = v_channex,
    is_active = coalesce(p_is_active, false),
    last_test_ok = case
      when nullif(btrim(coalesce(p_api_key, '')), '') is not null or environment <> p_environment then null
      else last_test_ok end,
    updated_at = now()
  where id = v_row.id;

  return v_row.id;
end;
$$;

revoke all on function public.save_channex_connection(text, text, text, boolean) from public;
revoke execute on function public.save_channex_connection(text, text, text, boolean) from anon;
grant execute on function public.save_channex_connection(text, text, text, boolean) to authenticated;
