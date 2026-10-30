-- 0164: the Channex push works out what changed once per hotel, not twice,
-- and runs every five minutes.
--
-- 30 Oct, 23:30: Supabase reported the project unhealthy. The minute push
-- (pg_cron `channex-ari-push`, `channex_push_all()`) had grown to about 20
-- seconds a run through the day -- ten hotels, Adjana alone 96 linked plans
-- over 500 nights -- and from 21:13 every run passed the 2 minute
-- statement_timeout and was cancelled: nothing reached Channex, each run
-- still held a CPU for two minutes, the booking pull could not start ("job
-- startup timeout") and app reads timed out. pg_stat_statements put the push
-- at roughly 85% of all database time since September.
--
-- channex_push_ari_for() called channex_ari_changes() -- which prices every
-- linked plan for every night and compares it with channex_ari_sent -- once
-- for availability and again for restrictions, each call working out BOTH
-- and keeping half. It is now called once per hotel and the two kinds are
-- read from that one answer. Same rows, same order, same batching, same
-- recording of what Channex accepted.
--
-- The schedule goes from every minute to every five (applied first, by hand,
-- during the incident; recorded here). A change reaches Channex within five
-- minutes instead of one.

create or replace function public.channex_push_ari_for(p_property uuid, p_full boolean, p_actor uuid)
 returns table(kind text, sent integer, succeeded boolean, detail text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_changes jsonb;
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

  -- Worked out ONCE for both kinds (0164).
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', x.kind, 'channex_id', x.channex_id,
           'date_from', x.date_from, 'date_to', x.date_to, 'value', x.value)), '[]'::jsonb)
    into v_changes
  from public.channex_ari_changes(p_property, p_full) x;

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
        select e ->> 'channex_id' as channex_id,
          (e ->> 'date_from')::date as date_from,
          (e ->> 'date_to')::date as date_to,
          e -> 'value' as value,
          (row_number() over (order by e ->> 'channex_id', (e ->> 'date_from')::date) - 1) / 10000 as batch
        from jsonb_array_elements(v_changes) e
        where e ->> 'kind' = v_kind
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

  if p_actor is not null or v_total_sent > 0 or v_failed > 0 or v_warnings > 0 then
    insert into public.channex_sync_log (property_id, kind, ok, sent, failed, message, created_by, task_ids, warnings)
    values (p_property, 'ari', v_failed = 0 and v_warnings = 0, v_total_sent, v_failed,
            left(v_first_error, 1000), p_actor, v_tasks, v_warnings);
  end if;
end;
$function$;

select cron.schedule('channex-ari-push', '*/5 * * * *', $cron$select public.channex_push_all()$cron$);
