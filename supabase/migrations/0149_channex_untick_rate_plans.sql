-- 0149: a rate plan can be taken off Channex as well as put on it.
--
-- 0148 ticked only plans not yet in Channex, so once a plan was sent there was
-- no choosing any more -- every plan on Reservation Centric Hotel had gone with
-- the first Send. Now every plan under a room type has a tick, ticked when it
-- is in Channex; unticking one and pressing Send takes it off Channex.
--
-- * Channex refuses to remove a plan an OTA is mapped to (422) unless forced.
--   It is never forced: the plan stays in Channex CLOSED -- the push sends stop
--   sell on every night -- so nothing can be sold on it. Ticked again, it opens.
-- * The link is kept, never removed (the connector refuses that in a
--   migration, and a booking from Channex may still name the plan):
--   withdrawn_at is when it was unticked, removed is true once Channex no
--   longer has it. A removed plan ticked again gets a new Channex plan on the
--   same row.
-- * Only a TICKED room type is touched. An unticked room type's plans stay as
--   they are, whatever their ticks.

alter table public.channex_rate_plan_map
  add column if not exists withdrawn_at timestamptz,
  add column if not exists removed boolean not null default false;

create or replace function public.channex_send_selection(p_room_type_ids uuid[], p_rate_plans jsonb)
returns table (step text, label text, succeeded boolean, detail text)
language plpgsql
security definer
set search_path = public
set statement_timeout = '55s'
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
  v_push record;
  v_payload jsonb;
  v_found jsonb;
  v_cx_types jsonb;
  v_cx_plans jsonb;
  v_gone record;
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  select * into v_conn from public.channex_connections c where c.property_id = v_property;
  if not found or v_conn.api_key_secret_id is null then
    raise exception 'Add the Channex API key first';
  end if;
  if coalesce(cardinality(p_room_type_ids), 0) = 0 then
    raise exception 'Tick at least one room type to send to Channex';
  end if;
  if exists (
    select 1 from unnest(p_room_type_ids) t(id)
    where not exists (select 1 from public.room_types rt where rt.id = t.id and rt.property_id = v_property)
  ) then
    raise exception 'That room type is not on this hotel';
  end if;

  select * into v_prop from public.properties p where p.id = v_property;
  v_today := public.open_business_date(v_property);
  v_cx := v_conn.channex_property_id;

  -- A property Channex already holds under this hotel's name, made by a Send
  -- that was cut off, is taken rather than made a second time.
  if v_cx is null then
    select r.status, r.body into v_status, v_body
    from public.channex_call(v_property, 'GET', '/properties?pagination[limit]=100', null) r;
    if v_status = 200 then
      select e ->> 'id' into v_cx
      from jsonb_array_elements(coalesce(v_body -> 'data', '[]'::jsonb)) e
      where lower(btrim(e -> 'attributes' ->> 'title')) = lower(btrim(v_prop.name))
        and not exists (select 1 from public.channex_connections o
          where o.channex_property_id = e ->> 'id' and o.property_id <> v_property)
      limit 1;
      if v_cx is not null then
        update public.channex_connections c set channex_property_id = v_cx, updated_at = now()
        where c.property_id = v_property;
        step := 'property'; label := v_prop.name; succeeded := true; detail := v_cx;
        return next;
      end if;
    end if;
  end if;

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
    step := 'property'; label := v_prop.name;
    if v_status in (200, 201) and v_id is not null then
      v_cx := v_id;
      update public.channex_connections c set channex_property_id = v_cx, updated_at = now()
      where c.property_id = v_property;
      v_made := v_made + 1;
      succeeded := true; detail := v_cx;
      return next;
    else
      detail := public.channex_error_text(v_status, v_body);
      insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message, created_by)
      values (v_property, 'setup', false, 0, 1, detail, auth.uid());
      succeeded := false;
      return next;
      return;
    end if;
  end if;

  -- What Channex already has on the property, read once, only when needed.
  if exists (
    select 1 from unnest(p_room_type_ids) t(id)
    where not exists (select 1 from public.channex_room_type_map m
      where m.room_type_id = t.id and m.channex_property_id = v_cx)
  ) then
    select r.status, r.body into v_status, v_body
    from public.channex_call(v_property, 'GET',
      '/room_types?filter[property_id]=' || v_cx || '&pagination[limit]=100', null) r;
    if v_status = 200 then v_cx_types := v_body -> 'data'; end if;
  end if;

  -- Each ticked room type: created, or brought up to date when it is there.
  for v_type in
    select rt.id,
      coalesce(nullif(btrim(rt.display_name), ''), rt.name) as title,
      greatest(coalesce(rt.max_occupancy, 1), 1) as max_occ,
      greatest(least(coalesce(rt.base_occupancy, 1), coalesce(rt.max_occupancy, 1)), 1) as default_occ,
      (select count(*) from public.rooms rm
        where rm.room_type_id = rt.id and rm.property_id = rt.property_id and rm.is_enabled) as room_count,
      m.channex_room_type_id as cx_type
    from public.room_types rt
    left join public.channex_room_type_map m
      on m.room_type_id = rt.id and m.channex_property_id = v_cx
    where rt.property_id = v_property
      and rt.id = any (p_room_type_ids)
    order by rt.sort_order, rt.name
  loop
    v_payload := jsonb_build_object(
      'property_id', v_cx,
      'title', v_type.title,
      'count_of_rooms', v_type.room_count,
      'occ_adults', v_type.max_occ,
      'occ_children', 0,
      'occ_infants', 0,
      'default_occupancy', v_type.default_occ
    );
    step := 'room_type'; label := v_type.title;
    -- One of the same title, not linked to another room type, is this one.
    if v_type.cx_type is null and v_cx_types is not null then
      select e ->> 'id' into v_id
      from jsonb_array_elements(v_cx_types) e
      where lower(btrim(e -> 'attributes' ->> 'title')) = lower(btrim(v_type.title))
        and not exists (select 1 from public.channex_room_type_map m
          where m.channex_room_type_id = e ->> 'id')
      limit 1;
      if v_id is not null then
        insert into public.channex_room_type_map (property_id, room_type_id, channex_property_id, channex_room_type_id)
        values (v_property, v_type.id, v_cx, v_id);
        v_type.cx_type := v_id;
      end if;
    end if;
    if v_type.cx_type is null then
      select r.status, r.body into v_status, v_body
      from public.channex_call(v_property, 'POST', '/room_types', jsonb_build_object('room_type', v_payload)) r;
      v_id := v_body -> 'data' ->> 'id';
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
    else
      select r.status, r.body into v_status, v_body
      from public.channex_call(v_property, 'PUT', '/room_types/' || v_type.cx_type,
        jsonb_build_object('room_type', v_payload)) r;
      if v_status = 200 then
        v_made := v_made + 1;
        succeeded := true; detail := v_type.cx_type;
      else
        v_failed := v_failed + 1;
        succeeded := false; detail := public.channex_error_text(v_status, v_body);
        v_first_error := coalesce(v_first_error, v_type.title || ': ' || detail);
      end if;
    end if;
    return next;
  end loop;

  -- Channex's rate plans on the property, read once, for the same reason.
  select r.status, r.body into v_status, v_body
  from public.channex_call(v_property, 'GET',
    '/rate_plans?filter[property_id]=' || v_cx || '&pagination[limit]=100', null) r;
  if v_status = 200 then v_cx_plans := v_body -> 'data'; end if;

  -- A plan closed in Channex (0149) and ticked again opens again: the next push
  -- sends its prices in place of stop sell.
  if p_rate_plans is not null then
    for v_gone in
      update public.channex_rate_plan_map m set withdrawn_at = null
      where m.property_id = v_property and m.channex_property_id = v_cx
        and m.withdrawn_at is not null and not m.removed
        and m.room_type_id = any (p_room_type_ids)
        and exists (
          select 1 from jsonb_array_elements(p_rate_plans) x
          where x ->> 'room_type_id' = m.room_type_id::text and x ->> 'rate_plan_id' = m.rate_plan_id::text)
      returning m.rate_plan_id, m.room_type_id, m.channex_rate_plan_id
    loop
      step := 'rate_plan';
      select rp.name || ' · ' || coalesce(nullif(btrim(rt.display_name), ''), rt.name) into label
      from public.rate_plans rp, public.room_types rt
      where rp.id = v_gone.rate_plan_id and rt.id = v_gone.room_type_id;
      v_made := v_made + 1;
      succeeded := true; detail := v_gone.channex_rate_plan_id;
      return next;
    end loop;
  end if;

  -- A Channex rate plan per active plan priced on a ticked, linked room type,
  -- from the business date on, that Channex does not have yet.
  for v_pair in
    select rp.id as plan_id, rp.name as plan_name,
      btrim(coalesce(rp.currency, v_prop.currency)) as plan_currency,
      rt.id as type_id, coalesce(nullif(btrim(rt.display_name), ''), rt.name) as type_title,
      tm.channex_room_type_id as cx_type,
      greatest(coalesce(rt.max_occupancy, 1), 1) as max_occ
    from public.rate_plans rp
    join public.room_types rt on rt.property_id = rp.property_id
    join public.channex_room_type_map tm
      on tm.room_type_id = rt.id and tm.channex_property_id = v_cx
    where rp.property_id = v_property
      and rp.is_active
      and rt.id = any (p_room_type_ids)
      and exists (
        select 1 from public.rate_plan_days d
        where d.rate_plan_id = rp.id and d.room_type_id = rt.id
          and d.property_id = v_property and d.stay_date >= v_today and d.rate_cents is not null)
      and not exists (
        select 1 from public.channex_rate_plan_map m
        where m.rate_plan_id = rp.id and m.room_type_id = rt.id and m.channex_property_id = v_cx
          and not m.removed)
      -- Only the ticked plans; null is every plan priced on the room type.
      and (p_rate_plans is null or exists (
        select 1 from jsonb_array_elements(p_rate_plans) x
        where x ->> 'room_type_id' = rt.id::text and x ->> 'rate_plan_id' = rp.id::text))
    order by rt.sort_order, rt.name, rp.sort_order, rp.name
  loop
    step := 'rate_plan'; label := v_pair.plan_name || ' · ' || v_pair.type_title;
    v_found := null;
    if v_cx_plans is not null then
      select e into v_found
      from jsonb_array_elements(v_cx_plans) e
      where lower(btrim(e -> 'attributes' ->> 'title')) = lower(btrim(v_pair.plan_name))
        and e -> 'relationships' -> 'room_type' -> 'data' ->> 'id' = v_pair.cx_type
        and not exists (select 1 from public.channex_rate_plan_map m
          where m.channex_rate_plan_id = e ->> 'id' and not m.removed)
      limit 1;
    end if;
    if v_found is not null then
      insert into public.channex_rate_plan_map (property_id, rate_plan_id, room_type_id, channex_property_id, channex_rate_plan_id)
      values (v_property, v_pair.plan_id, v_pair.type_id, v_cx, v_found ->> 'id')
      on conflict (rate_plan_id, room_type_id, channex_property_id) do update
        set channex_rate_plan_id = excluded.channex_rate_plan_id, withdrawn_at = null, removed = false;
      v_made := v_made + 1;
      succeeded := true; detail := v_found ->> 'id';
      return next;
      continue;
    end if;

    -- "A per_room rate plan takes one option for the maximum occupancy."
    select r.status, r.body into v_status, v_body
    from public.channex_call(v_property, 'POST', '/rate_plans', jsonb_build_object('rate_plan', jsonb_build_object(
      'property_id', v_cx,
      'room_type_id', v_pair.cx_type,
      'title', v_pair.plan_name,
      'currency', v_pair.plan_currency,
      'sell_mode', 'per_room',
      'rate_mode', 'manual',
      'options', jsonb_build_array(jsonb_build_object(
        'occupancy', v_pair.max_occ, 'is_primary', true, 'rate', 0))
    ))) r;
    v_id := v_body -> 'data' ->> 'id';
    if v_status in (200, 201) and v_id is not null then
      insert into public.channex_rate_plan_map (property_id, rate_plan_id, room_type_id, channex_property_id, channex_rate_plan_id)
      values (v_property, v_pair.plan_id, v_pair.type_id, v_cx, v_id)
      on conflict (rate_plan_id, room_type_id, channex_property_id) do update
        set channex_rate_plan_id = excluded.channex_rate_plan_id, withdrawn_at = null, removed = false;
      v_made := v_made + 1;
      succeeded := true; detail := v_id;
    else
      v_failed := v_failed + 1;
      succeeded := false; detail := public.channex_error_text(v_status, v_body);
      v_first_error := coalesce(v_first_error, label || ': ' || detail);
    end if;
    return next;
  end loop;

  -- A plan in Channex on a ticked room type and no longer ticked comes off
  -- Channex (0149). Channex refuses one an OTA is mapped to (422) unless forced,
  -- and it is never forced: that plan stays, closed -- the push sends stop sell
  -- on every night -- and the card says so.
  if p_rate_plans is not null then
    for v_gone in
      select m.rate_plan_id, m.room_type_id, m.channex_rate_plan_id,
        rp.name || ' · ' || coalesce(nullif(btrim(rt.display_name), ''), rt.name) as title
      from public.channex_rate_plan_map m
      join public.rate_plans rp on rp.id = m.rate_plan_id
      join public.room_types rt on rt.id = m.room_type_id
      where m.property_id = v_property and m.channex_property_id = v_cx
        and not m.removed
        and m.room_type_id = any (p_room_type_ids)
        and not exists (
          select 1 from jsonb_array_elements(p_rate_plans) x
          where x ->> 'room_type_id' = m.room_type_id::text and x ->> 'rate_plan_id' = m.rate_plan_id::text)
      order by rt.sort_order, rt.name, rp.sort_order, rp.name
    loop
      step := 'remove'; label := v_gone.title;
      select r.status, r.body into v_status, v_body
      from public.channex_call(v_property, 'DELETE', '/rate_plans/' || v_gone.channex_rate_plan_id, null) r;
      if v_status in (200, 204, 404) then
        update public.channex_rate_plan_map m set removed = true, withdrawn_at = coalesce(m.withdrawn_at, now())
        where m.rate_plan_id = v_gone.rate_plan_id and m.room_type_id = v_gone.room_type_id
          and m.channex_property_id = v_cx;
        v_made := v_made + 1;
        succeeded := true; detail := 'removed';
      else
        update public.channex_rate_plan_map m set withdrawn_at = coalesce(m.withdrawn_at, now())
        where m.rate_plan_id = v_gone.rate_plan_id and m.room_type_id = v_gone.room_type_id
          and m.channex_property_id = v_cx;
        succeeded := true; detail := 'closed';
      end if;
      return next;
    end loop;
  end if;

  insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message, created_by)
  values (v_property, 'setup', v_failed = 0, v_made, v_failed, left(v_first_error, 1000), auth.uid());

  -- Their rates and availability, now, so the rows read right in Channex.
  for v_push in select * from public.channex_push_ari_for(v_property, false, auth.uid()) loop
    step := 'push'; label := v_push.kind; succeeded := v_push.succeeded;
    detail := coalesce(v_push.detail, v_push.sent::text);
    return next;
  end loop;
