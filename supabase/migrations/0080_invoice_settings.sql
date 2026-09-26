-- Settings -> Finances -> Invoice Settings, cloned from the client's
-- reference: General Invoice Settings (three switches and the company the
-- invoice is issued by) and Invoice Logo and Notes.
--
-- IT IS READ BY SOMETHING. Nothing in this system printed an invoice until
-- now, so this migration also adds the read the printable invoice needs,
-- `booking_invoice_lines()`, and `/bookings/[id]/invoice` draws it -- the same
-- move the registration form made in 0073, where the settings screen and the
-- card that reads it landed together. Every switch here changes that page:
--
--   show_room_number_for_extras  a Room column on extras, where the booking
--                                has exactly one room (an extra is posted to
--                                the booking, not to a room, so on a group it
--                                has no room to name -- the column stays empty)
--   show_nights_breakdown        one line per night, or one line per room
--   vat_registered               the Net / VAT / Total split, or totals only
--   company_*                    who the invoice is from; blank falls back to
--                                the hotel's own name and address
--   logo / use_text / logo_text  the heading: the image, or the words
--   notes                        printed at the foot
--
-- One row per property, none until first saved.

/* -------------------------------------------------------------------------- */
/* The logo's bucket                                                          */
/* -------------------------------------------------------------------------- */

-- Public, like room-photos: a logo is printed on paper handed to the guest,
-- not a private document. The path is `<property_id>/invoice-logo/<file>`,
-- checked by the policy here and again by `set_invoice_logo()`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hotel-assets',
  'hotel-assets',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "hotel assets are readable" on storage.objects
  for select using (bucket_id = 'hotel-assets');
create policy "hotel assets are written by revenue staff" on storage.objects
  for insert with check (
    bucket_id = 'hotel-assets' and public.is_revenue_staff()
    and (storage.foldername(name))[1] = public.current_property_id()::text
  );
create policy "hotel assets are replaced by revenue staff" on storage.objects
  for update using (
    bucket_id = 'hotel-assets' and public.is_revenue_staff()
    and (storage.foldername(name))[1] = public.current_property_id()::text
  );
create policy "hotel assets are removed by revenue staff" on storage.objects
  for delete using (
    bucket_id = 'hotel-assets' and public.is_revenue_staff()
    and (storage.foldername(name))[1] = public.current_property_id()::text
  );

/* -------------------------------------------------------------------------- */
/* The settings                                                               */
/* -------------------------------------------------------------------------- */

create table public.invoice_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  show_room_number_for_extras boolean not null default false,
  show_nights_breakdown boolean not null default false,
  vat_registered boolean not null default false,
  company_name text,
  -- ISO 3166-1 alpha-2, as properties.country and customers.country.
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  region text,
  city text,
  address text,
  postcode text,
  logo_path text,
  use_text_instead_of_logo boolean not null default false,
  logo_text text check (logo_text is null or char_length(logo_text) <= 255),
  notes text check (notes is null or char_length(notes) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id) on delete set null
);

alter table public.invoice_settings enable row level security;

-- Anyone on the property reads it: the front desk prints invoices. Changing
-- it is revenue staff, like the rest of Settings.
create policy invoice_settings_select_current_property on public.invoice_settings
  for select using (property_id = public.current_property_id());
create policy invoice_settings_insert_revenue_staff on public.invoice_settings
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy invoice_settings_update_revenue_staff on public.invoice_settings
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update on public.invoice_settings to authenticated;
revoke all on public.invoice_settings from anon;

/* Makes the row if it is not there, so each card saves only its own columns. */
create or replace function public.invoice_settings_row()
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the invoice settings';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  insert into public.invoice_settings (property_id) values (v_property)
  on conflict (property_id) do nothing;
  return v_property;
end;
$$;

revoke execute on function public.invoice_settings_row() from public, anon;
grant execute on function public.invoice_settings_row() to authenticated;

