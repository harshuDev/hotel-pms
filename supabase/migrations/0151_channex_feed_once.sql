-- 0151: one booking-revisions feed call per Channex account, not per hotel.
--
-- Channex (Evan, 24 Oct): "You need to fix feed endpoint to check 1 time for
-- all properties not per property." channex_pull_bookings_all() called
-- GET /booking_revisions/feed?filter[property_id]=... once a minute for every
-- active hotel -- three staging hotels made 540 feed calls in three hours.
--
-- The feed without a property filter returns the unacknowledged revisions of
-- every property the API key can reach. So the minute job now groups the
-- active connections by environment and API KEY (the decrypted value: two
-- hotels may hold the same key under two vault secrets), calls the feed ONCE
-- per group, and hands each revision to the hotel whose channex_property_id
-- it names. In production there is one Channex account, so one call a minute.
--
-- A revision for a Channex property no hotel here is linked to is left
-- unacknowledged (Channex alarms on it, which is right) and skipped.
--
-- channex_call() now delegates to channex_http(environment, secret, ...),
-- which is what the group call uses; behaviour is unchanged, 0150's empty
-- body on a bodiless POST included. "Pull bookings now" on the card still
-- asks for its own hotel only.

create or replace function public.channex_http(
  p_environment text, p_secret_id uuid, p_method text, p_path text, p_body jsonb default null)
returns table (status integer, body jsonb)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_key text;
  v_resp extensions.http_response;
  v_body jsonb;
  v_send jsonb;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where id = p_secret_id;
  if v_key is null then
    raise exception 'Add the Channex API key first';
  end if;

  v_send := case
    when p_body is not null then p_body
    when upper(p_method) in ('POST', 'PUT', 'PATCH') then '{}'::jsonb
  end;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');
  v_resp := extensions.http((
    p_method::extensions.http_method,
    public.channex_base_url(p_environment) || p_path,
    array[extensions.http_header('user-api-key', v_key)],
    case when v_send is null then null else 'application/json' end,
    case when v_send is null then null else v_send::text end
  )::extensions.http_request);

  begin
    v_body := v_resp.content::jsonb;
  exception when others then
    v_body := jsonb_build_object('raw', left(coalesce(v_resp.content, ''), 500));
  end;

  return query select v_resp.status, v_body;
end;
$$;

revoke all on function public.channex_http(text, uuid, text, text, jsonb) from public;
revoke execute on function public.channex_http(text, uuid, text, text, jsonb) from anon, authenticated;

create or replace function public.channex_call(p_property uuid, p_method text, p_path text, p_body jsonb default null)
returns table (status integer, body jsonb)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_conn public.channex_connections;
begin
  select * into v_conn from public.channex_connections c where c.property_id = p_property;
  if not found or v_conn.api_key_secret_id is null then
    raise exception 'Add the Channex API key first';
  end if;
  return query select * from public.channex_http(v_conn.environment, v_conn.api_key_secret_id, p_method, p_path, p_body);
end;
$$;

revoke all on function public.channex_call(uuid, text, text, jsonb) from public;
revoke execute on function public.channex_call(uuid, text, text, jsonb) from anon, authenticated;

-- The whole account's feed, through one hotel's connection (any hotel in the
-- group: they share the environment and the key).
create or replace function public.channex_fetch_feed_account(p_via_property uuid)
returns table (revisions jsonb, error text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status integer;
  v_body jsonb;
begin
  begin
    select r.status, r.body into v_status, v_body
    from public.channex_call(p_via_property, 'GET',
      '/booking_revisions/feed?order[inserted_at]=asc&pagination[limit]=100') r;
  exception when others then
    return query select null::jsonb, left(sqlerrm, 1000);
    return;
  end;
  if v_status = 200 and jsonb_typeof(v_body -> 'data') = 'array' then
    return query select v_body -> 'data', null::text;
  else
    return query select null::jsonb, public.channex_error_text(v_status, v_body);
  end if;
end;
$$;

revoke all on function public.channex_fetch_feed_account(uuid) from public;
revoke execute on function public.channex_fetch_feed_account(uuid) from anon, authenticated;

create or replace procedure public.channex_pull_bookings_all()
language plpgsql
as $$
declare
  v_group record;
  v_feed record;
  v_rev jsonb;
  v_cx text;
  v_property uuid;
  v_res record;
  v_pending record;
  v_page integer;
  v_acked integer;
  v_changed uuid[];
begin
  for v_group in
    select c.environment,
           array_agg(c.property_id order by c.property_id) as properties,
           array_agg(c.channex_property_id order by c.property_id) as channex_ids
    from public.channex_connections c
    join vault.decrypted_secrets s on s.id = c.api_key_secret_id
    where c.is_active and c.channex_property_id is not null
    group by c.environment, s.decrypted_secret
  loop
    v_changed := '{}';

    -- Acks that failed last time, before asking for more.
    for v_pending in
      select r.property_id, r.channex_revision_id from public.channex_booking_revisions r
      where r.property_id = any (v_group.properties) and r.acked_at is null and r.outcome <> 'failed'
      order by r.received_at
    loop
      perform public.channex_ack_revision(v_pending.property_id, v_pending.channex_revision_id);
      commit;
    end loop;

    for v_page in 1..10 loop
      select * into v_feed from public.channex_fetch_feed_account(v_group.properties[1]);
      exit when v_feed.revisions is null or jsonb_array_length(v_feed.revisions) = 0;
      v_acked := 0;
      for v_rev in select x.value from jsonb_array_elements(v_feed.revisions) x loop
        v_cx := coalesce(v_rev -> 'attributes' ->> 'property_id', v_rev ->> 'property_id');
        v_property := null;
        for i in 1 .. array_length(v_group.channex_ids, 1) loop
          if v_group.channex_ids[i] = v_cx then
            v_property := v_group.properties[i];
          end if;
        end loop;
        continue when v_property is null;

        select * into v_res from public.channex_apply_revision(v_property, v_rev);
        commit;
        if v_res.outcome is not null and v_res.outcome <> 'failed' then
          if v_res.outcome <> 'seen' and not v_property = any (v_changed) then
            v_changed := v_changed || v_property;
          end if;
          if public.channex_ack_revision(v_property, v_res.revision_id) then
            v_acked := v_acked + 1;
          end if;
          commit;
        end if;
      end loop;
      exit when v_acked = 0;
    end loop;

    foreach v_property in array v_changed loop
      perform public.channex_try_push(v_property);
      commit;
    end loop;
  end loop;
end;
$$;

revoke all on procedure public.channex_pull_bookings_all() from public;
revoke execute on procedure public.channex_pull_bookings_all() from anon, authenticated;
