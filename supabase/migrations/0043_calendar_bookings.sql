-- 0043: the bookings behind the calendar's bars.
--
-- The calendar was a grid of numbers: rooms free to sell, per room type, per
-- night. The client's reference system draws the same rows as a tape chart with
-- a bar per booking across the dates it covers, and asked for that. The numbers
-- and the bars answer different questions — "can I sell tonight" against "who
-- is in, and when" — so this adds the second read rather than replacing the
-- first, and the screen shows both.
--
-- **This is the read that the ~1,800 room rule bites hardest on.** A bar is per
-- booking, not per room, so the rule is not broken outright — but a full house
-- over a fortnight is thousands of bars, and a row that draws them all is the
-- key-board grid again by another name. So the query caps per room type and
-- tells the screen what it left out:
--
--   * `p_max_per_type` bars per room type, oldest arrival first.
--   * `type_total` on every row is the true count of bookings overlapping the
--     window for that type, before the cap.
--
-- The screen says "showing 40 of 213" rather than quietly drawing 40. A count
-- that is silently short is worse than no count: somebody plans against it.
--
-- Canceled and no-show rooms are excluded, the same exclusion every
-- availability query makes, so a released room leaves the board at once.
--
-- The name is surname-first — "Danila, Alen" — because that is what a tape
-- chart is scanned by and what the reference system shows. A company books
-- under its own name, which has no halves to swap.
--
-- `check_out` is the morning the guest leaves and is not a night stayed, so a
-- bar covers `check_in` up to but not including `check_out`. The overlap test
-- is the same shape, half open at the end: a booking leaving on the first day
-- of the window does not belong on the board.

create or replace function public.calendar_bookings(
  p_from date,
  p_days integer default 14,
  p_max_per_type integer default 40
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
      and br.status not in ('canceled', 'no_show')
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
    bars.type_total
  from bars
  where bars.rn <= greatest(coalesce(p_max_per_type, 40), 1)
  order by bars.room_type_id, bars.check_in, bars.reference;
$function$;

revoke all on function public.calendar_bookings(date, integer, integer) from public;
grant execute on function public.calendar_bookings(date, integer, integer) to authenticated;
