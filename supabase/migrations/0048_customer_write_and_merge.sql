-- 0048: creating, correcting and merging a customer.
--
-- The Customers screen has carried three buttons since the first build —
-- Create Customer, Merge Selected, Export to Excel — and all three were
-- `disabled` with `title="Available in Phase 2"`. The row checkboxes were
-- disabled too, which is why Merge could never have worked: nothing could be
-- selected. The client reported them as not working, which is exactly right.
--
-- Export needs no database work; it reads what the screen already has. The
-- other two need functions, because until now a customer could only be created
-- as a side effect of `create_booking()` and could not be edited at all.
--
-- MERGE WAS DESIGNED FOR IN 0001 AND NEVER BUILT. `customers.merged_into_id`
-- has been there from the start, with a self-referencing foreign key and a
-- check that a row cannot be merged into itself, and `customer_stats` has
-- always filtered `where merged_into_id is null`. So the read side already
-- hides a merged-away customer; all that was missing was the write.
--
-- Nothing is deleted. The merged row stays, pointing at its keeper, so the
-- history is still there to read and the `on delete restrict` on that foreign
-- key keeps it that way.

/* -------------------------------------------------------------------------- */
/* Create and correct                                                         */
/* -------------------------------------------------------------------------- */

create or replace function public.save_customer(
  p_kind public.customer_kind,
  p_first_name text default null,
  p_last_name text default null,
  p_company_name text default null,
  p_national_id_number text default null,
  p_email text default null,
  p_phone text default null,
  p_exclude_from_email boolean default false,
  p_id uuid default null
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

  if p_id is null then
    insert into public.customers (
      property_id, kind, first_name, last_name, company_name,
      national_id_number, email, phone, exclude_from_email
    ) values (
      v_property, p_kind, v_first, v_last, v_company,
      nullif(btrim(coalesce(p_national_id_number, '')), ''),
      nullif(btrim(coalesce(p_email, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      coalesce(p_exclude_from_email, false)
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
        exclude_from_email = coalesce(p_exclude_from_email, false)
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

/**
 * The one field the list edits in place.
 *
 * Its own function rather than a `save_customer()` call, because the checkbox
 * in the table has only the id and the new value — routing it through the full
 * save would mean the row sending back every other field it happens to be
 * displaying, and any field it does not display would be wiped.
 */
create or replace function public.set_customer_exclude_from_email(
  p_id uuid,
  p_value boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_found uuid;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, manager and admin staff can change a customer';
  end if;

  update public.customers
  set exclude_from_email = coalesce(p_value, false)
  where id = p_id
    and property_id = public.current_property_id()
    and merged_into_id is null
  returning id into v_found;

  if v_found is null then
    raise exception 'That customer is not on this property, or has been merged away';
  end if;
end;
$function$;

/**
 * The editable fields of one customer.
 *
 * `customers_page()` composes a display name, which is right for a list and
 * useless for a form: "Okonkwo, Ada" cannot be split back into the two columns
 * the table stores without guessing where a double-barrelled surname ends. So
 * the edit dialog reads the parts.
 */
create or replace function public.customer_for_edit(p_id uuid)
returns table (
  id uuid,
  kind public.customer_kind,
  first_name text,
  last_name text,
  company_name text,
  national_id_number text,
  email text,
  phone text,
  exclude_from_email boolean
)
language sql
stable
security invoker
set search_path = public
as $function$
  select c.id, c.kind, c.first_name, c.last_name, c.company_name,
         c.national_id_number, c.email, c.phone, c.exclude_from_email
  from public.customers c
  where c.id = p_id
    and c.property_id = public.current_property_id()
    and c.merged_into_id is null;
$function$;

/* -------------------------------------------------------------------------- */
/* Merge                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fold one or more duplicate customers into a keeper.
 *
 * Everything that points at a customer is repointed — `bookings`, `folios` and
 * `meeting_room_bookings` are the three tables that carry `customer_id` — and
 * the duplicates are marked `merged_into_id`, which takes them off every screen
 * because `customer_stats` filters on it.
 *
 * One transaction. A merge that repointed the bookings and then failed before
 * marking the duplicate would leave two customers both looking live, one of
 * them holding somebody else's history.
 *
 * Admin and manager only. This rewrites who a booking belonged to, which is
 * more than a correction, and it cannot be undone from the application.
 */
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
      last_name = case when k.kind = 'personal' then coalesce(k.last_name, d.last_name) else k.last_name end
  from (
    select
      (array_agg(c.national_id_number order by c.customer_number)
        filter (where c.national_id_number is not null))[1] as national_id_number,
      (array_agg(c.email order by c.customer_number)
        filter (where c.email is not null))[1] as email,
      (array_agg(c.phone order by c.customer_number)
        filter (where c.phone is not null))[1] as phone,
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

/* -------------------------------------------------------------------------- */
/* Grants                                                                     */
/* -------------------------------------------------------------------------- */

-- `revoke ... from public` does not take the grant off `anon`; the hosted
-- project's default privileges hand it out on every new function. Both revokes,
-- every time — see the note in CLAUDE.md.
revoke all on function public.save_customer(
  public.customer_kind, text, text, text, text, text, text, boolean, uuid
) from public;
revoke execute on function public.save_customer(
  public.customer_kind, text, text, text, text, text, text, boolean, uuid
) from anon;
grant execute on function public.save_customer(
  public.customer_kind, text, text, text, text, text, text, boolean, uuid
) to authenticated;

revoke all on function public.set_customer_exclude_from_email(uuid, boolean) from public;
revoke execute on function public.set_customer_exclude_from_email(uuid, boolean) from anon;
grant execute on function public.set_customer_exclude_from_email(uuid, boolean) to authenticated;

revoke all on function public.customer_for_edit(uuid) from public;
revoke execute on function public.customer_for_edit(uuid) from anon;
grant execute on function public.customer_for_edit(uuid) to authenticated;

revoke all on function public.merge_customers(uuid, uuid[]) from public;
revoke execute on function public.merge_customers(uuid, uuid[]) from anon;
grant execute on function public.merge_customers(uuid, uuid[]) to authenticated;

comment on function public.save_customer(
  public.customer_kind, text, text, text, text, text, text, boolean, uuid
) is 'Create a customer, or correct one. Front desk and above.';
comment on function public.merge_customers(uuid, uuid[]) is
  'Fold duplicates into a keeper: repoints bookings, folios and meeting room bookings, then marks the duplicates merged. Manager and above.';
