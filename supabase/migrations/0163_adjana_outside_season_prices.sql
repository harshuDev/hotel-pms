-- 0163: Adjana Resort's nights outside every season take the Default Season week.
--
-- The client, 30 Oct: "The high season with the 20% discount is only from
-- November 15th to January 15th ... the problem of the tarifs is not yet
-- solved ... very urgent for this period". The season itself is right
-- (15 Nov - 15 Jan, every one of its nights on the saved high-season week),
-- but outside it, from the open business date, nights did not carry the
-- Default Season week:
--   * 31 Oct - 14 Nov: about fifteen villas on BAR-Rate and Abritel/AirBnB
--     at the HIGH-SEASON price (+20%), set on 26 Oct -- so Channex and the
--     OTAs were selling the high season two weeks early;
--   * VILLA 119 on 13 Nov, Abritel/AirBnB (EUR): 158,745.00, typed on 30 Oct
--     -- the F CFA figure in the euro plan; its week says 242.00;
--   * a few villas' nights 16-29 Oct 2027 with no price at all, so unsold.
-- Every such night takes the Default Season week saved for its plan, room
-- type and weekday. Nights inside a season or an event are untouched, and
-- a pair with no Default Season week is left alone. From the open business
-- date, 365 nights -- what a Default Season save covers. The minute push
-- sends the changed nights to Channex.

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
  and d.rate_cents is distinct from w.rate_cents
  and not exists (
    select 1 from public.seasons s
    where s.property_id = d.property_id
      and d.stay_date between s.starts_on and s.ends_on
  );