end;
$$;

revoke all on function public.channex_send_selection(uuid[], jsonb) from public;
revoke execute on function public.channex_send_selection(uuid[], jsonb) from anon;
grant execute on function public.channex_send_selection(uuid[], jsonb) to authenticated;

-- The push leaves removed plans out and closes withdrawn ones.
create or replace function public.channex_ari_changes(p_property uuid, p_full boolean)
returns table (kind text, channex_id text, date_from date, date_to date, value jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cx text;
  v_from date;
  v_currency text;
  v_zone text;
begin
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = p_property;
  select btrim(p.currency), p.timezone into v_currency, v_zone from public.properties p where p.id = p_property;
  v_from := greatest(
    public.open_business_date(p_property),
    (now() at time zone coalesce(v_zone, 'UTC'))::date
  );
  if v_cx is null or v_from is null then
    return;
  end if;

  return query
  with span as (
    select gs::date as sd from generate_series(v_from, v_from + 499, interval '1 day') gs
  ),
  avail as (
    select 'availability'::text as k, m.channex_room_type_id as cx, g.stay_date as sd,
      jsonb_build_object('availability', greatest(g.sellable - g.sold, 0)) as val
    from public.inventory_grid_for(p_property, null, v_from, 500) g
    join public.channex_room_type_map m
      on m.room_type_id = g.room_type_id and m.channex_property_id = v_cx
  ),
  restr as (
    select 'restrictions'::text as k, m.channex_rate_plan_id as cx, s.sd,
      case
        when m.withdrawn_at is not null then jsonb_build_object('stop_sell', true)
        when d.rate_cents is null or d.rate_cents <= 0 then jsonb_build_object('stop_sell', true)
        else jsonb_build_object(
          'rate', public.channex_rate_text(d.rate_cents, coalesce(btrim(rp.currency), v_currency)),
          'min_stay_arrival', greatest(coalesce(d.min_stay_arrival, 1), 1),
          'min_stay_through', greatest(coalesce(d.min_stay_through, 1), 1),
          'max_stay', greatest(coalesce(d.max_stay, 0), 0),
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
      and not m.removed
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

-- "Sent · n of m rate plans" counts plans open in Channex.
create or replace function public.channex_room_list()
returns table (
  room_type_id uuid, room_type_name text, room_type_code text, room_name text, rooms bigint,
  available bigint, rate_cents bigint, rate_currency text, plans_priced bigint, plans_sent bigint,
  channex_room_type_id text
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
  v_main uuid;
  v_main_currency text;
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = v_property;
  v_today := public.open_business_date(v_property);
  select btrim(p.currency) into v_currency from public.properties p where p.id = v_property;
  select rp.id, coalesce(btrim(rp.currency), v_currency) into v_main, v_main_currency
  from public.rate_plans rp
  where rp.property_id = v_property and rp.is_active
  order by rp.is_default desc, rp.sort_order, rp.name
  limit 1;

  return query
  select
    rt.id,
    rt.name,
    rt.code,
    coalesce(nullif(btrim(rt.display_name), ''), rt.name),
    (select count(*) from public.rooms r
      where r.room_type_id = rt.id and r.property_id = rt.property_id and r.is_enabled),
    g.sellable - g.sold,
    (select d.rate_cents from public.rate_plan_days d
      where d.rate_plan_id = v_main and d.room_type_id = rt.id
        and d.property_id = v_property and d.stay_date = v_today),
    v_main_currency,
    (select count(distinct rp.id) from public.rate_plans rp
      join public.rate_plan_days d
        on d.rate_plan_id = rp.id and d.room_type_id = rt.id and d.property_id = v_property
       and d.stay_date >= v_today and d.rate_cents is not null
      where rp.property_id = v_property and rp.is_active),
    (select count(*) from public.channex_rate_plan_map m
      where m.room_type_id = rt.id and m.channex_property_id = v_cx
        and not m.removed and m.withdrawn_at is null),
    tm.channex_room_type_id
  from public.room_types rt
  left join public.channex_room_type_map tm
    on tm.room_type_id = rt.id and tm.channex_property_id = v_cx
  left join public.inventory_grid_for(v_property, null, v_today, 1) g
    on g.room_type_id = rt.id
  where rt.property_id = v_property
  order by rt.sort_order, rt.name;
end;
$$;

-- The plans under each room type, with where each stands in Channex:
-- 'open', 'closed' (unticked, Channex would not remove it) or null (not there).
-- A plan open or closed in Channex is listed even if no longer priced.
create or replace function public.channex_room_plans()
returns table (
  room_type_id uuid,
  rate_plan_id uuid,
  rate_plan_name text,
  rate_cents bigint,
  rate_currency text,
  channex_rate_plan_id text,
  channex_state text
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
  select
    rt.id,
    rp.id,
    rp.name,
    (select d.rate_cents from public.rate_plan_days d
      where d.rate_plan_id = rp.id and d.room_type_id = rt.id
        and d.property_id = v_property and d.stay_date = v_today),
    coalesce(btrim(rp.currency), v_currency),
    case when m.removed then null else m.channex_rate_plan_id end,
    case
      when m.channex_rate_plan_id is null or m.removed then null
      when m.withdrawn_at is not null then 'closed'
      else 'open'
    end
  from public.room_types rt
  join public.rate_plans rp on rp.property_id = rt.property_id
  left join public.channex_rate_plan_map m
    on m.rate_plan_id = rp.id and m.room_type_id = rt.id and m.channex_property_id = v_cx
  where rt.property_id = v_property
    and (
      (m.channex_rate_plan_id is not null and not m.removed)
      or (rp.is_active and exists (
        select 1 from public.rate_plan_days d
        where d.rate_plan_id = rp.id and d.room_type_id = rt.id
          and d.property_id = v_property and d.stay_date >= v_today and d.rate_cents is not null))
    )
  order by rt.sort_order, rt.name, rp.is_default desc, rp.sort_order, rp.name;
end;
$$;

revoke all on function public.channex_room_plans() from public;
revoke execute on function public.channex_room_plans() from anon;
grant execute on function public.channex_room_plans() to authenticated;

notify pgrst, 'reload schema';
