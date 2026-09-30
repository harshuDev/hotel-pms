-- 0118: an extra sold with a rate is CHARGED, the way each hotel chooses.
--
-- 0115 stored which catalog extras a rate plan is sold with and charged
-- nothing. The client: "Sell with extras depend on client where he wants to
-- charge ... this system is gonna be used by a lot of Hotel clients ... it
-- should be according to them, whatever they choose." So every link carries
-- its own terms, set per extra on the rate plan's form:
--
--   posting    'added'    -- charged on top, a line of its own on the bill
--              'included' -- part of the rate: split out of the night's room
--                            charge (as a priced meal is, 0041), so the guest
--                            pays the same and the revenue lands in the
--                            extra's own report bucket
--   frequency  'per_night' | 'per_stay'
--   per_unit   'room' | 'person' | 'adult' | 'child' -- the room line's own
--              party, so a group's rooms are charged room by room
--   quantity   how many of the extra per unit (1-99)
--   price_cents  null is the catalog price at the moment it posts
--   charge_on  for 'added' only: 'check_in', 'each_night' (the night audit,
--              with the room charge) or 'check_out'. A per-night extra charged
--              at check-in or check-out is charged for every night at once.
--              'each_night' is per night by definition.
--
-- An added extra posts through post_charge(), so its tax (the extra's own,
-- else its category's), business date, append-only rule and reversal are the
-- ones every charge has. booking_extra_postings records each one, so a
-- check-in, a night or a check-out never charges the same extra twice --
-- reversing the charge on the folio is how a hotel takes one back, and it is
-- not re-posted.
--
-- An included extra is inside post_room_charge(): the night's net is split
-- into accommodation, meals (if priced) and each included extra, and every
-- tax on the night is shared across the lines by net, the pennies going to
-- accommodation. The lines always add up to what one room line would have
-- been. A per-stay included extra comes out of the room's first night. What
-- a rate includes may not be worth more than the night: refused by name, as
-- meals were.
--
-- The terms are read when the charge posts, as meal values always have been:
-- changing a plan's extras changes what stays not yet posted are charged.

-- ---------------------------------------------------------------------------
-- The terms on each link
-- ---------------------------------------------------------------------------

alter table public.rate_plan_extras
  add column posting text not null default 'added',
  add column frequency text not null default 'per_night',
  add column per_unit text not null default 'room',
  add column quantity integer not null default 1,
  add column price_cents bigint,
  add column charge_on text default 'each_night',
  add constraint rate_plan_extras_posting_known check (posting in ('added', 'included')),
  add constraint rate_plan_extras_frequency_known check (frequency in ('per_night', 'per_stay')),
  add constraint rate_plan_extras_per_unit_known check (per_unit in ('room', 'person', 'adult', 'child')),
  add constraint rate_plan_extras_quantity_range check (quantity between 1 and 99),
  add constraint rate_plan_extras_price_not_negative check (price_cents is null or price_cents >= 0),
  add constraint rate_plan_extras_charge_on_known check (
    (posting = 'included' and charge_on is null)
    or (posting = 'added' and charge_on in ('check_in', 'each_night', 'check_out'))
  ),
  add constraint rate_plan_extras_each_night_is_per_night check (
    charge_on is distinct from 'each_night' or frequency = 'per_night'
  );

comment on table public.rate_plan_extras is
  'Sell With Extras (0115): catalog extras sold with a rate, and how each is charged (0118).';

-- ---------------------------------------------------------------------------
-- What has been posted, so nothing posts twice
-- ---------------------------------------------------------------------------

create table public.booking_extra_postings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete restrict,
  booking_room_id uuid not null references public.booking_rooms (id) on delete cascade,
  extra_id uuid references public.extras (id) on delete set null,
  event text not null check (event in ('check_in', 'each_night', 'check_out')),
  stay_date date,
  folio_item_id uuid not null references public.folio_items (id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((event = 'each_night') = (stay_date is not null))
);
create unique index booking_extra_postings_once_per_stay
  on public.booking_extra_postings (booking_room_id, extra_id, event)
  where stay_date is null;
create unique index booking_extra_postings_once_per_night
  on public.booking_extra_postings (booking_room_id, extra_id, stay_date)
  where stay_date is not null;
create index booking_extra_postings_property_idx on public.booking_extra_postings (property_id);
alter table public.booking_extra_postings enable row level security;
create policy booking_extra_postings_select_same_property on public.booking_extra_postings
  for select using (property_id = public.current_property_id());

-- ---------------------------------------------------------------------------
-- Setting the extras and their terms
-- ---------------------------------------------------------------------------

drop function public.set_rate_plan_extras(uuid, uuid[]);

-- p_extras: [{extra_id, posting, frequency, per_unit, quantity, price_cents,
-- charge_on}], the whole set, like 0115's.
create function public.set_rate_plan_extras(
  p_rate_plan_id uuid,
  p_extras jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property uuid;
  v_row record;
  v_ids uuid[] := '{}';
begin
  if not coalesce(public.is_revenue_staff(), false) then
    raise exception 'Only managers and administrators can change what a rate includes';
  end if;
  v_property := public.current_property_id();

  if not exists (
    select 1 from public.rate_plans rp
    where rp.id = p_rate_plan_id and rp.property_id = v_property
  ) then
    raise exception 'That rate plan is not on this property';
  end if;

  if p_extras is not null and jsonb_typeof(p_extras) <> 'array' then
    raise exception 'The extras must be a list';
  end if;

  for v_row in
    select
      (x ->> 'extra_id')::uuid as extra_id,
      coalesce(x ->> 'posting', 'added') as posting,
      coalesce(x ->> 'frequency', 'per_night') as frequency,
      coalesce(x ->> 'per_unit', 'room') as per_unit,
      coalesce((x ->> 'quantity')::integer, 1) as quantity,
      (x ->> 'price_cents')::bigint as price_cents,
      x ->> 'charge_on' as charge_on,
      e.title
    from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) as x
    left join public.extras e
      on e.id = (x ->> 'extra_id')::uuid and e.property_id = v_property
  loop
    if v_row.title is null then
      raise exception 'That extra is not on this property';
    end if;
    if v_row.extra_id = any(v_ids) then
      raise exception '% is in the list twice', v_row.title;
    end if;
    v_ids := v_ids || v_row.extra_id;

    if v_row.quantity < 1 or v_row.quantity > 99 then
      raise exception 'The quantity of % must be between 1 and 99', v_row.title;
    end if;
    if v_row.price_cents < 0 then
      raise exception 'The price of % cannot be negative', v_row.title;
    end if;
    if v_row.posting = 'added' and v_row.charge_on = 'each_night' and v_row.frequency <> 'per_night' then
      raise exception '% is charged each night, so it is priced per night', v_row.title;
    end if;

    insert into public.rate_plan_extras (
      property_id, rate_plan_id, extra_id, posting, frequency, per_unit,
      quantity, price_cents, charge_on
    ) values (
      v_property, p_rate_plan_id, v_row.extra_id, v_row.posting, v_row.frequency,
      v_row.per_unit, v_row.quantity, v_row.price_cents,
      case when v_row.posting = 'added' then coalesce(v_row.charge_on, 'each_night') end
    )
    on conflict (rate_plan_id, extra_id) do update set
      posting = excluded.posting,
      frequency = excluded.frequency,
      per_unit = excluded.per_unit,
      quantity = excluded.quantity,
      price_cents = excluded.price_cents,
      charge_on = excluded.charge_on;
  end loop;

  delete from public.rate_plan_extras
  where rate_plan_id = p_rate_plan_id
    and not (extra_id = any (v_ids));
end;
$$;
revoke all on function public.set_rate_plan_extras(uuid, jsonb) from public, anon;
grant execute on function public.set_rate_plan_extras(uuid, jsonb) to authenticated;

-- merge_extra(): the merged-away extra's plans move to the one kept, with
-- their terms. Otherwise as 0115.
create or replace function public.merge_extra(p_source_id uuid, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_source public.extras;
  v_target public.extras;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the extras';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  if p_source_id is null or p_target_id is null then
    raise exception 'Choose the extra to merge into';
  end if;
  if p_source_id = p_target_id then
    raise exception 'An extra cannot be merged into itself';
  end if;

  select * into v_source from public.extras
  where id = p_source_id and property_id = v_property
  for update;
  if not found then
    raise exception 'That extra no longer exists';
  end if;

  select * into v_target from public.extras
  where id = p_target_id and property_id = v_property;
  if not found then
    raise exception 'The extra to merge into no longer exists';
  end if;

  insert into public.rate_plan_extras (
    property_id, rate_plan_id, extra_id, posting, frequency, per_unit,
    quantity, price_cents, charge_on
  )
  select rpe.property_id, rpe.rate_plan_id, v_target.id, rpe.posting, rpe.frequency,
         rpe.per_unit, rpe.quantity, rpe.price_cents, rpe.charge_on
  from public.rate_plan_extras rpe
  where rpe.extra_id = v_source.id
  on conflict do nothing;

  delete from public.extras where id = v_source.id;

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'extra', v_target.id, 'extras_merged',
    format('Extra %s merged into %s', v_source.title, v_target.title),
    jsonb_build_object(
      'kept_id', v_target.id,
      'kept_title', v_target.title,
      'merged_id', v_source.id,
      'merged_title', v_source.title,
      'merged_price_cents', v_source.price_cents,
      'merged_item_type', v_source.item_type
    )
  );
end;
$$;
revoke execute on function public.merge_extra(uuid, uuid) from public, anon;
grant execute on function public.merge_extra(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- How many of an extra a room line takes
-- ---------------------------------------------------------------------------

create or replace function public.rate_plan_extra_units(
  p_per_unit text,
  p_quantity integer,
  p_adults integer,
  p_children integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select p_quantity * case p_per_unit
    when 'room' then 1
    when 'person' then coalesce(p_adults, 0) + coalesce(p_children, 0)
    when 'adult' then coalesce(p_adults, 0)
    when 'child' then coalesce(p_children, 0)
    else 0
  end;
$$;
revoke all on function public.rate_plan_extra_units(text, integer, integer, integer) from public, anon;
grant execute on function public.rate_plan_extra_units(text, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Posting the added extras of one room line for one event
-- ---------------------------------------------------------------------------

-- Called from check_in_booking(), close_business_date() and
-- check_out_booking(), which have already checked who is calling; granted to
-- nobody, so it cannot be called on its own over RPC.
create or replace function public.post_rate_plan_extras(
  p_booking_room_id uuid,
  p_event text,
  p_date date default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_room record;
  v_folio uuid;
  v_nights integer;
  v_x record;
  v_qty integer;
  v_item uuid;
  v_posted integer := 0;
begin
  select br.id, br.property_id, br.booking_id, br.rate_plan_id, br.adults, br.children,
         br.status, b.reference
    into v_room
  from public.booking_rooms br
  join public.bookings b on b.id = br.booking_id and b.property_id = br.property_id
  where br.id = p_booking_room_id;

  if not found or v_room.rate_plan_id is null or v_room.status in ('canceled', 'no_show') then
    return 0;
  end if;

  select count(*) into v_nights
  from public.booking_room_nights n
  where n.booking_room_id = v_room.id
    and n.property_id = v_room.property_id
    and n.status not in ('canceled', 'no_show');

  for v_x in
    select rpe.extra_id, rpe.frequency, rpe.per_unit, rpe.quantity,
           coalesce(rpe.price_cents, e.price_cents) as price_cents,
           e.title, e.item_type,
           coalesce(e.tax_rate_id, c.tax_rate_id) as tax_rate_id
    from public.rate_plan_extras rpe
    join public.extras e on e.id = rpe.extra_id and e.property_id = rpe.property_id
    left join public.extra_categories c on c.id = e.category_id and c.property_id = e.property_id
    where rpe.rate_plan_id = v_room.rate_plan_id
      and rpe.property_id = v_room.property_id
      and rpe.posting = 'added'
      and rpe.charge_on = p_event
    order by e.title
  loop
    v_qty := public.rate_plan_extra_units(v_x.per_unit, v_x.quantity, v_room.adults, v_room.children)
      * case when v_x.frequency = 'per_night' and p_event <> 'each_night' then v_nights else 1 end;
    continue when v_qty <= 0;

    continue when exists (
      select 1 from public.booking_extra_postings p
      where p.booking_room_id = v_room.id
        and p.extra_id = v_x.extra_id
        and p.event = p_event
        and p.stay_date is not distinct from (case when p_event = 'each_night' then p_date end)
    );

    if v_folio is null then
      select f.id into v_folio
      from public.folios f
      where f.booking_id = v_room.booking_id
        and f.property_id = v_room.property_id
        and f.status = 'open'
      order by f.is_primary desc, f.folio_number
      limit 1;
      if v_folio is null then
        raise exception 'Booking % has no open folio, so the extras sold with its rate cannot be charged',
          v_room.reference;
      end if;
    end if;

    v_item := public.post_charge(
      v_folio, v_x.item_type, v_x.title, v_x.price_cents, v_qty, null, v_x.tax_rate_id,
      case when p_event = 'each_night' then p_date end
    );

    insert into public.booking_extra_postings (
      property_id, booking_room_id, extra_id, event, stay_date, folio_item_id
    ) values (
      v_room.property_id, v_room.id, v_x.extra_id, p_event,
      case when p_event = 'each_night' then p_date end, v_item
    );
    v_posted := v_posted + 1;
  end loop;

  return v_posted;
end;
$$;
revoke all on function public.post_rate_plan_extras(uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Included extras: split out of the room charge
-- ---------------------------------------------------------------------------

create or replace function public.post_room_charge(
  p_folio_id uuid,
  p_booking_room_night_id uuid,
  p_business_date date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_folio public.folios;
  v_night record;
  v_date date;
  v_id uuid;
  v_line uuid;
  v_net bigint;
  v_first date;
  v_inc record;
  -- The lines the night is split into; index 1 is always accommodation.
  v_nets bigint[];
  v_types public.folio_item_type[];
  v_descs text[];
  v_taxes bigint[];
  v_bds jsonb[];
  v_included bigint := 0;
  v_key text;
  v_part bigint;
  v_share bigint;
  v_given bigint;
  n integer;
  c integer;
begin
  perform public.require_financial_staff();

  select * into v_folio
  from public.folios
  where id = p_folio_id
    and property_id = public.current_property_id()
    and status = 'open';

  select brn.*, br.booking_id, br.rate_plan_id, br.adults, br.children into v_night
  from public.booking_room_nights brn
  join public.booking_rooms br
    on br.id = brn.booking_room_id and br.property_id = brn.property_id
  where brn.id = p_booking_room_night_id
    and brn.property_id = public.current_property_id();

  if not found or v_night.booking_id <> v_folio.booking_id then
    raise exception 'Room night does not belong to folio booking';
  end if;

  v_date := coalesce(p_business_date, public.open_business_date(v_folio.property_id));
  if v_date is null or v_date <> v_night.stay_date then
    raise exception 'Room charge must post on its open stay business date';
  end if;

  v_net := v_night.room_rate_cents - v_night.discount_cents;
  if v_net < 0 then
    raise exception 'Room night discount exceeds room rate';
  end if;

  v_nets := array[0::bigint];
  v_types := array['room_charge'::public.folio_item_type];
  v_descs := array[format('Room charge for %s', v_night.stay_date)];

  -- What this night's rate includes, priced. A stay booked before 0037 has no
  -- rate_plan_id and so never splits.
  if v_night.rate_plan_id is not null and v_net > 0 then
    select coalesce(sum(rpm.value_cents), 0)::bigint into v_part
    from public.rate_plan_meals rpm
    where rpm.rate_plan_id = v_night.rate_plan_id
      and rpm.property_id = v_folio.property_id
      and rpm.value_cents is not null;
    if v_part > 0 then
      v_nets := v_nets || v_part;
      v_types := v_types || 'food_beverage'::public.folio_item_type;
      v_descs := v_descs || format('Meals included in the rate for %s', v_night.stay_date);
      v_included := v_included + v_part;
    end if;

    select min(x.stay_date) into v_first
    from public.booking_room_nights x
    where x.booking_room_id = v_night.booking_room_id
      and x.property_id = v_night.property_id
      and x.status not in ('canceled', 'no_show');

    for v_inc in
      select e.title, e.item_type,
             coalesce(rpe.price_cents, e.price_cents)
               * public.rate_plan_extra_units(rpe.per_unit, rpe.quantity, v_night.adults, v_night.children)
               as value_cents
      from public.rate_plan_extras rpe
      join public.extras e on e.id = rpe.extra_id and e.property_id = rpe.property_id
      where rpe.rate_plan_id = v_night.rate_plan_id
        and rpe.property_id = v_folio.property_id
        and rpe.posting = 'included'
        and (rpe.frequency = 'per_night' or v_night.stay_date = v_first)
      order by e.title
    loop
      continue when v_inc.value_cents <= 0;
      v_nets := v_nets || v_inc.value_cents;
      v_types := v_types || v_inc.item_type;
      v_descs := v_descs || format('%s included in the rate for %s', v_inc.title, v_night.stay_date);
      v_included := v_included + v_inc.value_cents;
    end loop;

    if v_included > v_net then
      raise exception
        'What this rate includes is priced at % but the night is worth %. Correct the meal values or the extras sold with the rate.',
        v_included, v_net;
    end if;
  end if;

  v_nets[1] := v_net - v_included;
  n := cardinality(v_nets);

  if n = 1 then
    insert into public.folio_items(
      property_id, folio_id, booking_id, booking_room_night_id, business_date,
      item_type, description, quantity, unit_amount_cents, net_amount_cents,
      tax_amount_cents, amount_cents, posted_by, tax_breakdown
    ) values (
      v_folio.property_id, v_folio.id, v_folio.booking_id,
      p_booking_room_night_id, v_date, 'room_charge', v_descs[1],
      1, v_net, v_net, v_night.tax_cents, v_net + v_night.tax_cents, auth.uid(),
      case when v_night.tax_cents > 0 then v_night.tax_breakdown end
    )
    returning id into v_id;
    return v_id;
  end if;

  -- Every tax on the night is shared across the lines by net; what integer
  -- division leaves goes to accommodation. A night with no per-tax split
  -- (taken before 0116) shares its one figure the same way.
  v_taxes := array_fill(0::bigint, array[n]);
  v_bds := array_fill('{}'::jsonb, array[n]);
  for v_key, v_part in
    select k, (v_night.tax_breakdown ->> k)::bigint
    from jsonb_object_keys(coalesce(v_night.tax_breakdown, '{}'::jsonb)) as k
    union all
    select '', v_night.tax_cents where v_night.tax_breakdown is null
  loop
    v_given := 0;
    for c in 2 .. n loop
      v_share := case when v_net = 0 then 0 else (v_part * v_nets[c]) / v_net end;
      v_taxes[c] := v_taxes[c] + v_share;
      v_bds[c] := v_bds[c] || jsonb_build_object(v_key, v_share);
      v_given := v_given + v_share;
    end loop;
    v_taxes[1] := v_taxes[1] + (v_part - v_given);
    v_bds[1] := v_bds[1] || jsonb_build_object(v_key, v_part - v_given);
  end loop;

  for c in 1 .. n loop
    insert into public.folio_items(
      property_id, folio_id, booking_id, booking_room_night_id, business_date,
      item_type, description, quantity, unit_amount_cents, net_amount_cents,
      tax_amount_cents, amount_cents, posted_by, tax_breakdown
    ) values (
      v_folio.property_id, v_folio.id, v_folio.booking_id,
      p_booking_room_night_id, v_date, v_types[c], v_descs[c],
      1, v_nets[c], v_nets[c], v_taxes[c], v_nets[c] + v_taxes[c], auth.uid(),
      case when v_night.tax_breakdown is not null and v_taxes[c] > 0 then v_bds[c] end
    )
    returning id into v_line;
    if c = 1 then
      v_id := v_line;
    end if;
  end loop;

  -- The accommodation line, as before.
  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The three moments an added extra is charged
-- ---------------------------------------------------------------------------

create or replace function public.check_in_booking(
  p_booking_id uuid,
  p_move_arrival boolean default false
)
returns table (rooms_occupied integer)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_today date;
  v_unassigned integer;
  v_count integer;
  v_in record;
  v_br uuid;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may check a guest in';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and property_id = public.current_property_id()
  for update;

  if not found then
    raise exception 'That booking does not belong to this property';
  end if;

  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'Booking % is %, so it cannot be checked in', v_booking.reference, v_booking.status;
  end if;

  v_today := public.open_business_date(v_booking.property_id);
  if v_today is null then
    raise exception 'There is no open business date';
  end if;

  if v_booking.check_in > v_today then
    raise exception 'Booking % arrives on %, which is after the business date',
      v_booking.reference, v_booking.check_in;
  end if;

  -- A late arrival (0112). The audit charges only the night it closes, so
  -- checking in against a past arrival leaves every earlier night unbilled.
  if v_booking.check_in < v_today then
    if v_booking.check_out <= v_today then
      raise exception 'Booking % was due to leave on %, so it cannot be checked in. Change its dates first.',
        v_booking.reference, to_char(v_booking.check_out, 'FMDD Mon YYYY');
    end if;

    if not coalesce(p_move_arrival, false) then
      raise exception 'Booking % was due to arrive on %. Move the arrival to today to check the guest in.',
        v_booking.reference, to_char(v_booking.check_in, 'FMDD Mon YYYY')
        using errcode = 'HP004';
    end if;

    -- The same path the booking screen uses, so the nights, the rules about
    -- charged nights and the activity log are the ones every date change has.
    perform public.update_booking(p_booking_id => v_booking.id, p_check_in => v_today);

    select * into v_booking from public.bookings where id = v_booking.id;
  end if;

  select count(*) into v_unassigned
  from public.booking_rooms
  where booking_id = v_booking.id
    and property_id = v_booking.property_id
    and status not in ('canceled', 'no_show')
    and room_id is null;

  if v_unassigned > 0 then
    raise exception 'Booking % still needs % room(s) assigned', v_booking.reference, v_unassigned;
  end if;

  -- Somebody still in one of the rooms (0112). Named, as assign_room() does.
  select r.number,
         b.reference,
         coalesce(public.customer_display_name(c), 'No name recorded') as guest,
         other.check_out
    into v_in
  from public.booking_rooms mine
  join public.rooms r on r.id = mine.room_id and r.property_id = mine.property_id
  join public.booking_rooms other
    on other.room_id = mine.room_id
   and other.property_id = mine.property_id
   and other.booking_id <> mine.booking_id
   and other.status = 'checked_in'
  join public.bookings b on b.id = other.booking_id and b.property_id = other.property_id
  left join public.customers c on c.id = b.customer_id and c.property_id = b.property_id
  where mine.booking_id = v_booking.id
    and mine.property_id = v_booking.property_id
    and mine.status not in ('canceled', 'no_show')
  order by r.number
  limit 1;

  if found then
    raise exception 'Room % still has % (%) checked in, due out %. Check them out first.',
      v_in.number, v_in.guest, v_in.reference, to_char(v_in.check_out, 'FMDD Mon YYYY');
  end if;

  update public.bookings set status = 'checked_in' where id = v_booking.id;

  update public.rooms r
  set status = 'occupied'
  from public.booking_rooms br
  where br.booking_id = v_booking.id
    and br.property_id = v_booking.property_id
    and br.status not in ('canceled', 'no_show')
    and br.room_id = r.id
    and r.property_id = v_booking.property_id;

  get diagnostics v_count = row_count;

  -- Extras the rate sells "at check-in" (0118).
  for v_br in
    select br.id from public.booking_rooms br
    where br.booking_id = v_booking.id
      and br.property_id = v_booking.property_id
      and br.status not in ('canceled', 'no_show')
  loop
    perform public.post_rate_plan_extras(v_br, 'check_in');
  end loop;

  return query select v_count;
end;
$$;

create or replace function public.check_out_booking(p_booking_id uuid)
returns table (rooms_released integer, outstanding_cents bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_booking public.bookings;
  v_count integer;
  v_owed bigint;
  v_br uuid;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may check a guest out';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id and property_id = public.current_property_id()
  for update;

  if not found then
    raise exception 'That booking does not belong to this property';
  end if;

  if v_booking.status <> 'checked_in' then
    raise exception 'Booking % is %, so it cannot be checked out', v_booking.reference, v_booking.status;
  end if;

  -- Extras the rate sells "at check-out" (0118), before the balance is read.
  for v_br in
    select br.id from public.booking_rooms br
    where br.booking_id = v_booking.id
      and br.property_id = v_booking.property_id
      and br.status not in ('canceled', 'no_show')
  loop
    perform public.post_rate_plan_extras(v_br, 'check_out');
  end loop;

  update public.bookings set status = 'checked_out' where id = v_booking.id;

  -- A room a guest has just left is dirty, never ready -- unless another guest
  -- is still checked in to it, whose room it still is (0112).
  update public.rooms r
  set status = 'vacant_dirty'
  from public.booking_rooms br
  where br.booking_id = v_booking.id
    and br.property_id = v_booking.property_id
    and br.room_id = r.id
    and r.property_id = v_booking.property_id
    and not exists (
      select 1 from public.booking_rooms other
      where other.room_id = r.id
        and other.property_id = r.property_id
        and other.booking_id <> v_booking.id
        and other.status = 'checked_in'
    );

  get diagnostics v_count = row_count;

  select coalesce(sum(greatest(fb.outstanding_cents, 0)), 0) into v_owed
  from public.folio_balances fb
  where fb.booking_id = v_booking.id
    and fb.property_id = v_booking.property_id;

  return query select v_count, v_owed;
end;
$$;

create or replace function public.close_business_date()
returns table (
  closed_date date,
  next_date date,
  room_charges_posted integer,
  room_charges_cents bigint
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_bd public.business_dates;
  v_open_shifts integer;
  v_posted integer := 0;
  v_cents bigint := 0;
  v_folio uuid;
  r record;
begin
  -- coalesce, so a caller with no active staff row -- anonymous, or somebody
  -- deactivated since 0016 -- is refused rather than falling through a null.
  if not coalesce(public.current_role() in ('admin', 'manager'), false) then
    raise exception 'Only an administrator or manager may close the business date';
  end if;

  v_property := public.current_property_id();

  select * into v_bd
  from public.business_dates
  where property_id = v_property and status = 'open'
  for update;

  if not found then
    raise exception 'There is no open business date to close';
  end if;

  select count(*) into v_open_shifts
  from public.cashier_shifts
  where property_id = v_property
    and business_date_id = v_bd.id
    and status in ('open', 'closing');

  if v_open_shifts > 0 then
    raise exception
      'Close the % open cashier shift(s) before closing the business date',
      v_open_shifts;
  end if;

  -- No no-show sweep (0064): a confirmed booking whose guest has not arrived
  -- is left as it is, and only `checked_in` nights are charged.

  for r in
    select
      n.id as night_id,
      n.booking_room_id,
      br.booking_id,
      b.reference,
      n.room_rate_cents,
      n.tax_cents,
      n.discount_cents
    from public.booking_room_nights n
    join public.booking_rooms br
      on br.id = n.booking_room_id and br.property_id = n.property_id
    join public.bookings b
      on b.id = br.booking_id and b.property_id = br.property_id
    where n.property_id = v_property
      and n.stay_date = v_bd.business_date
      and n.status = 'checked_in'
      and not exists (
        select 1
        from public.folio_items fi
        where fi.booking_room_night_id = n.id
          and fi.item_type = 'room_charge'
          and fi.reverses_id is null
      )
    order by b.reference
  loop
    select f.id into v_folio
    from public.folios f
    where f.booking_id = r.booking_id
      and f.property_id = v_property
      and f.status = 'open'
    order by f.is_primary desc, f.folio_number
    limit 1;

    if v_folio is null then
      raise exception
        'Booking % has no open folio, so its room charge for % cannot be posted',
        r.reference, v_bd.business_date;
    end if;

    perform public.post_room_charge(v_folio, r.night_id, v_bd.business_date);

    -- Extras the rate sells "each night" (0118), with the night.
    perform public.post_rate_plan_extras(r.booking_room_id, 'each_night', v_bd.business_date);

    v_posted := v_posted + 1;
    v_cents := v_cents + (r.room_rate_cents - r.discount_cents + r.tax_cents);
  end loop;

  update public.business_dates
  set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = v_bd.id;

  insert into public.business_dates (property_id, business_date, status, opened_by)
  values (v_property, v_bd.business_date + 1, 'open', auth.uid());

  insert into public.activity_log (
    property_id, actor_id, entity_type, entity_id, action, summary, metadata
  ) values (
    v_property, auth.uid(), 'business_date', v_bd.id, 'business_date_closed',
    format('Business date %s closed, %s room charge(s) posted',
           v_bd.business_date, v_posted),
    jsonb_build_object(
      'closed_date', v_bd.business_date,
      'next_date', v_bd.business_date + 1,
      'room_charges_posted', v_posted,
      'room_charges_cents', v_cents
    )
  );

  return query
  select
    v_bd.business_date,
    (v_bd.business_date + 1)::date,
    v_posted,
    v_cents;
end;
$$;
