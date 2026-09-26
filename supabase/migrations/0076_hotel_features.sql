-- Settings -> System Settings -> Hotel Features, cloned from the client's
-- reference: a list of switches, each Active or not, saved together.
--
-- FOUR OF THEM ARE WIRED to what this application already does, and the rest
-- are stored for when their feature exists -- the same standing as the email
-- settings in 0074-0075. Which is which is listed in
-- `src/lib/hotel-features.ts` and in CLAUDE.md, so nobody reads a stored
-- switch as a working one:
--
--   housekeeping                      the Housekeeping report and the
--                                     calendar's housekeeping dots
--   housekeeping_status_modification  whether that dot opens its menu
--   group_booking                     "Add Group Booking" in the Bookings menu
--   accounting_report                 the Accounting report
--
-- One row per property, the switches as jsonb keyed by id. A switch never
-- saved takes its default from the TS list, so adding a switch is a line
-- there and a name in the list below, never a backfill.

create table public.hotel_features (
  property_id uuid primary key references public.properties(id) on delete cascade,
  features jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id) on delete set null,
  constraint hotel_features_object check (jsonb_typeof(features) = 'object')
);

alter table public.hotel_features enable row level security;

-- Everyone on the property reads them: the switches decide what menus and
-- screens show. Changing them is revenue staff, like the rest of Settings.
create policy hotel_features_select_current_property on public.hotel_features
  for select using (property_id = public.current_property_id());
create policy hotel_features_insert_revenue_staff on public.hotel_features
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy hotel_features_update_revenue_staff on public.hotel_features
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create or replace function public.save_hotel_features(p_features jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_key text;
  v_known text[] := array[
    'housekeeping',
    'housekeeping_status_modification',
    'room_rate_combination_modification',
    'sales_channels',
    'group_booking',
    'checkin_confirmation_mode',
    'payments_export_line_per_payment',
    'accounting_categories',
    'accounting_report',
    'invoice_date_changes',
    'invoice_number_changes',
    'payment_edit',
    'foreign_currency_invoices',
    'new_extra_in_booking',
    'multi_room_inventory_table',
    'payment_terminal',
    'three_column_dashboard',
    'room_rates_with_hotel_data',
    'travia_customer_lookup',
    'optimize_customer_search'
  ];
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the hotel features';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if jsonb_typeof(coalesce(p_features, '{}'::jsonb)) <> 'object' then
    raise exception 'The hotel features must be a set of switches';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_features, '{}'::jsonb)) loop
    if not (v_key = any (v_known)) then
      raise exception 'Unknown hotel feature %', v_key;
    end if;
    if jsonb_typeof(p_features->v_key) <> 'boolean' then
      raise exception 'Hotel feature % must be on or off', v_key;
    end if;
  end loop;

  insert into public.hotel_features as h (property_id, features, updated_at, updated_by)
  values (v_property, coalesce(p_features, '{}'::jsonb), now(), auth.uid())
  on conflict (property_id) do update set
    features = excluded.features,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

grant select, insert, update on public.hotel_features to authenticated;
revoke all on public.hotel_features from anon;

revoke execute on function public.save_hotel_features(jsonb) from public, anon;
grant execute on function public.save_hotel_features(jsonb) to authenticated;
