-- Channex, step one: a hotel's Channex connection, and a test that it works.
--
-- The client is integrating with Channex (their channel manager, which feeds
-- Booking.com, Expedia and the rest). Channex authenticates with an API KEY,
-- made in Channex under the profile's API key page -- never a username and
-- password.
--
-- THE CALLS GO FROM POSTGRES, through the `http` extension 0138 enabled for
-- the exchange rates: the database can reach Channex, the key never leaves
-- the server, and no new route is needed. Pushing rates and availability and
-- pulling bookings will run the same way, on pg_cron, in later steps.
--
-- This step only:
--  - `channex_connections`: one per property -- environment (staging or
--    production), the key's Vault id, the Channex property it maps to, and
--    the last test's result. Its own table rather than a provider on
--    `channel_managers`, whose provider list is a check constraint.
--  - the KEY IS WRITE-ONLY IN SUPABASE VAULT, as a channel manager's
--    password (0097): security definer writes, a SELECT-only table, a blank
--    field keeps the saved key.
--  - `test_channex_connection()` lists the Channex properties the key can
--    see, records the result, and returns them so the screen can map this
--    hotel to one.

create table public.channex_connections (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id) on delete cascade,
  environment text not null default 'staging' check (environment in ('staging', 'production')),
  api_key_secret_id uuid,
  channex_property_id text check (channex_property_id is null or channex_property_id ~ '^[0-9a-f-]{36}$'),
  is_active boolean not null default false,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_message text check (char_length(last_test_message) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.channex_connections enable row level security;

create policy channex_connections_select_current_property on public.channex_connections
  for select using (property_id = public.current_property_id());

revoke all on public.channex_connections from anon;
revoke insert, update on public.channex_connections from authenticated;
grant select on public.channex_connections to authenticated;

-- The base URL for an environment.
create or replace function public.channex_base_url(p_environment text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_environment = 'production'
    then 'https://app.channex.io/api/v1'
    else 'https://staging.channex.io/api/v1' end;
$$;

revoke all on function public.channex_base_url(text) from public;
revoke execute on function public.channex_base_url(text) from anon, authenticated;

-- Saves the connection. A blank key keeps the one saved; the key goes to the
-- vault, never to the row.
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
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change channel managers';
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
    -- A different key or environment has not been tested.
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

-- Calls Channex with the saved key and lists the properties it can see.
-- Records the outcome on the connection either way.
create or replace function public.test_channex_connection()
returns table (ok boolean, message text, channex_property_id text, title text, currency text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_property uuid := public.current_property_id();
  v_row public.channex_connections;
  v_key text;
  v_resp extensions.http_response;
  v_body jsonb;
  v_ok boolean := false;
  v_message text;
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change channel managers';
  end if;
  select * into v_row from public.channex_connections where property_id = v_property;
  if not found or v_row.api_key_secret_id is null then
    raise exception 'Add the Channex API key first';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where id = v_row.api_key_secret_id;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
    v_resp := extensions.http((
      'GET',
      public.channex_base_url(v_row.environment) || '/properties?pagination[limit]=100',
      array[extensions.http_header('user-api-key', v_key)],
      null,
      null
    )::extensions.http_request);
    if v_resp.status = 200 then
      v_body := v_resp.content::jsonb;
      v_ok := true;
      v_message := 'Connected';
    elsif v_resp.status in (401, 403) then
      v_message := 'Channex refused the API key';
    else
      v_message := 'Channex answered ' || v_resp.status::text;
    end if;
  exception when others then
    v_message := left('Could not reach Channex: ' || sqlerrm, 500);
  end;

  update public.channex_connections set
    last_tested_at = now(), last_test_ok = v_ok, last_test_message = v_message
  where id = v_row.id;

  if not v_ok then
    return query select false, v_message, null::text, null::text, null::text;
    return;
  end if;
  return query
  select true, v_message,
    d ->> 'id',
    d -> 'attributes' ->> 'title',
    d -> 'attributes' ->> 'currency'
  from jsonb_array_elements(coalesce(v_body -> 'data', '[]'::jsonb)) d;
  if not found then
    return query select true, v_message, null::text, null::text, null::text;
  end if;
end;
$$;

revoke all on function public.test_channex_connection() from public;
revoke execute on function public.test_channex_connection() from anon;
grant execute on function public.test_channex_connection() to authenticated;
