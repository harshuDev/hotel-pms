-- 0161: several rates priced at once, each at its own price.
--
-- The client, 30 Oct, on Inventory -> Rates (All): "when I select multiple
-- room type and then fill the dates and occupancy then all the selected room
-- types get updated but on their own prices". "Set a price on many days" took
-- ONE price and ONE occupancy for every ticked rate, so a Double and a Suite
-- ticked together were both set to the same figure, and an occupancy one of
-- them could not hold was refused for all of them.
--
-- The panel now sends a line per ticked rate -- its room type, its plan, the
-- party it prices and its own price, in that plan's currency -- and this
-- writes them all in ONE transaction: a refusal on any line changes nothing.
-- It decides nothing itself. Each line goes to the setter the grid's own row
-- for it uses, so every guard, the derived-plan triggers and the per-person
-- arithmetic are theirs:
--   'default'   -> set_default_rates()   the plan's main row (0156)
--   'standard'  -> set_rates()           the Sleeps row under a default that
--                                        is not Sleeps
--   'occupancy' -> set_occupancy_rates() any other number of adults (0110)
-- A refusal is raised again with the line's position in DETAIL, so the
-- screen can say which rate it was, and with its own SQLSTATE and words, so
-- it is translated as the setter's refusal always was.
--
-- security invoker: the setters check the role and the property, under RLS.

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
      v_cents := (v_line ->> 'rate_cents')::bigint;

      if v_rt is null or v_rp is null or v_kind is null
         or v_kind not in ('default', 'standard', 'occupancy') then
        raise exception 'A rate line is missing its room type, rate plan or occupancy.';
      end if;
      if v_cents is null or v_cents < 0 then
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
