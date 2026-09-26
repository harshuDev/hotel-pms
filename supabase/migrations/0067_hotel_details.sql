-- 0067  Hotel Details: everything the client's reference keeps about a hotel.
--
-- The client sent their old system's Settings > Hotel Profile > Hotel Details
-- screen and asked for ours to match it exactly. `properties` held a name, a
-- timezone, a currency and three times; theirs holds the company behind the
-- hotel, its address, a pinned location on a map and its contact details.
-- Every one of those is a column here now.
--
-- NOTHING READS THESE YET BEYOND THE SETTINGS SCREEN. They are the hotel's
-- record of itself — what a registration card, an invoice header or the guest
-- booking page will print later — and they are nullable because a property set
-- up before today has none of them and must not stop saving the fields it does
-- have.

alter table public.properties
  add column if not exists slug text,
  add column if not exists company_name text,
  add column if not exists company_registration_id text,
  add column if not exists property_type text not null default 'Hotel',
  add column if not exists country char(2),
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists postcode text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists phone text,
  add column if not exists fax text,
  add column if not exists email text,
  add column if not exists website text;

-- ISO 3166-1 alpha-2, as `customers.country` has been since 0050 and for the
-- same reason: a free-text country becomes "UK", "U.K." and "England" within a
-- fortnight. `src/lib/countries.ts` is the list the screen offers.
alter table public.properties
  drop constraint if exists properties_country_iso2,
  add constraint properties_country_iso2
    check (country is null or country ~ '^[A-Z]{2}$');

-- A coordinate is a pair or nothing. Half a location puts the pin on the
-- equator or the prime meridian, which reads as a real place and is not.
-- `double precision` is right here: these are not money, and the money rule
-- against floats is about currency.
alter table public.properties
  drop constraint if exists properties_location_pair,
  add constraint properties_location_pair
    check ((latitude is null) = (longitude is null)),
  drop constraint if exists properties_latitude_range,
  add constraint properties_latitude_range
    check (latitude is null or latitude between -90 and 90),
  drop constraint if exists properties_longitude_range,
  add constraint properties_longitude_range
    check (longitude is null or longitude between -180 and 180);

-- The slug is shown read-only, as theirs is. Worked out once from the name and
-- then left alone: a slug that followed every rename would break any link that
-- had been handed out with the old one. Unique because it names a hotel.
update public.properties
set slug = trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
where slug is null;

create unique index if not exists properties_slug_key on public.properties (slug);

/* -------------------------------------------------------------------------- */
/* Hotel Details                                                               */
/* -------------------------------------------------------------------------- */

-- ITS OWN FUNCTION, not more parameters on `save_property()`. That one would
-- have to be dropped and recreated with twenty-odd parameters to avoid the
-- PostgREST overload trap 0064 documents, and the two forms are separate
-- screens with separate Save buttons: saving the address must not also be a
-- statement about check-in time.
create or replace function public.save_property_details(
  p_name text,
  p_timezone text,
  p_currency text,
  p_property_type text default null,
  p_company_name text default null,
  p_company_registration_id text default null,
  p_country text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_region text default null,
  p_postcode text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_phone text default null,
  p_fax text default null,
  p_email text default null,
  p_website text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_property uuid;
  v_country text := upper(nullif(btrim(coalesce(p_country, '')), ''));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the property';
  end if;

  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'The hotel needs a name';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Pick a currency';
  end if;

  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'Pick a country from the list';
  end if;

  -- Said by name before the constraint says it in Postgres's words.
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'A location needs both a latitude and a longitude';
  end if;
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    raise exception 'Latitude runs from -90 to 90';
  end if;
  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'Longitude runs from -180 to 180';
  end if;

  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address does not look right';
  end if;

  -- now() at time zone raises on an unknown zone, which is the cheapest way to
  -- refuse one before it becomes every business date this property computes.
  perform now() at time zone p_timezone;

  update public.properties set
    name = btrim(p_name),
    timezone = p_timezone,
    currency = v_currency,
    property_type = coalesce(nullif(btrim(coalesce(p_property_type, '')), ''), 'Hotel'),
    company_name = nullif(btrim(coalesce(p_company_name, '')), ''),
    company_registration_id = nullif(btrim(coalesce(p_company_registration_id, '')), ''),
    country = v_country,
    address_line1 = nullif(btrim(coalesce(p_address_line1, '')), ''),
    address_line2 = nullif(btrim(coalesce(p_address_line2, '')), ''),
    city = nullif(btrim(coalesce(p_city, '')), ''),
    region = nullif(btrim(coalesce(p_region, '')), ''),
    postcode = nullif(btrim(coalesce(p_postcode, '')), ''),
    latitude = p_latitude,
    longitude = p_longitude,
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    fax = nullif(btrim(coalesce(p_fax, '')), ''),
    email = v_email,
    website = nullif(btrim(coalesce(p_website, '')), '')
  where id = v_property;
end;
$$;

revoke execute on function public.save_property_details(
  text, text, text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text, text, text, text
) from public, anon;
grant execute on function public.save_property_details(
  text, text, text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text, text, text, text
) to authenticated;

/* -------------------------------------------------------------------------- */
/* Hotel Properties: the three times                                           */
/* -------------------------------------------------------------------------- */

-- Check-in, check-out and the night audit hour move to their own panel, next
-- to Hotel Details under Hotel Profile, because the reference's Hotel Details
-- carries none of them. Same refusals `save_property()` has always made.
create or replace function public.save_property_times(
  p_check_in_time time,
  p_check_out_time time,
  p_audit_close_time time
)
returns void
language plpgsql
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

  if p_check_in_time is null then
    raise exception 'The property needs a check-in time, like 15:00';
  end if;
  if p_check_out_time is null then
    raise exception 'The property needs a check-out time, like 11:00';
  end if;
  if p_audit_close_time is null then
    raise exception 'The property needs a night audit time, like 02:00';
  end if;

  update public.properties set
    check_in_time = p_check_in_time,
    check_out_time = p_check_out_time,
    audit_close_time = p_audit_close_time
  where id = v_property;
end;
$$;

revoke execute on function public.save_property_times(time, time, time) from public, anon;
grant execute on function public.save_property_times(time, time, time) to authenticated;
