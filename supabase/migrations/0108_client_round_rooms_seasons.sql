-- The client's round of 27 September: six points, four of which need Postgres.
--
--   A. The calendar room menu offers more than "Do not disturb" on an occupied
--      room: an occupied room is cleaned too.
--   B. Room types can be deleted from the list -- with their rooms, when
--      nothing was ever booked on them.
--   C. Room types carry their own photographs and an accounting category.
--   D. A season carries its rates: the weekly grid can replace the prices
--      already on a season's nights, not only fill the empty ones.
--
-- Nothing here touches money that has been posted. Booked nights keep the rate
-- they were sold at (booking_room_nights), so a new plan price restates
-- nothing; the Accounting report only re-groups figures it already had.

/* ========================================================================== */
/* A. Housekeeping on an occupied room                                        */
/* ========================================================================== */

/*
 * `room_status` holds cleanliness only for a VACANT room: an occupied room is
 * just `occupied`, so "the guest in 104 has had their room done" had nowhere
 * to go. The calendar menu therefore offered an occupied room one thing, Do
 * not disturb, and the client asked for the rest.
 *
 * A FLAG, NOT A STATUS, for the reason 0062 gave Inspected and Do not disturb:
 * `room_status` is what decides whether a room can be sold, and an occupied
 * room is sold whatever its cleanliness. `service_due` is "occupied, and the
 * daily clean has not been done"; `is_inspected` on an occupied room is
 * "serviced and signed off". Neither moves availability.
 */
alter table public.rooms
  add column if not exists service_due boolean not null default false;

comment on column public.rooms.service_due is
  'An OCCUPIED room waiting for its stay-over clean. Meaningful only while occupied; cleared whenever the status changes. Affects nothing about availability.';

/*
 * The flags describe the state the room is in, so they go when the state
 * does. Until now nothing cleared them at check-in or check-out: 0062 relied
 * on the housekeeping menu to reset them, and a room checked into straight
 * from "inspected" went on saying so with a guest in it.
 *
 * On a change of status: service_due always goes; is_inspected survives only
 * into vacant_clean (the menu's own Inspected sets it in the same update);
 * do_not_disturb survives only while occupied.
 */
create or replace function public.rooms_housekeeping_flags_follow_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.service_due := false;
    if new.status <> 'vacant_clean' then
      new.is_inspected := false;
    end if;
    if new.status <> 'occupied' then
      new.do_not_disturb := false;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.rooms_housekeeping_flags_follow_status() from public, anon;

drop trigger if exists rooms_housekeeping_flags_follow_status on public.rooms;
create trigger rooms_housekeeping_flags_follow_status
  before update of status on public.rooms
  for each row execute function public.rooms_housekeeping_flags_follow_status();

-- The flags left stale by check-ins and check-outs before the trigger existed.
-- An occupied room's is_inspected meant nothing before this migration (it
-- was the inspection of the room before the guest arrived), so it goes too.
update public.rooms set is_inspected = false
where is_inspected and status <> 'vacant_clean';
update public.rooms set do_not_disturb = false
where do_not_disturb and status <> 'occupied';

/*
 * The menu, as 0062 wrote it, plus an occupied branch: Inspected, Clean and
 * Dirty set the two flags and leave `occupied` alone. Broken is still refused
 * on an occupied room -- it is `ooo`, and a room with a guest in it cannot be
 * taken off sale from a menu; the guest is moved or checked out first.
 */
create or replace function public.set_room_housekeeping(
  p_room_id uuid,
  p_choice public.housekeeping_choice
)
returns void
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_room public.rooms;
  v_status public.room_status;
begin
  select * into v_room from public.rooms
  where id = p_room_id and property_id = public.current_property_id();

  if not found then
    raise exception 'That room is not on this property';
  end if;

  if v_room.status = 'occupied' then
    if p_choice = 'broken' then
      raise exception
        'Room % has a guest in it. Move the guest or check them out before marking it broken.',
        v_room.number;
    end if;
    update public.rooms
    set service_due = (p_choice = 'dirty'),
        is_inspected = (p_choice = 'inspected')
    where id = p_room_id and property_id = public.current_property_id();
    return;
  end if;

  v_status := case p_choice
    when 'inspected' then 'vacant_clean'::public.room_status
    when 'clean' then 'vacant_clean'::public.room_status
    when 'dirty' then 'vacant_dirty'::public.room_status
    when 'broken' then 'ooo'::public.room_status
  end;

  update public.rooms
  set status = v_status,
      is_inspected = (p_choice = 'inspected'),
      do_not_disturb = false
  where id = p_room_id and property_id = public.current_property_id();
