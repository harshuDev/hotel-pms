-- 0111: guests still in the room after their departure date.
--
-- The client, on the calendar: rooms 101-108 looked empty, were marked clean,
-- and putting a pending booking into any of them was refused with "Room 101 is
-- occupied, so it is not ready for a guest" -- "but the room is not occupied,
-- it's empty". Checked against the hosted database before anything changed:
-- every one of those rooms DID still have a guest checked in. BK-000005 was due
-- out 23 Sep, BK-000017 26 Sep, and the ten-room BK-000010 27 Sep, and nobody
-- had checked them out. Postgres was right; the screens gave no way to see it:
--
--   * a bar ends on its departure date, so an overdue guest's room read as
--     empty on every day after it;
--   * the refusal said "occupied" without saying by whom;
--   * the dashboard's Departures list showed only today's departures, so a
--     guest who should have left yesterday dropped off the one list a front
--     desk works through to check people out.
--
-- This migration fixes the three reads. It deliberately does NOT check anybody
-- out or change the night audit: whether a guest left, and whether they owe
-- another night, is the front desk's call, not a sweep's (open decision 11).

-- 1. assign_room(): name who is in the room.
create or replace function public.assign_room(
  p_booking_room_id uuid,
  p_room_id uuid,
  p_allow_type_change boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_br public.booking_rooms;
  v_room public.rooms;
  v_sold_type text;
  v_in record;
begin
  if not public.is_front_office_staff() then
    raise exception 'Only front desk, management or an administrator may assign a room';
  end if;

  select * into v_br
  from public.booking_rooms
  where id = p_booking_room_id and property_id = public.current_property_id();

  if not found then
    raise exception 'That booked room does not belong to this property';
  end if;

  if v_br.status in ('canceled', 'no_show', 'checked_out') then
    raise exception 'A % booking cannot be given a room', v_br.status;
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id and property_id = v_br.property_id;

  if not found then
    raise exception 'That room does not belong to this property';
  end if;

  -- An upgrade is deliberate, never accidental. The sold type and the nightly
  -- rates are never rewritten: the same money, a better room.
  if v_room.room_type_id <> v_br.room_type_id
     and not coalesce(p_allow_type_change, false)
  then
    select rt.name into v_sold_type from public.room_types rt
    where rt.id = v_br.room_type_id and rt.property_id = v_br.property_id;

    raise exception
      'Room % is not a %, which is what this booking was sold. Confirm the upgrade to put the guest in it.',
      v_room.number, coalesce(v_sold_type, 'that type')
      using errcode = 'HP003';
  end if;

  -- Readiness is only a question for a stay that has already started (0053).
  if v_br.check_in <= coalesce(
       (select bd.business_date from public.business_dates bd
         where bd.property_id = v_br.property_id and bd.status = 'open'),
       v_br.check_in
     )
     and v_room.status <> 'vacant_clean'
  then
    -- Occupied by whom (0111): a room still holding a guest past their
    -- departure looks empty on the board, so "occupied" alone reads as a bug.
    if v_room.status = 'occupied' then
      select b.reference,
             coalesce(public.customer_display_name(c), 'No name recorded') as guest,
             br.check_out
        into v_in
      from public.booking_rooms br
      join public.bookings b on b.id = br.booking_id and b.property_id = br.property_id
      left join public.customers c on c.id = b.customer_id and c.property_id = b.property_id
      where br.room_id = v_room.id
        and br.property_id = v_room.property_id
        and br.status = 'checked_in'
        and br.id <> v_br.id
      order by br.check_out
      limit 1;
      if found then
        raise exception 'Room % still has % (%) checked in, due out %. Check them out first.',
          v_room.number, v_in.guest, v_in.reference, to_char(v_in.check_out, 'FMDD Mon YYYY');
      end if;
    end if;
    raise exception 'Room % is %, so it is not ready for a guest', v_room.number, v_room.status;
  end if;

  if exists (
    select 1
    from public.booking_rooms taken
    where taken.room_id = p_room_id
      and taken.property_id = v_br.property_id
      and taken.id <> p_booking_room_id
      and taken.status not in ('canceled', 'no_show', 'checked_out')
      and daterange(taken.check_in, taken.check_out, '[)')
          && daterange(v_br.check_in, v_br.check_out, '[)')
  ) then
    raise exception
      'Room % is already taken for part of % to %',
      v_room.number, v_br.check_in, v_br.check_out;
  end if;

  update public.booking_rooms
  set room_id = p_room_id
  where id = p_booking_room_id and property_id = v_br.property_id;
end;
$function$;

-- 2. dashboard_departures(): today's departures, and on the business date
--    also every guest still checked in whose departure has passed.
create or replace function public.dashboard_departures(p_date date)
returns setof public.booking_totals
language sql
stable
set search_path to 'public'
as $function$
  select t.*
  from public.booking_totals t
  where t.property_id = public.current_property_id()
    and (
      (t.check_out = p_date and t.status not in ('canceled', 'no_show'))
      or (
        t.status = 'checked_in'
        and t.check_out < p_date
        and p_date = (
          select bd.business_date from public.business_dates bd
          where bd.property_id = public.current_property_id() and bd.status = 'open'
        )
      )
    )
  order by t.check_out, t.customer_name;
$function$;

-- 3. calendar_room_bars(): a guest still checked in is on the board however
--    long ago their departure was. The overlap test used the departure date,
--    so an in-house guest more than the board's lookback overdue vanished from
--    it entirely. The row is unchanged; the board draws an overdue bar on to
--    the business date and says "Overdue" (0111).
create or replace function public.calendar_room_bars(p_from date, p_nights integer, p_unassigned_cap integer default 40)
returns table(room_id uuid, room_type_id uuid, booking_id uuid, booking_room_id uuid, reference text, guest_name text, status booking_status, check_in date, check_out date, guests integer, value_cents bigint, has_notes boolean, is_assigned boolean, unassigned_total integer, rate_plan_name text, channel_code text, payment_state text, is_company boolean, room_count integer)
language sql
stable
set search_path to 'public'
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
      and (br.check_out > w.from_date or br.status = 'checked_in')
  ),
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

revoke execute on function public.assign_room(uuid, uuid, boolean) from anon;
revoke execute on function public.dashboard_departures(date) from anon;
revoke execute on function public.calendar_room_bars(date, integer, integer) from anon;
