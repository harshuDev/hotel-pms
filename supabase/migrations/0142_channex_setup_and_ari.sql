-- 0142: Channex, step two -- the platform team creates the hotel in Channex
-- and pushes its rates, availability and restrictions.
--
-- Decided with the client (2026-10-20):
--  * ONLY THE PLATFORM TEAM sets Channex up. Hotels never see the key, the
--    mapping or the sync. save_channex_connection() and
--    test_channex_connection() now refuse anybody else, and the tables below
--    are readable by the team only.
--  * THE PMS CREATES CHANNEX'S STRUCTURE. channex_setup() makes the Channex
--    property (unless one was picked), a Channex room type per room type,
--    and a Channex rate plan per (rate plan, room type) pair that is priced
--    from the business date on -- a Channex rate plan belongs to ONE room
--    type. Each link is remembered, so running it again only creates what is
--    missing.
--  * THE PMS IS THE SOURCE OF ARI. channex_push_ari() sends availability
--    (rooms left to sell, the calendar's own figure, never below zero) and,
--    per rate plan, the night's rate IN THE PLAN'S OWN CURRENCY (0138) with
--    its restrictions. A night with no rate loaded cannot be sold here, so it
--    goes as stop sell.
--  * ONLY WHAT CHANGED IS SENT. channex_ari_sent remembers the last value
--    sent per Channex id and night; a push compares and sends the changed
--    nights, joined into date ranges. "Full" resends everything.
--  * Is Active means "keep Channex up to date": pg_cron runs
--    channex_push_all() every 15 minutes for active connections.
--
-- Links and sent values carry the Channex property id, so pointing a hotel at
-- another Channex property starts clean without deleting anything.
--
-- Not yet (step three): bookings in from the booking-revisions feed;
-- per-occupancy prices; updating a Channex room type's room count.

-- 1. Channex is the platform team's -------------------------------------------

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

-- Calls Channex with a property's saved key. Granted to nobody: only the
-- functions below, which check the caller first, reach it.
create or replace function public.channex_call(
  p_property uuid,
  p_method text,
  p_path text,
  p_body jsonb default null
)
returns table (status integer, body jsonb)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_conn public.channex_connections;
  v_key text;
  v_resp extensions.http_response;
  v_body jsonb;
begin
  select * into v_conn from public.channex_connections c where c.property_id = p_property;
  if not found or v_conn.api_key_secret_id is null then
    raise exception 'Add the Channex API key first';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where id = v_conn.api_key_secret_id;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');
  v_resp := extensions.http((
    p_method::extensions.http_method,
    public.channex_base_url(v_conn.environment) || p_path,
    array[extensions.http_header('user-api-key', v_key)],
    case when p_body is null then null else 'application/json' end,
    case when p_body is null then null else p_body::text end
  )::extensions.http_request);

  begin
    v_body := v_resp.content::jsonb;
  exception when others then
    v_body := jsonb_build_object('raw', left(coalesce(v_resp.content, ''), 500));
  end;

  return query select v_resp.status, v_body;
end;
$$;

revoke all on function public.channex_call(uuid, text, text, jsonb) from public;
revoke execute on function public.channex_call(uuid, text, text, jsonb) from anon, authenticated;

-- What Channex said when it refused, in one line.
create or replace function public.channex_error_text(p_status integer, p_body jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    'Channex answered ' || coalesce(p_status::text, '?') || ': ' ||
    coalesce(
      nullif(concat_ws(' ', p_body -> 'errors' ->> 'title', (p_body -> 'errors' -> 'details')::text), ''),
      p_body ->> 'raw',
      p_body::text,
      ''
    ),
    500
  );
$$;

revoke all on function public.channex_error_text(integer, jsonb) from public;
revoke execute on function public.channex_error_text(integer, jsonb) from anon, authenticated;

create or replace function public.test_channex_connection()
returns table (ok boolean, message text, channex_property_id text, title text, currency text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_row public.channex_connections;
  v_status integer;
  v_body jsonb;
  v_ok boolean := false;
  v_message text;
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  select * into v_row from public.channex_connections c where c.property_id = v_property;
  if not found or v_row.api_key_secret_id is null then
    raise exception 'Add the Channex API key first';
  end if;

  begin
    select r.status, r.body into v_status, v_body
    from public.channex_call(v_property, 'GET', '/properties?pagination[limit]=100') r;
    if v_status = 200 then
      v_ok := true;
      v_message := 'Connected';
    elsif v_status in (401, 403) then
      v_message := 'Channex refused the API key';
    else
      v_message := 'Channex answered ' || v_status::text;
    end if;
  exception when others then
    v_message := left('Could not reach Channex: ' || sqlerrm, 500);
  end;

  update public.channex_connections c set
    last_tested_at = now(), last_test_ok = v_ok, last_test_message = v_message
  where c.id = v_row.id;

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

alter policy channex_connections_select_current_property on public.channex_connections
  using (property_id = public.current_property_id() and public.is_platform_member(auth.uid()));

-- 2. Links, sent values, the log -----------------------------------------------

create table if not exists public.channex_room_type_map (
  property_id uuid not null references public.properties (id) on delete cascade,
  room_type_id uuid not null references public.room_types (id) on delete cascade,
  channex_property_id text not null,
  channex_room_type_id text not null,
  created_at timestamptz not null default now(),
  primary key (room_type_id, channex_property_id)
);

create table if not exists public.channex_rate_plan_map (
  property_id uuid not null references public.properties (id) on delete cascade,
  rate_plan_id uuid not null references public.rate_plans (id) on delete cascade,
  room_type_id uuid not null references public.room_types (id) on delete cascade,
  channex_property_id text not null,
  channex_rate_plan_id text not null,
  created_at timestamptz not null default now(),
  primary key (rate_plan_id, room_type_id, channex_property_id)
);

create table if not exists public.channex_ari_sent (
  property_id uuid not null references public.properties (id) on delete cascade,
  channex_property_id text not null,
  kind text not null check (kind in ('availability', 'restrictions')),
  channex_id text not null,
  stay_date date not null,
  value jsonb not null,
  sent_at timestamptz not null default now(),
  primary key (channex_property_id, kind, channex_id, stay_date)
);

create table if not exists public.channex_sync_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  kind text not null check (kind in ('setup', 'ari')),
  ok boolean not null,
  sent integer not null default 0,
  failed integer not null default 0,
  message text check (char_length(message) <= 1000),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists channex_sync_log_property_idx
  on public.channex_sync_log (property_id, created_at desc);

alter table public.channex_room_type_map enable row level security;
alter table public.channex_rate_plan_map enable row level security;
alter table public.channex_ari_sent enable row level security;
alter table public.channex_sync_log enable row level security;

create policy channex_room_type_map_select_team on public.channex_room_type_map
  for select using (property_id = public.current_property_id() and public.is_platform_member(auth.uid()));
create policy channex_rate_plan_map_select_team on public.channex_rate_plan_map
  for select using (property_id = public.current_property_id() and public.is_platform_member(auth.uid()));
create policy channex_ari_sent_select_team on public.channex_ari_sent
  for select using (property_id = public.current_property_id() and public.is_platform_member(auth.uid()));
create policy channex_sync_log_select_team on public.channex_sync_log
  for select using (property_id = public.current_property_id() and public.is_platform_member(auth.uid()));

revoke all on public.channex_room_type_map, public.channex_rate_plan_map,
  public.channex_ari_sent, public.channex_sync_log from anon;
revoke insert, update, delete, truncate on public.channex_room_type_map, public.channex_rate_plan_map,
  public.channex_ari_sent, public.channex_sync_log from authenticated;
grant select on public.channex_room_type_map, public.channex_rate_plan_map,
  public.channex_ari_sent, public.channex_sync_log to authenticated;

-- 3. Create the hotel in Channex -------------------------------------------------

create or replace function public.channex_setup()
returns table (step text, label text, succeeded boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_conn public.channex_connections;
  v_prop public.properties;
  v_today date;
  v_cx text;
  v_status integer;
  v_body jsonb;
  v_id text;
  v_made integer := 0;
  v_failed integer := 0;
  v_first_error text;
  v_type record;
  v_pair record;
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  select * into v_conn from public.channex_connections c where c.property_id = v_property;
  if not found or v_conn.api_key_secret_id is null then
    raise exception 'Add the Channex API key first';
  end if;
  select * into v_prop from public.properties p where p.id = v_property;
  v_today := public.open_business_date(v_property);
  v_cx := v_conn.channex_property_id;

  -- The property, unless one was picked after Test connection.
  if v_cx is null then
    select r.status, r.body into v_status, v_body
    from public.channex_call(v_property, 'POST', '/properties', jsonb_build_object('property', jsonb_strip_nulls(jsonb_build_object(
      'title', v_prop.name,
      'currency', btrim(v_prop.currency),
      'email', v_prop.email,
      'phone', v_prop.phone,
      'zip_code', v_prop.postcode,
      'country', btrim(v_prop.country),
      'state', v_prop.region,
      'city', v_prop.city,
      'address', v_prop.address_line1,
      'latitude', v_prop.latitude::text,
      'longitude', v_prop.longitude::text,
      'timezone', v_prop.timezone,
      'property_type', 'hotel'
    )))) r;
    v_id := v_body -> 'data' ->> 'id';
    if v_status in (200, 201) and v_id is not null then
      v_cx := v_id;
      update public.channex_connections c set channex_property_id = v_cx, updated_at = now()
      where c.property_id = v_property;
      v_made := v_made + 1;
      step := 'property'; label := v_prop.name; succeeded := true; detail := v_cx;
      return next;
    else
      detail := public.channex_error_text(v_status, v_body);
      insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message, created_by)
      values (v_property, 'setup', false, 0, 1, detail, auth.uid());
      step := 'property'; label := v_prop.name; succeeded := false;
      return next;
      return;
    end if;
  end if;

  -- A Channex room type per room type not linked yet.
  for v_type in
    select rt.id,
      coalesce(nullif(btrim(rt.display_name), ''), rt.name) as title,
      greatest(coalesce(rt.max_occupancy, 1), 1) as max_occ,
      greatest(least(coalesce(rt.base_occupancy, 1), coalesce(rt.max_occupancy, 1)), 1) as default_occ,
      (select count(*) from public.rooms rm
        where rm.room_type_id = rt.id and rm.property_id = rt.property_id and rm.is_enabled) as room_count
    from public.room_types rt
    where rt.property_id = v_property
      and not exists (
        select 1 from public.channex_room_type_map m
        where m.room_type_id = rt.id and m.channex_property_id = v_cx)
    order by rt.sort_order, rt.name
  loop
    select r.status, r.body into v_status, v_body
    from public.channex_call(v_property, 'POST', '/room_types', jsonb_build_object('room_type', jsonb_build_object(
      'property_id', v_cx,
      'title', v_type.title,
      'count_of_rooms', v_type.room_count,
      'occ_adults', v_type.max_occ,
      'occ_children', 0,
      'occ_infants', 0,
      'default_occupancy', v_type.default_occ
    ))) r;
    v_id := v_body -> 'data' ->> 'id';
    step := 'room_type'; label := v_type.title;
    if v_status in (200, 201) and v_id is not null then
      insert into public.channex_room_type_map (property_id, room_type_id, channex_property_id, channex_room_type_id)
      values (v_property, v_type.id, v_cx, v_id);
      v_made := v_made + 1;
      succeeded := true; detail := v_id;
    else
      v_failed := v_failed + 1;
      succeeded := false; detail := public.channex_error_text(v_status, v_body);
      v_first_error := coalesce(v_first_error, v_type.title || ': ' || detail);
    end if;
    return next;
  end loop;

  -- A Channex rate plan per (rate plan, room type) priced from the business
  -- date on, whose room type is linked, and not linked yet.
  for v_pair in
    select rp.id as plan_id, rp.name as plan_name,
      btrim(coalesce(rp.currency, v_prop.currency)) as plan_currency,
      rt.id as type_id, coalesce(nullif(btrim(rt.display_name), ''), rt.name) as type_title,
      tm.channex_room_type_id as cx_type,
      greatest(least(coalesce(rt.base_occupancy, 1), coalesce(rt.max_occupancy, 1)), 1) as default_occ
    from public.rate_plans rp
    join public.room_types rt on rt.property_id = rp.property_id
    join public.channex_room_type_map tm
      on tm.room_type_id = rt.id and tm.channex_property_id = v_cx
    where rp.property_id = v_property
      and rp.is_active
      and exists (
        select 1 from public.rate_plan_days d
        where d.rate_plan_id = rp.id and d.room_type_id = rt.id
          and d.property_id = v_property and d.stay_date >= v_today and d.rate_cents is not null)
      and not exists (
        select 1 from public.channex_rate_plan_map m
        where m.rate_plan_id = rp.id and m.room_type_id = rt.id and m.channex_property_id = v_cx)
    order by rt.sort_order, rt.name, rp.sort_order, rp.name
  loop
    select r.status, r.body into v_status, v_body
    from public.channex_call(v_property, 'POST', '/rate_plans', jsonb_build_object('rate_plan', jsonb_build_object(
      'property_id', v_cx,
      'room_type_id', v_pair.cx_type,
      'title', v_pair.plan_name,
      'currency', v_pair.plan_currency,
      'sell_mode', 'per_room',
      'rate_mode', 'manual',
      'options', jsonb_build_array(jsonb_build_object(
        'occupancy', v_pair.default_occ, 'is_primary', true, 'rate', 0))
    ))) r;
    v_id := v_body -> 'data' ->> 'id';
    step := 'rate_plan'; label := v_pair.plan_name || ' · ' || v_pair.type_title;
    if v_status in (200, 201) and v_id is not null then
      insert into public.channex_rate_plan_map (property_id, rate_plan_id, room_type_id, channex_property_id, channex_rate_plan_id)
      values (v_property, v_pair.plan_id, v_pair.type_id, v_cx, v_id);
      v_made := v_made + 1;
      succeeded := true; detail := v_id;
    else
      v_failed := v_failed + 1;
      succeeded := false; detail := public.channex_error_text(v_status, v_body);
      v_first_error := coalesce(v_first_error, label || ': ' || detail);
    end if;
    return next;
  end loop;

  insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message, created_by)
  values (v_property, 'setup', v_failed = 0, v_made, v_failed, left(v_first_error, 1000), auth.uid());
end;
$$;

revoke all on function public.channex_setup() from public;
revoke execute on function public.channex_setup() from anon;
grant execute on function public.channex_setup() to authenticated;

-- 4. Rates, availability and restrictions ----------------------------------------

-- A rate as Channex reads it: a decimal string in the currency's own units
-- (whole francs for a currency without minor units).
create or replace function public.channex_rate_text(p_cents bigint, p_currency text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when public.currency_minor_step(p_currency) >= 100 then round(p_cents / 100.0)::bigint::text
    else to_char(p_cents / 100.0, 'FM999999999990.00')
  end;
$$;

revoke all on function public.channex_rate_text(bigint, text) from public;
revoke execute on function public.channex_rate_text(bigint, text) from anon, authenticated;

-- What would be sent now: every linked room type's availability and every
-- linked rate plan's restrictions over the next 365 nights from the business
-- date, less what Channex already has (unless p_full), joined into ranges of
-- consecutive nights with the same values. Changes nothing.
create or replace function public.channex_ari_changes(p_property uuid, p_full boolean)
returns table (kind text, channex_id text, date_from date, date_to date, value jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cx text;
  v_from date := public.open_business_date(p_property);
  v_currency text;
begin
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = p_property;
  if v_cx is null or v_from is null then
    return;
  end if;
  select btrim(p.currency) into v_currency from public.properties p where p.id = p_property;

  return query
  with span as (
    select gs::date as sd from generate_series(v_from, v_from + 364, interval '1 day') gs
  ),
  avail as (
    select 'availability'::text as k, m.channex_room_type_id as cx, g.stay_date as sd,
      jsonb_build_object('availability', greatest(g.sellable - g.sold, 0)) as val
    from public.inventory_grid_for(p_property, null, v_from, 365) g
    join public.channex_room_type_map m
      on m.room_type_id = g.room_type_id and m.channex_property_id = v_cx
  ),
  restr as (
    select 'restrictions'::text as k, m.channex_rate_plan_id as cx, s.sd,
      case
        when d.rate_cents is null then jsonb_build_object('stop_sell', true)
        else jsonb_build_object(
          'rate', public.channex_rate_text(d.rate_cents, coalesce(btrim(rp.currency), v_currency)),
          'min_stay_arrival', coalesce(d.min_stay_arrival, 1),
          'min_stay_through', coalesce(d.min_stay_through, 1),
          'max_stay', coalesce(d.max_stay, 0),
          'closed_to_arrival', coalesce(d.closed_to_arrival, false),
          'closed_to_departure', coalesce(d.closed_to_departure, false),
          'stop_sell', coalesce(d.stop_sell, false) or not rp.is_active
        )
      end as val
    from public.channex_rate_plan_map m
    join public.rate_plans rp on rp.id = m.rate_plan_id
    cross join span s
    left join public.rate_plan_days d
      on d.rate_plan_id = m.rate_plan_id and d.room_type_id = m.room_type_id
     and d.stay_date = s.sd and d.property_id = p_property
    where m.property_id = p_property and m.channex_property_id = v_cx
  ),
  now_values as (
    select * from avail
    union all
    select * from restr
  ),
  changed as (
    select nv.k, nv.cx, nv.sd, nv.val
    from now_values nv
    left join public.channex_ari_sent x
      on x.channex_property_id = v_cx and x.kind = nv.k
     and x.channex_id = nv.cx and x.stay_date = nv.sd
    where p_full or x.value is distinct from nv.val
  ),
  runs as (
    select c.*, c.sd - (row_number() over (partition by c.k, c.cx, c.val order by c.sd))::integer as run
    from changed c
  )
  select r.k, r.cx, min(r.sd), max(r.sd), r.val
  from runs r
  group by r.k, r.cx, r.val, r.run
  order by r.k, r.cx, min(r.sd);
end;
$$;

revoke all on function public.channex_ari_changes(uuid, boolean) from public;
revoke execute on function public.channex_ari_changes(uuid, boolean) from anon, authenticated;

-- Sends the changes, 500 ranges a request, and remembers what Channex
-- accepted. Granted to nobody: channex_push_ari() and the cron job call it.
create or replace function public.channex_push_ari_for(p_property uuid, p_full boolean, p_actor uuid)
returns table (kind text, sent integer, succeeded boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cx text;
  v_kind text;
  v_chunk jsonb;
  v_status integer;
  v_body jsonb;
  v_sent integer;
  v_total_sent integer := 0;
  v_failed integer := 0;
  v_error text;
  v_first_error text;
begin
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = p_property;
  if v_cx is null then
    raise exception 'Create the hotel in Channex first';
  end if;

  foreach v_kind in array array['availability', 'restrictions'] loop
    v_sent := 0;
    v_error := null;
    for v_chunk in
      select jsonb_agg(
        jsonb_build_object(
          'property_id', v_cx,
          case when ch.kind = 'availability' then 'room_type_id' else 'rate_plan_id' end, ch.channex_id,
          'date_from', ch.date_from,
          'date_to', ch.date_to
        ) || ch.value
        order by ch.channex_id, ch.date_from)
      from (
        select x.*, (row_number() over (order by x.channex_id, x.date_from) - 1) / 500 as batch
        from public.channex_ari_changes(p_property, p_full) x
        where x.kind = v_kind
      ) ch
      group by ch.batch
      order by ch.batch
    loop
      begin
        select r.status, r.body into v_status, v_body
        from public.channex_call(p_property, 'POST', '/' || v_kind, jsonb_build_object('values', v_chunk)) r;
      exception when others then
        v_status := null;
        v_body := jsonb_build_object('raw', sqlerrm);
      end;

      if v_status = 200 then
        insert into public.channex_ari_sent (property_id, channex_property_id, kind, channex_id, stay_date, value, sent_at)
        select p_property, v_cx, v_kind,
          e ->> case when v_kind = 'availability' then 'room_type_id' else 'rate_plan_id' end,
          gs::date,
          e - 'property_id' - 'room_type_id' - 'rate_plan_id' - 'date_from' - 'date_to',
          now()
        from jsonb_array_elements(v_chunk) e
        cross join generate_series((e ->> 'date_from')::date, (e ->> 'date_to')::date, interval '1 day') gs
        on conflict on constraint channex_ari_sent_pkey
        do update set value = excluded.value, sent_at = excluded.sent_at;
        v_sent := v_sent + jsonb_array_length(v_chunk);
      else
        v_error := public.channex_error_text(v_status, v_body);
        v_failed := v_failed + jsonb_array_length(v_chunk);
        exit;
      end if;
    end loop;

    v_total_sent := v_total_sent + v_sent;
    v_first_error := coalesce(v_first_error, v_error);
    kind := v_kind; sent := v_sent; succeeded := v_error is null; detail := v_error;
    return next;
  end loop;

  insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message, created_by)
  values (p_property, 'ari', v_failed = 0, v_total_sent, v_failed, left(v_first_error, 1000), p_actor);
end;
$$;

revoke all on function public.channex_push_ari_for(uuid, boolean, uuid) from public;
revoke execute on function public.channex_push_ari_for(uuid, boolean, uuid) from anon, authenticated;

create or replace function public.channex_push_ari(p_full boolean default false)
returns table (kind text, sent integer, succeeded boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  return query select * from public.channex_push_ari_for(v_property, coalesce(p_full, false), auth.uid());
end;
$$;

revoke all on function public.channex_push_ari(boolean) from public;
revoke execute on function public.channex_push_ari(boolean) from anon;
grant execute on function public.channex_push_ari(boolean) to authenticated;

-- Every active connection with a Channex property, one hotel's failure never
-- stopping the next. Run by pg_cron; granted to nobody.
create or replace function public.channex_push_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid;
  v_count integer := 0;
begin
  for v_property in
    select c.property_id from public.channex_connections c
    where c.is_active and c.api_key_secret_id is not null and c.channex_property_id is not null
  loop
    begin
      perform public.channex_push_ari_for(v_property, false, null);
      v_count := v_count + 1;
    exception when others then
      insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message)
      values (v_property, 'ari', false, 0, 0, left(sqlerrm, 1000));
    end;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.channex_push_all() from public;
revoke execute on function public.channex_push_all() from anon, authenticated;

select cron.schedule('channex-ari-push', '*/15 * * * *', $cron$select public.channex_push_all()$cron$);

-- 5. What the Settings card shows ------------------------------------------------

-- Each room type, and each rate plan priced on a room type, with its Channex
-- id when linked.
create or replace function public.channex_overview()
returns table (
  kind text,
  room_type_id uuid,
  room_type_name text,
  rate_plan_id uuid,
  rate_plan_name text,
  currency text,
  channex_id text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_cx text;
  v_today date;
  v_currency text;
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = v_property;
  v_today := public.open_business_date(v_property);
  select btrim(p.currency) into v_currency from public.properties p where p.id = v_property;

  return query
  select 'room_type'::text, rt.id, coalesce(nullif(btrim(rt.display_name), ''), rt.name),
    null::uuid, null::text, null::text, m.channex_room_type_id
  from public.room_types rt
  left join public.channex_room_type_map m
    on m.room_type_id = rt.id and m.channex_property_id = v_cx
  where rt.property_id = v_property
  union all
  select 'rate_plan'::text, rt.id, coalesce(nullif(btrim(rt.display_name), ''), rt.name),
    rp.id, rp.name, coalesce(btrim(rp.currency), v_currency), m.channex_rate_plan_id
  from public.rate_plans rp
  join public.room_types rt on rt.property_id = rp.property_id
  left join public.channex_rate_plan_map m
    on m.rate_plan_id = rp.id and m.room_type_id = rt.id and m.channex_property_id = v_cx
  where rp.property_id = v_property
    and rp.is_active
    and (m.channex_rate_plan_id is not null or exists (
      select 1 from public.rate_plan_days d
      where d.rate_plan_id = rp.id and d.room_type_id = rt.id
        and d.property_id = v_property and d.stay_date >= v_today and d.rate_cents is not null));
end;
$$;

revoke all on function public.channex_overview() from public;
revoke execute on function public.channex_overview() from anon;
grant execute on function public.channex_overview() to authenticated;
