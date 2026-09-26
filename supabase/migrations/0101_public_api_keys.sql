-- Settings -> Connectivity Settings -> API Key and Developer Keys, cloned
-- from the client's reference, and the READ-ONLY PUBLIC API they open:
-- `/api/public/v1/<property>/` (the reference's "Endpoint"), with
-- `room-types`, `rate-plans`, `availability` and `rates`.
--
-- THE CLIENT ASKED FOR THE API, not only the screens: a key that opens
-- nothing is the dead control this application does not ship. This lifts
-- "no API routes except external webhooks" for this one versioned, read-only
-- API and nothing else.
--
-- KEYS
--   * One table. `kind = 'main'` is the hotel's API Key (one per property,
--     every permission); `kind = 'developer'` are the named Developer Keys,
--     each with its own permissions and an on/off switch.
--   * ONLY A SHA-256 HASH IS STORED. The key is shown once, when it is made;
--     afterwards the screens show a hint (`hk_Ab3…9xQz`). The reference keeps
--     its key on screen for ever, which is how a live one ended up in a
--     screenshot. A lost key is replaced, never recovered.
--   * 240 random bits from pgcrypto, so a key cannot be guessed; the hash is
--     a straight lookup and a stolen table row is not a usable key.
--
-- HOW THE API READS WITHOUT A STAFF SESSION -- and without a service-role key,
-- which never enters this codebase: every endpoint is one `security definer`
-- function granted to `anon` that takes the property and the key, and calls
-- `api_authorize()` FIRST. That refuses an unknown, revoked or other hotel's
-- key with HA401, and a developer key without the endpoint's permission with
-- HA403, before a row is read. The property is a parameter, as on the guest
-- booking page; `current_property_id()` is not taught about keys.
--
-- ONE COPY OF THE INVENTORY LOGIC. `inventory_grid()` becomes a wrapper round
-- `inventory_grid_for(property, ...)`, which the API calls too -- the same
-- move `stay_rule_violation_for()` made. The staff grid's output is unchanged.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('main', 'developer')),
  name text check (name is null or (btrim(name) <> '' and char_length(name) <= 80)),
  key_hash text not null unique,
  key_hint text not null,
  permissions text[] not null default '{}'
    check (permissions <@ array['room_types', 'rate_plans', 'availability', 'rates']::text[]),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  check ((kind = 'main') = (name is null))
);

create unique index api_keys_one_main on public.api_keys (property_id) where kind = 'main';
create unique index api_keys_developer_name on public.api_keys (property_id, lower(btrim(name)))
  where kind = 'developer';

alter table public.api_keys enable row level security;

-- Only managers and administrators see keys at all, even as hints.
create policy api_keys_revenue_staff on public.api_keys
  for all using (property_id = public.current_property_id() and public.is_revenue_staff())
  with check (property_id = public.current_property_id() and public.is_revenue_staff());

grant select, insert, update, delete on public.api_keys to authenticated;
revoke all on public.api_keys from anon;

/* -- Making keys -------------------------------------------------------- */

create or replace function public.api_key_new()
returns text
language sql
volatile
set search_path = public
as $$
  select 'hk_' || rtrim(translate(encode(extensions.gen_random_bytes(30), 'base64'), '+/', '-_'), '=');
$$;

