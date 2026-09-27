-- 0107: global_search() returns the facts, not an English sentence about them.
--
-- The staff application speaks twelve languages as of 0106, and this was the
-- one read that composed its display text in SQL: "Room 101", "3 bookings",
-- "12 Sep – 14 Sep · checked in", "floor 2", "No contact details". Postgres
-- cannot know the reader's language, so it now hands back the parts and
-- `globalSearch()` in src/lib/actions/search.ts writes the line in the staff
-- member's language.
--
-- Same search, same filters, same caps, same order, still security invoker.
-- A changed return shape is a new function, so the old one is dropped first
-- rather than left beside it for PostgREST to choose between.

drop function if exists public.global_search(text, integer);

create function public.global_search(
  p_q text,
  p_limit integer default 6
)
returns table (
  kind text,
  id uuid,
  -- booking: its reference; customer: the name; room: the room number.
  title text,
  -- booking: the guest; customer: email, else phone, else null; room: its type.
  subtitle text,
  check_in date,
  check_out date,
  -- booking: booking_status; room: room_status.
  status text,
  booking_count bigint,
  floor text
)
language sql
stable
security invoker
set search_path = public
as $function$
  with q as (
    select
      btrim(coalesce(p_q, '')) as term,
      greatest(least(coalesce(p_limit, 6), 20), 1) as cap
  ),
  bookings as (
    select
      'booking'::text as kind,
      b.id,
      b.reference as title,
      public.customer_display_name(c) as subtitle,
      b.check_in,
      b.check_out,
      b.status::text as status,
      null::bigint as booking_count,
      null::text as floor,
      row_number() over (order by b.check_in desc, b.reference) as rn
    from public.bookings b
    join public.customers c
      on c.id = b.customer_id and c.property_id = b.property_id
    cross join q
    where q.term <> ''
      and (
        strpos(lower(b.reference), lower(q.term)) > 0
        or strpos(lower(coalesce(b.external_reference, '')), lower(q.term)) > 0
        or strpos(lower(coalesce(public.customer_display_name(c), '')), lower(q.term)) > 0
      )
  ),
  customers as (
    select
      'customer'::text as kind,
      s.customer_id as id,
      s.name as title,
      coalesce(s.email, s.phone) as subtitle,
      null::date as check_in,
      null::date as check_out,
      null::text as status,
      s.booking_count::bigint as booking_count,
      null::text as floor,
      row_number() over (order by s.booking_count desc, s.name) as rn
    from public.customer_stats s
    cross join q
    where q.term <> ''
      and (
        strpos(lower(coalesce(s.name, '')), lower(q.term)) > 0
        or strpos(lower(coalesce(s.email, '')), lower(q.term)) > 0
        or strpos(coalesce(s.phone, ''), q.term) > 0
        or s.customer_number::text = q.term
      )
  ),
  rooms as (
    select
      'room'::text as kind,
      r.id,
      r.number as title,
      rt.name as subtitle,
      null::date as check_in,
      null::date as check_out,
      r.status::text as status,
      null::bigint as booking_count,
      r.floor::text as floor,
      row_number() over (
        order by (lower(r.number) = lower((select term from q))) desc, r.number
      ) as rn
    from public.rooms r
    join public.room_types rt
      on rt.id = r.room_type_id and rt.property_id = r.property_id
    cross join q
    where q.term <> ''
      and strpos(lower(r.number), lower(q.term)) > 0
  )
  select x.kind, x.id, x.title, x.subtitle, x.check_in, x.check_out, x.status, x.booking_count, x.floor
  from (
    select * from bookings
    union all select * from customers
    union all select * from rooms
  ) x
  cross join q
  where x.rn <= q.cap
  order by case x.kind when 'booking' then 1 when 'customer' then 2 else 3 end,
           x.rn;
$function$;

revoke all on function public.global_search(text, integer) from public;
revoke execute on function public.global_search(text, integer) from anon;
grant execute on function public.global_search(text, integer) to authenticated;

comment on function public.global_search(text, integer) is
  'Bookings, customers and rooms matching one term, as raw fields; the caller writes the line in the staff language (0107). Filtered and capped per kind in Postgres; security invoker, so RLS decides what the caller sees.';
