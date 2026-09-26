-- Settings -> Communications & Notifications -> Email Setup, cloned from the
-- client's reference: General Settings, Footer Template, Booking Confirmation
-- Email settings, Pre Arrival, Post Departure and Request Payment email
-- setup, and a list of Email Templates. Each section saves on its own, as the
-- reference's does, so each has its own function.
--
-- STORED, LIKE 0074: there is no mail provider in this system, so nothing
-- here sends. The one part with a reader today is Email Templates -- the
-- booking screen's Email tab offers them when recording a message, which is
-- the "faster communication with your guests" the reference names.
--
-- "Booking Notification Email Address" is NOT a new column. The reference
-- shows the same addresses on this page and on Hotel Emails Preferences, so
-- both pages read and write `hotel_email_settings.notification_emails`; two
-- lists that were meant to be one would drift the first time a receptionist
-- changed one.
--
-- Bodies and footers are plain text, like the registration card's terms:
-- HTML typed in a browser and sent or printed back out needs a sanitiser this
-- codebase does not have.

alter table public.hotel_email_settings
  add column reply_to_emails text[] not null default '{}',
  add column from_text text,
  add column footer_template text,
  add column checkin_notes text,
  add column directions text,
  add column single_property_address text not null default 'hotel',
  add column multi_property_address text not null default 'hotel_hide_properties',
  add column confirmation_message text,
  add column confirmation_colors jsonb not null default jsonb_build_object(
    'header_info_text', '#003580',
    'title_text', '#2d90d1',
    'reservation_details_background', '#71bb6e',
    'reservation_details_text', '#ffffff',
    'room_details_background', '#eafbe9',
    'room_details_text', '#000000',
    'room_price_nights_text', '#57a571'
  ),
  add column show_hotel_logo boolean not null default false,
  add column include_footer boolean not null default false,
  add column pre_arrival_enabled boolean not null default false,
  add column post_departure_enabled boolean not null default false,
  add column post_departure_subject text,
  add column post_departure_body text,
  add column payment_request_subject text,
  add column payment_request_body text,
  add constraint hotel_email_settings_reply_to_count check (cardinality(reply_to_emails) <= 10),
  add constraint hotel_email_settings_from_text_length check (char_length(from_text) <= 255),
  add constraint hotel_email_settings_post_subject_length check (char_length(post_departure_subject) <= 255),
  add constraint hotel_email_settings_payment_subject_length check (char_length(payment_request_subject) <= 255),
  add constraint hotel_email_settings_single_address check (
    single_property_address in ('hotel', 'property')
  ),
  add constraint hotel_email_settings_multi_address check (
    multi_property_address in ('hotel_hide_properties', 'show_properties')
  ),
  add constraint hotel_email_settings_colors_object check (jsonb_typeof(confirmation_colors) = 'object');

/* -- Shared checks --------------------------------------------------------- */

-- The row for this property, made if it is not there yet, so every section's
-- save is an UPDATE of its own columns and never clears another section.
create or replace function public.hotel_email_settings_row()
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the email setup';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  insert into public.hotel_email_settings (property_id) values (v_property)
  on conflict (property_id) do nothing;
  return v_property;
end;
$$;

-- Trimmed, lower-cased, de-duplicated; one that is not an address refused by name.
create or replace function public.clean_email_list(p_emails text[])
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_emails text[];
  v_bad text;
begin
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
    raise exception 'Up to 10 addresses';
  end if;
  return v_emails;
end;
$$;

/* -- General Settings ------------------------------------------------------ */

