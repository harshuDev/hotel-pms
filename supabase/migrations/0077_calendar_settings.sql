-- Settings -> System Settings -> Calendar Settings, cloned from the client's
-- reference: seven colours and nine switches, saved together.
--
-- WHAT IS WIRED, and to what:
--
--   unpaid / paid / partially paid   the value badge on a bar -- the money
--                                    figure, coloured by whether it is paid
--   company / group booking          a stripe down the bar's left edge
--   weekend border                   the edges of Saturday and Sunday columns
--   use rounded corners              the bars' corners
--   show seasons in calendar         the season names and fills on the band
--   show channel abbreviation        the channel's code on the bar
--   show last name first             the guest's name on the bar (below)
--   hide cancellation area           the Cancelled band
--
-- STORED, NOT YET LIVE: room blocker colour (there is no room blocker in this
-- system), the two "intersect checkout date" switches (bars are positioned by
-- whole columns, and half-column bars would collide in the lane packing),
-- fixed width for zoom (columns are always a fixed width here, which is what
-- the tick already says) and show waitlist (the waitlist is its own report,
-- and a board band for it has not been asked for). See CLAUDE.md.
--
-- One row per property. No row reads as the reference's own values, which
-- are the column defaults below, so a property never saved still draws.

create table public.calendar_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  room_blocker_color text not null default '#b4d0f5',
  unpaid_booking_color text not null default '#ed5b4f',
  paid_booking_color text not null default '#74c971',
  partially_paid_booking_color text not null default '#fdb650',
  company_booking_color text not null default '#71b4e9',
  group_booking_color text not null default '#74c971',
  weekend_border_color text not null default '#dce7f5',
  rounded_corners boolean not null default true,
  bookings_intersect_checkout boolean not null default false,
  booking_marker_intersect_checkout boolean not null default false,
  fixed_width_zoom boolean not null default true,
  show_seasons boolean not null default true,
  show_channel_abbreviation boolean not null default true,
  last_name_first boolean not null default true,
  hide_cancellation_area boolean not null default false,
  show_waitlist boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_users(id) on delete set null,
  -- A colour reaches a style attribute on every bar, so only a plain six
  -- digit hex is stored: nothing else can ride along into the CSS.
  constraint calendar_settings_colors check (
    room_blocker_color ~ '^#[0-9a-f]{6}$'
    and unpaid_booking_color ~ '^#[0-9a-f]{6}$'
    and paid_booking_color ~ '^#[0-9a-f]{6}$'
    and partially_paid_booking_color ~ '^#[0-9a-f]{6}$'
    and company_booking_color ~ '^#[0-9a-f]{6}$'
    and group_booking_color ~ '^#[0-9a-f]{6}$'
    and weekend_border_color ~ '^#[0-9a-f]{6}$'
  )
);

alter table public.calendar_settings enable row level security;

-- Everyone on the property reads them, because the board is drawn with them.
-- Changing them is revenue staff, like the rest of Settings.
create policy calendar_settings_select_current_property on public.calendar_settings
  for select using (property_id = public.current_property_id());
create policy calendar_settings_insert_revenue_staff on public.calendar_settings
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy calendar_settings_update_revenue_staff on public.calendar_settings
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update on public.calendar_settings to authenticated;
revoke all on public.calendar_settings from anon;

