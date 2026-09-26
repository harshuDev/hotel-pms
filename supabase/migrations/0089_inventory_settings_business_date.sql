-- 0088's two functions that date against the open business date called
-- `open_business_date()`, which staff cannot execute -- so every save of the
-- cut-off date and of the visibility ticks raised a permission error before
-- doing anything. They read `business_dates` directly now, under the caller's
-- own RLS (property isolation), which is what every other security invoker
-- function here does.

create or replace function public.save_online_booking_cutoff(
  p_enabled boolean,
  p_date date
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.inventory_settings_row();
  v_open date;
begin
  select b.business_date into v_open
  from public.business_dates b
  where b.property_id = v_property and b.status = 'open';

  if coalesce(p_enabled, false) and p_date is null then
    raise exception 'Choose the cut-off date';
  end if;
  if coalesce(p_enabled, false) and v_open is not null and p_date < v_open then
    raise exception 'Choose a cut-off date from the business date on';
  end if;
  update public.inventory_settings set
    online_cutoff_enabled = coalesce(p_enabled, false),
    -- Unticking drops the date rather than keeping one nothing reads.
    online_cutoff_date = case when coalesce(p_enabled, false) then p_date end,
    updated_at = now()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_online_booking_cutoff(boolean, date) from public, anon;
grant execute on function public.save_online_booking_cutoff(boolean, date) to authenticated;

create or replace function public.save_inventory_visibility(
  p_min_stay_through boolean,
  p_min_stay_arrival boolean,
  p_closed_to_arrival boolean,
  p_closed_to_departure boolean,
  p_max_stay boolean,
  p_stop_sell boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.inventory_settings_row();
  v_open date;
  v_field record;
  v_nights bigint;
begin
  select b.business_date into v_open
  from public.business_dates b
  where b.property_id = v_property and b.status = 'open';
  v_open := coalesce(v_open, current_date);

  -- A field may not be hidden while it is still set on a night to come.
  for v_field in
    select * from (values
      ('Min Stay Through', coalesce(p_min_stay_through, true), 'min_stay_through is not null'),
      ('Min Stay Arrival', coalesce(p_min_stay_arrival, true), 'min_stay_arrival is not null'),
      ('Closed To Arrival', coalesce(p_closed_to_arrival, true), 'closed_to_arrival'),
      ('Closed To Departure', coalesce(p_closed_to_departure, true), 'closed_to_departure'),
      ('Max Stay', coalesce(p_max_stay, true), 'max_stay is not null'),
      ('Stop Sell', coalesce(p_stop_sell, true), 'stop_sell')
    ) as f(label, shown, predicate)
    where not f.shown
  loop
    -- The predicate is one of the six literals above, never caller input.
    execute format(
      'select count(*) from public.rate_plan_days d
       join public.rate_plans rp on rp.id = d.rate_plan_id and rp.is_active
       where d.property_id = $1 and d.stay_date >= $2 and %s',
      v_field.predicate
    ) into v_nights using v_property, v_open;
    if v_nights > 0 then
      raise exception '% is still set on % night%. Clear it before hiding it.',
        v_field.label, v_nights, case when v_nights = 1 then '' else 's' end;
    end if;
  end loop;

  update public.inventory_settings set
    show_min_stay_through = coalesce(p_min_stay_through, true),
    show_min_stay_arrival = coalesce(p_min_stay_arrival, true),
    show_closed_to_arrival = coalesce(p_closed_to_arrival, true),
    show_closed_to_departure = coalesce(p_closed_to_departure, true),
    show_max_stay = coalesce(p_max_stay, true),
    show_stop_sell = coalesce(p_stop_sell, true),
    updated_at = now()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_inventory_visibility(boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.save_inventory_visibility(boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