end;
$function$;

comment on function public.set_room_housekeeping(uuid, public.housekeeping_choice) is
  'The housekeeping menu from the calendar rail. On a vacant room: Inspected and Clean are vacant_clean (differing by is_inspected), Dirty is vacant_dirty, Broken is ooo. On an occupied room (0108): Inspected, Clean and Dirty set is_inspected / service_due and leave it occupied; Broken is refused.';

-- The rail draws the dot, so it needs the new flag. Otherwise exactly 0091's.
drop function public.calendar_rooms();

create function public.calendar_rooms()
returns table (
  room_id uuid, room_number text, floor text, room_type_id uuid, room_type_name text,
  room_status room_status, is_inspected boolean, do_not_disturb boolean, sort_order integer,
  color text, has_divider boolean, service_due boolean
)
language sql
stable
set search_path = public
as $$
  select
    r.id,
    r.number,
    r.floor::text,
    rt.id,
    rt.name,
    r.status,
    r.is_inspected,
    r.do_not_disturb,
    rt.sort_order,
    r.color,
    r.has_divider,
    r.service_due
  from public.rooms r
  join public.room_types rt
    on rt.id = r.room_type_id and rt.property_id = r.property_id
  where r.property_id = public.current_property_id()
  order by rt.sort_order, rt.name,
           nullif(regexp_replace(r.number, '\D', '', 'g'), '')::bigint
             nulls last,
           r.number;
$$;

revoke execute on function public.calendar_rooms() from public, anon;
grant execute on function public.calendar_rooms() to authenticated;

/* ========================================================================== */
/* C. Room type photographs and accounting category                          */
/* ========================================================================== */

/*
 * PHOTOGRAPHS OF THE TYPE ITSELF. Since 0055 a photograph belonged to one
 * room, and the guest page showed a type through its rooms' pictures. The
 * client asked for images on the room type: several, ordered, in the same
 * public `room-photos` bucket under `<property>/room-types/<type>/<file>`.
 * The bucket's policies already turn on the first folder being the property.
 *
 * A PATH, NEVER A URL, as 0055: the page resolves it against one bucket.
 */
create table if not exists public.room_type_photos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  room_type_id uuid not null references public.room_types(id) on delete cascade,
  path text not null unique check (char_length(path) <= 400),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists room_type_photos_type_idx
  on public.room_type_photos (room_type_id, sort_order);

alter table public.room_type_photos enable row level security;

drop policy if exists room_type_photos_read on public.room_type_photos;
create policy room_type_photos_read on public.room_type_photos
  for select using (property_id = public.current_property_id());

-- Writes go through the two functions below, which check the path; the table
-- takes no direct insert, update or delete from anyone.

create or replace function public.add_room_type_photo(p_room_type_id uuid, p_path text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_id uuid;
  v_count integer;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up room types';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if not exists (
    select 1 from public.room_types where id = p_room_type_id and property_id = v_property
  ) then
    raise exception 'That room type is not on this property';
  end if;
  -- The browser chose the name, so the database checks it names this
  -- property and this type -- the same belt and braces as set_room_photo().
  if p_path is null
     or p_path not like v_property::text || '/room-types/' || p_room_type_id::text || '/%'
     or p_path like '%..%' then
    raise exception 'That file does not belong to this room type';
  end if;
  select count(*) into v_count from public.room_type_photos
  where room_type_id = p_room_type_id and property_id = v_property;
  if v_count >= 12 then
    raise exception 'A room type holds at most 12 pictures. Remove one first.';
  end if;

  insert into public.room_type_photos (property_id, room_type_id, path, sort_order)
  values (v_property, p_room_type_id, p_path, v_count)
  returning id into v_id;
  return v_id;
end;
$$;

