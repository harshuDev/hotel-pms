-- 0147: Send to Channex no longer runs out of time, and no longer leaves a
-- duplicate behind when it does.
--
-- On 22 Oct the first Send on Reservation Centric Hotel was cut off by the
-- 8 second limit every request from the app gets ("HTTP request cancelled").
-- Postgres rolled back its own side -- the links -- but the property, four room
-- types and six rate plans Channex had already made in those 8 seconds stayed
-- there. The second Send, finding no link, made all of it again.
--
-- 1. The Channex actions get 55 seconds (a function-level statement_timeout,
--    which the REST API applies; its ceiling is 60).
-- 2. Send ADOPTS what Channex already has before creating anything: the
--    property with this hotel's name that no other hotel is linked to, a room
--    type of the same title, a rate plan of the same title on the same room
--    type. So an interrupted Send, sent again, picks up where it stopped.

create or replace function public.channex_send_room_types(p_room_type_ids uuid[])
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
        where m.rate_plan_id = rp.id and m.room_type_id = rt.id and m.channex_property_id = v_cx)
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
          where m.channex_rate_plan_id = e ->> 'id')
      limit 1;
    end if;
    if v_found is not null then
      insert into public.channex_rate_plan_map (property_id, rate_plan_id, room_type_id, channex_property_id, channex_rate_plan_id)
      values (v_property, v_pair.plan_id, v_pair.type_id, v_cx, v_found ->> 'id');
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

  -- Their rates and availability, now, so the rows read right in Channex.
  for v_push in select * from public.channex_push_ari_for(v_property, false, auth.uid()) loop
    step := 'push'; label := v_push.kind; succeeded := v_push.succeeded;
    detail := coalesce(v_push.detail, v_push.sent::text);
    return next;
  end loop;
end;
$$;

revoke all on function public.channex_send_room_types(uuid[]) from public;
revoke execute on function public.channex_send_room_types(uuid[]) from anon;
grant execute on function public.channex_send_room_types(uuid[]) to authenticated;

-- The other Channex actions the app calls get the same time.
alter function public.channex_push_ari(boolean) set statement_timeout = '55s';
alter function public.channex_pull_bookings() set statement_timeout = '55s';
alter function public.test_channex_connection() set statement_timeout = '55s';

notify pgrst, 'reload schema';
