-- 0049: the search button in the top bar.
--
-- It has been in the bar since the nav was built, and `disabled` the whole
-- time: nothing ever passed `onSearchClick`, so it could not be clicked at all.
-- CLAUDE.md records it as "disabled until the lookup is built". This is the
-- lookup.
--
-- It is also the last dead control in the application. The client has already
-- objected once to a menu item that could not do anything, and was right to.
--
-- WHAT IT SEARCHES: the three things somebody at a front desk has in their
-- hand when they pick up the phone — a booking reference, a guest's name, or a
-- room number. Anything else is a report.
--
-- `security invoker`, so RLS does the filtering exactly as it does everywhere
-- else and there is no role check to keep in step with the policies. A
-- housekeeper searching sees what a housekeeper can already read.
--
-- THE ~1,800 ROOM RULE APPLIES HERE TOO. Every branch is filtered and capped in
-- Postgres; nothing returns a whole table, and the cap is per kind so one busy
-- kind cannot crowd the others out of the results.

create or replace function public.global_search(
  p_q text,
  p_limit integer default 6
)
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text,
  meta text
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
  -- A booking by its reference, the channel's reference, or the guest on it.
  -- Ordered by arrival descending: when a name matches several stays, the one
  -- being asked about is almost always the current or next one.
  bookings as (
    select
      'booking'::text as kind,
      b.id,
      b.reference as title,
      public.customer_display_name(c) as subtitle,
      to_char(b.check_in, 'DD Mon') || ' – ' || to_char(b.check_out, 'DD Mon')
        || ' · ' || replace(b.status::text, '_', ' ') as meta,
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
  -- `customer_stats` rather than `customers`, so a merged-away duplicate never
  -- comes back through search after being merged off every other screen.
  customers as (
    select
      'customer'::text as kind,
      s.customer_id as id,
      s.name as title,
      coalesce(s.email, s.phone, 'No contact details') as subtitle,
      s.booking_count || ' booking' || case when s.booking_count = 1 then '' else 's' end as meta,
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
  -- A room number is what a housekeeper or a receptionist says out loud, so an
  -- exact match sorts first: typing "10" should reach room 10 before room 101.
  rooms as (
    select
      'room'::text as kind,
      r.id,
      'Room ' || r.number as title,
      rt.name as subtitle,
      replace(r.status::text, '_', ' ')
        || case when r.floor is null then '' else ' · floor ' || r.floor end as meta,
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
  select x.kind, x.id, x.title, x.subtitle, x.meta
  from (
    select * from bookings
    union all select * from customers
    union all select * from rooms
  ) x
  cross join q
  where x.rn <= q.cap
  -- Bookings first: the reference in somebody's hand is the commonest reason
  -- to open this at all.
  order by case x.kind when 'booking' then 1 when 'customer' then 2 else 3 end,
           x.rn;
$function$;

revoke all on function public.global_search(text, integer) from public;
revoke execute on function public.global_search(text, integer) from anon;
grant execute on function public.global_search(text, integer) to authenticated;

comment on function public.global_search(text, integer) is
  'Bookings, customers and rooms matching one term. Filtered and capped per kind in Postgres; security invoker, so RLS decides what the caller sees.';
