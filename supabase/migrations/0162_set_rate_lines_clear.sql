-- 0162: a line in "Set a price on many days" can clear its nights.
--
-- 0161 priced each ticked rate on its own and skipped a blank line, which
-- took away clearing a range from the panel: before, a blank price cleared
-- every ticked rate's nights. The client asked for it back as an explicit
-- choice. A line with "clear": true sends NULL to its setter, which is what
-- clearing a cell in the grid sends:
--   'default' / 'standard' -> the price goes back to "not loaded", so that
--                             plan is not sold on that room type those nights
--   'occupancy'            -> that party's own price goes, and it pays the
--                             standard price again
-- Same signature, so create or replace; nothing else changes.

create or replace function public.set_rate_lines(
  p_from date,
  p_to date,
  p_days_of_week integer[],
  p_lines jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line jsonb;
  v_i integer := 0;
  v_kind text;
  v_rt uuid;
  v_rp uuid;
  v_adults integer;
  v_cents bigint;
  v_clear boolean;
  v_total integer := 0;
  v_state text;
  v_msg text;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Tick at least one rate to apply this to.';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'Apply at most 500 rates at a time.';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    begin
      v_kind := v_line ->> 'kind';
      v_rt := (v_line ->> 'room_type_id')::uuid;
      v_rp := (v_line ->> 'rate_plan_id')::uuid;
      v_adults := (v_line ->> 'adults')::integer;
      v_clear := coalesce((v_line ->> 'clear')::boolean, false);
      v_cents := case when v_clear then null else (v_line ->> 'rate_cents')::bigint end;

      if v_rt is null or v_rp is null or v_kind is null
         or v_kind not in ('default', 'standard', 'occupancy') then
        raise exception 'A rate line is missing its room type, rate plan or occupancy.';
      end if;
      if not v_clear and (v_cents is null or v_cents < 0) then
        raise exception 'That is not an amount. Try 120 or 120.50.';
      end if;

      if v_kind = 'default' then
        v_total := v_total + coalesce(public.set_default_rates(
          v_rp, array[v_rt], p_from, p_to, p_days_of_week, v_cents), 0);
      elsif v_kind = 'standard' then
        v_total := v_total + coalesce(public.set_rates(
          v_rp, array[v_rt], p_from, p_to, p_days_of_week, v_cents), 0);
      else
        if v_adults is null or v_adults < 1 then
          raise exception 'A rate line is missing its room type, rate plan or occupancy.';
        end if;
        v_total := v_total + coalesce(public.set_occupancy_rates(
          v_rp, array[v_rt], p_from, p_to, p_days_of_week, v_adults, v_cents), 0);
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      raise exception using errcode = v_state, message = v_msg, detail = v_i::text;
    end;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.set_rate_lines(date, date, integer[], jsonb) from public;
revoke execute on function public.set_rate_lines(date, date, integer[], jsonb) from anon;
grant execute on function public.set_rate_lines(date, date, integer[], jsonb) to authenticated;
