-- 0050: who a guest is, for the Immigration and Country reports.
--
-- `customers` has carried `national_id_number` since 0001 and nothing else
-- that identifies a person. Two of the reports the client asked for cannot be
-- written over that:
--
--   * Immigration — the list a hotel hands to the police or the border force
--     in the many countries that require one. It wants a document number, a
--     nationality and a date of birth, not a name and an email.
--   * Country — where this hotel's guests come from, which is a marketing
--     question and a different column from nationality: a German passport
--     holder living in Paris is a French booking and a German national.
--
-- So both are stored. They are separate fields because they answer separate
-- questions and collapsing them would quietly make one of the two reports
-- wrong.
--
-- EVERY FIELD IS NULLABLE, and stays null on every row that already exists.
-- These are asked for at check-in, not at booking: a hotel takes a reservation
-- over the phone with a name and a card, and sees a passport when the guest
-- walks in. Making any of this `not null` would refuse every booking the guest
-- booking page takes.

alter table public.customers
  add column nationality text,
  add column country text,
  add column passport_number text,
  add column passport_expiry date,
  add column date_of_birth date;

comment on column public.customers.nationality is
  'ISO 3166-1 alpha-2 country of citizenship. What an immigration return asks for.';
comment on column public.customers.country is
  'ISO 3166-1 alpha-2 country of residence. What the Country report counts. Not the same as nationality.';
comment on column public.customers.passport_number is
  'Passport or travel document number, taken at check-in. `national_id_number` stays what it was: a domestic identifier.';
comment on column public.customers.date_of_birth is
  'Date of birth. Immigration returns ask for it; nothing else reads it.';

-- Two letters, upper case, or nothing at all. A free-text country column
-- becomes "UK", "U.K.", "United Kingdom" and "England" within a fortnight and
-- the Country report then counts four countries that are one. The check is
-- deliberately not a foreign key to a countries table: the list lives in
-- `src/lib/countries.ts` where the form can render it, and a table of static
-- reference data is a migration every time the world changes.
alter table public.customers
  add constraint customers_nationality_is_iso_code
    check (nationality is null or nationality ~ '^[A-Z]{2}$'),
  add constraint customers_country_is_iso_code
    check (country is null or country ~ '^[A-Z]{2}$');

-- A passport that expired before the guest arrived is a real thing a front desk
-- needs to notice, so the date is not constrained to the future. It is recorded
-- as found.

/* -------------------------------------------------------------------------- */
/* save_customer                                                              */
/* -------------------------------------------------------------------------- */

-- DROPPED AND RECREATED rather than `create or replace` with extra arguments.
-- Adding defaulted parameters to a function makes a second overload rather
-- than replacing the first, and PostgREST then has two candidates for a call
-- that names only the original arguments — which is an ambiguity error at the
-- front desk rather than at deploy time.
drop function if exists public.save_customer(
  public.customer_kind, text, text, text, text, text, text, boolean, uuid
);

