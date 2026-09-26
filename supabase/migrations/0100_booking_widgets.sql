-- Settings -> Connectivity Settings -> Booking Widget, cloned from the
-- client's reference: Saved Widgets (Hash code, edit, delete, "Create new
-- widget") and the New Booking Widget form -- Title, Button, Check-In,
-- Check-Out and Nights texts, "Show occupancy options", "Use Checkout Date
-- Instead Nights Count", month and weekday names, five colours and a
-- language -- then "Save widget to get embed code".
--
-- LIVE. The embed code is an <iframe> of `/book/widget/<hash>`, a page of
-- this application that draws the widget from the saved row and sends the
-- guest to the hotel's booking page (`/book/<property>?from=&to=`, with the
-- party and language) in the top window. An iframe rather than a script tag:
-- nothing of ours runs inside the hotel's own page, and the hotel's page
-- cannot reach into ours.
--
-- THE HASH IS PUBLIC -- it is in the embed code on the hotel's website -- so
-- `public_booking_widget()` answers it with the widget's look and the
-- property id, and nothing else. It is the tenth function on the public
-- surface, read-only like the others.
--
-- "Currency (optional)" is NOT copied: a property sells in one currency and
-- nothing converts (see Currencies), so it would be a choice that does
-- nothing. Language is copied, and chooses the booking page's language.

create table public.booking_widgets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  hash text not null unique check (hash ~ '^[0-9a-f]{8}$'),
  -- Null falls back to the widget's own default wording.
  title_text text check (char_length(title_text) <= 255),
  button_text text check (char_length(button_text) <= 255),
  check_in_text text check (char_length(check_in_text) <= 255),
  check_out_text text check (char_length(check_out_text) <= 255),
  nights_text text check (char_length(nights_text) <= 255),
  show_occupancy boolean not null default false,
  use_checkout_date boolean not null default false,
  -- Comma separated: twelve months, seven weekdays from Sunday. Null uses
  -- the language's own names.
  month_names text check (char_length(month_names) <= 255),
  weekday_names text check (char_length(weekday_names) <= 255),
  primary_color text not null default '#0098d1' check (primary_color ~ '^#[0-9a-f]{6}$'),
  text_color text not null default '#363b3d' check (text_color ~ '^#[0-9a-f]{6}$'),
  background_color text not null default '#ffffff' check (background_color ~ '^#[0-9a-f]{6}$'),
  label_color text not null default '#a0acb2' check (label_color ~ '^#[0-9a-f]{6}$'),
  border_color text not null default '#e2e2e2' check (border_color ~ '^#[0-9a-f]{6}$'),
  -- Null is the hotel's default language (Language Settings).
  language text check (language = any (public.known_locales())),
  created_at timestamptz not null default now()
);

alter table public.booking_widgets enable row level security;

create policy booking_widgets_select_current_property on public.booking_widgets
  for select using (property_id = public.current_property_id());
create policy booking_widgets_write_revenue_staff on public.booking_widgets
  for all using (property_id = public.current_property_id() and public.is_revenue_staff())
  with check (property_id = public.current_property_id() and public.is_revenue_staff());

grant select, insert, update, delete on public.booking_widgets to authenticated;
revoke all on public.booking_widgets from anon;