/* A colour field, lower-cased, or a refusal naming the field. */
create or replace function public.calendar_color(p_value text, p_label text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(btrim(coalesce(p_value, '')));
begin
  if v !~ '^#[0-9a-f]{6}$' then
    raise exception '% must be a colour like #74c971', p_label;
  end if;
  return v;
end;
$$;

revoke execute on function public.calendar_color(text, text) from public, anon;
grant execute on function public.calendar_color(text, text) to authenticated;

create or replace function public.save_calendar_settings(
  p_room_blocker_color text,
  p_unpaid_booking_color text,
  p_paid_booking_color text,
  p_partially_paid_booking_color text,
  p_company_booking_color text,
  p_group_booking_color text,
  p_weekend_border_color text,
  p_rounded_corners boolean,
  p_bookings_intersect_checkout boolean,
  p_booking_marker_intersect_checkout boolean,
  p_fixed_width_zoom boolean,
  p_show_seasons boolean,
  p_show_channel_abbreviation boolean,
  p_last_name_first boolean,
  p_hide_cancellation_area boolean,
  p_show_waitlist boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the calendar settings';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;

  insert into public.calendar_settings as c (
    property_id,
    room_blocker_color, unpaid_booking_color, paid_booking_color,
    partially_paid_booking_color, company_booking_color, group_booking_color,
    weekend_border_color,
    rounded_corners, bookings_intersect_checkout, booking_marker_intersect_checkout,
    fixed_width_zoom, show_seasons, show_channel_abbreviation, last_name_first,
    hide_cancellation_area, show_waitlist,
    updated_at, updated_by
  ) values (
    v_property,
    public.calendar_color(p_room_blocker_color, 'Room Blocker Color'),
    public.calendar_color(p_unpaid_booking_color, 'Unpaid Booking Color'),
    public.calendar_color(p_paid_booking_color, 'Paid Booking Color'),
    public.calendar_color(p_partially_paid_booking_color, 'Partially Paid Booking Color'),
    public.calendar_color(p_company_booking_color, 'Company Booking Color'),
    public.calendar_color(p_group_booking_color, 'Group Booking Color'),
    public.calendar_color(p_weekend_border_color, 'Weekend Border Color'),
    coalesce(p_rounded_corners, true),
    coalesce(p_bookings_intersect_checkout, false),
    coalesce(p_booking_marker_intersect_checkout, false),
    coalesce(p_fixed_width_zoom, true),
    coalesce(p_show_seasons, true),
    coalesce(p_show_channel_abbreviation, true),
    coalesce(p_last_name_first, true),
    coalesce(p_hide_cancellation_area, false),
    coalesce(p_show_waitlist, false),
    now(), auth.uid()
  )
  on conflict (property_id) do update set
    room_blocker_color = excluded.room_blocker_color,
    unpaid_booking_color = excluded.unpaid_booking_color,
    paid_booking_color = excluded.paid_booking_color,
    partially_paid_booking_color = excluded.partially_paid_booking_color,
    company_booking_color = excluded.company_booking_color,
    group_booking_color = excluded.group_booking_color,
    weekend_border_color = excluded.weekend_border_color,
    rounded_corners = excluded.rounded_corners,
    bookings_intersect_checkout = excluded.bookings_intersect_checkout,
    booking_marker_intersect_checkout = excluded.booking_marker_intersect_checkout,
    fixed_width_zoom = excluded.fixed_width_zoom,
    show_seasons = excluded.show_seasons,
    show_channel_abbreviation = excluded.show_channel_abbreviation,
    last_name_first = excluded.last_name_first,
    hide_cancellation_area = excluded.hide_cancellation_area,
    show_waitlist = excluded.show_waitlist,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

revoke execute on function public.save_calendar_settings(
  text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean
) from public, anon;
grant execute on function public.save_calendar_settings(
  text, text, text, text, text, text, text,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean
) to authenticated;

/* -------------------------------------------------------------------------- */
/* The guest's name on a bar, in the order the hotel chose                    */
/* -------------------------------------------------------------------------- */

-- Until now the two bar reads disagreed: the room rows said "Anna Smith"
-- (customer_display_name) and the Cancelled band said "Smith, Anna". Both go
-- through this now, so the switch decides for the whole board.
-- `customer_display_name()` itself is untouched -- every other screen uses it.
create or replace function public.calendar_guest_name(p_customer public.customers, p_last_first boolean)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_customer.kind = 'company' then nullif(btrim(p_customer.company_name), '')
    when p_last_first then nullif(btrim(concat_ws(', ',
      nullif(btrim(p_customer.last_name), ''),
      nullif(btrim(p_customer.first_name), '')
    )), '')
    else nullif(btrim(concat_ws(' ',
      nullif(btrim(p_customer.first_name), ''),
      nullif(btrim(p_customer.last_name), '')
    )), '')
  end;
$$;

revoke execute on function public.calendar_guest_name(public.customers, boolean) from public, anon;
grant execute on function public.calendar_guest_name(public.customers, boolean) to authenticated;

/* -------------------------------------------------------------------------- */
/* calendar_room_bars: name order, channel, payment state, company, group     */
/* -------------------------------------------------------------------------- */

/* Dropped and recreated: the return type gains columns, which
   `create or replace` cannot do. */
drop function if exists public.calendar_room_bars(date, integer, integer);

create function public.calendar_room_bars(
  p_from date,
  p_nights integer,
  p_unassigned_cap integer default 40
)
returns table (
  room_id uuid,
  room_type_id uuid,
  booking_id uuid,
  booking_room_id uuid,
  reference text,
  guest_name text,
  status public.booking_status,
  check_in date,
  check_out date,
  guests integer,
  value_cents bigint,
  has_notes boolean,
  is_assigned boolean,
  unassigned_total integer,
  rate_plan_name text,
  /* The booking source's short code -- BDC, EXP, DIR. */
  channel_code text,
  /* unpaid | partial | paid, for the whole booking. See below. */
  payment_state text,
  is_company boolean,
  /* Live rooms on the booking; more than one is a group. */
  room_count integer
)
language sql
stable
security invoker
set search_path = public
as $function$
  with win as (
    select p_from as from_date, (p_from + greatest(coalesce(p_nights, 30), 1)) as to_date
  ),
  cfg as (
    select coalesce((
      select cs.last_name_first from public.calendar_settings cs
      where cs.property_id = public.current_property_id()
    ), true) as last_first
  ),
  lines as (
    select
      br.room_id,
      br.room_type_id,
      b.id as booking_id,
      br.id as booking_room_id,
      b.reference,
      coalesce(
        public.calendar_guest_name(c, cfg.last_first),
        public.customer_display_name(c),
        'No name recorded'
      ) as guest_name,
      b.status,
      br.check_in,
      br.check_out,
      (br.adults + br.children) as guests,
      coalesce((
        select sum(n.room_rate_cents - n.discount_cents + n.tax_cents)
        from public.booking_room_nights n
        where n.booking_room_id = br.id and n.property_id = br.property_id
          and n.status not in ('canceled', 'no_show')
      ), 0)::bigint as value_cents,
      (
        nullif(btrim(coalesce(b.guest_notes, '')), '') is not null
        or nullif(btrim(coalesce(b.internal_notes, '')), '') is not null
      ) as has_notes,
      rp.name as rate_plan_name,
      ch.code as channel_code,
      b.settlement,
      (c.kind = 'company') as is_company
    from public.booking_rooms br
    join public.bookings b
      on b.id = br.booking_id and b.property_id = br.property_id
    join public.customers c
      on c.id = b.customer_id and c.property_id = b.property_id
    left join public.rate_plans rp
      on rp.id = br.rate_plan_id and rp.property_id = br.property_id
    left join public.channels ch
      on ch.id = b.channel_id and ch.property_id = b.property_id
    cross join win w
    cross join cfg
    where br.property_id = public.current_property_id()
      and br.status not in ('canceled', 'no_show')
      and br.check_in < w.to_date
      and br.check_out > w.from_date
  ),
  /*
   * PAYMENT STATE, per booking, for the bookings on this board only.
   *
   * What is owed is the LARGER of what the stay is worth (every live night,
   * the same figure the bar's value badge shows, across all its rooms) and
   * what has actually been charged to its folios (which adds extras and fees
   * the nights do not know about). Taking only the folio would call every
   * future booking "paid", since nothing is charged before the night audit
   * runs; taking only the nights would ignore a minibar bill.
   *
   * A booking prepaid to the channel is paid as far as this hotel's desk is
   * concerned -- prepaid bookings must never read as cash owed here.
   */
  money as (
    select
      bk.booking_id,
      coalesce((
        select sum(n.room_rate_cents - n.discount_cents + n.tax_cents)
        from public.booking_rooms br2
        join public.booking_room_nights n
          on n.booking_room_id = br2.id and n.property_id = br2.property_id
        where br2.booking_id = bk.booking_id
          and br2.status not in ('canceled', 'no_show')
          and n.status not in ('canceled', 'no_show')
      ), 0)::bigint as worth,
      coalesce((
        select sum(fb.total_charges_cents)
        from public.folios f
        join public.folio_balances fb on fb.folio_id = f.id
        where f.booking_id = bk.booking_id
      ), 0)::bigint as charged,
      coalesce((
        select sum(fb.total_payments_cents)
        from public.folios f
        join public.folio_balances fb on fb.folio_id = f.id
        where f.booking_id = bk.booking_id
      ), 0)::bigint as paid,
      (
        select count(*) from public.booking_rooms br3
        where br3.booking_id = bk.booking_id
          and br3.status not in ('canceled', 'no_show')
      )::integer as room_count
    from (select distinct booking_id from lines) bk
  ),
  ranked as (
    select
      l.*,
      case when l.room_id is null then
        row_number() over (partition by l.room_type_id order by l.check_in, l.reference)
      end as rn,
      count(*) filter (where l.room_id is null)
        over (partition by l.room_type_id) as unassigned_in_type
    from lines l
  )
  select
    r.room_id,
    r.room_type_id,
    r.booking_id,
    r.booking_room_id,
    r.reference,
    r.guest_name,
    r.status,
    r.check_in,
    r.check_out,
    r.guests,
    r.value_cents,
    r.has_notes,
    (r.room_id is not null),
    coalesce(r.unassigned_in_type, 0)::integer,
    r.rate_plan_name,
    r.channel_code,
    case
      when r.settlement = 'prepaid_to_channel' then 'paid'
      when m.paid <= 0 then 'unpaid'
      when m.paid >= greatest(m.worth, m.charged) then 'paid'
      else 'partial'
    end,
    r.is_company,
    m.room_count
  from ranked r
  join money m on m.booking_id = r.booking_id
  where r.room_id is not null
     or r.rn <= greatest(coalesce(p_unassigned_cap, 40), 1)
  order by r.check_in, r.reference;
$function$;

comment on function public.calendar_room_bars(date, integer, integer) is
  'Calendar bars keyed to a room, with the rate plan, channel code, payment state, company flag and room count of each booking. Guest names follow calendar_settings.last_name_first. Unassigned bookings come back with a null room_id and are capped per type.';

revoke all on function public.calendar_room_bars(date, integer, integer) from public, anon;
grant execute on function public.calendar_room_bars(date, integer, integer) to authenticated;

/* -------------------------------------------------------------------------- */
/* calendar_bookings: the same name order, nothing else changed              */
/* -------------------------------------------------------------------------- */

-- Same signature and return type, so replaced in place; it feeds only the
-- Cancelled band now. The name was hard-coded surname-first here.
create or replace function public.calendar_bookings(
  p_from date,
  p_days integer default 14,
  p_max_per_type integer default 40,
  p_include_canceled boolean default false
)
returns table(
  room_type_id uuid, booking_id uuid, booking_room_id uuid, reference text,
  guest_name text, status public.booking_status, room_number text,
  check_in date, check_out date, guests integer, value_cents bigint,
  has_notes boolean, type_total integer
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
  cfg as (
    select coalesce((
      select cs.last_name_first from public.calendar_settings cs
      where cs.property_id = public.current_property_id()
    ), true) as last_first
  ),
  bars as (
    select
      br.room_type_id,
      b.id as booking_id,
      br.id as booking_room_id,
      b.reference,
      coalesce(
        public.calendar_guest_name(c, cfg.last_first),
        public.customer_display_name(c),
        'Guest'
      ) as guest_name,
      b.status,
      r.number as room_number,
      br.check_in,
      br.check_out,
      (coalesce(br.adults, 0) + coalesce(br.children, 0))::integer as guests,
      coalesce((
        select sum(n.room_rate_cents - n.discount_cents + n.tax_cents)
        from public.booking_room_nights n
        where n.booking_room_id = br.id
          and n.property_id = br.property_id
      ), 0)::bigint as value_cents,
      (
        nullif(btrim(coalesce(b.guest_notes, '')), '') is not null
        or nullif(btrim(coalesce(b.internal_notes, '')), '') is not null
      ) as has_notes,
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
    cross join cfg
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
    bars.has_notes,
    bars.type_total
  from bars
  where bars.rn <= greatest(coalesce(p_max_per_type, 40), 1)
  order by bars.room_type_id, bars.check_in, bars.reference;
$function$;