create function public.save_customer(
  p_kind public.customer_kind,
  p_first_name text default null,
  p_last_name text default null,
  p_company_name text default null,
  p_national_id_number text default null,
  p_email text default null,
  p_phone text default null,
  p_exclude_from_email boolean default false,
  p_id uuid default null,
  p_nationality text default null,
  p_country text default null,
  p_passport_number text default null,
  p_passport_expiry date default null,
  p_date_of_birth date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_property uuid;
  v_id uuid;
  v_first text;
  v_last text;
  v_company text;
  v_nationality text;
  v_country text;
begin
  -- Front desk creates customers already, every time they take a booking; this
  -- only gives them a way to do it without one, and to fix a typo afterwards.
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can change a customer';
  end if;

  v_property := public.current_property_id();

  v_first := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last := nullif(btrim(coalesce(p_last_name, '')), '');
  v_company := nullif(btrim(coalesce(p_company_name, '')), '');

  -- Upper-cased here rather than refused, because a receptionist typing "gb"
  -- has not made a mistake worth stopping them over. An unknown code still
  -- fails the check constraint below.
  v_nationality := nullif(btrim(upper(coalesce(p_nationality, ''))), '');
  v_country := nullif(btrim(upper(coalesce(p_country, ''))), '');

  -- `customers_name_for_kind` enforces this in the table, but a raw check
  -- constraint violation tells a receptionist nothing. Say which field is
  -- missing, in their words.
  if p_kind = 'personal' then
    if v_first is null then
      raise exception 'A person needs a first name';
    end if;
    -- A company name on a person is not an error worth refusing over; it is a
    -- field they left behind when switching the kind. Drop it.
    v_company := null;
  else
    if v_company is null then
      raise exception 'A company needs a company name';
    end if;
    v_first := null;
    v_last := null;
  end if;

  -- Say which field is wrong. The check constraint's own message names a
  -- constraint, which means nothing to the person who typed it.
  if v_nationality is not null and v_nationality !~ '^[A-Z]{2}$' then
    raise exception 'Nationality must be a two-letter country code';
  end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'Country must be a two-letter country code';
  end if;

  if p_id is null then
    insert into public.customers (
      property_id, kind, first_name, last_name, company_name,
      national_id_number, email, phone, exclude_from_email,
      nationality, country, passport_number, passport_expiry, date_of_birth
    ) values (
      v_property, p_kind, v_first, v_last, v_company,
      nullif(btrim(coalesce(p_national_id_number, '')), ''),
      nullif(btrim(coalesce(p_email, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      coalesce(p_exclude_from_email, false),
      v_nationality, v_country,
      nullif(btrim(coalesce(p_passport_number, '')), ''),
      p_passport_expiry, p_date_of_birth
    )
    returning id into v_id;
  else
    update public.customers
    set kind = p_kind,
        first_name = v_first,
        last_name = v_last,
        company_name = v_company,
        national_id_number = nullif(btrim(coalesce(p_national_id_number, '')), ''),
        email = nullif(btrim(coalesce(p_email, '')), ''),
        phone = nullif(btrim(coalesce(p_phone, '')), ''),
        exclude_from_email = coalesce(p_exclude_from_email, false),
        nationality = v_nationality,
        country = v_country,
        passport_number = nullif(btrim(coalesce(p_passport_number, '')), ''),
        passport_expiry = p_passport_expiry,
        date_of_birth = p_date_of_birth
    where id = p_id
      and property_id = v_property
      -- A merged-away row is history. Editing it would change what the merge
      -- recorded, and it is not on any screen to be edited from anyway.
      and merged_into_id is null
    returning id into v_id;

    if v_id is null then
      raise exception 'That customer is not on this property, or has been merged away';
    end if;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.save_customer(
  public.customer_kind, text, text, text, text, text, text, boolean, uuid,
  text, text, text, date, date
) from public, anon;
grant execute on function public.save_customer(
  public.customer_kind, text, text, text, text, text, text, boolean, uuid,
  text, text, text, date, date
) to authenticated;

comment on function public.save_customer(
  public.customer_kind, text, text, text, text, text, text, boolean, uuid,
  text, text, text, date, date
) is
  'Create or correct a customer. Front office staff only. The identity fields are optional and are taken at check-in, not at booking.';

/* -------------------------------------------------------------------------- */
/* customer_for_edit                                                          */
/* -------------------------------------------------------------------------- */

-- Returns a new column set, so the same drop-first rule applies: the return
-- type of an existing function cannot be changed by `create or replace`.
drop function if exists public.customer_for_edit(uuid);

create function public.customer_for_edit(p_id uuid)
returns table (
  id uuid,
  kind public.customer_kind,
  first_name text,
  last_name text,
  company_name text,
  national_id_number text,
  email text,
  phone text,
  exclude_from_email boolean,
  nationality text,
  country text,
  passport_number text,
  passport_expiry date,
  date_of_birth date
)
language sql
stable
security invoker
set search_path = public
as $function$
  select c.id, c.kind, c.first_name, c.last_name, c.company_name,
         c.national_id_number, c.email, c.phone, c.exclude_from_email,
         c.nationality, c.country, c.passport_number, c.passport_expiry,
         c.date_of_birth
  from public.customers c
  where c.id = p_id
    and c.property_id = public.current_property_id()
    and c.merged_into_id is null;
$function$;

revoke all on function public.customer_for_edit(uuid) from public, anon;
grant execute on function public.customer_for_edit(uuid) to authenticated;

/* -------------------------------------------------------------------------- */
/* merge_customers — carry the new fields too                                 */
/* -------------------------------------------------------------------------- */

-- The keeper's null-fill names its columns one by one, so five new nullable
-- columns are five fields a merge would silently drop. A passport number held
-- only on the duplicate would vanish the moment somebody tidied up two records
-- of the same guest -- precisely the loss that block exists to prevent.
--
-- THIS BODY IS 0048'S, TAKEN VERBATIM AND EDITED IN TWO PLACES: the five
-- coalesce lines in the keeper's SET, and the five array_agg lines that pick a
-- value from the duplicates. Everything else -- the guards, the repointing, the
-- activity_log entry -- is character-for-character what 0048 shipped. It was
-- assembled by script rather than retyped, because the last function rewritten
-- from memory here (close_business_date in 0047) came out wrong in four
-- separate ways and only a diff against the original caught it.

create or replace function public.merge_customers(
  p_keep_id uuid,
  p_merge_ids uuid[]
)
returns table (
  bookings_moved integer,
  folios_moved integer,
  meeting_rooms_moved integer,
  customers_merged integer
)
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_property uuid;
  v_ids uuid[];
  v_bookings integer := 0;
  v_folios integer := 0;
  v_meetings integer := 0;
  v_merged integer := 0;
  v_keep public.customers;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only a manager or administrator can merge customers';
  end if;

  v_property := public.current_property_id();

  if p_keep_id is null then
    raise exception 'Choose which customer to keep';
  end if;

  -- Distinct, non-null, and never the keeper itself. Selecting the keeper
  -- among the duplicates is an easy slip on a table of tickboxes, and the
  -- check constraint would otherwise refuse it with a constraint name.
  select array_agg(distinct x)
  into v_ids
  from unnest(coalesce(p_merge_ids, '{}'::uuid[])) as x
  where x is not null and x <> p_keep_id;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'Choose at least one other customer to merge in';
  end if;

  select * into v_keep
  from public.customers
  where id = p_keep_id and property_id = v_property and merged_into_id is null
  for update;

  if not found then
    raise exception 'The customer to keep is not on this property, or has already been merged away';
  end if;

  -- Every duplicate has to be live and on this property before anything moves.
  -- Checking them one at a time as we go would leave a half-done merge behind
  -- on the first bad id.
  if exists (
    select 1
    from unnest(v_ids) as x
    where not exists (
      select 1 from public.customers c
      where c.id = x and c.property_id = v_property and c.merged_into_id is null
    )
  ) then
    raise exception 'One of the customers to merge is not on this property, or has already been merged away';
  end if;

  perform 1 from public.customers
  where id = any(v_ids) and property_id = v_property
  for update;

  update public.bookings
  set customer_id = p_keep_id
  where customer_id = any(v_ids) and property_id = v_property;
  get diagnostics v_bookings = row_count;

  update public.folios
  set customer_id = p_keep_id
  where customer_id = any(v_ids) and property_id = v_property;
  get diagnostics v_folios = row_count;

  update public.meeting_room_bookings
  set customer_id = p_keep_id
  where customer_id = any(v_ids) and property_id = v_property;
  get diagnostics v_meetings = row_count;

  /*
   * Fill only what the keeper is missing.
   *
   * Never overwrite: somebody picked this row to keep, so its own details are
   * the ones they meant. But a phone number that existed only on the duplicate
   * would otherwise vanish from every screen, since the duplicate drops off
   * the list. Filling nulls is additive and cannot lose a chosen value.
   */
  update public.customers k
  set national_id_number = coalesce(k.national_id_number, d.national_id_number),
      email = coalesce(k.email, d.email),
      phone = coalesce(k.phone, d.phone),
      nationality = coalesce(k.nationality, d.nationality),
      country = coalesce(k.country, d.country),
      passport_number = coalesce(k.passport_number, d.passport_number),
      passport_expiry = coalesce(k.passport_expiry, d.passport_expiry),
      date_of_birth = coalesce(k.date_of_birth, d.date_of_birth),
      last_name = case when k.kind = 'personal' then coalesce(k.last_name, d.last_name) else k.last_name end
  from (
    select
      (array_agg(c.national_id_number order by c.customer_number)
        filter (where c.national_id_number is not null))[1] as national_id_number,
      (array_agg(c.email order by c.customer_number)
        filter (where c.email is not null))[1] as email,
      (array_agg(c.phone order by c.customer_number)
        filter (where c.phone is not null))[1] as phone,
      (array_agg(c.nationality order by c.customer_number)
        filter (where c.nationality is not null))[1] as nationality,
      (array_agg(c.country order by c.customer_number)
        filter (where c.country is not null))[1] as country,
      (array_agg(c.passport_number order by c.customer_number)
        filter (where c.passport_number is not null))[1] as passport_number,
      (array_agg(c.passport_expiry order by c.customer_number)
        filter (where c.passport_expiry is not null))[1] as passport_expiry,
      (array_agg(c.date_of_birth order by c.customer_number)
        filter (where c.date_of_birth is not null))[1] as date_of_birth,
      (array_agg(c.last_name order by c.customer_number)
        filter (where c.last_name is not null))[1] as last_name
    from public.customers c
    where c.id = any(v_ids) and c.property_id = v_property
  ) d
  where k.id = p_keep_id and k.property_id = v_property;

  update public.customers
  set merged_into_id = p_keep_id
  where id = any(v_ids) and property_id = v_property;
  get diagnostics v_merged = row_count;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'customer', p_keep_id, 'customers_merged',
    format('%s customer record(s) merged into %s',
           v_merged, public.customer_display_name(v_keep)),
    jsonb_build_object(
      'kept_id', p_keep_id,
      'merged_ids', to_jsonb(v_ids),
      'bookings_moved', v_bookings,
      'folios_moved', v_folios,
      'meeting_rooms_moved', v_meetings
    )
  );

  return query select v_bookings, v_folios, v_meetings, v_merged;
end;
$function$;