create or replace function public.save_booking_widget(
  p_id uuid,
  p_title_text text,
  p_button_text text,
  p_check_in_text text,
  p_check_out_text text,
  p_nights_text text,
  p_show_occupancy boolean,
  p_use_checkout_date boolean,
  p_month_names text,
  p_weekday_names text,
  p_primary_color text,
  p_text_color text,
  p_background_color text,
  p_label_color text,
  p_border_color text,
  p_language text
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_months text := nullif(btrim(coalesce(p_month_names, '')), '');
  v_days text := nullif(btrim(coalesce(p_weekday_names, '')), '');
  v_hash text;
  v_colors text[] := array[
    lower(btrim(coalesce(p_primary_color, ''))), lower(btrim(coalesce(p_text_color, ''))),
    lower(btrim(coalesce(p_background_color, ''))), lower(btrim(coalesce(p_label_color, ''))),
    lower(btrim(coalesce(p_border_color, '')))
  ];
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can change booking widgets';
  end if;
  if exists (select 1 from unnest(v_colors) c where c !~ '^#[0-9a-f]{6}$') then
    raise exception 'Write each colour as # and six hex digits, like #0098d1';
  end if;
  if v_months is not null and array_length(string_to_array(v_months, ','), 1) <> 12 then
    raise exception 'Month names are twelve names separated by commas';
  end if;
  if v_days is not null and array_length(string_to_array(v_days, ','), 1) <> 7 then
    raise exception 'Week day names are seven names separated by commas, starting on Sunday';
  end if;
  if p_language is not null and not (p_language = any (public.known_locales())) then
    raise exception 'Choose a language from the list';
  end if;

  if p_id is null then
    loop
      v_hash := substr(md5(gen_random_uuid()::text), 1, 8);
      exit when not exists (select 1 from public.booking_widgets w where w.hash = v_hash);
    end loop;
    insert into public.booking_widgets (property_id, hash)
    values (v_property, v_hash)
    returning id into p_id;
  else
    select w.hash into v_hash from public.booking_widgets w
    where w.id = p_id and w.property_id = v_property;
    if v_hash is null then
      raise exception 'That widget is not on this property';
    end if;
  end if;

  update public.booking_widgets set
    title_text = nullif(btrim(coalesce(p_title_text, '')), ''),
    button_text = nullif(btrim(coalesce(p_button_text, '')), ''),
    check_in_text = nullif(btrim(coalesce(p_check_in_text, '')), ''),
    check_out_text = nullif(btrim(coalesce(p_check_out_text, '')), ''),
    nights_text = nullif(btrim(coalesce(p_nights_text, '')), ''),
    show_occupancy = coalesce(p_show_occupancy, false),
    use_checkout_date = coalesce(p_use_checkout_date, false),
    month_names = v_months,
    weekday_names = v_days,
    primary_color = v_colors[1],
    text_color = v_colors[2],
    background_color = v_colors[3],
    label_color = v_colors[4],
    border_color = v_colors[5],
    language = p_language
  where id = p_id;

  return v_hash;
end;
$$;

revoke execute on function public.save_booking_widget(
  uuid, text, text, text, text, text, boolean, boolean, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.save_booking_widget(
  uuid, text, text, text, text, text, boolean, boolean, text, text, text, text, text, text, text, text
) to authenticated;

-- Genuinely deleted: the embed code stops showing a widget, and nothing
-- else points at one.
create or replace function public.delete_booking_widget(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not coalesce(public.is_revenue_staff(), false) then
    raise exception 'Only managers and administrators can change booking widgets';
  end if;
  delete from public.booking_widgets
  where id = p_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That widget is not on this property';
  end if;
end;
$$;

revoke execute on function public.delete_booking_widget(uuid) from public, anon;
grant execute on function public.delete_booking_widget(uuid) to authenticated;

-- The widget as the embed draws it, for an active property. Nothing but the
-- look, the property id and the default language.
create or replace function public.public_booking_widget(p_hash text)
returns table (
  property_id uuid,
  title_text text,
  button_text text,
  check_in_text text,
  check_out_text text,
  nights_text text,
  show_occupancy boolean,
  use_checkout_date boolean,
  month_names text,
  weekday_names text,
  primary_color text,
  text_color text,
  background_color text,
  label_color text,
  border_color text,
  language text
)
language sql
stable
security definer
set search_path = public
as $$
  select w.property_id, w.title_text, w.button_text, w.check_in_text, w.check_out_text,
    w.nights_text, w.show_occupancy, w.use_checkout_date, w.month_names, w.weekday_names,
    w.primary_color, w.text_color, w.background_color, w.label_color, w.border_color,
    w.language
  from public.booking_widgets w
  join public.properties p on p.id = w.property_id and p.is_active
  where w.hash = lower(btrim(coalesce(p_hash, '')));
$$;

revoke execute on function public.public_booking_widget(text) from public;
grant execute on function public.public_booking_widget(text) to anon, authenticated;
