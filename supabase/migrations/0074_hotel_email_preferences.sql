-- Settings -> Communications & Notifications -> Hotel Emails Preferences,
-- cloned from the client's reference: the addresses the hotel's notification
-- emails go to, and which kinds of notification it wants.
--
-- A STORED CHOICE, NOT YET A LIVE ONE -- the same standing as
-- `properties.audit_close_time` before its job. There is no mail provider in
-- this system, so nothing sends; and six of the eight kinds are channel-manager
-- events (a booking, change or cancellation arriving from an OTA) which cannot
-- happen while OTA bookings are entered by hand (open decision 2). The
-- settings are kept so that the moment sending exists, the hotel's choices are
-- already there to read. CLAUDE.md records it so nobody mistakes the table for
-- a working feature.
--
-- One row per property. Preferences are jsonb keyed by kind, and a kind with
-- no key reads as ACTIVE, which is how the reference ships every one of them.
-- The kinds are checked here and listed in `src/lib/email-preferences.ts`.

create table public.hotel_email_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  notification_emails text[] not null default '{}',
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id) on delete set null,
  constraint hotel_email_settings_preferences_object check (jsonb_typeof(preferences) = 'object'),
  constraint hotel_email_settings_email_count check (cardinality(notification_emails) <= 10)
);

alter table public.hotel_email_settings enable row level security;

create policy hotel_email_settings_select_current_property on public.hotel_email_settings
  for select using (property_id = public.current_property_id());
create policy hotel_email_settings_insert_revenue_staff on public.hotel_email_settings
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy hotel_email_settings_update_revenue_staff on public.hotel_email_settings
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

/*
 * The whole page at once, as the reference's one SAVE does. Addresses are
 * trimmed, lower-cased and de-duplicated; one that is not an address is
 * refused by name. A preference for a kind this system does not know is
 * refused rather than stored, so the jsonb only ever holds real kinds.
 */
create or replace function public.save_hotel_email_settings(
  p_emails text[],
  p_preferences jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_emails text[];
  v_bad text;
  v_key text;
  v_known text[] := array[
    'channel_booking_confirmation',
    'channel_booking_modification',
    'pre_arrival',
    'channel_booking_cancellation',
    'channel_missing_booking_cancellation',
    'channel_missing_booking_modification',
    'channel_overbooking',
    'channel_rate_mapping_error'
  ];
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the email preferences';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  select coalesce(array_agg(distinct lower(btrim(e))), '{}')
  into v_emails
  from unnest(coalesce(p_emails, '{}')) e
  where btrim(coalesce(e, '')) <> '';

  select e into v_bad from unnest(v_emails) e
  where e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  limit 1;
  if v_bad is not null then
    raise exception '% does not look like an email address', v_bad;
  end if;
  if cardinality(v_emails) > 10 then
    raise exception 'Up to 10 notification addresses';
  end if;

  if jsonb_typeof(coalesce(p_preferences, '{}'::jsonb)) <> 'object' then
    raise exception 'The email preferences must be a set of switches';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_preferences, '{}'::jsonb)) loop
    if not (v_key = any (v_known)) then
      raise exception 'Unknown email preference %', v_key;
    end if;
    if jsonb_typeof(p_preferences->v_key) <> 'boolean' then
      raise exception 'Email preference % must be on or off', v_key;
    end if;
  end loop;

  insert into public.hotel_email_settings as h (
    property_id, notification_emails, preferences, updated_at, updated_by
  ) values (
    v_property, v_emails, coalesce(p_preferences, '{}'::jsonb), now(), auth.uid()
  )
  on conflict (property_id) do update set
    notification_emails = excluded.notification_emails,
    preferences = excluded.preferences,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

grant select, insert, update on public.hotel_email_settings to authenticated;
revoke all on public.hotel_email_settings from anon;

revoke execute on function public.save_hotel_email_settings(text[], jsonb) from public, anon;
grant execute on function public.save_hotel_email_settings(text[], jsonb) to authenticated;
