-- 0044: seasons, and the rest of what the reference system's bars carry.
--
-- The client sent two clean screenshots of the Reservation Centric calendar
-- (the first was a photo of a monitor and its warm cast made the grid read as
-- cream; it is not, it is a cool light blue) and asked for it exactly. Three
-- things in it needed data this schema did not hold.
--
-- 1. SEASONS. The band across the top reading "LOW SEASON". There was no season
--    model, and 0043's note said to raise it rather than fake it. This is the
--    smallest honest version: a named date range per property, nothing more.
--    It labels the calendar and changes no price — pricing is `rate_plan_days`
--    and stays there. If seasons should ever drive rates, that is a different
--    change and a bigger one.
--
--    Seasons may not overlap. Two bands over one date has no sensible drawing,
--    and the exclusion constraint says so in the one place that can enforce it.
--    The range is inclusive at both ends, like meeting rooms and unlike a stay:
--    a season runs to the end of its last day.
--
--    Unlike a room or a tax rate, a season is deletable. Nothing points at one:
--    it is a label over dates, so removing it loses no history.
--
-- 2. GUESTS AND VALUE ON A BAR. The reference draws the guest count and the
--    stay's value inside each bar. `booking_rooms` already carries adults and
--    children; the value is the room line's own nights, rate less discount plus
--    tax, which is what that room will bill if nothing changes. It is not read
--    from the folio: most of these nights have not been charged yet, and a bar
--    for a future stay would otherwise show nothing.
--
-- 3. CANCELLED BOOKINGS. The reference keeps a "Canceled Area" row. 0043
--    excluded canceled and no-show outright, which is right for availability
--    and wrong for a board that wants to show them somewhere. They are now
--    returned when asked for, never by default, and the board puts them in
--    their own row rather than among the live ones.

/* -------------------------------------------------------------------------- */
/* Seasons                                                                    */
/* -------------------------------------------------------------------------- */

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  constraint seasons_name_not_blank check (btrim(name) <> ''),
  constraint seasons_dates_ordered check (ends_on >= starts_on),
  -- Inclusive at both ends: a season runs to the end of its last day.
  constraint seasons_no_overlap exclude using gist (
    property_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  )
);

create index if not exists seasons_property_dates_idx
  on public.seasons (property_id, starts_on, ends_on);

alter table public.seasons enable row level security;

drop policy if exists seasons_select on public.seasons;
create policy seasons_select on public.seasons
  for select using (property_id = public.current_property_id());

drop policy if exists seasons_write on public.seasons;
create policy seasons_write on public.seasons
  for all
  using (property_id = public.current_property_id() and public.is_revenue_staff())
  with check (property_id = public.current_property_id() and public.is_revenue_staff());

comment on table public.seasons is
  'A named date range that labels the calendar. It changes no price: pricing is rate_plan_days. Ranges may not overlap and are inclusive at both ends.';

/** The season segments touching a calendar window. */
create or replace function public.calendar_seasons(
  p_from date,
  p_days integer default 14
)
returns table(
  id uuid,
  name text,
  starts_on date,
  ends_on date
)
language sql
stable
set search_path to 'public'
as $function$
  select s.id, s.name, s.starts_on, s.ends_on
  from public.seasons s
  where s.property_id = public.current_property_id()
    and s.starts_on < (p_from + greatest(coalesce(p_days, 14), 1))
    and s.ends_on >= p_from
  order by s.starts_on;
$function$;

