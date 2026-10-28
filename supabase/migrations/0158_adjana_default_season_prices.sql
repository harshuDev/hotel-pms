-- 0158: Adjana Resort's nights outside a season take the Default Season week.
--
-- The client, 28 Oct: Channex showed 50 on every villa and a Booking.com guest
-- was sold a villa far below its price -- "the rate from the main default is
-- not updating". On 12 Oct every night of both plans was loaded in bulk,
-- Abritel/AirBnB at a placeholder 50.00 EUR. The Default Season week was saved
-- with the real prices this morning, but a Default Season save only filled
-- EMPTY nights unless "Replace prices already on these nights" was ticked, so
-- 17,504 nights outside the High and Low seasons kept the 12 Oct prices and
-- the minute push kept sending them to Channex.
--
-- Decided with the client: only nights still holding the 12 Oct load take
-- the saved week. A night changed since (26 and 28 Oct) was set by somebody
-- on purpose and is left as it is. The seasons' own nights are untouched
-- (they were saved with replace), and there are no events. From the open
-- business date, 365 nights -- what a Default Season save covers. The push
-- sends the changed nights to Channex on its next run.

update public.rate_plan_days d
set rate_cents = w.rate_cents
from public.rate_plan_week_rates w
where d.property_id = '67f4552c-92ff-475a-89aa-3e5c0162b6d6'
  and w.property_id = d.property_id
  and w.rate_plan_id = d.rate_plan_id
  and w.room_type_id = d.room_type_id
  and w.season_type_id is null
  and w.weekday = extract(isodow from d.stay_date)
  and w.rate_cents is not null
  and d.stay_date between public.open_business_date(d.property_id)
                      and public.open_business_date(d.property_id) + 364
  and d.updated_at >= '2026-10-12' and d.updated_at < '2026-10-13'
  and d.rate_cents is distinct from w.rate_cents
  and not exists (
    select 1 from public.seasons s
    where s.property_id = d.property_id
      and d.stay_date between s.starts_on and s.ends_on
  );