create or replace function public.api_key_hash(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
$$;

create or replace function public.api_key_hint(p_key text)
returns text
language sql
immutable
as $$
  select left(p_key, 6) || '…' || right(p_key, 4);
$$;

revoke execute on function public.api_key_new() from public, anon;
revoke execute on function public.api_key_hash(text) from public, anon;
revoke execute on function public.api_key_hint(text) from public, anon;
grant execute on function public.api_key_new() to authenticated;
grant execute on function public.api_key_hash(text) to authenticated;
grant execute on function public.api_key_hint(text) to authenticated;

-- The hotel's API Key: made, or replaced, and returned once. Replacing it
-- stops the old one at once.
create or replace function public.generate_api_key()
returns text
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  v_property uuid := public.current_property_id();
  v_key text := public.api_key_new();
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can manage API keys';
  end if;
  delete from public.api_keys where property_id = v_property and kind = 'main';
  insert into public.api_keys (property_id, kind, key_hash, key_hint, permissions, created_by)
  values (v_property, 'main', public.api_key_hash(v_key), public.api_key_hint(v_key),
          array['room_types', 'rate_plans', 'availability', 'rates'], auth.uid());
  return v_key;
end;
$$;

revoke execute on function public.generate_api_key() from public, anon;
grant execute on function public.generate_api_key() to authenticated;

-- A developer key, returned once. Permissions are the endpoints it may read.
create or replace function public.create_developer_key(p_name text, p_permissions text[])
returns text
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  v_property uuid := public.current_property_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_key text := public.api_key_new();
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can manage API keys';
  end if;
  if v_name = '' then
    raise exception 'Write the key''s name';
  end if;
  if exists (
    select 1 from public.api_keys k
    where k.property_id = v_property and k.kind = 'developer' and lower(btrim(k.name)) = lower(v_name)
  ) then
    raise exception 'There is already a developer key called %', v_name;
  end if;
  if not (coalesce(p_permissions, '{}') <@ array['room_types', 'rate_plans', 'availability', 'rates']::text[]) then
    raise exception 'Choose permissions from the list';
  end if;
  insert into public.api_keys (property_id, kind, name, key_hash, key_hint, permissions, created_by)
  values (v_property, 'developer', v_name, public.api_key_hash(v_key), public.api_key_hint(v_key),
          coalesce(p_permissions, '{}'), auth.uid());
  return v_key;
end;
$$;

revoke execute on function public.create_developer_key(text, text[]) from public, anon;
grant execute on function public.create_developer_key(text, text[]) to authenticated;

create or replace function public.update_developer_key(
  p_id uuid, p_name text, p_permissions text[], p_is_active boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can manage API keys';
  end if;
  if v_name = '' then
    raise exception 'Write the key''s name';
  end if;
  if exists (
    select 1 from public.api_keys k
    where k.property_id = v_property and k.kind = 'developer'
      and lower(btrim(k.name)) = lower(v_name) and k.id <> p_id
  ) then
    raise exception 'There is already a developer key called %', v_name;
  end if;
  if not (coalesce(p_permissions, '{}') <@ array['room_types', 'rate_plans', 'availability', 'rates']::text[]) then
    raise exception 'Choose permissions from the list';
  end if;
  update public.api_keys
  set name = v_name, permissions = coalesce(p_permissions, '{}'), is_active = coalesce(p_is_active, false)
  where id = p_id and property_id = v_property and kind = 'developer';
  if not found then
    raise exception 'That developer key is not on this property';
  end if;
end;
$$;

revoke execute on function public.update_developer_key(uuid, text, text[], boolean) from public, anon;
grant execute on function public.update_developer_key(uuid, text, text[], boolean) to authenticated;

-- Genuinely deleted: a revoked key is gone, and nothing points at one.
create or replace function public.delete_developer_key(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not coalesce(public.is_revenue_staff(), false) then
    raise exception 'Only managers and administrators can manage API keys';
  end if;
  delete from public.api_keys
  where id = p_id and property_id = public.current_property_id() and kind = 'developer';
  if not found then
    raise exception 'That developer key is not on this property';
  end if;
end;
$$;

revoke execute on function public.delete_developer_key(uuid) from public, anon;
grant execute on function public.delete_developer_key(uuid) to authenticated;

/* -- One copy of the inventory logic ------------------------------------ */

create or replace function public.inventory_grid_for(
  p_property_id uuid, p_rate_plan_id uuid, p_from date, p_days integer
)
returns table (
  stay_date date, room_type_id uuid, room_type_code text, room_type_name text,
  rate_cents bigint, min_stay_through integer, min_stay_arrival integer, max_stay integer,
  closed_to_arrival boolean, closed_to_departure boolean, stop_sell boolean,
  allotment integer, close_out boolean, physical_rooms bigint, out_of_order bigint,
  sold bigint, sellable bigint
)
language sql
stable
set search_path = public
as $$
  with span as (
    select d::date as stay_date
    from generate_series(
      p_from,
      p_from + greatest(coalesce(p_days, 28), 1) - 1,
      interval '1 day'
    ) as d
  ),
  types as (
    select
      rt.id, rt.code, rt.name, rt.sort_order,
      count(r.id) as physical_rooms,
      count(r.id) filter (where r.status = 'ooo') as out_of_order
    from public.room_types rt
    left join public.rooms r
      on r.room_type_id = rt.id and r.property_id = rt.property_id
    where rt.property_id = p_property_id
    group by rt.id, rt.code, rt.name, rt.sort_order
  ),
  sold as (
    select n.stay_date, coalesce(r.room_type_id, br.room_type_id) as room_type_id, count(*) as sold
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    left join public.rooms r
      on r.id = br.room_id and r.property_id = br.property_id
    where n.property_id = p_property_id
      and n.status not in ('canceled', 'no_show')
      and n.stay_date >= p_from
      and n.stay_date < p_from + greatest(coalesce(p_days, 28), 1)
    group by n.stay_date, coalesce(r.room_type_id, br.room_type_id)
  )
  select
    span.stay_date,
    types.id,
    types.code,
    types.name,
    d.rate_cents,
    d.min_stay_through,
    d.min_stay_arrival,
    d.max_stay,
    coalesce(d.closed_to_arrival, false),
    coalesce(d.closed_to_departure, false),
    coalesce(d.stop_sell, false),
    rtd.allotment,
    coalesce(rtd.close_out, false),
    types.physical_rooms,
    types.out_of_order,
    coalesce(sold.sold, 0)::bigint,
    -- What may actually be sold that night: the physical rooms, less those out
    -- of order, capped by any allotment, and nothing at all when closed out.
    case
      when coalesce(rtd.close_out, false) then 0
      else least(
        types.physical_rooms - types.out_of_order,
        coalesce(rtd.allotment, types.physical_rooms - types.out_of_order)
      )
    end::bigint
  from span
  cross join types
  left join public.rate_plan_days d
    on d.rate_plan_id = p_rate_plan_id
   and d.room_type_id = types.id
   and d.stay_date = span.stay_date
   and d.property_id = p_property_id
  left join public.room_type_days rtd
    on rtd.room_type_id = types.id
   and rtd.stay_date = span.stay_date
   and rtd.property_id = p_property_id
  left join sold
    on sold.stay_date = span.stay_date and sold.room_type_id = types.id
  order by types.sort_order, types.name, span.stay_date;
$$;

-- Invoker: called by staff through the wrapper it reads under their own RLS,
-- so another property's id returns nothing. Called from the API's definer
-- functions it reads as the owner, after api_authorize().
revoke execute on function public.inventory_grid_for(uuid, uuid, date, integer) from public, anon;
grant execute on function public.inventory_grid_for(uuid, uuid, date, integer) to authenticated;

create or replace function public.inventory_grid(p_rate_plan_id uuid, p_from date, p_days integer default 28)
returns table (
  stay_date date, room_type_id uuid, room_type_code text, room_type_name text,
  rate_cents bigint, min_stay_through integer, min_stay_arrival integer, max_stay integer,
  closed_to_arrival boolean, closed_to_departure boolean, stop_sell boolean,
  allotment integer, close_out boolean, physical_rooms bigint, out_of_order bigint,
  sold bigint, sellable bigint
)
language sql
stable
set search_path = public
as $$
  select * from public.inventory_grid_for(public.current_property_id(), p_rate_plan_id, p_from, p_days);
$$;

/* -- The API ----------------------------------------------------------- */

-- The gate every endpoint calls first. Not granted to anyone: only the
-- definer functions below reach it.
create or replace function public.api_authorize(p_property_id uuid, p_key text, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key public.api_keys;
begin
  select k.* into v_key
  from public.api_keys k
  join public.properties p on p.id = k.property_id and p.is_active
  where k.key_hash = public.api_key_hash(p_key)
    and k.property_id = p_property_id
    and k.is_active;
  if not found then
    raise exception 'API_KEY_INVALID' using errcode = 'HA401';
  end if;
  if p_permission is not null and not (p_permission = any (v_key.permissions)) then
    raise exception 'API_PERMISSION_DENIED: %', p_permission using errcode = 'HA403';
  end if;
end;
$$;

revoke execute on function public.api_authorize(uuid, text, text) from public, anon, authenticated;

-- Dates are nights, inclusive at both ends, at most 366 of them.
create or replace function public.api_check_range(p_from date, p_to date)
returns integer
language plpgsql
immutable
as $$
begin
  if p_from is null or p_to is null then
    raise exception 'API_BAD_REQUEST: from and to are required dates (YYYY-MM-DD)' using errcode = 'HA400';
  end if;
  if p_to < p_from then
    raise exception 'API_BAD_REQUEST: to is before from' using errcode = 'HA400';
  end if;
  if p_to - p_from > 365 then
    raise exception 'API_BAD_REQUEST: at most 366 nights per request' using errcode = 'HA400';
  end if;
  return p_to - p_from + 1;
end;
$$;

revoke execute on function public.api_check_range(date, date) from public, anon, authenticated;

create or replace function public.api_property(p_property_id uuid, p_key text)
returns table (property_id uuid, name text, currency text, timezone text, business_date date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.api_authorize(p_property_id, p_key, null);
  return query
  select p.id, p.name, trim(p.currency)::text, p.timezone,
    (select b.business_date from public.business_dates b
     where b.property_id = p.id and b.status = 'open' limit 1)
  from public.properties p
  where p.id = p_property_id;
end;
$$;

create or replace function public.api_room_types(p_property_id uuid, p_key text)
returns table (
  room_type_id uuid, code text, name text, display_name text, description text,
  base_occupancy integer, max_occupancy integer, rooms bigint, rooms_online bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.api_authorize(p_property_id, p_key, 'room_types');
  return query
  select rt.id, rt.code, rt.name, coalesce(rt.display_name, rt.name), rt.description,
    rt.base_occupancy, rt.max_occupancy,
    count(r.id) filter (where r.is_enabled),
    count(r.id) filter (where r.is_enabled and r.available_online)
  from public.room_types rt
  left join public.rooms r on r.room_type_id = rt.id and r.property_id = rt.property_id
  where rt.property_id = p_property_id
  group by rt.id
  order by rt.sort_order, rt.name;
end;
$$;

create or replace function public.api_rate_plans(p_property_id uuid, p_key text)
returns table (
  rate_plan_id uuid, code text, name text, description text, is_default boolean,
  is_public boolean, meals text[], cancellation_policy text,
  cancellation_kind text, free_cancellation_days integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.api_authorize(p_property_id, p_key, 'rate_plans');
  return query
  select rp.id, rp.code, rp.name, rp.description, rp.is_default, rp.is_public,
    coalesce((select array_agg(m.meal::text order by m.meal::text)
              from public.rate_plan_meals m where m.rate_plan_id = rp.id), '{}'),
    cp.name, cp.kind::text, cp.free_cancellation_days
  from public.rate_plans rp
  left join public.cancellation_policies cp on cp.id = rp.cancellation_policy_id
  where rp.property_id = p_property_id and rp.is_active
  order by rp.is_default desc, rp.name;
end;
$$;

create or replace function public.api_availability(p_property_id uuid, p_key text, p_from date, p_to date)
returns table (
  stay_date date, room_type_id uuid, room_type_code text,
  sellable bigint, sold bigint, available bigint, close_out boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer;
begin
  perform public.api_authorize(p_property_id, p_key, 'availability');
  v_days := public.api_check_range(p_from, p_to);
  return query
  select g.stay_date, g.room_type_id, g.room_type_code, g.sellable, g.sold,
    g.sellable - g.sold, g.close_out
  from public.inventory_grid_for(p_property_id, null, p_from, v_days) g;
end;
$$;

-- One plan's prices and stay rules per room type per night; null plan is
-- the hotel's default. Null rate is "no rate loaded", never free.
create or replace function public.api_rates(
  p_property_id uuid, p_key text, p_rate_plan_id uuid, p_from date, p_to date
)
returns table (
  stay_date date, room_type_id uuid, room_type_code text, rate_plan_id uuid,
  rate_cents bigint, currency text, min_stay_through integer, min_stay_arrival integer,
  max_stay integer, closed_to_arrival boolean, closed_to_departure boolean,
  stop_sell boolean, close_out boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_plan uuid;
  v_currency text;
begin
  perform public.api_authorize(p_property_id, p_key, 'rates');
  v_days := public.api_check_range(p_from, p_to);
  select rp.id into v_plan from public.rate_plans rp
  where rp.property_id = p_property_id and rp.is_active
    and (case when p_rate_plan_id is null then rp.is_default else rp.id = p_rate_plan_id end)
  limit 1;
  if v_plan is null then
    raise exception 'API_BAD_REQUEST: no such active rate plan' using errcode = 'HA400';
  end if;
  select trim(p.currency) into v_currency from public.properties p where p.id = p_property_id;
  return query
  select g.stay_date, g.room_type_id, g.room_type_code, v_plan, g.rate_cents, v_currency,
    g.min_stay_through, g.min_stay_arrival, g.max_stay, g.closed_to_arrival,
    g.closed_to_departure, g.stop_sell, g.close_out
  from public.inventory_grid_for(p_property_id, v_plan, p_from, v_days) g;
end;
$$;

-- The API's surface: executable without a session, useless without a key.
revoke execute on function public.api_property(uuid, text) from public;
revoke execute on function public.api_room_types(uuid, text) from public;
revoke execute on function public.api_rate_plans(uuid, text) from public;
revoke execute on function public.api_availability(uuid, text, date, date) from public;
revoke execute on function public.api_rates(uuid, text, uuid, date, date) from public;
grant execute on function public.api_property(uuid, text) to anon, authenticated;
grant execute on function public.api_room_types(uuid, text) to anon, authenticated;
grant execute on function public.api_rate_plans(uuid, text) to anon, authenticated;
grant execute on function public.api_availability(uuid, text, date, date) to anon, authenticated;
grant execute on function public.api_rates(uuid, text, uuid, date, date) to anon, authenticated;
