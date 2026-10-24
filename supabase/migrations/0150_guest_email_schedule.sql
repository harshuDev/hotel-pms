-- 0150: Email Setup's pre-arrival and post-departure emails get a schedule.
--
-- The client, in a Loom of Email Setup: "you have to open like a small window
-- when they can choose the date ... one day before, two days before, three
-- days before ... we can put a time. And also here [post departure] the same."
--
-- * Pre arrival: how many days before arrival, at what time on the hotel's
--   clock, and -- which it never had -- its own subject and body.
-- * Post departure: how many days after departure, at what time.
--
-- STORED, NOT YET SENT, as 0075's switches: nothing sends a scheduled email
-- yet. The days and time are what a sender will read; the hotel's clock is
-- properties.timezone, never the server's.
--
-- New functions rather than new parameters on save_pre_arrival_email() and
-- save_post_departure_email(): a changed parameter list is a second function
-- for PostgREST to choose between (the overload trap), and the connector
-- refuses the drop that would avoid it. The old two are called by nothing.

alter table public.hotel_email_settings
  add column if not exists pre_arrival_days integer not null default 1,
  add column if not exists pre_arrival_time time not null default '10:00',
  add column if not exists pre_arrival_subject text,
  add column if not exists pre_arrival_body text,
  add column if not exists post_departure_days integer not null default 1,
  add column if not exists post_departure_time time not null default '10:00';

alter table public.hotel_email_settings
  add constraint hotel_email_settings_pre_days check (pre_arrival_days between 0 and 30),
  add constraint hotel_email_settings_post_days check (post_departure_days between 0 and 30),
  add constraint hotel_email_settings_pre_subject_length check (char_length(pre_arrival_subject) <= 255);

create or replace function public.save_pre_arrival_email_setup(
  p_enabled boolean,
  p_days integer,
  p_time time,
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
  if p_days is null or p_days < 0 or p_days > 30 then
    raise exception 'Choose between 0 and 30 days before arrival';
  end if;
  if p_time is null then
    raise exception 'Choose the time the pre-arrival email goes';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) > 255 then
    raise exception 'The subject can be up to 255 characters';
  end if;
  if coalesce(p_enabled, false) and btrim(coalesce(p_subject, '')) = '' then
    raise exception 'Give the pre-arrival email a subject, or turn it off';
  end if;
  update public.hotel_email_settings set
    pre_arrival_enabled = coalesce(p_enabled, false),
    pre_arrival_days = p_days,
    pre_arrival_time = p_time,
    pre_arrival_subject = nullif(btrim(coalesce(p_subject, '')), ''),
    pre_arrival_body = nullif(btrim(coalesce(p_body, '')), ''),
    updated_at = now(), updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

create or replace function public.save_post_departure_email_setup(
  p_enabled boolean,
  p_days integer,
  p_time time,
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
  if p_days is null or p_days < 0 or p_days > 30 then
    raise exception 'Choose between 0 and 30 days after departure';
  end if;
  if p_time is null then
    raise exception 'Choose the time the post-departure email goes';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) > 255 then
    raise exception 'The subject can be up to 255 characters';
  end if;
  if coalesce(p_enabled, false) and btrim(coalesce(p_subject, '')) = '' then
    raise exception 'Give the post-departure email a subject, or turn it off';
  end if;
  update public.hotel_email_settings set
    post_departure_enabled = coalesce(p_enabled, false),
    post_departure_days = p_days,
    post_departure_time = p_time,
    post_departure_subject = nullif(btrim(coalesce(p_subject, '')), ''),
    post_departure_body = nullif(btrim(coalesce(p_body, '')), ''),
    updated_at = now(), updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

revoke all on function public.save_pre_arrival_email_setup(boolean, integer, time, text, text) from public;
revoke execute on function public.save_pre_arrival_email_setup(boolean, integer, time, text, text) from anon;
grant execute on function public.save_pre_arrival_email_setup(boolean, integer, time, text, text) to authenticated;
revoke all on function public.save_post_departure_email_setup(boolean, integer, time, text, text) from public;
revoke execute on function public.save_post_departure_email_setup(boolean, integer, time, text, text) from anon;
grant execute on function public.save_post_departure_email_setup(boolean, integer, time, text, text) to authenticated;

notify pgrst, 'reload schema';
