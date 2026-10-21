-- 0145: Channex -- send chosen room types, and push the way Channex certifies.
--
-- Written beside another session's 0143 (docs fixes) and 0144 (booking feed),
-- and applied after them as "0143_channex_send_rooms" plus 0145b. It replaces
-- 0143's channex_setup(), channex_ari_changes() and channex_push_ari_for()
-- whole, keeping everything 0143 fixed (warnings, max occupancy, no past
-- date) and adding what is below. 0144's channex_try_push() calls the push
-- unchanged.
--
-- The client (video, 2026-10-21): the Channex card should list every room
-- type -- Room Type, Room Name, Availability, Rate -- each with a tick, and a
-- "Send to Channex" button that sends only the ticked ones. Only what was
-- sent appears on Channex's Inventory page; once a room type is there, its
-- rates and availability keep going automatically.
--
--  * channex_room_list(): the card's list. Per room type: its staff name and
--    code, the name Channex and the guest see (display name, else the name),
--    enabled rooms, rooms left to sell on the business date (the calendar's
--    figure), the main rate plan's price that night in the plan's currency,
--    how many active plans are priced on it and how many of those Channex
--    has, and its Channex id.
--  * channex_send_room_types(ids): makes the Channex property if there is
--    none, then per ticked room type creates it in Channex -- or, when it is
--    already there, updates its title, room count and occupancy (the step two
--    gap) -- creates a Channex rate plan per active plan priced on it that is
--    not there yet, and pushes the changed rates and availability at once so
--    the rows read right in Channex straight away. Room types not ticked are
--    not touched. channex_setup() now sends every room type through it.
--
-- From Channex's PMS Integration Guide and PMS Certification Tests:
--  * A full sync is 500 days, ONE availability request and ONE rates and
--    restrictions request. The horizon was 365 and requests were split every
--    500 ranges; it is 500 days and up to 10,000 ranges a request now (well
--    under Channex's 10 MB).
--  * Changes go within a minute, batched: the cron job runs every minute
--    (was 15). A full resend at most once a day: channex-ari-full at 02:17
--    UTC, active connections only.
--  * Channex answers 200 with "warnings" for values it refused. Those nights
--    are no longer recorded as sent, so the next push tries them again, and
--    the run says what was refused.
--  * A 429 stops the run; what was not sent goes on the next one.
--  * The task ids Channex returns are kept on the run, for the certification
--    submission.
--  * Channex refuses past dates and a rate of 0: the first night sent is the
--    later of the business date and the hotel's own today (Channex dates by
--    the property's time zone), and a night priced 0 goes as stop sell.
--  * One push per hotel at a time (an advisory lock), so the minute job and
--    a button press never send the same nights twice.

-- 1. The run log keeps Channex's task ids and refused values ------------------

alter table public.channex_sync_log add column if not exists task_ids text[] not null default '{}';
alter table public.channex_sync_log add column if not exists warnings integer not null default 0;

-- 2. The card's list ------------------------------------------------------------------

create or replace function public.channex_room_list()
returns table (
  room_type_id uuid,
  room_type_name text,
  room_type_code text,
  room_name text,
  rooms bigint,
  available bigint,
  rate_cents bigint,
  rate_currency text,
  plans_priced bigint,
  plans_sent bigint,
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
      where m.room_type_id = rt.id and m.channex_property_id = v_cx),
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

revoke all on function public.channex_room_list() from public;
revoke execute on function public.channex_room_list() from anon;
grant execute on function public.channex_room_list() to authenticated;

-- 3. Rates and availability, as Channex certifies them ------------------------------

-- What would be sent now: every linked room type's availability and every
-- linked rate plan's restrictions over 500 nights from the first date Channex
-- accepts, less what Channex already has (unless p_full), joined into ranges
-- of consecutive nights with the same values. Changes nothing.
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
  -- Not a business date: the first night Channex will take, which it dates
  -- by the property's own clock. An audit not yet run must not send a past
  -- night, which Channex refuses.
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

-- Sends the changes -- one request per kind unless there are more than 10,000
-- ranges -- and remembers what Channex accepted. Granted to nobody:
-- channex_push_ari(), channex_send_room_types() and the cron jobs call it.
create or replace function public.channex_push_ari_for(p_property uuid, p_full boolean, p_actor uuid)
returns table (kind text, sent integer, succeeded boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cx text;
  v_kind text;
  v_key text;
  v_chunk jsonb;
  v_status integer;
  v_body jsonb;
  v_warn jsonb;
  v_sent integer;
  v_total_sent integer := 0;
  v_failed integer := 0;
  v_warnings integer := 0;
  v_tasks text[] := '{}';
  v_limited boolean := false;
  v_error text;
  v_first_error text;
begin
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = p_property;
  if v_cx is null then
    raise exception 'Create the hotel in Channex first';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('channex-ari:' || p_property::text, 0)) then
    kind := 'availability'; sent := 0; succeeded := false;
    detail := 'Another push to Channex is running for this hotel. Try again in a minute.';
    return next;
    return;
  end if;

  foreach v_kind in array array['availability', 'restrictions'] loop
    exit when v_limited;
    v_key := case when v_kind = 'availability' then 'room_type_id' else 'rate_plan_id' end;
    v_sent := 0;
    v_error := null;
    for v_chunk in
      select jsonb_agg(
        jsonb_build_object(
          'property_id', v_cx,
          v_key, ch.channex_id,
          'date_from', ch.date_from,
          'date_to', ch.date_to
        ) || ch.value
        order by ch.channex_id, ch.date_from)
      from (
        select x.*, (row_number() over (order by x.channex_id, x.date_from) - 1) / 10000 as batch
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
        v_tasks := v_tasks || array(
          select t ->> 'id' from jsonb_array_elements(coalesce(v_body -> 'data', '[]'::jsonb)) t
          where jsonb_typeof(v_body -> 'data') = 'array' and t ->> 'id' is not null);
        v_warn := case when jsonb_typeof(v_body -> 'meta' -> 'warnings') = 'array'
                       then v_body -> 'meta' -> 'warnings' else '[]'::jsonb end;

        -- What Channex took. A night a warning names was refused: it is not
        -- recorded, so the next push sends it again.
        insert into public.channex_ari_sent (property_id, channex_property_id, kind, channex_id, stay_date, value, sent_at)
        select p_property, v_cx, v_kind, e ->> v_key, gs::date,
          e - 'property_id' - 'room_type_id' - 'rate_plan_id' - 'date_from' - 'date_to',
          now()
        from jsonb_array_elements(v_chunk) e
        cross join generate_series((e ->> 'date_from')::date, (e ->> 'date_to')::date, interval '1 day') gs
        where not exists (
          select 1 from jsonb_array_elements(v_warn) w
          where w ->> v_key = e ->> v_key
            and gs::date between coalesce(w ->> 'date_from', w ->> 'date')::date
                             and coalesce(w ->> 'date_to', w ->> 'date')::date)
        on conflict on constraint channex_ari_sent_pkey
        do update set value = excluded.value, sent_at = excluded.sent_at;

        v_sent := v_sent + jsonb_array_length(v_chunk);
        if jsonb_array_length(v_warn) > 0 then
          v_warnings := v_warnings + jsonb_array_length(v_warn);
          v_error := coalesce(v_error, left(
            'Channex refused some values: ' || coalesce((v_warn -> 0 -> 'warning')::text, (v_warn -> 0)::text), 500));
        end if;
      elsif v_status = 429 then
        v_limited := true;
        v_error := 'Channex asked us to slow down. What was not sent goes on the next push.';
        v_failed := v_failed + jsonb_array_length(v_chunk);
        exit;
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

  -- The minute job logs only a push that did something; a button press
  -- always says what happened.
  if p_actor is not null or v_total_sent > 0 or v_failed > 0 or v_warnings > 0 then
    insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message, created_by, task_ids, warnings)
    values (p_property, 'ari', v_failed = 0 and v_warnings = 0, v_total_sent, v_failed,
            left(v_first_error, 1000), p_actor, v_tasks, v_warnings);
  end if;
end;
$$;

revoke all on function public.channex_push_ari_for(uuid, boolean, uuid) from public;
revoke execute on function public.channex_push_ari_for(uuid, boolean, uuid) from anon, authenticated;

-- The nightly full sync: every active connection, one hotel's failure never
-- stopping the next. Run by pg_cron; granted to nobody.
create or replace function public.channex_full_sync_all()
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
      perform public.channex_push_ari_for(v_property, true, null);
      v_count := v_count + 1;
    exception when others then
      insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message)
      values (v_property, 'ari', false, 0, 0, left(sqlerrm, 1000));
    end;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.channex_full_sync_all() from public;
revoke execute on function public.channex_full_sync_all() from anon, authenticated;

-- cron.schedule() with an existing name replaces that job's schedule.
select cron.schedule('channex-ari-push', '* * * * *', $cron$select public.channex_push_all()$cron$);
select cron.schedule('channex-ari-full', '17 2 * * *', $cron$select public.channex_full_sync_all()$cron$);

-- 4. Send the ticked room types ------------------------------------------------------

create or replace function public.channex_send_room_types(p_room_type_ids uuid[])
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
  v_push record;
  v_payload jsonb;
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

-- channex_setup() keeps working: it sends every room type.
create or replace function public.channex_setup()
returns table (step text, label text, succeeded boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select * from public.channex_send_room_types(array(
    select rt.id from public.room_types rt where rt.property_id = public.current_property_id()));
end;
$$;

revoke all on function public.channex_setup() from public;
revoke execute on function public.channex_setup() from anon;
grant execute on function public.channex_setup() to authenticated;
