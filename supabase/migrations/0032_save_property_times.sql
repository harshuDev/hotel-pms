-- save_property() wrote its two time parameters straight into columns that are
-- `not null`, so clearing the check-in time in Settings reached a manager as
--
--   null value in column "check_in_time" of relation "properties"
--   violates not-null constraint
--
-- which says what Postgres refused but nothing about what to do. Every other
-- refusal in this function is a sentence; these two were the only raw
-- constraint errors left in the settings path.
--
-- The parameters also gain `default null`. They are the last two, so this is
-- legal, and it is what they always meant: a caller that has no opinion about
-- the times now says so rather than being forced to invent a value. It also
-- lets the generated types describe them honestly — a parameter with no
-- default is typed non-null by the generator even when the function handles
-- null, and this one refuses it deliberately.

create or replace function public.save_property(
  p_name text,
  p_timezone text,
  p_currency char(3),
  p_check_in_time time default null,
  p_check_out_time time default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the property';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'The property needs a name';
  end if;

  -- The times are what every arrival and departure is timed against, and a
  -- booking cannot be taken without them, so there is no blank to fall back to.
  if p_check_in_time is null then
    raise exception 'The property needs a check-in time, like 15:00';
  end if;

  if p_check_out_time is null then
    raise exception 'The property needs a check-out time, like 11:00';
  end if;

  -- now() at time zone raises on an unknown zone, which is the cheapest way to
  -- refuse one before it becomes every business date this property computes.
  perform now() at time zone p_timezone;

  update public.properties set
    name = btrim(p_name),
    timezone = p_timezone,
    currency = upper(p_currency),
    check_in_time = p_check_in_time,
    check_out_time = p_check_out_time
  where id = v_property;
end;
$$;
