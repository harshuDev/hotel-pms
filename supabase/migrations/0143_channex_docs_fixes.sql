-- 0143: Channex, checked against Channex's own documentation
-- (docs.channex.io, read 2026-10-21). Nothing had been sent to Channex yet,
-- so no Channex object made by 0142 needs repairing.
--
--  * A REFUSED VALUE COMES BACK AS A WARNING ON A 200. /availability and
--    /restrictions accept the good values of a request, drop the bad ones and
--    list them under meta.warnings, still answering 200 OK. 0142 recorded
--    every value of a 200 in channex_ari_sent, so a refused night was taken
--    as sent and never retried. A warned value is now left out of
--    channex_ari_sent (the next push sends it again), counted as failed, and
--    named in the run's message.
--  * A per_room rate plan "takes one option for the maximum occupancy".
--    0142 sent the base occupancy; it now sends the room type's maximum,
--    which is what the Channex room type's occ_adults is.
--  * Channex refuses a past date, and between midnight and the night audit
--    the business date is yesterday on the hotel's clock. The push starts at
--    the later of the two.
--  * The limit is 10 requests a minute per property per endpoint and 10 MB a
--    request, and Channex asks for a full sync to be about one call each.
--    500 ranges a request would hit the limit on a large hotel's full push;
--    it is 5000 now (about 1.5 MB).
--
-- Each function is replaced whole; signatures are unchanged.

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
      greatest(coalesce(rt.max_occupancy, 1), 1) as max_occ
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
        'occupancy', v_pair.max_occ, 'is_primary', true, 'rate', 0))
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
  v_tz text;
begin
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = p_property;
  if v_cx is null or v_from is null then
    return;
  end if;
  select btrim(p.currency), p.timezone into v_currency, v_tz from public.properties p where p.id = p_property;
  -- Channex refuses a past date. Between midnight and the night audit the
  -- business date is still yesterday on the hotel's clock.
  v_from := greatest(v_from, (now() at time zone coalesce(v_tz, 'UTC'))::date);

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
  v_warnings jsonb;
  v_id_key text;
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
        select x.*, (row_number() over (order by x.channex_id, x.date_from) - 1) / 5000 as batch
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
        v_id_key := case when v_kind = 'availability' then 'room_type_id' else 'rate_plan_id' end;
        v_warnings := coalesce(v_body -> 'meta' -> 'warnings', '[]'::jsonb);
        if jsonb_typeof(v_warnings) <> 'array' then
          v_warnings := '[]'::jsonb;
        end if;
        insert into public.channex_ari_sent (property_id, channex_property_id, kind, channex_id, stay_date, value, sent_at)
        select p_property, v_cx, v_kind,
          e ->> case when v_kind = 'availability' then 'room_type_id' else 'rate_plan_id' end,
          gs::date,
          e - 'property_id' - 'room_type_id' - 'rate_plan_id' - 'date_from' - 'date_to',
          now()
        from jsonb_array_elements(v_chunk) e
        cross join generate_series((e ->> 'date_from')::date, (e ->> 'date_to')::date, interval '1 day') gs
        where not exists (
          select 1 from jsonb_array_elements(v_warnings) w
          where w ->> v_id_key = e ->> v_id_key
            and coalesce(w ->> 'date_from', w ->> 'date') = e ->> 'date_from'
            and coalesce(w ->> 'date_to', w ->> 'date') = e ->> 'date_to')
        on conflict on constraint channex_ari_sent_pkey
        do update set value = excluded.value, sent_at = excluded.sent_at;
        v_sent := v_sent + jsonb_array_length(v_chunk) - jsonb_array_length(v_warnings);
        if jsonb_array_length(v_warnings) > 0 then
          v_failed := v_failed + jsonb_array_length(v_warnings);
          v_error := coalesce(v_error, left(
            'Channex refused ' || jsonb_array_length(v_warnings) || ' of ' || jsonb_array_length(v_chunk) || ': ' ||
            coalesce(v_warnings -> 0 ->> v_id_key, '?') || ' ' ||
            coalesce(v_warnings -> 0 ->> 'date_from', v_warnings -> 0 ->> 'date', '') || ' ' ||
            coalesce((v_warnings -> 0 -> 'warning')::text, ''), 1000));
        end if;
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
