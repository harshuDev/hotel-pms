-- 0150: acknowledging a booking revision never reached Channex.
--
-- channex_call() passed a NULL content for a call with no body, and the http
-- extension refuses a POST or PUT whose content is NULL ("http_request.content
-- is NULL"). The only such call is the ack, POST /booking_revisions/:id/ack,
-- and channex_ack_revision() swallows the error and returns false -- so every
-- revision was saved and none was acknowledged, and Channex would have kept
-- sending them. Found in certification test 11.
--
-- A POST, PUT or PATCH with no body now sends an empty JSON object. GET and
-- DELETE still send none. Same signature, so create or replace is safe.

create or replace function public.channex_call(p_property uuid, p_method text, p_path text, p_body jsonb default null)
returns table (status integer, body jsonb)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_conn public.channex_connections;
  v_key text;
  v_resp extensions.http_response;
  v_body jsonb;
  v_send jsonb;
begin
  select * into v_conn from public.channex_connections c where c.property_id = p_property;
  if not found or v_conn.api_key_secret_id is null then
    raise exception 'Add the Channex API key first';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where id = v_conn.api_key_secret_id;

  v_send := case
    when p_body is not null then p_body
    when upper(p_method) in ('POST', 'PUT', 'PATCH') then '{}'::jsonb
  end;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');
  v_resp := extensions.http((
    p_method::extensions.http_method,
    public.channex_base_url(v_conn.environment) || p_path,
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

revoke all on function public.channex_call(uuid, text, text, jsonb) from public;
revoke execute on function public.channex_call(uuid, text, text, jsonb) from anon, authenticated;
