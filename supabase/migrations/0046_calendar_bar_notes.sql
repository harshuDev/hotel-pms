-- 0046: the speech bubble on a bar in the reference system.
--
-- Comparing the board against the client's screenshots line by line, every bar
-- in theirs carries a small speech bubble before the guest name. It is not
-- decoration: it marks a booking somebody has left a note on, which is what a
-- receptionist scanning a tape chart is looking for before they pick up the
-- phone.
--
-- `bookings` has carried `guest_notes` and `internal_notes` since 0002, so this
-- is a flag over columns that already exist rather than anything new. Blank and
-- whitespace-only count as no note, the same test `create_booking()` applies
-- when it writes them.
--
-- Deliberately a boolean and not the note itself. The note can be long, a board
-- draws forty of these, and the bar has room for an icon and nothing more. The
-- booking screen is where a note is read.

drop function if exists public.calendar_bookings(date, integer, integer, boolean);

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
  has_notes boolean,
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
      -- Whether anybody has left a note on this booking, for the bubble.
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

revoke all on function public.calendar_bookings(date, integer, integer, boolean) from public;
grant execute on function public.calendar_bookings(date, integer, integer, boolean) to authenticated;
