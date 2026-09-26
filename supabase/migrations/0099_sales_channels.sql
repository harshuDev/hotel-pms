-- Settings -> Connectivity Settings -> Sales Channels, cloned from the
-- client's reference: Name, Abbreviation, Status (Active / Draft) with an
-- Active | All | Draft filter, a tickbox per row and MERGE, and a Create form
-- with an Associated Customer.
--
-- SALES CHANNELS ARE `channels`, the booking sources every booking already
-- carries -- not a second list. The screen replaces "Booking Sources".
--   * Abbreviation is `code`, which the calendar already shows on a bar
--     ("Show channel abbreviation", 0077) and the channel report groups by.
--   * Status is `is_active`: Draft is a channel not selling, which
--     `create_booking()` has always refused. Nothing else changes meaning.
--   * Kind and commission stay on the form: settlement, the channel report
--     and its commission are worked out from them.
--
-- ASSOCIATED CUSTOMER is new: `channels.customer_id`, a customer record the
-- channel is linked to -- typically the OTA or wholesaler as a company.
-- STORED, NOT YET READ by anything else: nothing bills a channel's bookings
-- to it. `merge_customers()` now follows it, like the bookings and folios.
--
-- MERGE folds channels into one: every booking of the others moves to the
-- one kept, then the others are deleted (nothing else points at a channel).
-- The moved bookings take the keeper's commission in the channel report,
-- which works commission out at read time. Logged, like a customer merge.
--
-- merge_customers() is recreated for the associated customer, and at last
-- carries the 0073 fields: the identification type (paired with the document
-- number it describes) and the additional guest fields.

alter table public.channels
  add column customer_id uuid,
  add constraint channels_customer_fkey foreign key (customer_id, property_id)
    references public.customers (id, property_id) on delete restrict;

drop function public.save_channel(text, text, public.channel_kind, uuid, integer, boolean);

create function public.save_channel(
  p_id uuid,
  p_code text,
  p_name text,
  p_kind public.channel_kind,
  p_commission_bps integer,
  p_is_active boolean,
  p_customer_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid := public.current_property_id();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can set up sales channels';
  end if;
  if v_name = '' then
    raise exception 'Write the name';
  end if;
  if v_code = '' then
    raise exception 'Write the abbreviation';
  end if;
  if char_length(v_code) > 12 then
    raise exception 'Keep the abbreviation to 12 characters';
  end if;
  if p_kind is null then
    raise exception 'Choose the kind';
  end if;
  if coalesce(p_commission_bps, 0) < 0 or coalesce(p_commission_bps, 0) > 10000 then
    raise exception 'Commission must be between 0 and 100 percent';
  end if;
  if exists (
    select 1 from public.channels c
    where c.property_id = v_property and c.code = v_code and (p_id is null or c.id <> p_id)
  ) then
    raise exception 'Another sales channel already uses the abbreviation %', v_code;
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.property_id = v_property and c.merged_into_id is null
  ) then
    raise exception 'That customer is not on this property';
  end if;

  if p_id is null then
    insert into public.channels (property_id, code, name, kind, commission_bps, is_active, customer_id)
    values (v_property, v_code, v_name, p_kind, coalesce(p_commission_bps, 0),
            coalesce(p_is_active, true), p_customer_id)
    returning id into v_id;
  else
    update public.channels set
      code = v_code,
      name = v_name,
      kind = p_kind,
      commission_bps = coalesce(p_commission_bps, 0),
      is_active = coalesce(p_is_active, true),
      customer_id = p_customer_id
    where id = p_id and property_id = v_property
    returning id into v_id;
    if v_id is null then
      raise exception 'That sales channel is not on this property';
    end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_channel(uuid, text, text, public.channel_kind, integer, boolean, uuid) from public, anon;
grant execute on function public.save_channel(uuid, text, text, public.channel_kind, integer, boolean, uuid) to authenticated;

create or replace function public.merge_channels(p_keep_id uuid, p_merge_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid := public.current_property_id();
  v_ids uuid[];
  v_keep public.channels;
  v_moved integer := 0;
  v_names text;
begin
  if not coalesce(public.is_revenue_staff(), false) or v_property is null then
    raise exception 'Only managers and administrators can merge sales channels';
  end if;
  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_merge_ids, '{}'::uuid[])) as x
  where x is not null and x <> p_keep_id;
  if v_ids is null then
    raise exception 'Choose at least one other sales channel to merge in';
  end if;
  select * into v_keep from public.channels
  where id = p_keep_id and property_id = v_property
  for update;
  if not found then
    raise exception 'The sales channel to keep is not on this property';
  end if;
  if (select count(*) from public.channels where id = any(v_ids) and property_id = v_property)
     <> array_length(v_ids, 1) then
    raise exception 'One of the sales channels to merge is not on this property';
  end if;

  select string_agg(name, ', ' order by name) into v_names
  from public.channels where id = any(v_ids) and property_id = v_property;

  update public.bookings set channel_id = p_keep_id
  where channel_id = any(v_ids) and property_id = v_property;
  get diagnostics v_moved = row_count;

  delete from public.channels where id = any(v_ids) and property_id = v_property;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'channel', p_keep_id, 'channels_merged',
    format('Sales channel(s) %s merged into %s', v_names, v_keep.name),
    jsonb_build_object('kept_id', p_keep_id, 'merged_ids', to_jsonb(v_ids), 'bookings_moved', v_moved)
  );
  return v_moved;
end;
$$;

revoke execute on function public.merge_channels(uuid, uuid[]) from public, anon;
grant execute on function public.merge_channels(uuid, uuid[]) to authenticated;

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

  -- A sales channel's associated customer (0099) follows the merge too.
  update public.channels
  set customer_id = p_keep_id
  where customer_id = any(v_ids) and property_id = v_property;

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
      -- The type describes the document number (0073), so the two travel
      -- together: a keeper with no number takes the duplicate's number AND
      -- its type; a keeper with a number keeps its own type, unguessed.
      identification_type_id = case
        when k.passport_number is null and d.passport_number is not null then d.document_type_id
        when k.passport_number is null then coalesce(k.identification_type_id, d.any_type_id)
        else k.identification_type_id
      end,
      -- Additional guest fields (0073): the duplicates' values fill the keys
      -- the keeper has not got; the keeper's own always win.
      custom_fields = coalesce(d.custom_fields, '{}'::jsonb) || k.custom_fields,
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
      (array_agg(c.identification_type_id order by c.customer_number)
        filter (where c.passport_number is not null))[1] as document_type_id,
      (array_agg(c.identification_type_id order by c.customer_number)
        filter (where c.identification_type_id is not null))[1] as any_type_id,
      (
        select jsonb_object_agg(f.key, f.value)
        from (
          select distinct on (e.key) e.key, e.value
          from public.customers c2
          cross join lateral jsonb_each(c2.custom_fields) as e
          where c2.id = any(v_ids) and c2.property_id = v_property
          order by e.key, c2.customer_number
        ) f
      ) as custom_fields,
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

revoke execute on function public.merge_customers(uuid, uuid[]) from public, anon;
grant execute on function public.merge_customers(uuid, uuid[]) to authenticated;