-- Returns the path, so the caller removes the object only once the row is gone.
create or replace function public.delete_room_type_photo(p_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_path text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up room types';
  end if;
  delete from public.room_type_photos
  where id = p_photo_id and property_id = public.current_property_id()
  returning path into v_path;
  if v_path is null then
    raise exception 'That picture is not on this property';
  end if;
  return v_path;
end;
$$;

revoke execute on function public.add_room_type_photo(uuid, text) from public, anon;
revoke execute on function public.delete_room_type_photo(uuid) from public, anon;
grant execute on function public.add_room_type_photo(uuid, text) to authenticated;
grant execute on function public.delete_room_type_photo(uuid) to authenticated;

/*
 * THE GUEST PAGE shows the type's own photographs first, then its rooms', up
 * to eight together. Same shape as 0072's, so the booking flow is untouched.
 */
create or replace function public.public_room_type_content(p_property_id uuid)
returns table (
  room_type_id uuid,
  description text,
  photo_paths text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rt.id,
    rt.description,
    coalesce(
      (
        select array_agg(x.path order by x.rank, x.pos)
        from (
          select y.path, y.rank, y.pos
          from (
            select tp.path, 0 as rank, tp.sort_order::bigint as pos
            from public.room_type_photos tp
            where tp.room_type_id = rt.id and tp.property_id = rt.property_id
            union all
            select r.photo_path, 1,
                   coalesce(nullif(regexp_replace(r.number, '\D', '', 'g'), '')::bigint, 0)
            from public.rooms r
            where r.room_type_id = rt.id
              and r.property_id = rt.property_id
              and r.photo_path is not null
          ) y
          order by y.rank, y.pos
          limit 8
        ) x
      ),
      '{}'::text[]
    )
  from public.room_types rt
  join public.properties p on p.id = rt.property_id
  where rt.property_id = p_property_id and p.is_active;
$$;

revoke all on function public.public_room_type_content(uuid) from public;
grant execute on function public.public_room_type_content(uuid) to anon, authenticated;

/*
 * THE LEDGER ACCOUNT a room type's revenue posts to (Settings -> Finances ->
 * Accounting Categories, 0085). Null is "the accommodation default", which is
 * what every type did until now. The Accounting report reads it.
 *
 * `on delete restrict`, and delete_accounting_category() refuses by name: a
 * category quietly dropping off a room type would move that type's revenue to
 * another account with nobody told.
 */
alter table public.room_types
  add column if not exists accounting_category_id uuid
    references public.accounting_categories(id) on delete restrict;

create or replace function public.set_room_type_accounting_category(
  p_room_type_id uuid,
  p_category_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up room types';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.accounting_categories
    where id = p_category_id and property_id = public.current_property_id()
  ) then
    raise exception 'That accounting category is not on this property';
  end if;
  update public.room_types
  set accounting_category_id = p_category_id
  where id = p_room_type_id and property_id = public.current_property_id()
  returning id into v_id;
  if v_id is null then
    raise exception 'That room type is not on this property';
  end if;
end;
$$;

revoke execute on function public.set_room_type_accounting_category(uuid, uuid) from public, anon;
grant execute on function public.set_room_type_accounting_category(uuid, uuid) to authenticated;

create or replace function public.delete_accounting_category(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_name text;
  v_default text;
  v_type text;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the accounting categories';
  end if;
  v_property := public.current_property_id();
  select name into v_name from public.accounting_categories
  where id = p_id and property_id = v_property;
  if v_name is null then
    raise exception 'That accounting category is not on this property';
  end if;

  select case
    when d.accommodation_id = p_id then 'accommodation'
    when d.extras_id = p_id then 'extras'
    when d.taxes_id = p_id then 'taxes'
    when d.payments_id = p_id then 'payments'
  end into v_default
  from public.accounting_defaults d
  where d.property_id = v_property;
  if v_default is not null then
    raise exception '% is the default for %. Choose another default first.', v_name, v_default;
  end if;

  select rt.name into v_type from public.room_types rt
  where rt.accounting_category_id = p_id and rt.property_id = v_property
  order by rt.sort_order limit 1;
  if v_type is not null then
    raise exception '% is the accounting category of %. Choose another for that room type first.', v_name, v_type;
  end if;

  delete from public.accounting_categories
  where id = p_id and property_id = v_property;
end;
$$;

/*
 * ROOM REVENUE BY ROOM TYPE, for the Accounting report. The same lines
 * accounting_report() sums as `room_charge` -- folio_item_lines, by effective
 * type, signed -- split by the type the night was SOLD as, which is the type a
 * room charge is priced at. A reversal counts against the type of the night it
 * reverses. A charge with no night behind it (none today; room charges are
 * only posted by the audit) is kept with a null type, so the split always adds
 * up to the room_charge line.
 */
create or replace function public.accounting_room_revenue(p_from date, p_to date)
returns table (
  room_type_id uuid,
  room_type_name text,
  accounting_category_id uuid,
  net_cents bigint,
  tax_cents bigint,
  gross_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $function$
begin
  perform public.require_money_reports();

  return query
  select
    rt.id,
    rt.name,
    rt.accounting_category_id,
    sum(l.signed_net_amount_cents)::bigint,
    sum(l.signed_tax_amount_cents)::bigint,
    sum(l.signed_amount_cents)::bigint
  from public.folio_item_lines l
  join public.folio_items fi on fi.id = l.id and fi.property_id = l.property_id
  left join public.folio_items orig on orig.id = fi.reverses_id and orig.property_id = fi.property_id
  left join public.booking_room_nights n
    on n.id = coalesce(fi.booking_room_night_id, orig.booking_room_night_id)
  left join public.booking_rooms br on br.id = n.booking_room_id
  left join public.room_types rt on rt.id = br.room_type_id
  where l.property_id = public.current_property_id()
    and l.business_date between p_from and p_to
    and l.effective_item_type = 'room_charge'
  group by rt.id, rt.name, rt.accounting_category_id, rt.sort_order
  order by rt.sort_order nulls last, rt.name;
end;
$function$;

revoke all on function public.accounting_room_revenue(date, date) from public, anon;
grant execute on function public.accounting_room_revenue(date, date) to authenticated;

/* ========================================================================== */
/* B. Deleting a room type                                                    */
/* ========================================================================== */

/*
 * The delete existed (0091) but the list only offered it on a type with no
 * rooms, which on a set-up hotel is never -- so the client saw no delete at
 * all. The list now offers it on every type, and this answers:
 *
 *   - Never booked: deleted. With `p_with_rooms` its rooms go too, provided no
 *     booking ever pointed at one of them (a room can hold a booking of
 *     another type through an upgrade). Without it, rooms still refuse by
 *     name, so nothing is deleted that the confirmation did not name.
 *   - Booked: refused by name, as before. `booking_rooms` points at the type
 *     under `on delete restrict`, and a reservation has to keep saying what it
 *     was sold as.
 *
 * Returns the storage paths of the photographs that went with it (the type's
 * and its rooms'), so the caller removes the files once Postgres has agreed.
 *
 * The one-argument signature is DROPPED, not left beside this one -- the
 * overload trap.
 */
drop function if exists public.delete_room_type(uuid);

create function public.delete_room_type(p_room_type_id uuid, p_with_rooms boolean default false)
returns text[]
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_type public.room_types;
  v_n bigint;
  v_paths text[];
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can set up room types';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  select * into v_type from public.room_types
  where id = p_room_type_id and property_id = v_property;
  if not found then
    raise exception 'That room type is not on this property';
  end if;

  select count(*) into v_n from public.booking_rooms
  where room_type_id = v_type.id and property_id = v_property;
  if v_n > 0 then
    raise exception '% has % booked room(s), so it stays on the record and cannot be deleted.',
      v_type.name, v_n;
  end if;

  select count(*) into v_n from public.booking_waitlist
  where room_type_id = v_type.id and property_id = v_property;
  if v_n > 0 then
    raise exception '% is on the booking waitlist and cannot be deleted.', v_type.name;
  end if;

  select count(*) into v_n from public.virtual_room_types
  where parent_room_type_id = v_type.id and property_id = v_property;
  if v_n > 0 then
    raise exception '% is the parent of a virtual room type. Delete that first.', v_type.name;
  end if;

  select count(*) into v_n from public.rooms
  where room_type_id = v_type.id and property_id = v_property;
  if v_n > 0 and not coalesce(p_with_rooms, false) then
    raise exception '% has % room(s). Delete them with it, or move them first.',
      v_type.name, v_n;
  end if;

  if v_n > 0 then
    select count(*) into v_n
    from public.rooms r
    join public.booking_rooms br on br.room_id = r.id and br.property_id = r.property_id
    where r.room_type_id = v_type.id and r.property_id = v_property;
    if v_n > 0 then
      raise exception 'A room of % has a booking against it, so the rooms cannot be deleted. Move that room to another type first.',
        v_type.name;
    end if;
  end if;

  select coalesce(array_agg(p), '{}') into v_paths from (
    select tp.path as p from public.room_type_photos tp
    where tp.room_type_id = v_type.id and tp.property_id = v_property
    union all
    select r.photo_path from public.rooms r
    where r.room_type_id = v_type.id and r.property_id = v_property and r.photo_path is not null
  ) x;

  delete from public.room_status_history h
  using public.rooms r
  where h.room_id = r.id and r.room_type_id = v_type.id and r.property_id = v_property;
  delete from public.rooms where room_type_id = v_type.id and property_id = v_property;
  delete from public.room_types where id = v_type.id and property_id = v_property;

  return v_paths;
end;
$$;

revoke execute on function public.delete_room_type(uuid, boolean) from public, anon;
grant execute on function public.delete_room_type(uuid, boolean) to authenticated;

/* ========================================================================== */
/* D. Rates on a season                                                       */
/* ========================================================================== */

/*
 * The weekly grid (0096) only FILLS: a night that already has a price keeps
 * it. That was the client's rule for the grid, and it stays the default. But
 * "put rate in the Season" on a hotel whose main plan is already priced for a
 * year does nothing at all under it -- every night already has a price. So
 * the grid can now REPLACE the rate on the season's nights, when asked.
 *
 * Only the RATE is replaced. Stay rules stay fill-only: clearing or moving a
 * restriction is a commercial decision made in Inventory, night by night.
 *
 * Safe for money: a booking's nights carry the rate they were sold at in
 * booking_room_nights, so a new plan price restates nothing already sold.
 *
 * Returns the nights whose rate was set or changed. The four-argument form is
 * DROPPED -- the overload trap.
 */
drop function if exists public.save_week_rates(uuid, uuid, uuid, jsonb);

create function public.save_week_rates(
  p_rate_plan_id uuid,
  p_room_type_id uuid,
  p_season_type_id uuid,
  p_days jsonb,
  p_replace_rates boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  v_property uuid;
  v_open date;
  v_to date;
  v_dates date[];
  v_changed integer;
  v_replace boolean := coalesce(p_replace_rates, false);
begin
  select b.business_date into v_open
  from public.business_dates b
  where b.property_id = public.current_property_id() and b.status = 'open';
  if v_open is null then
    raise exception 'There is no open business date';
  end if;
  v_property := public.inventory_guard(p_rate_plan_id, v_open, v_open);
  if p_rate_plan_id is null then
    raise exception 'Pick a rate plan';
  end if;
  if not exists (
    select 1 from public.room_types rt where rt.id = p_room_type_id and rt.property_id = v_property
  ) then
    raise exception 'That room type is not on this property';
  end if;
  if p_season_type_id is not null and not exists (
    select 1 from public.season_types t
    where t.id = p_season_type_id and t.property_id = v_property and t.kind = 'season'
  ) then
    raise exception 'Choose a season, or the Default Season';
  end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 7 then
    raise exception 'Send one entry per weekday';
  end if;

  insert into public.rate_plan_week_rates (
    property_id, rate_plan_id, room_type_id, season_type_id, weekday,
    rate_cents, min_stay_through, min_stay_arrival, max_stay,
    closed_to_arrival, closed_to_departure, stop_sell, updated_at, updated_by
  )
  select
    v_property, p_rate_plan_id, p_room_type_id, p_season_type_id, (d->>'weekday')::smallint,
    (d->>'rate_cents')::bigint, (d->>'min_stay_through')::integer,
    (d->>'min_stay_arrival')::integer, (d->>'max_stay')::integer,
    coalesce((d->>'closed_to_arrival')::boolean, false),
    coalesce((d->>'closed_to_departure')::boolean, false),
    coalesce((d->>'stop_sell')::boolean, false),
    now(), auth.uid()
  from jsonb_array_elements(p_days) as d
  on conflict (rate_plan_id, room_type_id, season_type_id, weekday) do update set
    rate_cents = excluded.rate_cents,
    min_stay_through = excluded.min_stay_through,
    min_stay_arrival = excluded.min_stay_arrival,
    max_stay = excluded.max_stay,
    closed_to_arrival = excluded.closed_to_arrival,
    closed_to_departure = excluded.closed_to_departure,
    stop_sell = excluded.stop_sell,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  if p_season_type_id is not null then
    v_to := v_open + 730;
    select coalesce(array_agg(distinct d::date), '{}') into v_dates
    from public.seasons s
    cross join lateral generate_series(greatest(s.starts_on, v_open), least(s.ends_on, v_to), interval '1 day') as d
    where s.property_id = v_property and s.season_type_id = p_season_type_id and s.kind = 'season'
      and s.ends_on >= v_open;
  else
    v_to := v_open + 364;
    select coalesce(array_agg(d::date), '{}') into v_dates
    from generate_series(v_open, v_to, interval '1 day') as d
    where not exists (
      select 1 from public.seasons s
      where s.property_id = v_property and s.kind = 'season'
        and d::date between s.starts_on and s.ends_on
    );
  end if;

  -- The nights whose rate this will set or change.
  select count(*) into v_changed
  from unnest(v_dates) as n(stay_date)
  join public.rate_plan_week_rates w
    on w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
   and w.season_type_id is not distinct from p_season_type_id
   and w.weekday = extract(isodow from n.stay_date)
  left join public.rate_plan_days r
    on r.rate_plan_id = p_rate_plan_id and r.room_type_id = p_room_type_id and r.stay_date = n.stay_date
  where w.rate_cents is not null
    and (r.rate_cents is null or (v_replace and r.rate_cents <> w.rate_cents));

  insert into public.rate_plan_days (
    property_id, rate_plan_id, room_type_id, stay_date, rate_cents,
    min_stay_through, min_stay_arrival, max_stay,
    closed_to_arrival, closed_to_departure, stop_sell, updated_by
  )
  select
    v_property, p_rate_plan_id, p_room_type_id, n.stay_date, w.rate_cents,
    w.min_stay_through, w.min_stay_arrival, w.max_stay,
    w.closed_to_arrival, w.closed_to_departure, w.stop_sell, auth.uid()
  from unnest(v_dates) as n(stay_date)
  join public.rate_plan_week_rates w
    on w.rate_plan_id = p_rate_plan_id and w.room_type_id = p_room_type_id
   and w.season_type_id is not distinct from p_season_type_id
   and w.weekday = extract(isodow from n.stay_date)
  where w.rate_cents is not null or w.min_stay_through is not null
     or w.min_stay_arrival is not null or w.max_stay is not null
     or w.closed_to_arrival or w.closed_to_departure or w.stop_sell
  on conflict (rate_plan_id, room_type_id, stay_date) do update set
    rate_cents = case
      when v_replace and excluded.rate_cents is not null then excluded.rate_cents
      else coalesce(public.rate_plan_days.rate_cents, excluded.rate_cents)
    end,
    min_stay_through = coalesce(public.rate_plan_days.min_stay_through, excluded.min_stay_through),
    min_stay_arrival = coalesce(public.rate_plan_days.min_stay_arrival, excluded.min_stay_arrival),
    max_stay = coalesce(public.rate_plan_days.max_stay, excluded.max_stay),
    closed_to_arrival = public.rate_plan_days.closed_to_arrival or excluded.closed_to_arrival,
    closed_to_departure = public.rate_plan_days.closed_to_departure or excluded.closed_to_departure,
    stop_sell = public.rate_plan_days.stop_sell or excluded.stop_sell,
    updated_by = excluded.updated_by
  where (public.rate_plan_days.rate_cents is null and excluded.rate_cents is not null)
     or (v_replace and excluded.rate_cents is not null
         and public.rate_plan_days.rate_cents is distinct from excluded.rate_cents)
     or (public.rate_plan_days.min_stay_through is null and excluded.min_stay_through is not null)
     or (public.rate_plan_days.min_stay_arrival is null and excluded.min_stay_arrival is not null)
     or (public.rate_plan_days.max_stay is null and excluded.max_stay is not null)
     or (not public.rate_plan_days.closed_to_arrival and excluded.closed_to_arrival)
     or (not public.rate_plan_days.closed_to_departure and excluded.closed_to_departure)
     or (not public.rate_plan_days.stop_sell and excluded.stop_sell);

  return v_changed;
end;
$$;

revoke execute on function public.save_week_rates(uuid, uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_week_rates(uuid, uuid, uuid, jsonb, boolean) to authenticated;