create or replace function public.save_season(
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_id uuid default null
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_property uuid;
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change seasons';
  end if;

  v_property := public.current_property_id();

  if p_ends_on < p_starts_on then
    raise exception 'A season cannot end before it starts';
  end if;

  if p_id is null then
    insert into public.seasons (property_id, name, starts_on, ends_on)
    values (v_property, btrim(p_name), p_starts_on, p_ends_on)
    returning id into v_id;
  else
    update public.seasons
    set name = btrim(p_name), starts_on = p_starts_on, ends_on = p_ends_on
    where id = p_id and property_id = v_property
    returning id into v_id;

    if v_id is null then
      raise exception 'That season is not on this property';
    end if;
  end if;

  return v_id;
end;
$function$;

-- A season is a label over dates and nothing points at one, so unlike a room or
-- a tax rate it can simply go.
create or replace function public.delete_season(p_id uuid)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change seasons';
  end if;

  delete from public.seasons
  where id = p_id and property_id = public.current_property_id();

  if not found then
    raise exception 'That season is not on this property';
  end if;
end;
$function$;

revoke all on function public.calendar_seasons(date, integer) from public;
grant execute on function public.calendar_seasons(date, integer) to authenticated;
revoke all on function public.save_season(text, date, date, uuid) from public;
grant execute on function public.save_season(text, date, date, uuid) to authenticated;
revoke all on function public.delete_season(uuid) from public;
grant execute on function public.delete_season(uuid) to authenticated;

/* -------------------------------------------------------------------------- */
/* Bars that carry what the reference's carry                                 */
/* -------------------------------------------------------------------------- */

drop function if exists public.calendar_bookings(date, integer, integer);

create function public.calendar_bookings(
  p_from date,
  p_days integer default 14,
  p_max_per_type integer default 40,
  p_include_canceled boolean default false
)
returns table(
  room_type_id uuid,
  booking_id uuid,
  booking_room_id uuid,
  reference text,
  guest_name text,
  status public.booking_status,
  room_number text,
  check_in date,
  check_out date,
  guests integer,
  value_cents bigint,
  type_total integer
)
language sql
stable
set search_path to 'public'
as $function$
  with win as (
    select
      p_from as from_date,
      (p_from + greatest(coalesce(p_days, 14), 1)) as to_date
  ),
  bars as (
    select
      br.room_type_id,
      b.id as booking_id,
      br.id as booking_room_id,
      b.reference,
      coalesce(
        case
          when c.kind = 'company' then nullif(btrim(c.company_name), '')
          else nullif(
            btrim(concat_ws(
              ', ',
              nullif(btrim(c.last_name), ''),
              nullif(btrim(c.first_name), '')
            )),
            ''
          )
        end,
        public.customer_display_name(c),
        'Guest'
      ) as guest_name,
      b.status,
      r.number as room_number,
      br.check_in,
      br.check_out,
      (coalesce(br.adults, 0) + coalesce(br.children, 0))::integer as guests,
      -- What this room line will bill if nothing changes. Read from the nights
      -- rather than the folio, because most of them have not been charged yet
      -- and a future stay would otherwise show nothing at all.
      coalesce((
        select sum(n.room_rate_cents - n.discount_cents + n.tax_cents)
        from public.booking_room_nights n
        where n.booking_room_id = br.id
          and n.property_id = br.property_id
      ), 0)::bigint as value_cents,
      row_number() over (
        partition by br.room_type_id
        order by br.check_in, b.reference, br.id
      ) as rn,
      count(*) over (partition by br.room_type_id)::integer as type_total
    from public.booking_rooms br
    join public.bookings b
      on b.id = br.booking_id and b.property_id = br.property_id
    join public.customers c
      on c.id = b.customer_id and c.property_id = b.property_id
    left join public.rooms r
      on r.id = br.room_id and r.property_id = br.property_id
    cross join win
    where br.property_id = public.current_property_id()
      and (
        case
          when coalesce(p_include_canceled, false)
            then br.status in ('canceled', 'no_show')
          else br.status not in ('canceled', 'no_show')
        end
      )
      and br.check_in < win.to_date
      and br.check_out > win.from_date
  )
  select
    bars.room_type_id,
    bars.booking_id,
    bars.booking_room_id,
    bars.reference,
    bars.guest_name,
    bars.status,
    bars.room_number,
    bars.check_in,
    bars.check_out,
    bars.guests,
    bars.value_cents,
    bars.type_total
  from bars
  where bars.rn <= greatest(coalesce(p_max_per_type, 40), 1)
  order by bars.room_type_id, bars.check_in, bars.reference;
$function$;

revoke all on function public.calendar_bookings(date, integer, integer, boolean) from public;
grant execute on function public.calendar_bookings(date, integer, integer, boolean) to authenticated;
