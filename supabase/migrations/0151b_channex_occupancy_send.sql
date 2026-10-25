-- 0151b: the card and Send for 0151's occupancy options. See 0151a.

-- Is what Channex holds for this plan what 0151 would send? A per_room plan
-- with one option counts as current when the plan sells one occupancy only.
create or replace function public.channex_plan_is_current(
  p_sell_mode text, p_occs integer[], p_primary integer, p_lo integer, p_hi integer, p_want_primary integer
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_sell_mode = 'per_person' then
      p_occs = array(select generate_series(p_lo, p_hi)) and p_primary = p_want_primary
    else p_lo = p_hi and coalesce(p_occs, array[p_hi]) = array[p_hi]
  end;
$$;

-- The card's Rate is the price for the plan's default occupancy now -- the
-- primary option, what Booking.com reads. It was the base occupancy's price.
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
    pr.rate_cents,
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
  left join public.channex_plan_occupancy(v_property) o
    on o.rate_plan_id = v_main and o.room_type_id = rt.id
  left join public.channex_occupancy_prices(v_property, v_today, 1) pr
    on pr.rate_plan_id = v_main and pr.room_type_id = rt.id and pr.adults = o.primary_occ
  where rt.property_id = v_property
  order by rt.sort_order, rt.name;
end;
$$;

create or replace function public.channex_room_plans()
returns table (
  room_type_id uuid, rate_plan_id uuid, rate_plan_name text, rate_cents bigint, rate_currency text,
  channex_rate_plan_id text, channex_state text
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
    pr.rate_cents,
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
  left join public.channex_plan_occupancy(v_property) o
    on o.rate_plan_id = rp.id and o.room_type_id = rt.id
  left join public.channex_occupancy_prices(v_property, v_today, 1) pr
    on pr.rate_plan_id = rp.id and pr.room_type_id = rt.id and pr.adults = o.primary_occ
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

-- Tonight's price for every occupancy a plan sells on a room type, for the
-- card; `in_channex` says whether Channex holds that occupancy, `is_current`
-- whether the plan as a whole is what Send would make it.
create or replace function public.channex_room_plan_occupancies()
returns table (
  room_type_id uuid, rate_plan_id uuid, adults integer, rate_cents bigint, is_primary boolean,
  in_channex boolean, is_current boolean
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
begin
  if v_property is null or not public.is_platform_member(auth.uid()) then
    raise exception 'Only the platform team can set up Channex';
  end if;
  select c.channex_property_id into v_cx from public.channex_connections c where c.property_id = v_property;
  v_today := public.open_business_date(v_property);

  return query
  select o.room_type_id, o.rate_plan_id, n.n, pr.rate_cents, n.n = o.primary_occ,
    m.channex_rate_plan_id is not null
      and n.n = any (coalesce(m.channex_occupancies, array[greatest(coalesce(rt.max_occupancy, 1), 1)])),
    m.channex_rate_plan_id is null or public.channex_plan_is_current(
      m.channex_sell_mode, m.channex_occupancies, m.channex_primary, o.lo, o.hi, o.primary_occ)
  from public.channex_plan_occupancy(v_property) o
  join public.room_types rt on rt.id = o.room_type_id
  cross join lateral generate_series(o.lo, o.hi) n(n)
  left join public.channex_rate_plan_map m
    on m.rate_plan_id = o.rate_plan_id and m.room_type_id = o.room_type_id
   and m.channex_property_id = v_cx and not m.removed
  left join public.channex_occupancy_prices(v_property, v_today, 1) pr
    on pr.rate_plan_id = o.rate_plan_id and pr.room_type_id = o.room_type_id and pr.adults = n.n
  order by rt.sort_order, o.room_type_id, o.rate_plan_id, n.n;
end;
$$;

revoke all on function public.channex_plan_is_current(text, integer[], integer, integer, integer, integer) from public;
revoke execute on function public.channex_plan_is_current(text, integer[], integer, integer, integer, integer) from anon, authenticated;
revoke all on function public.channex_room_plan_occupancies() from public;
revoke execute on function public.channex_room_plan_occupancies() from anon;
grant execute on function public.channex_room_plan_occupancies() to authenticated;

-- The options Send gives a plan on a room type: one per occupancy lo..hi.
create or replace function public.channex_desired_options(p_property uuid, p_rate_plan_id uuid, p_room_type_id uuid)
returns table (lo integer, hi integer, primary_occ integer, occs integer[], options jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select o.lo, o.hi, o.primary_occ,
    array(select generate_series(o.lo, o.hi)),
    (select jsonb_agg(jsonb_build_object('occupancy', n, 'is_primary', n = o.primary_occ, 'rate', 0) order by n)
       from generate_series(o.lo, o.hi) n)
  from public.channex_plan_occupancy(p_property) o
  where o.rate_plan_id = p_rate_plan_id and o.room_type_id = p_room_type_id;
$$;

revoke all on function public.channex_desired_options(uuid, uuid, uuid) from public;
revoke execute on function public.channex_desired_options(uuid, uuid, uuid) from anon, authenticated;

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
  v_want record;
  v_mode text;
  v_occs integer[];
  v_primary integer;
  v_mapped text[];
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

  select r.status, r.body into v_status, v_body
  from public.channex_call(v_property, 'GET',
    '/rate_plans?filter[property_id]=' || v_cx || '&pagination[limit]=100', null) r;
  if v_status = 200 then v_cx_plans := v_body -> 'data'; end if;

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

  for v_pair in
    select rp.id as plan_id, rp.name as plan_name,
      btrim(coalesce(rp.currency, v_prop.currency)) as plan_currency,
      rt.id as type_id, coalesce(nullif(btrim(rt.display_name), ''), rt.name) as type_title,
      tm.channex_room_type_id as cx_type
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
      -- Adopted as Channex has it; the loop below brings its occupancies up to date.
      insert into public.channex_rate_plan_map (property_id, rate_plan_id, room_type_id, channex_property_id,
        channex_rate_plan_id, channex_sell_mode, channex_occupancies, channex_primary)
      values (v_property, v_pair.plan_id, v_pair.type_id, v_cx, v_found ->> 'id',
        v_found -> 'attributes' ->> 'sell_mode',
        array(select (x ->> 'occupancy')::integer
          from jsonb_array_elements(coalesce(v_found -> 'attributes' -> 'options', '[]'::jsonb)) x order by 1),
        (select (x ->> 'occupancy')::integer
          from jsonb_array_elements(coalesce(v_found -> 'attributes' -> 'options', '[]'::jsonb)) x
          where (x ->> 'is_primary')::boolean limit 1))
      on conflict (rate_plan_id, room_type_id, channex_property_id) do update
        set channex_rate_plan_id = excluded.channex_rate_plan_id, withdrawn_at = null, removed = false,
            channex_sell_mode = excluded.channex_sell_mode, channex_occupancies = excluded.channex_occupancies,
            channex_primary = excluded.channex_primary;
      v_made := v_made + 1;
      succeeded := true; detail := v_found ->> 'id';
      return next;
      continue;
    end if;

    select * into v_want from public.channex_desired_options(v_property, v_pair.plan_id, v_pair.type_id);
    select r.status, r.body into v_status, v_body
    from public.channex_call(v_property, 'POST', '/rate_plans', jsonb_build_object('rate_plan', jsonb_build_object(
      'property_id', v_cx,
      'room_type_id', v_pair.cx_type,
      'title', v_pair.plan_name,
      'currency', v_pair.plan_currency,
      'sell_mode', 'per_person',
      'rate_mode', 'manual',
      'options', v_want.options
    ))) r;
    v_id := v_body -> 'data' ->> 'id';
    if v_status in (200, 201) and v_id is not null then
      insert into public.channex_rate_plan_map (property_id, rate_plan_id, room_type_id, channex_property_id,
        channex_rate_plan_id, channex_sell_mode, channex_occupancies, channex_primary)
      values (v_property, v_pair.plan_id, v_pair.type_id, v_cx, v_id, 'per_person', v_want.occs, v_want.primary_occ)
      on conflict (rate_plan_id, room_type_id, channex_property_id) do update
        set channex_rate_plan_id = excluded.channex_rate_plan_id, withdrawn_at = null, removed = false,
            channex_sell_mode = excluded.channex_sell_mode, channex_occupancies = excluded.channex_occupancies,
            channex_primary = excluded.channex_primary;
      v_made := v_made + 1;
      succeeded := true; detail := v_id;
    else
      v_failed := v_failed + 1;
      succeeded := false; detail := public.channex_error_text(v_status, v_body);
      v_first_error := coalesce(v_first_error, label || ': ' || detail);
    end if;
    return next;
  end loop;

  -- Every Channex plan (and occupancy option) a channel is mapped to. Read
  -- before anything is deleted: a mapped plan is never rebuilt, whatever
  -- Channex would allow. Unreadable, nothing is rebuilt.
  select r.status, r.body into v_status, v_body
  from public.channex_call(v_property, 'GET',
    '/channels?filter[property_id]=' || v_cx || '&pagination[limit]=100', null) r;
  if v_status = 200 then
    v_mapped := array(
      select x ->> 'rate_plan_id'
      from jsonb_array_elements(coalesce(v_body -> 'data', '[]'::jsonb)) c
      cross join jsonb_array_elements(coalesce(c -> 'attributes' -> 'rate_plans', '[]'::jsonb)) x
      where x ->> 'rate_plan_id' is not null);
  end if;

  -- Plans already in Channex: one option per occupancy, the default primary.
  -- Read from Channex rather than from what was recorded, so a plan made
  -- before 0151 is seen as the per_room plan it is. A plan that differs is
  -- rebuilt under the same title when no channel is mapped to it, and kept
  -- as it is (and pushed what its options say) when one is.
  if v_cx_plans is not null then
    for v_pair in
      select m.rate_plan_id as plan_id, m.room_type_id as type_id, m.channex_rate_plan_id as cx_plan,
        rp.name as plan_name,
        btrim(coalesce(rp.currency, v_prop.currency)) as plan_currency,
        rp.name || ' · ' || coalesce(nullif(btrim(rt.display_name), ''), rt.name) as title,
        tm.channex_room_type_id as cx_type,
        (select e from jsonb_array_elements(v_cx_plans) e where e ->> 'id' = m.channex_rate_plan_id limit 1) as cx
      from public.channex_rate_plan_map m
      join public.rate_plans rp on rp.id = m.rate_plan_id
      join public.room_types rt on rt.id = m.room_type_id
      join public.channex_room_type_map tm
        on tm.room_type_id = m.room_type_id and tm.channex_property_id = v_cx
      where m.property_id = v_property and m.channex_property_id = v_cx
        and not m.removed and m.withdrawn_at is null
        and m.room_type_id = any (p_room_type_ids)
        and (p_rate_plans is null or exists (
          select 1 from jsonb_array_elements(p_rate_plans) x
          where x ->> 'room_type_id' = m.room_type_id::text and x ->> 'rate_plan_id' = m.rate_plan_id::text))
      order by rt.sort_order, rt.name, rp.sort_order, rp.name
    loop
      continue when v_pair.cx is null;
      v_mode := v_pair.cx -> 'attributes' ->> 'sell_mode';
      v_occs := array(select (x ->> 'occupancy')::integer
        from jsonb_array_elements(coalesce(v_pair.cx -> 'attributes' -> 'options', '[]'::jsonb)) x order by 1);
      v_primary := (select (x ->> 'occupancy')::integer
        from jsonb_array_elements(coalesce(v_pair.cx -> 'attributes' -> 'options', '[]'::jsonb)) x
        where (x ->> 'is_primary')::boolean limit 1);
      select * into v_want from public.channex_desired_options(v_property, v_pair.plan_id, v_pair.type_id);

      if public.channex_plan_is_current(v_mode, v_occs, v_primary, v_want.lo, v_want.hi, v_want.primary_occ) then
        update public.channex_rate_plan_map m
          set channex_sell_mode = v_mode, channex_occupancies = v_occs, channex_primary = v_primary
        where m.rate_plan_id = v_pair.plan_id and m.room_type_id = v_pair.type_id and m.channex_property_id = v_cx;
        continue;
      end if;

      step := 'rate_plan'; label := v_pair.title;
      -- Channex will not change a plan's sell mode or its primary occupancy,
      -- and ignores options added or taken away (each tried on staging), so
      -- the plan is made again -- only if no channel is mapped to it (by the
      -- list above, and by Channex refusing the delete).
      if v_mapped is null
         or v_pair.cx_plan = any (v_mapped)
         or exists (select 1 from jsonb_array_elements(coalesce(v_pair.cx -> 'attributes' -> 'options', '[]'::jsonb)) x
                    where x ->> 'id' = any (v_mapped)) then
        v_status := 422;
      else
        select r.status, r.body into v_status, v_body
        from public.channex_call(v_property, 'DELETE', '/rate_plans/' || v_pair.cx_plan, null) r;
      end if;
      if v_status not in (200, 204, 404) then
        update public.channex_rate_plan_map m
          set channex_sell_mode = coalesce(v_mode, 'per_room'), channex_occupancies = v_occs, channex_primary = v_primary
        where m.rate_plan_id = v_pair.plan_id and m.room_type_id = v_pair.type_id and m.channex_property_id = v_cx;
        step := 'kept'; succeeded := true; detail := v_pair.cx_plan;
        return next;
        continue;
      end if;

      select r.status, r.body into v_status, v_body
      from public.channex_call(v_property, 'POST', '/rate_plans', jsonb_build_object('rate_plan', jsonb_build_object(
        'property_id', v_cx,
        'room_type_id', v_pair.cx_type,
        'title', v_pair.plan_name,
        'currency', v_pair.plan_currency,
        'sell_mode', 'per_person',
        'rate_mode', 'manual',
        'options', v_want.options
      ))) r;
      v_id := v_body -> 'data' ->> 'id';
      if v_status in (200, 201) and v_id is not null then
        update public.channex_rate_plan_map m
          set channex_rate_plan_id = v_id, channex_sell_mode = 'per_person',
              channex_occupancies = v_want.occs, channex_primary = v_want.primary_occ
        where m.rate_plan_id = v_pair.plan_id and m.room_type_id = v_pair.type_id and m.channex_property_id = v_cx;
        v_made := v_made + 1;
        succeeded := true; detail := v_id;
      else
        -- The old plan is gone; ticking it and sending again makes it.
        update public.channex_rate_plan_map m
          set removed = true, withdrawn_at = coalesce(m.withdrawn_at, now())
        where m.rate_plan_id = v_pair.plan_id and m.room_type_id = v_pair.type_id and m.channex_property_id = v_cx;
        v_failed := v_failed + 1;
        succeeded := false; detail := public.channex_error_text(v_status, v_body);
        v_first_error := coalesce(v_first_error, label || ': ' || detail);
      end if;
      return next;
    end loop;
  end if;

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

  for v_push in select * from public.channex_push_ari_for(v_property, false, auth.uid()) loop
    step := 'push'; label := v_push.kind; succeeded := v_push.succeeded;
    detail := coalesce(v_push.detail, v_push.sent::text);
    return next;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
