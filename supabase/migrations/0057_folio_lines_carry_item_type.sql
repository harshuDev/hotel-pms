-- 0057: the folio read says what KIND of charge each line is.
--
-- The booking screen needs to separate the room from everything else -- the
-- reference PMS shows Extras as its own area -- and `booking_folio_lines()`
-- returned a description and an amount with no way to tell one from the other
-- except by reading the words.
--
-- EXTRAS ARE NOT A NEW THING AND GET NO NEW TABLE. `folio_item_type` has
-- carried `food_beverage`, `laundry`, `minibar`, `transport` and
-- `miscellaneous` since 0002, and `extras_report()` has read exactly those
-- since 0038. An extra IS a folio item that is not the room -- so this adds no
-- storage, no second money path and no second total. It surfaces the column
-- the read was already sitting on.
--
-- IT READS `effective_item_type`, NOT `posted_item_type`, which is the rule
-- CLAUDE.md sets for anything splitting revenue by type: `reverse_charge()`
-- posts its row as `reversal` rather than the type it reverses, and
-- `post_discount()` sets `reverses_id` as well, so the posted type puts both in
-- the wrong bucket. The view already untangles them.
--
-- A PAYMENT HAS NO ITEM TYPE and comes back null. A payment is not a charge
-- and does not belong to any revenue category; giving it one would put it in
-- a bucket the financial report would then have to take back out.

/* Dropped and recreated rather than replaced: the return type gains a column,
   and `create or replace function` cannot change one. */
drop function if exists public.booking_folio_lines(uuid);

create function public.booking_folio_lines(p_booking_id uuid)
returns table (
  line_id uuid,
  folio_id uuid,
  folio_number bigint,
  business_date date,
  posted_at timestamptz,
  kind text,
  description text,
  is_reversal boolean,
  amount_cents bigint,
  /* Null on a payment. On a charge it is the effective type, so a reversal
     and a discount land in the bucket they actually affect. */
  item_type public.folio_item_type
)
language sql
stable
security invoker
set search_path = public
as $function$
  select
    l.id,
    l.folio_id,
    f.folio_number,
    l.business_date,
    l.posted_at,
    'charge'::text,
    l.description,
    l.is_reversal,
    l.signed_amount_cents,
    l.effective_item_type
  from public.folio_item_lines l
  join public.folios f on f.id = l.folio_id and f.property_id = l.property_id
  where l.booking_id = p_booking_id
    and l.property_id = public.current_property_id()

  union all

  select
    p.id,
    p.folio_id,
    f.folio_number,
    p.business_date,
    p.paid_at,
    'payment'::text,
    pm.name,
    (p.reverses_id is not null),
    p.signed_amount_cents,
    null::public.folio_item_type
  from public.payments p
  join public.folios f on f.id = p.folio_id and f.property_id = p.property_id
  join public.payment_methods pm
    on pm.id = p.payment_method_id and pm.property_id = p.property_id
  where p.booking_id = p_booking_id
    and p.property_id = public.current_property_id()

  -- Business date first: a folio is read day by day, and posted_at is the
  -- same instant for everything written in one transaction, so it can only
  -- ever be the tiebreak.
  order by 4, 5, 1;
$function$;

comment on function public.booking_folio_lines(uuid) is
  'Charges and payments on a booking, in posting order, each charge carrying its effective item type so the screen can separate the room from the extras. Payments carry none.';

revoke all on function public.booking_folio_lines(uuid) from public, anon;
grant execute on function public.booking_folio_lines(uuid) to authenticated;