create or replace function public.save_invoice_general(
  p_show_room_number_for_extras boolean,
  p_show_nights_breakdown boolean,
  p_vat_registered boolean,
  p_company_name text,
  p_country text,
  p_region text,
  p_city text,
  p_address text,
  p_postcode text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.invoice_settings_row();
  v_country text := upper(nullif(btrim(coalesce(p_country, '')), ''));
begin
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'Pick a country from the list';
  end if;

  update public.invoice_settings set
    show_room_number_for_extras = coalesce(p_show_room_number_for_extras, false),
    show_nights_breakdown = coalesce(p_show_nights_breakdown, false),
    vat_registered = coalesce(p_vat_registered, false),
    company_name = nullif(btrim(coalesce(p_company_name, '')), ''),
    country = v_country,
    region = nullif(btrim(coalesce(p_region, '')), ''),
    city = nullif(btrim(coalesce(p_city, '')), ''),
    address = nullif(btrim(coalesce(p_address, '')), ''),
    postcode = nullif(btrim(coalesce(p_postcode, '')), ''),
    updated_at = now(),
    updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_invoice_general(
  boolean, boolean, boolean, text, text, text, text, text, text
) from public, anon;
grant execute on function public.save_invoice_general(
  boolean, boolean, boolean, text, text, text, text, text, text
) to authenticated;

create or replace function public.save_invoice_logo_and_notes(
  p_use_text_instead_of_logo boolean,
  p_logo_text text,
  p_notes text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.invoice_settings_row();
  v_text text := nullif(btrim(coalesce(p_logo_text, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if coalesce(p_use_text_instead_of_logo, false) and v_text is null then
    raise exception 'Write the text to print instead of the logo';
  end if;
  if v_text is not null and char_length(v_text) > 255 then
    raise exception 'The logo text can be at most 255 characters';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'The invoice notes can be at most 2000 characters';
  end if;

  update public.invoice_settings set
    use_text_instead_of_logo = coalesce(p_use_text_instead_of_logo, false),
    logo_text = v_text,
    notes = v_notes,
    updated_at = now(),
    updated_by = auth.uid()
  where property_id = v_property;
end;
$$;

revoke execute on function public.save_invoice_logo_and_notes(boolean, text, text) from public, anon;
grant execute on function public.save_invoice_logo_and_notes(boolean, text, text) to authenticated;

/*
 * The logo is its own function, like set_room_photo(): an upload is a
 * separate act from typing the notes, and a parameter on the notes save would
 * be saying "and no logo" every time somebody fixed a typo. It hands back the
 * path it replaced, so the caller removes the old file only once Postgres has
 * recorded the new one.
 */
create or replace function public.set_invoice_logo(p_logo_path text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.invoice_settings_row();
  v_path text := nullif(btrim(coalesce(p_logo_path, '')), '');
  v_prefix text := v_property::text || '/invoice-logo/';
  v_old text;
begin
  if v_path is not null and left(v_path, length(v_prefix)) <> v_prefix then
    raise exception 'That file does not belong to this hotel''s invoice';
  end if;

  select logo_path into v_old from public.invoice_settings where property_id = v_property;
  update public.invoice_settings set
    logo_path = v_path,
    updated_at = now(),
    updated_by = auth.uid()
  where property_id = v_property;
  return v_old;
end;
$$;

revoke execute on function public.set_invoice_logo(text) from public, anon;
grant execute on function public.set_invoice_logo(text) to authenticated;

/* -------------------------------------------------------------------------- */
/* What the invoice prints                                                    */
/* -------------------------------------------------------------------------- */

/*
 * One row per charge on the booking's folios, with the net and tax split and
 * the room a night was charged for. Read over `folio_item_lines`, per the
 * reports rule, so a reversal lands against the type it reverses and carries
 * its sign. A reversal of a room charge names the room of the night it
 * reverses. Payments are not here: `booking_folio_lines()` already returns
 * them and the invoice takes them from there.
 */
create or replace function public.booking_invoice_lines(p_booking_id uuid)
returns table (
  line_id uuid,
  business_date date,
  description text,
  item_type public.folio_item_type,
  is_reversal boolean,
  is_discount boolean,
  net_cents bigint,
  tax_cents bigint,
  gross_cents bigint,
  booking_room_id uuid,
  room_number text,
  stay_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.business_date,
    l.description,
    l.effective_item_type,
    l.is_reversal,
    l.is_discount,
    l.signed_net_amount_cents,
    l.signed_tax_amount_cents,
    l.signed_amount_cents,
    n.booking_room_id,
    r.number,
    n.stay_date
  from public.folio_item_lines l
  join public.folio_items fi on fi.id = l.id and fi.property_id = l.property_id
  left join public.folio_items orig on orig.id = fi.reverses_id and orig.property_id = fi.property_id
  left join public.booking_room_nights n
    on n.id = coalesce(fi.booking_room_night_id, orig.booking_room_night_id)
   and n.property_id = fi.property_id
  left join public.booking_rooms br on br.id = n.booking_room_id and br.property_id = n.property_id
  left join public.rooms r on r.id = br.room_id and r.property_id = br.property_id
  where l.booking_id = p_booking_id
    and l.property_id = public.current_property_id()
  order by l.business_date, n.stay_date nulls last, l.posted_at, l.id;
$$;

revoke execute on function public.booking_invoice_lines(uuid) from public, anon;
grant execute on function public.booking_invoice_lines(uuid) to authenticated;
