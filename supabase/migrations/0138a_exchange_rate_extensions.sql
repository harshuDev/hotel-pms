-- A rate plan priced in its own currency, converted to the hotel's on booking.
--
-- The client, in a Loom of their reference system: a Mexican hotel keeps its
-- books in pesos, but the rate plan it sends to Booking.com through Channex is
-- priced in US dollars, "because if Booking is supposed to receive US dollars
-- and Channex is sending Mexican pesos, it's going to reject it". Adjana
-- (XOF) is the same with euros. "Any reservation that came into the system is
-- going to be automatically exchanged to the default currency."
--
-- So, and only so:
--  - `rate_plans.currency` is the currency the plan's prices are TYPED and
--    STORED in -- `rate_plan_days`, the occupancy prices, the weekly
--    templates and the per-person amounts. Null is the hotel's own currency,
--    which every plan was until now, so nothing already stored changes
--    meaning.
--  - The public API's rates carry that currency, which is what a channel
--    manager pushes.
--  - A BOOKING IS STILL IN THE HOTEL'S CURRENCY. `rate_plan_night_rate()` --
--    the one place a night is priced for a party -- converts its answer, so
--    create_booking(), create_public_booking(), public_room_types() and
--    booking_quote() all price in the hotel's currency with no change to any
--    of them. Folios, payments, the cashier and every report keep one
--    currency, as before.
--  - The rate is a fixed rate set in Settings -> Currencies, else the live
--    rate, fetched every six hours into `exchange_rates`. XOF and XAF are
--    pegged to the euro at 655.957 by law, and that peg is never overwritten.
--
-- Changing a priced plan's currency converts its stored prices at today's
-- rate, so 50,000 F CFA becomes EUR 76.22 rather than EUR 50,000.
--
-- Applied in five parts, 0138a-e: the connector cancelled it as one.

-- ---------------------------------------------------------------------------
-- Live rates
-- ---------------------------------------------------------------------------

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;