create or replace function public.save_email_general(
  p_reply_to text[],
  p_from_text text,
  p_notification_emails text[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.hotel_email_settings_row();
begin
  if char_length(btrim(coalesce(p_from_text, ''))) > 255 then
    raise exception 'The From text can be up to 255 characters';
  end if;
  update public.hotel_email_settings set
    reply_to_emails = public.clean_email_list(p_reply_to),
    from_text = nullif(btrim(coalesce(p_from_text, '')), ''),
    notification_emails = public.clean_email_list(p_notification_emails),
    updated_at = now(), updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

/* -- Footer Template ------------------------------------------------------- */

create or replace function public.save_email_footer(p_footer text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.hotel_email_settings_row();
begin
  update public.hotel_email_settings set
    footer_template = nullif(btrim(coalesce(p_footer, '')), ''),
    updated_at = now(), updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

/* -- Booking Confirmation Email settings ----------------------------------- */

create or replace function public.save_booking_confirmation_email(
  p_checkin_notes text,
  p_directions text,
  p_single_property_address text,
  p_multi_property_address text,
  p_confirmation_message text,
  p_colors jsonb,
  p_show_hotel_logo boolean,
  p_include_footer boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.hotel_email_settings_row();
  v_key text;
  v_known text[] := array[
    'header_info_text', 'title_text', 'reservation_details_background',
    'reservation_details_text', 'room_details_background', 'room_details_text',
    'room_price_nights_text'
  ];
begin
  if p_single_property_address not in ('hotel', 'property') then
    raise exception 'Choose an address for single-property bookings';
  end if;
  if p_multi_property_address not in ('hotel_hide_properties', 'show_properties') then
    raise exception 'Choose an address for multi-property bookings';
  end if;
  if jsonb_typeof(coalesce(p_colors, '{}'::jsonb)) <> 'object' then
    raise exception 'The colours must be a set of colours';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_colors, '{}'::jsonb)) loop
    if not (v_key = any (v_known)) then
      raise exception 'Unknown colour %', v_key;
    end if;
    if coalesce(p_colors->>v_key, '') !~ '^#[0-9a-fA-F]{6}$' then
      raise exception '% is not a colour like #003580', coalesce(p_colors->>v_key, 'That');
    end if;
  end loop;

  update public.hotel_email_settings set
    checkin_notes = nullif(btrim(coalesce(p_checkin_notes, '')), ''),
    directions = nullif(btrim(coalesce(p_directions, '')), ''),
    single_property_address = p_single_property_address,
    multi_property_address = p_multi_property_address,
    confirmation_message = nullif(btrim(coalesce(p_confirmation_message, '')), ''),
    -- Kept over the stored set, so a colour not sent keeps its value.
    confirmation_colors = confirmation_colors || coalesce(p_colors, '{}'::jsonb),
    show_hotel_logo = coalesce(p_show_hotel_logo, false),
    include_footer = coalesce(p_include_footer, false),
    updated_at = now(), updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

/* -- Pre Arrival, Post Departure, Request Payment -------------------------- */

create or replace function public.save_pre_arrival_email(p_enabled boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.hotel_email_settings_row();
begin
  update public.hotel_email_settings set
    pre_arrival_enabled = coalesce(p_enabled, false),
    updated_at = now(), updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

create or replace function public.save_post_departure_email(
  p_enabled boolean,
  p_subject text,
  p_body text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.hotel_email_settings_row();
begin
  if char_length(btrim(coalesce(p_subject, ''))) > 255 then
    raise exception 'The subject can be up to 255 characters';
  end if;
  if coalesce(p_enabled, false) and btrim(coalesce(p_subject, '')) = '' then
    raise exception 'Give the post-departure email a subject, or turn it off';
  end if;
  update public.hotel_email_settings set
    post_departure_enabled = coalesce(p_enabled, false),
    post_departure_subject = nullif(btrim(coalesce(p_subject, '')), ''),
    post_departure_body = nullif(btrim(coalesce(p_body, '')), ''),
    updated_at = now(), updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

create or replace function public.save_payment_request_email(p_subject text, p_body text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.hotel_email_settings_row();
begin
  if char_length(btrim(coalesce(p_subject, ''))) > 255 then
    raise exception 'The subject can be up to 255 characters';
  end if;
  update public.hotel_email_settings set
    payment_request_subject = nullif(btrim(coalesce(p_subject, '')), ''),
    payment_request_body = nullif(btrim(coalesce(p_body, '')), ''),
    updated_at = now(), updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

/* -- Email Templates ------------------------------------------------------- */

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  title text not null,
  subject text,
  body text,
  created_at timestamptz not null default now(),
  constraint email_templates_title_present check (btrim(title) <> ''),
  constraint email_templates_subject_length check (char_length(subject) <= 255)
);

create unique index email_templates_title_key
  on public.email_templates (property_id, lower(btrim(title)));

alter table public.email_templates enable row level security;

-- Anyone on the property reads them: the front desk records messages from
-- them on the booking screen. Changing the list is revenue staff.
create policy email_templates_select_current_property on public.email_templates
  for select using (property_id = public.current_property_id());
create policy email_templates_write_revenue_staff on public.email_templates
  for all using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

create or replace function public.save_email_template(
  p_id uuid,
  p_title text,
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the email setup';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'An email template needs a title';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) > 255 then
    raise exception 'The subject can be up to 255 characters';
  end if;
  if exists (
    select 1 from public.email_templates
    where property_id = v_property
      and lower(btrim(title)) = lower(btrim(p_title))
      and id is distinct from p_id
  ) then
    raise exception 'There is already an email template called %', btrim(p_title);
  end if;

  if p_id is null then
    insert into public.email_templates (property_id, title, subject, body)
    values (
      v_property, btrim(p_title),
      nullif(btrim(coalesce(p_subject, '')), ''), nullif(btrim(coalesce(p_body, '')), '')
    )
    returning id into v_id;
  else
    update public.email_templates set
      title = btrim(p_title),
      subject = nullif(btrim(coalesce(p_subject, '')), ''),
      body = nullif(btrim(coalesce(p_body, '')), '')
    where id = p_id and property_id = v_property
    returning id into v_id;
    if v_id is null then
      raise exception 'That email template no longer exists';
    end if;
  end if;
  return v_id;
end;
$$;

-- A real delete: a template is a starting point, and a message recorded from
-- one keeps its own copy of the words.
create or replace function public.delete_email_template(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the email setup';
  end if;
  delete from public.email_templates
  where id = p_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That email template no longer exists';
  end if;
end;
$$;

/* -- Grants ---------------------------------------------------------------- */

grant select, insert, update, delete on public.email_templates to authenticated;
revoke all on public.email_templates from anon;

revoke execute on function public.hotel_email_settings_row() from public, anon;
revoke execute on function public.clean_email_list(text[]) from public, anon;
revoke execute on function public.save_email_general(text[], text, text[]) from public, anon;
revoke execute on function public.save_email_footer(text) from public, anon;
revoke execute on function public.save_booking_confirmation_email(text, text, text, text, text, jsonb, boolean, boolean) from public, anon;
revoke execute on function public.save_pre_arrival_email(boolean) from public, anon;
revoke execute on function public.save_post_departure_email(boolean, text, text) from public, anon;
revoke execute on function public.save_payment_request_email(text, text) from public, anon;
revoke execute on function public.save_email_template(uuid, text, text, text) from public, anon;
revoke execute on function public.delete_email_template(uuid) from public, anon;

grant execute on function public.hotel_email_settings_row() to authenticated;
grant execute on function public.clean_email_list(text[]) to authenticated;
grant execute on function public.save_email_general(text[], text, text[]) to authenticated;
grant execute on function public.save_email_footer(text) to authenticated;
grant execute on function public.save_booking_confirmation_email(text, text, text, text, text, jsonb, boolean, boolean) to authenticated;
grant execute on function public.save_pre_arrival_email(boolean) to authenticated;
grant execute on function public.save_post_departure_email(boolean, text, text) to authenticated;
grant execute on function public.save_payment_request_email(text, text) to authenticated;
grant execute on function public.save_email_template(uuid, text, text, text) to authenticated;
grant execute on function public.delete_email_template(uuid) to authenticated;
