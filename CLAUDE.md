# Hotel PMS Portal

Custom property management system for a hotel. Front desk operations,
channel-connected bookings, and a cashier shift/drawer feature.

## Where this project currently stands

The front end is **built and deployed**, and every read and write in it goes to
Supabase. `src/lib/mock/` is deleted. Migrations `0001` through `0115` are
applied to the hosted database.

Working on real data: dashboard (house board, movements, pace, activity feed),
bookings list, customers, the availability calendar, cashier (open a shift,
take payments, record paid-outs, blind close), check-in and check-out, the
night audit that advances the business date, taking a booking, all nine
Inventory screens, the booking screen with edit and cancel, promotions,
meeting rooms, property settings, the guest booking page, all eleven Inventory
screens, and twenty-two reports — occupancy, debtors, payments, financial,
extras, daily checkout, booking, reservations, cancellation, channel,
housekeeping, in house, meal, manager, folio, immigration, country, deposit,
rate plan, accounting, end of day and booking waitlist.

**The hosted property is set up and can take a booking.** The Grand Hotel holds
four room types and 120 rooms — Standard Double 101–160 on floor 1, Twin
201–230 on floor 2, Deluxe 301–320 on floor 3, Suite 401–410 on floor 4 — five
booking sources (Direct, Walk-in, Phone, Booking.com at 15%, Expedia at 18%),
VAT at 20% inclusive, seven payment methods, and one rate plan, Best Available,
priced per room type from the open business date to 2027-09-18 and published to
the guest booking page. Every row went in through the same RPCs `/settings` and
Inventory call, as the admin staff user with RLS in force — nothing was written
by hand.

Those figures are a working configuration, not the client's own property. They
were chosen with the client and are cheap to change in the application, with
one exception that Postgres will not let anyone undo: a room type that has
been BOOKED cannot be deleted, because bookings point at it under `on delete
restrict` (as of 0091 one nothing was ever built on can be, and as of 0108
together with its rooms, if none of them was ever booked). **A tax
rate CAN be deleted as of 0079, but only one nothing points at** — no charge
posted at it, no extra or extras category set to it; one in use is retired.

**A ROOM CAN BE DELETED, as of 0055, if it has never been booked.** That
reverses what this file said from 0030 to 0054, and the reversal is narrow:
`delete_room()` refuses by name the moment `booking_rooms` points at the room,
and such a room is still `ooo`. What it unblocks is the case the old rule got
wrong — a run of 60 entered as 50, a number typed wrong, a cupboard counted as
sellable — where `ooo` is not an answer at all, because an out-of-order room
still sits in the rail and still reads as a room the hotel owns.

As of 0030 all of this can be created from `/settings` rather than by hand in
SQL, and as of 0031 an individual room and the payment methods can be corrected
there too. Until a channel exists, no booking can be taken at all: every
booking must have a source.

The night audit advances the business date one day at a time and posts that
night's room charges, so it is run once per day rather than caught up
automatically. Nothing runs it on a schedule: "Close the day" on the dashboard
is the only caller, and it refuses while a cashier shift is still open on the
date being closed.

**IT NO LONGER MARKS NO-SHOWS, as of 0064.** See open decision 11, which has
been reversed. **The hour it should run at now lives on the property** —
`properties.audit_close_time`, defaulting to 02:00, set in Settings beside the
check-in and check-out times and read against `properties.timezone`. **Nothing
reads that column yet**, because the scheduled job that will is the next piece
of work and the client has not finished settling what it may do. It is a stored
choice rather than a live setting, and it is the one place in this application
where a control does not yet change anything — if the job does not land, the
field comes out again.

A client revision round has been applied on top of the original build: the
palette moved from brass/slate to the client's white/blue/dark-blue scheme, the
per-room grid on the dashboard was replaced with a compact house board, the
property name moved from the sidebar into a top bar, and several nav items were
renamed and reordered. See "Client revision round" below before changing any UI.

**Do not rebuild or restyle existing screens unless asked.**

## Client revision round — do not revert these

The client compared this build against their reference system (Reservation
Centric) and asked for five changes. All five are shipped. Treat them as the
current design, not as drift.

1. **Nav order and labels.** Section order is fixed: Dashboard, Calendar,
   Inventory, Bookings, Promotions, Reports, Customers, Cashier, Meeting Rooms.
   - **The Reports menu carries twenty-two items and Inventory eleven**, in the
     reference's order and with the reference's labels. The order is theirs
     rather than anything meaningful, and it is kept so somebody moving between
     the two systems finds the same item in the same place.
     - Reports read "Payments Report", "Daily Checkout Report" and so on —
       Title Case with the word Report on the end, as theirs do. The one
       departure is "Reservations Report": their own screen has it lower-case,
       which is a slip rather than a decision, and copying it would have been
       copying a typo.
     - Inventory keeps their mixed casing exactly — "Min Stay Through" and
       "Stop Sell" in Title Case beside "Closed to arrival" in sentence case.
       That looks like an inconsistency because it is one, and it is theirs;
       tidying it would be the one thing that made our menu look unlike the
       screenshot they sent.
     - **Reports is one scrolling column, not two.** `scroll` on the section
       and on `Menu` caps the panel at `78vh` and lets it scroll, which is what
       their menu does. Two columns fits twenty-two items without scrolling and
       was what we had; they compared the two and asked for theirs. Do not
       "improve" it back into columns.
   - **The Bookings menu carries exactly three items**, matching the reference:
     Add Simple Booking, Add Group Booking, Search. It used to carry five.
     **Arrivals, Departures and In house are still built and still reachable** —
     the bookings list links to all three, and In house is that list's own
     `checked_in` filter. They came out of the menu, not out of the application;
     do not "restore" them to the nav.
   - **Simple and Group are the same transaction.** A group here is one
     `bookings` row with several `booking_rooms` on it, which `create_booking()`
     has always taken. `?group=1` changes the wording so somebody who chose
     Group is told where the rooms go. There is no group flag in the schema and
     adding one would be a second booking model to keep in step with the
     first.
     - **ONE ROOM OF A GROUP CAN BE CANCELLED ON ITS OWN, as of 0065.** The
       client: "Group bookings allow the receptionist to be able to cancel a
       reservation." Until then the only cancel was `cancel_booking()`, which
       takes the whole booking down — five rooms booked, one guest drops out,
       and the desk could cancel all five or none. See the cancellation notes
       below for how it is built and for the two things that would have
       silently undone it.
2. **Dashboard, not Front Desk.** The route `/dashboard` is labelled
   "Dashboard" in the nav, the page `<h1>` and the page title. "Front Desk"
   survives only as a booking channel value in mock data — do not rename that.
3. **Offers, not Promotions — reversed by the client, later.** This item used
   to read the other way round. The client subsequently sent their reference
   system's Offers screen and asked for the section to be called Offers and to
   look like it, so the nav label, the page title and every piece of copy on
   the screen now say "offer". The route was always `/offers`, so it did not
   move. **The database still says `promotions`** — the table, the RPCs, the
   `Promotion` type and `savePromotion()` — and renaming those is a migration
   with no user-visible effect, so it has not been done. Read "offer" in the
   interface and `promotion` in the schema as the same thing.
4. **Navigation is horizontal, across the top. There is no sidebar.** The
   client confirmed this is what "move the main headline to the top" meant.
   `src/components/side-nav.tsx` is deleted — do not reintroduce it, and do
   not restore a sidebar layout when touching `src/app/(app)/layout.tsx`.
   - `src/components/top-nav.tsx` is the blue bar: logo slot, nine sections,
     search button, user menu. Sticky at `top-0`, `h-14`.
     - **It is `z-50`, and that is load-bearing.** The mobile drawer inside it
       is `fixed inset-0 z-50`, but a `sticky` element with a z-index creates a
       stacking context — so the drawer's 50 only ranks it *within the header*,
       and at page level the whole header competes with its own z-index. At
       z-40 it tied with the calendar's paging chevrons and lost to them on DOM
       order, so the two arrows floated on top of the open drawer on a phone.
       Any z-40 page content would have done the same; the calendar merely had
       some. Dialogs still cover the bar because they are `fixed inset-0 z-50`
       inside `main`, which comes after the header, and an equal z-index
       resolves on DOM order. Do not lower this to match the top bar, which is
       `z-30` and belongs underneath.
   - `src/components/top-bar.tsx` is a slim strip below it with the property
     name and business date. Sticky at `top-14` — that offset is what stops
     the two bars overlapping on scroll. Do not change it to `top-0`.
   - `src/lib/nav.ts` is the single source of nav sections, read by both the
     desktop bar and the mobile drawer. Add or reorder sections there, never
     inline in a component.
   - **The browser tab title comes from the database.** Every page under
     `src/app/(app)/` exports a bare title — `"Dashboard"`, `"Settings"` — and
     `generateMetadata` in `(app)/layout.tsx` supplies the hotel from
     `properties.name`, so renaming the property in Settings reaches the tab as
     well as the bar. Do not put the hotel's name back into a page. The root
     layout still names it once, for `/login` and the root redirect, where
     there is no session and so no property row to read.
   - `src/components/menu.tsx` is the shared dropdown primitive — hover
     intent, click-outside, Escape, arrow keys. Inventory, Bookings, Reports
     and the user menu all use it. Do not hand-roll another one.
   - **The user menu is Profile, Guest booking page, Settings, Reload data, the
     LANGUAGE GRID, and Log out (0106). This reverses what this file said**,
     which was that there is no Language item. It was taken out because the
     staff app spoke only English, so the control changed nothing — a disabled
     row was tried twice, silent and then labelled "English", and read as
     broken and then pointless. The app is translated now (see "The staff
     application speaks twelve languages"), so the switch changes every screen
     and earns its place. **Do not add a control to this menu that cannot do
     anything** still holds; this one does something.
     - It is the reference's, copied at the client's request: twelve codes in
       a grid of four (`LanguageChoices` in `language-switch.tsx`), the current
       one marked, and a confirmation — "You're changing the language. The page
       will reload…", Cancel and Confirm — before `save_own_locale()` and a
       full reload, so every Server Component renders again in the new
       language. The dialog is portalled to `<body>`: the top nav is a sticky
       `z-50` stacking context, the calendar room menu's trap.
     - **The Greek nav label for Meeting Rooms is "Αίθουσες"**, short on
       purpose: the full "Αίθουσες συσκέψεων" pushed the bar past 1024px. The
       page title keeps the full words (a different key, "Meeting rooms").
     - **Nav labels never wrap, and between `lg` and `xl` the triggers are
       `px-2` and the user's name is hidden behind its initial.** Translated
       labels run long; measured at 1024px in all twelve languages, and at
       390px, with no horizontal scroll. Re-measure if a label changes. The logo
     is `/public/logo-mark.png`, supplied by the client in the first commit,
     and it is now the favicon too — `src/app/icon.png`, `apple-icon.png` and
     `favicon.ico` are generated from that same mark, trimmed to its own bounds
     and squared.
   - **Search works, as of 0049**, and `src/components/search-overlay.tsx` owns
     it. `global_search()` returns bookings, customers and rooms — a reference,
     a name, a room number, which is what somebody at a front desk has in their
     hand. `security invoker`, so RLS decides what the caller sees and there is
     no role check to keep in step with the policies. Filtered and capped per
     kind in Postgres, so the ~1,800 rule holds here too.
     - **The button was structurally un-wireable, not merely unwired.** It took
       an `onSearchClick` prop from `(app)/layout.tsx`, a Server Component,
       which cannot hand a function to a client component — so nothing was ever
       passed and `disabled={!onSearchClick}` was permanent. The overlay owns
       its own open state now. Same trap as the calendar's date picker.
     - Two characters minimum, debounced, and each reply checks it is still the
       newest: without that a slow early request lands after a fast late one and
       shows results for a term already typed over.
     - **`global_search()` returns raw fields as of 0107**, not sentences:
       status, dates, booking count and floor rather than a subtitle written
       in English in SQL. `search.ts` composes the meta line in the reader's
       language. `SearchHit.term` carries what was searched for the href.
5. **No per-room grid.** See the house board note in the design system section.

## Stack

- Next.js 15 (App Router), TypeScript strict, React 19
- Tailwind 3, no component library — plain components in `src/components`
- Supabase (Postgres, Auth, Realtime, RLS) — not yet added
- Recharts, date-fns
- pnpm

## The query layer — read this before touching data

`src/lib/mock/` is deleted. Every page reads through `src/lib/queries.ts`, and
every write goes through a Server Action in `src/lib/actions/`. Reads are
Server Components calling Supabase with the signed-in user's session, so RLS
does the filtering; nothing bypasses it.

Each read is a Postgres view or RPC, never aggregation in the client:

| Query layer                         | Postgres                          |
| ----------------------------------- | --------------------------------- |
| `getArrivals(date)`                 | `dashboard_arrivals(p_date)`      |
| `getDepartures(date)`               | `dashboard_departures(p_date)`    |
| `getOccupancyForecast()`            | `occupancy_forecast(from, 28)`    |
| `getRevenueSeries()`                | `revenue_series(from, 28)`        |
| `getActivity()`                     | `activity_feed(limit, offset)`    |
| `getBookings(filters)`              | `bookings_page(...)`              |
| `getCustomers(filters)`             | `customers_page(...)`             |
| `getRooms({ q, state, page })`      | `rooms_page(...)`                 |
| `getHouseSummary()`                 | `house_summary()`                 |
| `getOpenShift()`                    | `current_cashier_shift()`         |
| `getCalendarAvailability(from, n)`  | `calendar_availability(from, n)`  |
| `getCalendarBookings(from, n, cap)` | `calendar_bookings(from, n, cap)`  |
| `getCalendarSeasons(from, n)`       | `calendar_seasons(from, n)` -- seasons and events (0113) |
| `getCalendarNotes(from, n)`         | `calendar_notes_for(from, n)`      |
| `getSeasonSettings()`               | `season_types` with their `seasons` ranges (0095) |
| `getWeekRates()`                    | `rate_plan_week_rates` (0096)     |
| `getOccupancyGrid(from, n)`         | `inventory_occupancy_grid(from, n)` (0110) |
| `getRoomTypeOccupancies()`          | `room_types` base and max occupancy |
| `getRoomStatusByType()` (unused)    | `room_status_by_type()`            |
| `getOccupancyReport(from, to)`      | `occupancy_report(from, to)`      |
| `getDebtorsReport()`                | `debtors_report()`                |
| `getPaymentsReport(from, to)`       | `payments_report(from, to)`       |
| `getFinancialReport(from, to)`      | `financial_report(from, to)`      |
| `getExtrasReport(from, to)`         | `extras_report(from, to)`         |
| `getDailyCheckout(date)`            | `daily_checkout_report(date)`     |
| `getBookingReport(from, to)`        | `booking_report(from, to)`        |
| `getReservationsReport(from, to)`   | `reservations_report(from, to)`   |
| `getCancellationReport(from, to)`   | `cancellation_report(from, to)`   |
| `getChannelReport(from, to)`        | `channel_report(from, to)`        |
| `getHousekeepingRooms(filters)`     | `housekeeping_rooms(...)`         |
| `getInHouseReport()`                | `in_house_report()`               |
| `getBookableRoomTypes(from, to)`    | `bookable_room_types(from, to)`   |
| `getInventoryGrid(plan, from, n)`   | `inventory_grid(plan, from, n)`   |
| `getRatePlans()`                    | `rate_plans` where active         |
| `getRatePlanSettings()`             | `rate_plans` incl. retired (Settings) |
| `getBookingDetail(id)`              | `booking_detail(id)`              |
| `getBookingRoomLines(id)`           | `booking_room_lines(id)`          |
| `getBookingNights(id)`              | `booking_nights(id)`              |
| `getBookingFolioLines(id)`          | `booking_folio_lines(id)`         |
| `getBookingActivity(id)`            | `booking_activity(id)`            |
| `getPromotions()`                   | `promotions_list()`               |
| `getMeetingRoomCalendar(from, n)`   | `meeting_room_calendar(from, n)`  |
| `getMeetingRoomBooking(id)`         | `meeting_room_booking_detail(id)` |
| `getPropertySettings()`             | `properties` row incl. 0067 details |
| `getHotelPolicies()`                | `property_policies` row (0068)    |
| `getExtrasCatalog()`                | `extra_categories` + `extras` (0069) |
| `getFacilities()`                   | `facilities` (0070)               |
| `getRoomTypeSettings()`             | `room_types` with room counts and facility ids |
| `getVirtualRoomTypes()`             | `virtual_room_types` (0091)       |
| `getChannelSettings()`              | `channels` + associated customer (0099) |
| `getTaxRateSettings()`              | `tax_rates_list()` (order, in use) |
| `getStaffSettings()`                | `staff_users`                     |
| `getRoomsForSettings({ q, page })`  | `rooms_for_settings(...)`         |
| `getPaymentMethodSettings()`        | `payment_methods` incl. retired   |
| `getAccountingSettings()`           | `accounting_categories` + `accounting_defaults` (0085) |
| `getPaymentGateways()`              | `payment_gateways` (0086)         |
| `getAccountingSystems()`            | `accounting_systems` (0087)       |
| `getInventorySettings()`            | `inventory_settings` (0088)       |
| `getDiscounts()`                    | `discounts` (0090)                |
| `getChannelManagers()`              | `channel_managers` (0097)         |
| `getBookingEngineSettings()`        | `booking_engine_settings` + `booking_engine_profiles` (0098) |
| `getBookingWidgets()`               | `booking_widgets` (0100)          |
| `getApiKeys()`                      | `api_keys` -- hints only (0101)   |
| `getSystemConnections(category)`    | `system_connections` (0102-0103)  |
| `getReactions()`                    | `reactions` (0104)                |
| `getDocumentTemplate("folio")`      | `document_templates` (0105)       |
| `getMealReport(from, to)`           | `meal_report(from, to)`           |
| `getAccountingRoomRevenue(from, to)` | `accounting_room_revenue(from, to)` (0108) |

**Two signatures carry the room-count rule.** The client operates properties
with up to ~1,800 rooms, so no query may return every room and no screen may
draw one element per room:

- `getHouseSummary()` returns the six room-state counts, so the collapsed house
  board needs no room list at all.
- `getRooms({ q, state, page })` is filtered and paginated in Postgres, and is
  called only when the room list is expanded.

The calendar follows the same rule from the other side: its rows are room
types, not rooms, so the grid is the same height at 40 rooms and at 1,800. The
housekeeping report follows it too: a floor summary, which is a handful of rows
whatever the hotel, plus a room list paged in Postgres.

`getCalendarBookings()` is the one read where the rule is not automatic. A bar
is per booked room rather than per room, so it is not broken outright, but a
full house over a fortnight is thousands of bars and a row that draws them all
is the key-board grid again by another name. It is capped per room type in
Postgres, and every row carries `type_total`, the real number before the cap,
so the board can say "1 of 9 shown" rather than quietly drawing one.

If a screen seems to need a shape the query does not return, fix the query, not
the component.

## Non-negotiable rules

**Money**

- Integer minor units only. Every currency column and field ends in `_cents` /
  `Cents`, type `bigint` in SQL.
- Never float, never `numeric`, never JS `number` arithmetic on currency.
- Tax rates are basis points, suffix `_bps` (1250 = 12.5%).
- `src/lib/money.ts` is the ONLY place a number becomes a currency string.
  Never format inline.
- **THE CURRENCY IS THE PROPERTY'S, AND IT IS A REQUIRED ARGUMENT** (0071
  round). `formatMoney`, `formatMoneyShort` and `formatDue` take `currency`
  with no default. They used to default to a constant "GBP", so a hotel set up
  in pesos had every staff screen print pounds.
  - **A Server Component** reads it with `await getPropertyCurrency()` --
    free, because `getProperty()` is `cache()`d and the layout already called
    it. A non-async server component that formats money was made async for
    this (`Bars`, `BookingList`, `HouseStrip`, `InventoryAll`).
  - **A client component** reads it with `useCurrency()`, from the
    `CurrencyProvider` the `(app)` layout puts round every page. It has no
    default and throws outside the provider, rather than quietly printing one
    currency for every hotel.
  - **It can never be a module-level setting.** money.ts renders on the server
    for every hotel at once; two requests interleaving would print one hotel's
    money in another's currency. Required-argument is what the compiler can
    hold everyone to -- the same move as removing `PageHeader`'s subtitle.
  - **`currencyDisplay: "narrowSymbol"`**, so a peso hotel reads "$1,284.00"
    as its reference does, not en-GB's "MX$1,284.00". Checked identical in
    Node and Chromium for the currencies a client is likely to use, which
    matters because a client component renders in both.
  - The figures stay en-GB ("1,284.00") in EVERY staff language, as of 0106.
    The words around them are translated; the money is not reformatted,
    because a cash screen where "1.284,00" and "1,284.00" both appear
    depending on who is logged in is a counting error waiting to happen. The
    guest page still writes numbers in the guest's language, via
    `formatMoneyIn()`.

**Sign convention**

- `folio balance = sum(charges) - sum(payments)`
- Positive balance means the guest owes the hotel.
- Charges post positive. Payments store positive and subtract in views.
- Refunds and corrections are reversing rows, never negative amounts.
- The display inversion that shows an amount due as negative lives in
  `formatDue()` and nowhere else.

**Immutability**

- `folio_items`, `payments`, `paid_outs` are append-only.
- Never UPDATE or DELETE a posted row. Corrections insert a new row with
  `reverses_id` pointing at the original.
- Each carries:
  `signed_amount_cents bigint generated always as (amount_cents * case when reverses_id is null then 1 else -1 end) stored`
  Every total is `sum(signed_amount_cents)`. Never hand-write that CASE.

**Dates**

- `business_date date` is the hotel operating day. `created_at timestamptz` is
  wall-clock. Different columns, never interchangeable.
- All operational reporting groups by `business_date`.
- Property timezone lives on `properties.timezone`. Never derive a business
  date from server local time or `now()::date`.
- **A `timestamptz` is rendered by `formatStampInProperty()` in
  `src/lib/dates.ts`, never by `format()` from date-fns.** date-fns renders in
  the RUNTIME's zone, and a client component is rendered twice — once on the
  server (UTC on Vercel) and once in the browser — so one row came out
  "20 Sep, 11:18" and "20 Sep, 12:18" and React reported a hydration mismatch.
  Neither was the hotel's clock either. The helper names the zone, which makes
  the two renders identical and the time the one the front desk would read off
  the wall. Its month names and hour cycle are pinned rather than left to
  `Intl`, because Node's ICU and the browser's disagree about "Sep"/"Sept" and
  about midnight under `hour12: false` — leaving either to the platform would
  put the mismatch straight back. A plain `date` column is not affected and
  `format()` is still right for one.

**Schema**

- Schema changes ONLY through `supabase/migrations/*.sql`. Never through the
  Supabase dashboard, never through ad-hoc SQL.
- After any migration:
  `pnpm supabase gen types typescript --local > src/lib/database.types.ts`
  That file is generated and never edited. It is what makes a renamed RPC
  parameter, a misspelt function name or an enum value that does not exist a
  compile error instead of a PostgREST failure in front of a receptionist.
- **`src/lib/supabase/database.ts` is the type the clients actually use**, and
  it corrects the generator in one place. A parameter with a SQL DEFAULT is
  generated as optional (`p_id?: string`) and never as nullable, but PostgREST
  accepts null for all of them — and null is not the same as omitting it:
  omitting uses the SQL default, null passes NULL. The optional arguments are
  widened to accept null so the call sites keep saying which they mean. Nothing
  else is relaxed. A required parameter that is nonetheless nullable, which the
  generator cannot express at all, is marked at the call site with
  `nullableArg()` and a line saying what null means to that function.
- Every tenant table has `property_id` and an RLS policy. A new table without a
  policy is a bug, not a TODO.
- **`revoke all on function ... from public` does not take the grant off
  `anon`.** The hosted project carries `alter default privileges in schema
  public grant execute on functions to anon, authenticated, service_role`, so a
  new function comes out executable by `anon` however carefully the migration
  revokes PUBLIC afterwards — PUBLIC and a named role are different grants.
  0047 found thirteen that had drifted this way and took them back. **A new
  staff function needs `revoke execute on function ... from anon` explicitly**,
  and the check is
  `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')`
  — it should return only the public booking surface (ten functions since
  0100: the four below plus `public_hotel_policies`,
  `public_room_type_facilities`, `public_room_type_content`,
  `public_language_settings` (0078), `public_booking_engine` (0098) and
  `public_booking_widget` (0100)), the five public API functions
  (`api_property`, `api_room_types`, `api_rate_plans`, `api_availability`,
  `api_rates`, 0101, useless without a key), the two policy helpers, and the
  `btree_gist` extension's own internals. Four older functions held it through PUBLIC instead and needed
  `from public`; both revokes exist for a reason.
- **A null role is not a refusal unless you write it as one.**
  `current_role()` returns null for anyone with no active `staff_users` row —
  `anon`, and anybody deactivated since 0016 — and `null not in ('admin', ...)`
  is null, which plpgsql treats as false. So
  `if current_role() not in (...) then raise` skips the guard for exactly the
  callers it exists to stop. Write
  `if not coalesce(current_role() in (...), false) then`, which is the shape
  `is_revenue_staff()` already uses. 0047 fixed `close_business_date()`, which
  mattered most because it is `security definer` and so has no RLS behind it.
  **Seven more of the `not in` shape remain**, in 0003, 0004, 0011 and 0013 on
  the folio and cashier paths. Each appears to fail closed further down, on a
  null `current_property_id()`, but that is luck rather than design — worth
  fixing, and not swept into an unrelated change because it touches money.

**Reports**

- Every report groups by `business_date`. `created_at` and `paid_at` are
  wall-clock and never the axis.
- Read `folio_item_lines`, not `folio_items`, when splitting revenue by type.
  `reverse_charge()` posts its row as `item_type = 'reversal'` rather than the
  type it reverses, and `post_discount()` also sets `reverses_id`, so filtering
  `folio_items.item_type` directly attributes both to the wrong bucket. The
  view untangles them into `effective_item_type`.
- Sum `signed_net_amount_cents` and `signed_tax_amount_cents`, never the
  unsigned columns. They carry the reversal sign the same way
  `signed_amount_cents` does.
- **There are two gates and they raise the same string.**
  `require_money_reports()` covers anything showing money;
  `require_guest_identity_reports()` (0052) covers the immigration and waitlist
  reports, which show passport numbers, dates of birth and guest contact
  details. A cashier may read a folio and has no business reading a travel
  document, so the money test is the wrong one there. Both raise
  `REPORT_ACCESS_DENIED`, because `queries.ts` matches that string to render
  `<ReportNoAccess />` and a second string would be a second branch at both
  ends for an identical outcome. What differs is who passes, not what the
  refusal looks like.
- The revenue and payment reports are gated by `require_money_reports()`, which
  raises `REPORT_ACCESS_DENIED` for housekeeping. `src/lib/queries.ts` turns
  that into a `ReportAccessError` and the page renders `<ReportNoAccess />`.
  The string is matched on, so renaming it means changing both ends.
  **Table RLS is still property isolation only** — the gate is on the report
  entry points, not on `payments`. Narrowing the policy itself is worth doing
  and would touch the cashier screen, so it has not been done here.
- Reservation value is rate less discount over the booked nights, excluding
  tax, so it matches the occupancy report rather than the folio.

**Data access**

- Server Components for reads. Server Actions for writes.
- No API routes except external webhooks **and the read-only public API
  under `/api/public/v1/` (0101)**, which the client asked for. That is the
  whole exception: anything else that looks like it wants a route is a Server
  Action. See the Connectivity -> API Key notes.
- Aggregation happens in Postgres views or RPCs, never in the client.

## Design system — match it, don't invent

Defined in `tailwind.config.ts`. New UI must use these tokens.

- **Chrome** `chrome-900/800/700/600` — dark blue, matching the client's
  reference system. Sidebar and dark fills.
- **Content** `ink`, `ink-muted`, `ink-faint` on `shell` (#F4F7FB) and white cards.
- **Accent** `brass` (#1D6FE0) — ONE accent, used sparingly: active nav marker,
  revenue line, today's marker, key figures. Nothing else gets the accent.
  The token is still named `brass` for historical reasons and no longer
  describes its colour. Renaming it to `accent` is a safe, mechanical change
  and would be an improvement — but only as its own commit.
- **`warn`** (#D97706) carries two statuses that never appear on the same
  object: due-out rooms on the house board, and pending bookings in the
  bookings list. Both were previously on the accent — due-out became
  indistinguishable from the active nav marker, and pending read as pale blue
  next to `confirmed`. Do not "tidy" this by splitting `warn` into two tokens,
  and do not move `pending` back to `brass`. One amber for two unrelated
  object types is deliberate.
- **`warn-deep`** (#92400E) is the text shade. `warn` DEFAULT on `warn-wash` is
  about 3:1, unreadable at the 10.5px `text-xxs` badge size. Use `warn-deep`
  for text on a wash, `warn` DEFAULT for fills and dots.  
- **Status colours stay semantic** — emerald ready, `warn` due out, rose owing,
  slate departed. These carry meaning; don't restyle them decoratively.
- **Type** `font-display` (Archivo) for headings and figures with
  `tracking-tightest`. `font-sans` (Public Sans) for everything else.
- All figures carry the `tnum` class so columns align.
- Cards use `rounded-lg border border-line shadow-card`.

**The calendar is a tape chart, cloned from the client's reference system.**
`src/components/calendar/calendar-board.tsx` — room types down the rail, dates
across the top, one bar per booked room across the nights it covers. The client
showed the Reservation Centric calendar and asked for it by name.

- **ROWS ARE ROOMS, NOT ROOM TYPES. This reverses an earlier decision.** The
  rail used to be one row per room type, on the grounds that a 1,800 room
  property could not draw a row each. The client corrected it directly: "in the
  calendar you should use the room setup because it allows the hotel to see all
  the rooms they have and the guest staying in each room". They are right, and
  it is what every property management system does — a receptionist's first
  question is "who is in 101", which a row aggregated to type cannot answer at
  all. Do not put types back.
  - **This overrides the ~1,800 room rule for this one screen only.**
    `calendar_rooms()` deliberately returns every room. The rule stands
    everywhere else. What makes it safe here is that the row is thin — a
    number, a floor, a type and a status, never the whole room — and rooms are
    grouped under their type, so a very large property reads as a handful of
    headers rather than one endless list.
  - **The type still gets a header row**, because the availability figure at
    the foot of each cell belongs to the type and not to any one room, and it
    is the only thing on this board that answers "can I sell tonight".
  - **The dot on a room row is that room's own housekeeping status**, which is
    more use than a per-type summary: "101 is dirty" is actionable in a way
    that "something in Deluxe is dirty" was not.
- **THERE IS NO DOT ON A ROOM TYPE. This reverses what this file said**, which
  was that the type kept a summary dot as well as the room rows. The client
  asked for it gone twice — first in a voice note, "the housekeeping button
  has to be next to each room. Not the room type", and again in writing: "isme
  room type ke aage nhi ayega vo ... sbhi room number ke aage ayega, jisme hum
  kisi bhi room ka tag lga skte h".
  - **They were right, and it was a real defect rather than a preference.**
    The type dot was never a control — the menu has always been on the room
    rows — but it was drawn exactly like one: same size, same shape, same
    colours, sitting one row above sixty dots that DO open the menu. So the
    board offered a mark that looked pressable and did nothing, which is the
    thing this application keeps refusing to ship. See the user-menu note for
    the last time the client objected to a control that changes nothing.
  - **Nothing is lost.** Every room under the header carries its own status,
    which is the thing the client actually wants to see and act on. The
    aggregate only ever said "something in here needs attention" without
    saying what.
  - **`getRoomStatusByType()` and `room_status_by_type()` still exist and are
    now called by nothing.** They are left in place rather than deleted: the
    RPC would need a migration to drop, and a per-type roll-up is a reasonable
    thing to want again. The calendar makes one fewer read per board for it.
- **The rail's pencil goes to Settings.** Hovering a room type shows an edit
  affordance, as the reference does, linking to
  `/settings?tab=room-types&edit=<id>`, which opens that type's form on
  arrival. It is a way in, not a second editor: renaming still happens in one
  place. It appears on focus as well as hover, because hover alone hides it
  from anyone working by tab.
- **The corner carries a date picker that draws a month.**
  `src/components/calendar/date-jump.tsx`. It was an `<input type="date">`, on
  the grounds that a plain GET form needs no client JavaScript; the client asked
  for a calendar they can see and click, and the native control shows one only
  behind a small icon in an 18px field on a dark rail, which nobody reads as a
  calendar. Picking a day navigates, and "Today" returns to the business date.
  - **THE CORNER MUST NOT READ AS "today is <date>".** The picker's button
    shows where the BOARD STARTS, which since the lookback landed is a week
    BEFORE the business date — so it can never equal the date the top bar
    shows, and the two sat on screen contradicting each other. The client
    circled both: "Business date Sat 19 Sep 2026" above, "12 Sep 2026" in the
    corner.
    - Nothing was wrong with either figure. The fault was typographic: the
      Today control carried the same styling as the "Date" heading above it —
      uppercase, tracked, semibold — so the three stacked lines read as
      "DATE / TODAY / 12 Sep 2026", a heading, a sub-heading and a value.
    - **Today is a chip now**, matching the `+`, `−` and the picker beside it,
      so all four read as things you press rather than captions. Do not style
      it like the "Date" label again.
    - **The picker's label starts with "From"**, so the date on it says which
      of the two dates it is. One word, and it is a control label rather than
      explanatory copy, so the no-prose rule is intact.
    - The popover marks both: the window start in `brass`, the business date in
      rose. Seeing them as two different days in one month grid is the clearest
      statement that they are two different things.
  - It is a client component, so it takes `basePath` and `railW` and builds its
    own href. **A Server Component cannot hand it a `hrefFor` closure** — React
    refuses to serialise a function across that boundary, and the page 500s.
  - `railW` has to be carried or picking a date silently resets the room column.
  - `HEAD_H` is tall enough for three rows — at two the controls shared a line
    and the "−" was pushed off the end of the rail.
- **`+` and `−` size the rail, not the date range.** They widen and narrow the
  blue room column, between `RAIL_MIN_W` and `RAIL_MAX_W`, so a long room type
  name can be read in full without the dates moving underneath it. They were
  first built to change how many days were shown, which the client corrected.
  The width rides in `?rail=`, and every link and the jump form carry it —
  drop it from one of them and going to a date silently resets the column.
  `railW` is a prop rather than a constant because the chevron's offset and the
  season label's sticky `left` are both arithmetic over it.
- **The board keeps the availability figure** at the foot of each cell, because
  that is what this screen used to be and is the only thing on it that answers
  "can I sell tonight". **It is BOLD**, at the client's request — "ye jo 60 60
  dekh rhe ho likha hua hai, inko bold krna hai". It used to be faint and
  unweighted, to keep it from competing with the bars, which made the one
  figure that answers the board's own question the hardest thing on it to read.
  The weight is the same on all three states now and only the COLOUR carries
  meaning: rose oversold, amber none left, ordinary ink otherwise. It sits in a reserved strip rather than behind
  the bars: overlaid, it vanished under every booking, and cells without one
  still showed a number, so the row read as half broken.
- **Bars carry booking status on their edge** — amber pending, blue confirmed,
  green in house, grey departed — where the reference's are uniform. The
  information was already there.
  - **The status is also a word on the bar, as of 0056.** The edge colour had
    been the only encoding, and the legend that explained it was deleted at the
    client's request — so blue-means-confirmed became something a receptionist
    either already knew or did not. `STATUS_LABEL` gives it in front-desk words
    ("In house", "Departed"), coloured to match the edge. The colour stays:
    scanning forty bars for a colour is faster than reading them.
- **A bar says which rate the room was sold on** (0056). `rate_plan_name` comes
  off `booking_rooms.rate_plan_id`, which 0037 added and which every row on the
  hosted property carries. **No column was added for this** — the board's read
  simply never returned it. It is null for a stay taken before 0037, and the
  bar then draws nothing rather than guessing a plan, the same way the Rate
  plan report counts those nights under "Not recorded".
- **The bottom line of a bar sheds detail by the bar's own width**, and that
  width is known exactly: it is `(endIdx - startIdx)` columns, the same
  arithmetic that positions the bar. Measured, not guessed — a one-night bar
  leaves 100px inside its border, the value badge takes 56 and "Confirmed"
  wants 52. So the rate goes below three columns and the party size below two,
  and on a one-night bar the status word goes too. **The value never goes**,
  because it is the one figure on the bar with no second encoding; the status
  keeps its edge colour and its tooltip. Truncating instead would have given
  "Confi…", which is worse than showing less.
- **`board` in `tailwind.config.ts` is the grid surface, and it is cool.** The
  first look at the reference was a photo of a monitor whose warm cast made the
  grid read as cream; it was built that way and it was wrong. The clean
  screenshots show near-white cells, blue-grey rules and a slate season band.
  The rail uses `chrome`, so the board's left column matches this app's own nav
  rather than introducing a third blue.
- **Today's marker on this board is rose, not the accent.** Everywhere else
  `brass` marks today. The reference circles it in red and the client asked for
  the board exactly, so this one screen differs. It is a date marker, not a
  status, so it does not collide with rose meaning "owing".
- **Column width is fixed; the card is `w-full`.** These are two different
  elements and the distinction matters. Bars are positioned by arithmetic over
  `COL_W`, so the GRID's width is fixed and columns must never stretch to fill
  — that would put every bar in the wrong place. The CARD around it fills the
  page. It used to be `w-fit`, which left a band of empty page beside the board
  whenever the dates did not happen to fill the screen, and the client asked for
  that space back.
- **One scroller, and everything freezes against it with `sticky`.** The board
  is a single element that scrolls both ways: the date header and the season
  band hold their place down the page, the room-type rail holds its place
  across, and the corner holds both. Two panes syncing their scroll positions
  is the other way to build this and it drifts by a pixel on a trackpad; one
  scroller cannot drift from itself. The sticky offsets are arithmetic over
  `HEAD_H` and `SEASON_H`, so those two must be exactly as tall as declared —
  padding them by eye opens a gap where rows show through.
- **A day on the board can carry an operational note** (0058).
  `calendar_notes` is a new table: one property, one day, one note. The client
  asked for their reference's "Add Note" action — a dialog with the date, a
  field, Cancel and Save, and the note visible on the board afterwards.
  - **NONE of the existing note columns could be reused, and that was checked
    before the table was written.** `bookings.guest_notes` and
    `internal_notes` belong to a stay, `booking_waitlist.notes` to an enquiry,
    `cashier_shifts.opening_notes`/`closing_notes` to a drawer,
    `meeting_room_bookings.comments` to one meeting room booking. The
    `activity_log` is deliberately not used either: it records what the system
    did, it is not somewhere a person writes.
  - **`note_date` IS NOT `business_date` and does not reference
    `business_dates`.** That table holds the days the audit has opened or
    closed; the board shows weeks beyond it, and the point of a day note is to
    write it down BEFORE the day arrives. Keying to `business_dates` would make
    next Tuesday un-noteable and tie note-keeping to the audit. Nothing in 0058
    reads, writes or constrains `business_dates`.
  - **Several notes per day are allowed.** No unique constraint on (property,
    date): two things can happen on one day, and one textarea means the second
    person to write overwrites the first.
  - **The board shows a marker and a count, never the words.** A column is
    118px and an operational note is a sentence. The note is read in the
    dialog, which opens from `?note=<date>` — URL state, like the booking
    dialog, so a reload keeps it open and the back button closes it.
  - **The month in the date header is in CAPITALS**, at the client's request.
  - **The marker is a PENCIL IN A BOX, matching the reference**, which the
    client circled in a screenshot. It is deliberately a different mark from
    the speech bubble on a bar: a bubble on a BAR means "this booking carries
    a note about the guest", a pencil in the DATE HEADER means "write a note
    about this day". Drawing both as a bubble made the board say one word for
    two things. It is revealed on hover, as theirs is, and goes solid with a
    count once the day has a note.
  - Reading is anyone on the property, writing is `is_front_office_staff()`,
    both enforced by the RLS policy rather than by a second copy of the rule
    inside the RPCs — which is why they are `security invoker`.
  - **A note is genuinely deleted**, like a season. Nothing points at one and
    it is not a record of money or of a stay.
- **The season band is real, and a season changes no price.** 0044 added
  `seasons`: a named date range per property, managed in Settings. It labels
  the calendar and nothing else — rates stay in `rate_plan_days`, because a
  season that quietly moved rates would be a second price list nobody could
  see. Seasons cannot overlap (an exclusion constraint, since two bands over
  one date has no sensible drawing) and the last day is included.
  - A season is genuinely deleted, unlike a room, a room type or a payment
    method. Nothing points at one, so removing it loses no history.
  - **SEASONS AND EVENTS ARE THE REFERENCE'S MODEL AS OF 0095.** A season or
    event is a NAME AND A COLOUR (`season_types`, kind `season | event`) that
    owns several date ranges (`seasons`, now pointing at its type and carrying
    its kind). Settings -> Seasons and Events (`seasons-panel.tsx`) draws the
    year as twelve month grids, each day in its season's colour with an
    event underlined in its own, and lists Seasons, Default Season and Events
    with + (add dates), edit (name, colour) and delete, per season and per
    range.
    - **The no-overlap constraint now applies to seasons only**
      (`where kind = 'season'`): a day is in one season, which is what this
      band and the Default Season need. Events may overlap anything.
      `calendar_seasons()` returns seasons and, as of 0113, events, each with
      its colour and `kind`; a season fills the band (`inkOn()` picks the text
      colour).
    - **EVENTS ARE ON THE PMS CALENDAR AS OF 0113**, at the client's request
      that a season or event be visible over its dates. They never share the
      season strip: each event is a `EVENT_H` lane under it, in its own colour
      with its name sticky at the left edge, packed greedily so events on
      different dates share a lane and the band only grows when events really
      overlap. The rail says "Events" beside the lanes. The band's height is
      `SEASON_H` plus the lanes -- nothing else is offset against it, and the
      chevrons stay on the season strip. "Show seasons in calendar" covers
      both.
    - **A RANGE'S DATES ARE EDITED IN PLACE (0113)**: a pencil on each range
      opens the same From/To dialog as "+", and `update_season_range()` moves
      it with `add_season_range()`'s checks -- the overlap test not counting
      the range itself -- and applies the season's saved week rates to the
      new dates. Nights the range no longer covers keep their prices, exactly
      as deleting a range leaves them.
    - **The Default Season is not a row**: every day no season covers,
      computed in the panel from the first season year to the last.
    - `add_season_range()` names the season an overlap hits rather than
      letting the constraint's raw text through. A new season is its type and
      its first range; if the range is refused the type is taken back.
    - The kind is fixed once made -- turning a season into an event would
      lift the no-overlap rule from ranges already checked against it.
    - **AN EVENT CAN BE PRICED, AS OF 0114**, like a season: a week of rates
      per plan and room type (`save_week_rates()` takes its id), written onto
      the event's own ranges, always replacing. **An event wins its nights**:
      a season or the Default Season saved later leaves out every night
      covered by an event priced for the same plan and room type, so
      re-saving a season can never put the season's price back under an
      event. An event with no week for that pairing wins nothing. Adding or
      moving an event's range re-applies its week, as for a season. The
      Seasons screen's price tag is on events too. Nights an event range
      stops covering keep the event's price until something re-saves them --
      the same rule as a season's.
  - The band's label is `sticky` inside its segment so it rides the left edge
    of what is on screen. Do not put `overflow-hidden` on that segment: it
    becomes the sticky containing block and pins the label, which is the bug
    the sticky is there to avoid.
- **Paging sits outside the scroller.** The chevrons are absolutely positioned
  on the card, over the band. Inside the scroller they scrolled away with the
  dates, so once you had moved right there was no way to page back.
- **Bars carry guests and value**, like the reference's. The value is the room
  line's own nights — rate less discount plus tax — not the folio: most of
  those nights have not been charged yet and a future stay would show nothing.
- **THE HOLDING AREA IS GONE. UNASSIGNED IS BOTH. This reverses an earlier
  decision, at the client's direction:** "unassigned bhi holding ke liye hi hai
  ... to holding area vala remove krdo". One standing row is left under the
  room types — Cancelled — and it still draws through `ExtraRow`.
  - The two bands used to be separate: Holding held every `pending` booking,
    Unassigned held the confirmed ones with no room yet, on the argument that
    "nobody has confirmed this" and "confirmed, but no room" are different
    facts. They ARE different facts, but they are both "this booking is being
    held and occupies no room", which is the one thing the band tells a
    receptionist. The client judged one band enough. **Do not split them
    again.**
  - **The Unassigned band carries "(Holding area)" under its label**, so
    somebody moving between the two systems finds the reference's word where
    they expect it.
  - **Nothing is lost from the bar**: a pending booking still draws its amber
    edge and still says "Pending" in words, so it stays distinguishable from a
    confirmed one beside it. `calendar/page.tsx` no longer filters pending out
    — every bar takes the ordinary split, onto its room or into its type's
    Unassigned band.
  - **Cancelled** never goes among the live rows. `calendar_bookings()`
    returns those only when asked.
  - **THE CANCELLED BAND IS PINNED TO THE FOOT OF THE SCROLLER when it holds
    anything.** It sits below every room row, which is fine at four rooms and
    useless at 120: the client cancelled a booking and reported that it was
    not going into Cancelled at all. It was — a hundred and twenty rows down,
    past every room in the hotel. `calendar_bookings(..., true)` was returning
    all three cancelled bookings correctly, which was checked against the
    hosted database before anything was changed.
    - Sticky rather than moved to the top: the band belongs under the rooms,
      and pinning keeps its place in the document while putting it where
      somebody can see it.
    - **Only when it has bars.** An empty band pinned across the foot would
      cost a row of height to say nothing.
    - It is rendered AFTER the filler element, because `sticky bottom-0` has
      nothing to stick against while a flex-grow sibling sits below it.
    - **ONLY ITS FIRST LANE IS PINNED; MORE CANCELLATIONS GO DOWN, NOT UP.**
      Pinned whole, every extra lane raised the band and covered another
      room row. The client: "when we don't have cancellation we can see five
      rooms, when we have cancellation four ... six cancellations and we end
      up seeing one room. The cancellation have to go down, not up." Lane one
      is `sticky bottom-0`; the other lanes follow it in the flow, below,
      where the board scrolls down to them. The rail shows the count. Do not
      pin the whole band again.
    - Its grid cells are `relative z-0`: the Restore control is `z-20`, and
      without its own stacking context it drew over the rail's `z-10` when a
      cancelled bar scrolled left -- the same trap as the top nav and the
      room menu.
- **"Unassigned" is a third band, and it is not Holding.** Holding is "nobody
  has confirmed this booking". Unassigned is "confirmed, but no room picked
  yet" — which is every booking between being taken and being checked in,
  since no room is allocated when a booking is made. Collapsing the two would
  tell a receptionist a confirmed stay was still unconfirmed. Each room type
  gets its own Unassigned band, kept at full height when empty so the board
  does not jump as rooms are allocated through the day.
  - A bar with no room is drawn there rather than guessed onto a room. A bar
    sitting on 101 that nobody put in 101 reads as settled when it is not.
- **A booking is put in a room from the board**, through
  `src/components/calendar/assign-room.tsx` — `+` on an unassigned bar, `⇄` on
  an assigned one to move it or take it out. Holding and Cancelled bars carry
  no control: an unconfirmed or cancelled booking holds nothing, so offering it
  a room would be a promise the hotel has not made.
  - **The picker offers every room of the type, not a filtered "free" list.**
    Filtering in the browser is a promise it cannot keep — the list is a
    snapshot and the room can go between page load and click. `assign_room()`
    does the real check inside the transaction and refuses by name, which is a
    better answer than a room quietly missing with no explanation.
  - **The control that takes a booking out of a room reads "Cancel the room"**,
    which is the client's wording, not "Take out of the room".
  - **A CANCELLED BOOKING CAN BE RESTORED** (0061), from the Cancelled band and
    from the booking screen. `restore_booking()` is the exact reverse of
    `cancel_booking()` — the booking, its rooms and their nights go back to
    `confirmed` — plus the one thing the reversal makes necessary.
    - **It re-checks availability, because cancelling freed the rooms.**
      Between the cancellation and the restore somebody may have sold those
      nights, so it refuses with `HP001` rather than overselling silently, and
      the override is a deliberate second ask, exactly like taking a booking
      that would oversell.
    - **Back to `confirmed`, not to whatever it was.** `cancel_booking()`
      overwrote the old status, so restoring a `pending` booking as `pending`
      would be a guess. Staff pressing Restore are saying the hotel intends to
      honour the stay.
    - **`room_id` stays null** — the old room may be occupied now, so
      `assign_room()` does the placing with its overlap check. The booking
      lands in its type's Unassigned band.
    - **The folio is not touched.** A cancellation or no-show fee stands until
      somebody reverses it deliberately; `folio_items` is append-only and a
      Restore button is not the place to decide about money.
    - Nothing is logged by hand: `bookings_log_activity_after_status_change`
      already writes it, and a second insert would put two rows on the trail
      for one act.
  - **THE HOUSEKEEPING DOT IS A CONTROL** (`room-status-menu.tsx`), as the
    reference's is: clicking it sets that room's status from the board, which
    is where somebody already is when they learn a room has been cleaned.
    - **ALL FIVE OF THE REFERENCE'S ARE BUILT, as of 0062.** This note used to
      say three were and the other two were raised rather than half-built.
      The schema decision they were waiting on has been made, and it is the
      one the old note argued for: Inspected and Do not disturb are BOOLEAN
      COLUMNS ON `rooms`, not two more values of `room_status`.
      - `room_status` is what decides whether a room can be sold, so neither
        could go in it. **Inspected is a second fact about a room that is
        already CLEAN** — as a status, every `= 'vacant_clean'` test would stop
        matching it, including the readiness check inside `assign_room()`, so
        signing a room off would have made it unassignable. **Do not disturb
        belongs to an OCCUPIED room** and is the guest's request rather than a
        state of cleanliness.
      - `set_room_housekeeping()` takes a `housekeeping_choice`
        (`inspected | clean | dirty | broken`) and writes the status and the
        flag together, so the two cannot disagree: inspected is
        `vacant_clean` + `is_inspected`, and clean, dirty or broken clears it.
        `set_room_do_not_disturb()` is its own function and Postgres refuses it
        on a room with nobody in it.
      - **`set_room_status()` still exists and is unchanged.** The
        housekeeping report and check-in and check-out call it; nothing was
        broken to add a second, richer way in.
    - **THE CLIENT ON WHAT THIS DOT IS FOR:** "The housekeeping, does not
      affect availability. It's there for the hotel reception and housekeeping
      staff to use ... If the 101 is showing as dirty, the receptionist knows
      that the room is not ready and will offer a room that's is shown ready in
      the system." That is true of four of the five, and the fourth is the
      exception worth knowing: **Broken is `ooo`, which DOES reduce what the
      hotel can sell** — and should, since a broken room cannot take a guest.
      The menu does NOT say so on the item — it used to, and the client had
      that removed with the rest of the copy — so Broken reads like the other
      three and its effect is something the board's own figures show. Clean,
      Dirty, Inspected and Do not disturb move no availability number
      anywhere.
    - **Both flags show on the rail dot**, or setting one would have no visible
      result and the menu would read as broken. Inspected is a deeper green
      than merely clean — the same two greens the menu uses, so the board and
      the menu cannot say different things — and Do not disturb takes amber on
      an occupied room.
    - **THE MENU IS PORTALLED TO `document.body`, AND IT HAS TO BE.** Each
      room row's rail cell is `sticky left-0 z-10` — a positioned element with
      a z-index, which creates a STACKING CONTEXT. So a `z-50` on a menu
      inside room 103's cell only ranks it against room 103's own contents;
      rows 104, 105 and the rest are later siblings at the same `z-10` and
      paint straight over it. The client saw a menu with only its first item
      visible and everything below it buried under the room numbers.
      - **This is the same trap the top nav documents**, and the third time it
        has bitten this board. Raising the number does not help, because the
        competition is between the ROWS and not inside them.
      - A portal leaves the stacking contexts behind, so the menu is placed by
        measuring the dot rather than by `absolute`. It clamps to the viewport
        both ways — the rail is on the left of a phone, so it opens to the
        right and flips only when there is no room, and a dot near the foot of
        a long list would otherwise hang off the bottom.
      - **It closes on scroll.** The board is a scroller and the menu is fixed
        to the viewport, so the two come apart the moment anything moves;
        re-measuring every frame would have the menu chasing the dot across
        the screen, which is worse than it going away.
      - `AssignRoom` is NOT affected and needs no portal: its dropdown sits in
        the grid, whose row wrappers are `relative` with no z-index, so they
        are not stacking contexts and its `z-50` still wins.
    - **THE MENU OFFERS ONLY WHAT THE ROOM ALLOWS, and explains nothing about
      the rest.** A vacant room gets the four cleaning states; an occupied
      room gets Inspected, Clean, Dirty and Do not disturb (0108). Broken is
      the one it never gets: it is `ooo`, and a room with a guest in it
      cannot go out of order until the guest is moved or checked out.
      - **THE OCCUPIED OPTIONS ARE 0108, at the client's request** -- their
        screenshot showed room 104's menu holding Do not disturb alone, where
        the reference offers the cleaning states on an occupied room too.
        That is the stay-over clean: a guest in 104 wants the room made up,
        and housekeeping wants to say it has been.
      - **`room_status` cannot carry it**, because `occupied` already means
        "a guest is in it" and says nothing about cleanliness. So an occupied
        room's Dirty is a FLAG, `rooms.service_due`, beside `is_inspected`
        and `do_not_disturb`: Dirty sets it, Clean clears both, Inspected sets
        `is_inspected`. The status stays `occupied` throughout, so nothing
        about availability or the house count moves.
      - **The trigger `rooms_housekeeping_flags_follow_status` clears the
        flags on any status change** -- `service_due` always, `is_inspected`
        unless the room becomes `vacant_clean`, `do_not_disturb` unless it is
        `occupied`. Without it a room checked out while flagged would carry
        "needs its stay-over clean" into the next guest's stay.
      - The rail dot shows it: rose for occupied and waiting for its clean,
        the inspected ring for occupied and signed off, amber for Do not
        disturb, which wins over both.
      - It used to show all five always, greying out whatever the room's state
        forbade and printing a sentence underneath saying why — "Occupied —
        check the guest out before changing its state", "Do not disturb needs
        a guest in the room". The client struck both out: "there's no need as
        client have said earlier also."
      - **They were right on both counts.** The sentences are exactly the
        explanatory copy the rules forbid, and the greyed rows were disabled
        controls, which this application does not have — see the user-menu
        note, where the client objected to one and was right then too. **A
        control that is not offered needs no explanation.**
      - **"Takes it off sale" under Broken went too.** It was kept for one
        round as the permitted clause on a control whose consequence is not
        obvious — the exception the overbook tickbox holds — and the client
        asked for it gone with the rest. `CHOICES` now has **no `note` field
        at all**, so putting a sub-label back is a deliberate act rather than
        an easy one. The menu is four labels and a coloured dot.
      - Postgres enforces the same split either way, so hiding a row is a
        courtesy and never the only thing standing between a bad write and the
        database.
    - **Occupied is not offered in either direction**, as before: a guest being
      in the room is what puts it there. The occupied room's Clean and Dirty
      are the flags above, never a move off `occupied`.
  - **A GUEST CAN BE UPGRADED INTO ANOTHER ROOM TYPE** (0062). The client:
    "when a room is in the holding area, whe can only move it to the same room
    type. But hotels do offer upgrades. Let's say someone booked a Double Room
    but when he arrive at the property they changed their mind and decide to
    upgrade to the Suite. The way the system is build now, the hotel cannot
    upgrade the guest room in the system." They were right — `assign_room()`
    refused a room of any other type outright.
    - **It is a deliberate second act, never a misclick.** A cross-type room is
      still refused, now with `HP003` and a message naming what the booking was
      sold, and `p_allow_type_change` is what overrides it. Same shape as
      `p_allow_overbook` on a new booking and on a restore: the first click
      attempts, Postgres refuses, and the interface offers the override with
      the refusal's own words on it. The picker does not decide this — the
      board's room list is a snapshot, and the server is the authority on what
      type a room actually is.
    - **The sold type and the nightly rates are NEVER rewritten.**
      `booking_rooms.room_type_id` and `booking_room_nights.room_rate_cents`
      stay exactly as sold, so an upgrade is the same money in a better room —
      which is what an upgrade is. Rewriting the type would restate the
      reservation's value and move revenue between room types after the fact.
    - **AVAILABILITY COUNTS THE ROOM THE GUEST IS ACTUALLY IN, and that change
      is what makes the upgrade safe.** Every availability read counted a
      booked night against the type it was SOLD. Put a Double booking in a
      Suite under that rule and the Suite still reads as free while the Double
      reads as sold — phantom availability on the room that is genuinely
      occupied. The `sold` CTE in `calendar_availability()`,
      `bookable_room_types()`, `public_room_types()` and `inventory_grid()`
      now counts `coalesce(the assigned room's type, the sold type)`, so an
      unassigned booking still counts against what it was sold and an assigned
      one counts against where the guest is.
      - It is a no-op on every row that has never been upgraded, which was
        confirmed against the hosted property rather than assumed: zero of the
        assigned `booking_rooms` had a room whose type differed from the sold
        type when 0062 was applied.
      - The overlap check is untouched, so an upgraded room cannot be sold to
        somebody else either — tested.
  - **A GUEST STILL CHECKED IN AFTER THEIR DEPARTURE IS SHOWN, NOT HIDDEN
    (0111).** The client reported rooms 101-108 "empty" and the picker
    refusing them as occupied. They were occupied: ten bookings were still
    checked in days past departure, and nobody had checked them out. A bar
    ended on its departure date, so the room read as empty from then on.
    - The calendar page moves an overdue in-house bar's end to the day after
      the business date and sets `dueOut`; the bar says "Overdue" in rose and
      its tooltip the real departure. `calendar_room_bars()` returns a
      checked-in line however far back its departure, or one more than the
      lookback overdue would vanish.
    - `assign_room()` names who is in an occupied room: "Room 101 still has
      Juan Test (BK-000005) checked in, due out 23 Sep 2026. Check them out
      first."
    - `dashboard_departures()` on the business date also lists every guest
      still checked in whose departure has passed, so the dashboard is where
      they are found and checked out.
    - **An occupied room's rail dot keeps the occupied fill**; its cleaning
      state is a RING (emerald inspected, rose needs cleaning). Drawn solid, an
      occupied room signed off looked exactly like a vacant one ready to sell.
    - **Nothing checks a guest out automatically, and the audit still closes**
      -- whether a guest left is the desk's call (open decision 11). Worth
      knowing: availability counts nights, so an overdue guest's room is
      counted free for tonight until they are checked out.
    - **"Close the day" WARNS about them** (`close-day.tsx`, fed by the
      dashboard's departures): every guest still checked in whose departure is
      the business date or earlier, the first five named with a link to the
      booking, and one clause -- tonight is not charged to them unless the
      stay is extended, which is true because the audit charges only nights
      dated the day being closed and they have none. A warning and not a
      refusal: a guest leaving late is ordinary, and the client asked for the
      audit to make no decisions about guests. One row per BOOKING, so a group
      counts once.
  - **`assign_room()` only demands a clean room for a stay that has already
    started** (0053). It used to demand `vacant_clean` always, which was right
    while check-in was the only caller and wrong the moment the front desk
    started placing future bookings: a room occupied tonight is a perfectly
    good room for next March. The overlap check is what protects the guest and
    is unchanged.
    - **An inspected room is still `vacant_clean`**, so signing a room off does
      not make it unassignable. That is the whole reason Inspected is a flag.
  - **The picker opens on the sold type and keeps the others collapsed.** Most
    of the time the guest goes in the room they bought, and a list that opens
    on every room of every type makes the ordinary job harder to do the common
    way round. The board builds that grouped room list ONCE and hands the same
    array to every bar, so the rooms cross the server boundary once rather than
    once per booking — built per bar, a full house on a large property would
    ship the room list forty times over.
  - **The control is a sibling of the bar, not a child of it.** A `<button>`
    inside an `<a>` is invalid HTML and browsers rearrange it during parsing,
    so it vanished; and `Bars` is a Server Component, so the wrapper meant to
    stop the click carried an `onClick` React cannot serialise and the page
    500'd. As a sibling it needs neither. **That is the third time this
    boundary has bitten** — after the calendar's `hrefFor` closure and the
    search button's `onSearchClick`.
- **There is no page heading on the calendar.** The client: "eliminate the
  written calendar it does not make sense to have it there". The reference's
  board starts immediately under the nav, and an `<h1>` reading "Calendar" on
  the Calendar screen — with Calendar already marked active in the bar above
  it — says the same thing a third time while costing the board a row of
  height. `MAX_H` went from `calc(100vh - 200px)` to `calc(100vh - 150px)` to
  take that height back. Do not put the heading back.
- **The board fills the window, and the rail runs to the bottom.** The scroller
  takes a `height` of `calc(100vh - 200px)`, not a `max-height`, and a filler
  element under the last row takes the slack so the rail and the grid surface
  reach the foot of the card. Content-sized, the board stopped mid-screen
  against flat white and read as though it had failed to load. The card is
  `w-full`; only the grid inside it keeps the fixed `COL_W` geometry the bars
  are positioned against.
- **There is no explanatory copy under the board.** A legend and two paragraphs
  were there; the client read them as leftover prompt text and asked for them
  gone. The reference has none. What mattered survives in place — the rail says
  "2 of 9" where a type is capped, and the dot has its tooltip.
- **The board LOADS a week before the business date and OPENS ON it.** Those
  are two different things and treating them as one was a bug the client hit
  twice.
  - The load range is the lookback. The client: "in the calendar I want the
    hotels to be able to see past dates too". Nothing had ever stopped a past
    date being shown — the chevrons and the date picker go anywhere, and past
    nights are already shaded `board-past` — but the default window put today
    hard against the left edge, so looking back meant paging a whole month and
    hunting. `CALENDAR_LOOKBACK` is 7 and `CALENDAR_NIGHTS` went from 30 to 35
    with it, so the four weeks of forward view are still there.
  - **The opening scroll position is the business date**, set by
    `OpenOnToday` in `open-on-today.tsx`. The board used to open on the first
    column it had loaded, which is a separate decision and one nobody asked
    for. On a desk monitor it was survivable — eight or nine columns fit, so
    today was on screen, just not at the left. **On a phone exactly one column
    fits**, so the client opened the calendar, saw 12 September, and read it
    against a top bar saying "Business date Sat 19 Sep 2026". The figure that
    mattered was seven columns off the edge with nothing to say so.
  - The week of history is one swipe LEFT, which is where a tape chart keeps
    the past. Nothing was removed to fix this.
  - **It scrolls only on arrival**, never after somebody has moved the board:
    the component remounts on every navigation the board makes, and forcing
    the offset back each time would drag the grid out from under a reader. A
    `scrollLeft` already above zero means hands off.
  - **The offset is `dates.indexOf(businessDate)`, not arithmetic over the
    lookback constant.** Paging and the date picker both move the window, and
    on those the business date is usually not in it at all — `indexOf` then
    returns -1, the offset is 0, and the board stays where the URL put it,
    which is the whole point of the URL being the state.
  - **The corner names the column you land on**, so `DateJump` is handed that
    same date rather than `dates[0]`. Naming a column seven to the left of the
    first one on screen is true of the data range and useless to the reader.
  - `OpenOnToday` takes the scroller's **id**, not a ref: it is a client
    component and the board is a Server Component, so a ref cannot cross that
    boundary. Same wall as the date picker's `hrefFor` and the search button's
    `onSearchClick`. A string crosses it.
  - **Both "Today" controls return to the same place** — the rail's chip and
    the date picker's button. They go to the default window, which now opens
    scrolled to the business date, so the two land identically. Two Todays
    landing in different places reads as a bug.
  - **A cell in the past is not a link.** `create_booking()` refuses an
    arrival before the business date, so a booking link there opened a dialog
    the server then threw away.
- **A gutter separates the room types from Holding and Cancelled.** The client
  asked for "a small space between the rooms, Holding Area and Cancelled
  area", pointing at the reference, where those two bands sit below a plain
  gap. It is doing real work: they are not rooms, and butted against the last
  room row the eye reads "Holding area" as one more room in the last type. The
  gutter spans the rail as well as the grid — breaking the dates while the
  blue column ran straight past would look like a rendering fault.
- **The window is a fixed month and the URL carries no `days`.** It used to:
  the + and − controls moved the date span before they were corrected to size
  the rail. Anybody who pressed "−" while they were wired that way got `days=7`
  stuck in their URL, every link threaded it onward, and once + and − meant
  something else there was no way back — the calendar showed a week for ever.
  `CALENDAR_NIGHTS` in `src/lib/queries.ts` is the one place it is set. A
  setting with no control is worse than no setting, so if the span becomes
  adjustable again it needs its own control, not the rail's.
- **+ and − size the rail, not the dates.** `railW` is a URL param and a prop
  rather than component state because the chevron offset and the season label's
  sticky `left` are arithmetic over it. `clampRail()` bounds it.
- **Clicking an empty cell opens the booking form over the board**, as the
  reference's "Create Booking" panel does. `src/components/calendar/booking-dialog.tsx`
  is the frame; what it wraps is the same `NewBookingForm` that `/bookings/new`
  renders, handed to it as children from the server.
  - **The dialog is a frame and never a form.** Taking a booking goes through
    `create_booking()` and nothing else, and a second, smaller form would be
    another thing to keep in step with it — the per-night rate lookup, the two
    override flags, promotion resolution. The one that does less is the one a
    receptionist would reach for. So the dialog moves where the form is shown
    and changes nothing about what it does.
  - **Open state is the URL** — `?book=<date>&type=<id>` on `/calendar` — not
    React state, so the server renders the form already filled in for the night
    clicked, and the back button closes it.
  - **`NewBookingForm` NEEDS A `key` ON THE NIGHT AND THE ROOM TYPE.** It seeds
    check-in and check-out with `useState(arrival)`, which runs once per mount.
    Clicking a second cell changes only `?book=`, so React reconciles the same
    instance at the same position and the state never re-seeds — the form went
    on showing the FIRST night it was opened with, while the dialog's subtitle
    (a prop rendered directly) updated. The header said one date, the field
    said another, and **the field is what gets submitted**, so the booking was
    taken on the wrong night. The client: "Date ko fix kro vrna ye by default
    mein jo date dikha rha hai vhi date confirmed krne pr or hold krne pr
    dikha rha hai." The key remounts the form and re-seeds the dates and the
    prefilled line together; syncing in an effect would be one per field and
    would fight anything already typed.
  - The date is validated server-side and ignored if it falls before the
    business date. A URL is not a form and cannot be trusted to have come from
    the board. A role that cannot book gets the same refusal `/bookings/new`
    gives, in the dialog, rather than a form Postgres will reject.
  - `/bookings/new?check_in=&room_type=` still works, for a deep link and for
    anyone who wants the full page.
  - The prefilled line's React key is the fixed string `"from-calendar"`; a
    generated id there is a hydration mismatch.
  - **The stay band is dark**, matching the reference's Create Booking panel,
    which puts the dates on a charcoal band and everything else on white.
    `labelDark` and `fieldDark` in `new-booking-form.tsx` carry it, and the
    inputs take `[color-scheme:dark]` so the native date picker's own icon is
    light rather than a black square on a dark field. **It is one component**,
    so the dark band appears wherever the form does — the calendar's dialog and
    `/bookings/new` alike. That is the point of there being one form.
  - **The room lines are NOT on the dark band, and use `field`, not
    `fieldDark`.** They sit on the white card under it, and in `fieldDark`
    -- white text on a near-transparent fill -- they were white on white: the
    client sent a screenshot of ROOMS / RATE A NIGHT / ADULTS / CHILDREN with
    nothing visible beneath them. Only the Stay band takes the dark styles.
  - **Focus goes to the first field, not the first focusable element.**
    `querySelector` returns document order and the close button is first in the
    markup, so one selector put the cursor on "close" — where a habitual space
    or enter throws the form away.
- **A bar carries a speech bubble when the booking has a note**, as the
  reference's do. `calendar_bookings()` returns `has_notes` over the
  `guest_notes` and `internal_notes` columns `bookings` has held since 0002 —
  a flag and not the note, because a board draws forty of these and the booking
  screen is where a note is read.
- **The "Holding Area" row is cloned, and it holds `pending` bookings.** It
  waited for an answer rather than being guessed at, because nothing in this
  schema obviously matched it and putting bookings somewhere arbitrary would
  have been worse than leaving the row out. The client settled it: it holds
  what nobody has confirmed. See the "Two standing rows" note above for how it
  is built.

**The house board, not a room rack.** The dashboard shows house state as a
segmented status bar plus a clickable legend, with an on-demand room list
behind a "View rooms" toggle —
`src/components/dashboard/house-board.tsx`. It replaced a key-board grid that
rendered one tile per room. That grid was the nicest thing on the page at 40
rooms and unusable at 1,800, which is the scale the client actually operates
at. **Do not reintroduce a grid of one tile per room**, on the dashboard or
anywhere else. Collapsed height must stay constant regardless of room count.

**The dashboard shows where the business comes from** (0108 round). The
client: "Need to add Booking Channel in the Dashboard".
- **Booking channels** (`src/components/dashboard/channel-mix.tsx`) is a card
  in the right column: one row per channel over the next 28 nights from the
  business date -- the same nights the pace chart forecasts -- with its
  bookings, room nights, value and a bar for its share of room nights. It is
  `channel_report()`, the Channel report's own read, so the card and the
  report cannot disagree; the card links to the report over the same dates.
  No new function and no new aggregation.
- **Each arrival and departure carries its channel as a chip**, where it
  used to be the last clause of the grey line under the name. The Arrivals
  and Departures tabs are translated now; they printed the raw English keys.

## Naming

- `staff_users` = people who log in. `customers` = guests and companies.
  Never use "profile" for either.
- Booking status: `pending | confirmed | checked_in | checked_out | canceled | no_show`
- Room status in DB: `vacant_clean | vacant_dirty | occupied | ooo`
  (the dashboard derives `due_out` and `arriving` on top of these)

## Domain notes

- "Inventory" means rates, availability and stay restrictions (min stay, max
  stay, CTA, CTD, stop sell, close out). Not physical stock or supplies.
- Booking sources include OTAs and wholesalers. `channels.kind` is
  `direct | ota | wholesaler | gds | offline`; `bookings.settlement` is
  `at_property | prepaid_to_channel | virtual_card`. Prepaid bookings must
  never appear as cash owed at the front desk.
- `payment_methods.affects_drawer` decides whether a payment hits physical
  cash. Cash true; card, UPI, bank transfer, OTA prepaid false. It follows from
  the kind by check constraint and is never set independently — see the
  settings notes below.
- `booking_room_nights` holds one row per room per night at that night's rate.
  Occupancy, ADR, RevPAR and the revenue chart all derive from it with a
  GROUP BY. Generate these rows on booking create and modify.
- **The rate model is three tables.** `rate_plans` is what the hotel sells
  (Best Available, Corporate), changed rarely. `rate_plan_days` holds the price
  and the stay rules for one plan, one room type, one night — changed
  constantly, in bulk. `room_type_days` holds an allotment cap and a close-out
  for the room type itself, independent of any plan, because closing a room
  type has to close every rate on it.
- **Rate and restrictions share `rate_plan_days` on purpose.** They share a key
  exactly — plan, type, night — and every screen reads the same grid. Two
  tables would mean two upserts and two joins to show one cell.
- **Null means "no rule" everywhere in the inventory.** That is what lets a
  screen clear a restriction by writing null instead of needing a delete path,
  and it keeps "min stay of one" distinct from "no min stay". A null
  `rate_cents` means no rate is loaded, which is not the same as free: a
  booking against it is refused.
- **The Inventory menu is eleven items, matching the reference.** Nine of them
  are one grid with a different column brought forward: `inventory_grid()`
  reads it, `src/components/inventory/` renders it, and `SCREENS` in
  `field-spec.ts` says what each one shows and sets. Do not build a tenth
  editing screen by copying a ninth.
  - **"All" is the tenth entry and edits nothing.** `inventory-all.tsx` draws
    every field at once, a block of rows per room type, over the same
    `inventory_grid()` read — there was nothing to add in Postgres, only a way
    to look at it. It answers "why will this date not sell", which no
    single-field screen can, because the reason is usually on a different
    screen from the one you are looking at. Cells that are actively stopping a
    sale are shaded rose. **It stays read-only**: editing any field from here
    would need either a tenth generic setter, which the field coming from the
    browser is exactly the argument against, or nine bulk editors on one page.
    Each row heading links to the screen that does edit it.
- **RATES IS A NESTED GRID: every rate plan under every room type** (0054).
  `src/components/inventory/rates-screen.tsx`, over
  `inventory_rates_grid(from, days)`. The client: "the hotels have different
  rates. Let's say bed and breakfast, room only, non-refundable ... when you
  click on rates you will see the room and then below the room all the rates
  and then you will be able to change the price on those rates."
  - **It is not a tenth copy of the shared grid.** That rule covers the nine
    screens that are each ONE field across room types, and they still share one
    component. This is one field across TWO dimensions — plan and room type —
    and folding it in would make all nine grow a rate-plan axis they have no
    use for.
  - **A blank cell is "not loaded", never free and never zero.**
    `create_booking()` refuses a stay against a night with no rate, so a blank
    is also how a hotel says "we do not sell this plan on this room type". That
    is the plan-to-room-type link the client described, expressed as the
    absence of a price rather than a second table somebody has to remember to
    fill in. Do not add a `rate_plan_room_types` table for this.
  - A selection is a (room type, rate plan) PAIR, so `applyRates()` groups the
    selection by plan and calls `set_rates()` once per plan — each its own
    transaction, exactly as applying to several room types already was. It
    routes through `applyInventory()` so the validation stays in one place.
  - **EVERY NIGHT IS TYPED INTO ITS OWN CELL (0110).** The client, twice in
    one evening: "Hotels have to be able to change the rates per day ... it is
    very important to have the rates PER DAY", and in a Loom: "the OTAs don't
    receive per year ... we do per day". The prices were always stored per
    night; what was missing was a way to change ONE night -- every cell was
    read-only and the bulk panel was the only editor. A cell now saves on
    Enter or when focus leaves it (`set_rates()` over a one-day range), past
    nights stay read-only, and ‹ Previous / Today / Next › with a date field
    page the 28 nights. The bulk panel stays for ranges.
  - **A plan that prices by occupancy draws a row per number of adults**
    under its standard row (the room type's base occupancy). An empty cell
    shows, faint, what that party pays anyway; typing sets that night's own
    price for them (`set_occupancy_rates()`), clearing puts them back. The
    bulk panel takes an Occupancy too.
  - **Rates (Main) is this screen pinned to the main plan** (0110), through
    `RatesPage` in `rates-page.tsx`, which both routes render. It used to be
    the shared nine-screen grid, which could do neither of the two things
    above.
- **Rate plans are created and corrected in Settings** (`?tab=rate-plans`),
  through `save_rate_plan()`. Until 0054 a plan could be created — from a
  corner of the Inventory screen — and never renamed, retired or reordered,
  which is why the hosted property had exactly one. Setting up what the hotel
  sells belongs beside the room types and the tax rates, not inside a week's
  pricing.
  - **A plan CAN be deleted as of 0094, but only one nothing was sold on and
    that is not the main rate** -- `delete_rate_plan()` refuses the rest by
    name. `booking_rooms` points at a plan under `on delete restrict`, so a
    sold plan stays and a booking keeps saying what it was sold as; one no
    longer sold is `is_active = false`. An unused plan's nightly prices,
    offer links and meal inclusions go with it.
  - **SETTINGS -> RATE PLANS IS THE REFERENCE'S "RATE CATEGORIES"**
    (`rate-plans-panel.tsx`): Title (sort, search), Currency (the property's),
    Cancellation Policy (sort, filter), the main rate's tick, a pencil and a
    red bin (not on the main rate), "Add New Rate Plan" and "Show Expired
    Rates" -- "expired" being a plan no longer selling, which
    `getRatePlanSettings()` returns and `getRatePlans()` does not. The form
    sets the cancellation policy through its own RPC, as before; a new plan
    takes the default policy by trigger (0093).
    - "Show Special Offer Rates" is not copied: offers here reduce a stay,
      they do not create rate plans, so there would be nothing to show.
    - **THE PLAN'S PRICES ARE IN ITS OWN FORM (0110)**, as the reference
      has them -- the client sent a Loom of it and asked for "the way we have
      it here". `plan-rates.tsx`, under Pricing: Season (Default Season or a
      season), Affected Room Types as chips (those priced on the plan, else
      all), then per room type "(Max Occ. n)" and a row per number of adults
      up to it, Monday to Sunday, each row with a ">>" that copies Monday
      across the week. Below: "Rate Category Restrictions" -- MST, MSA, MXS,
      CTA, CTD, SS as rows with ">>", one set for the plan, written to every
      room type in the grid. ONE Save stores the terms and then the week.
      - **ROOM RATE COMBINATIONS IS BACK, UNDER THE LIST AND AS THE SEASONS
        POPUP. This reverses what this file said**, that the grid was gone
        for good: 0110 removed it when the client could not see how a
        season linked to it; this round they sent their reference's Rate
        Plans page and its Seasons popup and asked for both, "with all the
        information showing in the screenshot".
        `rate-combinations.tsx`: Filters (Season, Room types, Rate
        Categories), "Show Multi Occupancy Rates", then per room
        type -- with "Show derived and calculated rates" -- each plan: name,
        adults and children, a star on the main rate, an eye (crossed when
        not on the guest page), "policy, currency", ⋮ (opens the plan's
        form), ">>" (copies Monday's whole cell across the week), and per
        weekday the Rate, MST MSA MXS and CTA CTD SS. "Add New Room Rate
        Combination", Reset Changes, Save Changes.
        - **THE THREE FILTERS ARE THE REFERENCE'S DROPDOWNS**
          (`filter-select.tsx`, `FilterSelect`): a field that opens a list of
          EVERY option with the chosen ones ticked. Room types and Rate
          Categories are multi-select -- a chip with × per choice on one
          line, "+n …" past three, a click in the list toggles and it stays
          open. Season is single: seasons, then events (tagged "Event"), then
          the Default Season, each with its colour. The plan form's Season
          and Affected Room Types use the same component. It stops Escape
          from reaching the Seasons popup, which closes on Escape. It used to
          be a native select offering only what was NOT chosen, which the
          client read as "ours contains only" a few options.
        - **It is the SAME weekly template as the plan's form, seen across
          plans** -- `rate_plan_week_rates`, saved per (plan, room type) by
          `save_week_rates()` with the form's rules. Not a second price
          list. Restrictions are per room type here; the form writes one
          set to every type -- both are the same columns.
        - **A pairing shows when it is in use** (priced from the business
          date, or given a week in any season) or when "Add New Room Rate
          Combination" adds it -- still no link table.
        - Occupancy rows: a per-occupancy plan types each; a per-person plan
          shows them grey. Saving a per-person row sends back the stored
          occupancy prices untouched. A derived plan never sends a rate.
        - **The Seasons screen's tag opens it as a right-hand panel**,
          `?tab=seasons&rates=<season id|default>` (URL state like the
          calendar's dialogs), in `BookingDialog` with `side wide`, season
          fixed, titled "Room Rate Combinations for <season>" with the
          season's dates under it. It no longer navigates to Rate Plans --
          the client: "vo na lejakr ek popup aa jaye".
      - The three occupancy modes: One Price For All Occupancies is one row
        (`single`); unticked, every row is typed (`per_occupancy`, 0110);
        with Automatic Calculation (`per_person`) the radio picks the row you
        type in and the rest are worked out, grey, from Increase Per Adult,
        Decrease Per Adult (0110) and Increase Per Child. The base-occupancy
        row is always `rate_cents`; the others go to the template's
        `occupancy_rates` jsonb and then onto the nights'
        `rate_plan_occupancy_days`. Automatic from the base row stores none
        and lets Postgres work them out; from another row it stores what is
        shown. "Decrease Per Child" is not copied: base children is none, so
        it could never apply.
      - `rate_plan_week_rates` stores the template; `save_week_rates()`
        writes it onto the nights. **A SEASON REPLACES THE PRICE ON ITS OWN
        DATES (0110)** -- that is what a season is for, and fill-only made it
        change nothing on a property already priced: "Season does not work".
        **The Default Season still only fills empty nights** unless "Replace
        prices already on these nights" is ticked, so re-saving the year never
        wipes a night priced by hand. **Restrictions only ever fill**: a
        min or max stay only where none is set, CTA/CTD/SS only switched ON.
      - **Dates added to a season later get its prices** (0110):
        `add_season_range()` re-applies the season's saved week. Before,
        they kept whatever they had.
      - **Which nights:** from the open business date on. A season: its own
        ranges, up to two years out. The Default Season: the next 365 nights
        that no season covers. `inventory_guard()` does the role check.
      - **A restriction cleared by hand in Inventory is empty again, so the
        next Save fills it back in.** Tell the client if they clear rules
        night by night and then re-save the week.
      - The Seasons screen's "Rates" button opens Room Rate Combinations
        for that season in a panel over the screen (see above); a row's ⋮
        there opens that plan's form on the season
        (`?tab=rate-plans&edit=<plan>&season=<id|default>`).
      - A derived plan's rows show the parent's week, adjusted, read-only;
        its restrictions stay its own.
  - **THE RATE PLAN FORM IS A POPUP, THE REFERENCE'S (0115).** The pencil
    (and "Add New Rate Plan", and ⋮ in Room Rate Combinations) opens it over
    the list -- `PlanPopup` in `rate-plans-panel.tsx`, portalled to `<body>`
    for the stacking-context reason. Laid out as theirs, labels on the left
    ending in colons, "*" on Title, Meal Type, Cancellation Policy, Currency
    and Attached Taxes: Title | Meal Type, Cancellation Policy | Currency,
    Description, Min | Max Days Advance, "Active at specific date range"
    (From | To), Max Adults | Max Children, Derived Rate (Parent Rate,
    Relation, Amount), One Price For All Occupancies, the prices and "Rate
    Category Restrictions", Sell With Extras, Attached Taxes, Accounting
    Category, "Only For Channels (Hide on IBE)" and "Save as default rate".
    Every dropdown is `FilterSelect`.
    - **A NEW PLAN IS PRICED IN THE SAME FORM**, as the reference's is: the
      prices and restrictions are there from the start (the grid runs on
      `newPlanFor(draft)`, an unsaved plan with id "new" that nothing is
      stored against), and ONE Save creates the plan and then writes its
      week under the id it was given; the popup then closes, as an edit does.
      A new plan's tax starts on the hotel's default (the first active rate),
      not "No tax".
    - **MEAL TYPE IS ONE OF THE REFERENCE'S EIGHT** (`rate_plans.meal_plan`,
      `src/lib/meal-plans.ts`): Room only, Bed and breakfast, Bed only, Half
      board, Full board, All inclusive, Custom Meal Plan, Self Catering.
      `set_rate_plan_meal_plan()` writes `rate_plan_meals` from it -- none,
      breakfast, breakfast + dinner, all three -- and only Custom takes the
      ticked meals, so the choice and the meals (which the meal report and
      the audit's meal split read) never disagree; a kept meal keeps its
      value. Existing plans took the choice their meals said.
    - **The code is not on the form** (the reference has none): a new plan is
      given the title's initials, unique on the property; an edit keeps its
      code. **Min Adults / Min Children are drawn only when a plan already has
      one**, so a rule set before is never hidden while enforced.
    - **Attached Taxes takes ONE tax.** The reference's shows two chips
      (City Tax, IVA); a night carries one tax figure and a folio item one
      rate, so several taxes on a rate is a change to how every night is
      taxed and posted -- to be asked for. "Save without taxes" is not
      copied: what it does has not been seen.
  - **THE RATE PLAN FORM CARRIES THE REFERENCE'S TERMS (0109)**, saved by
    `set_rate_plan_terms()` -- one function taking the whole set, its own for
    the overload reason -- plus meals through `set_rate_plan_meals()`. Every
    term is applied or enforced; none is a stored wish. The client's video
    brief also named the workflow; what already existed was reused, not
    rebuilt (room types, cancellation policies, seasons, the weekly grid,
    `rate_plan_days`, taxes, accounting categories, channels).
    - **Booking conditions**: min/max days in advance (against the open
      business date), min/max adults and children per room, and an active
      range of NIGHTS (`valid_from`/`valid_to`, inclusive -- every night of
      the stay must fall inside). `rate_plan_condition_violation()` decides
      them in one place. `create_booking()` checks them with the stay rules,
      as HP002, overridden by the same `p_ignore_restrictions`; the guest page
      gets them in `unavailable_reason`.
    - **Channels**: `rate_plan_channels`, no rows = every channel. A plan
      restricted to other channels is refused for that channel (HP002) and is
      not offered on the guest page at all, which books through the first
      active direct channel (`public_direct_channel()`). `merge_channels()`
      moves a merged channel's plan rows to the keeper, so a restricted plan
      never silently opens to everyone.
    - **DERIVED RATES ARE MATERIALISED, NOT COMPUTED ON READ.** A derived
      plan names a parent and a percentage (bps) or an amount (pence), up or
      down, never below zero. Two triggers on `rate_plan_days` keep it true:
      before any write of a derived plan's night the price is recomputed from
      the parent's night (whatever was sent is replaced), and after a
      parent's price changes the same night on each child is touched. So
      every reader of `rate_plan_days` -- `create_booking()`, the guest page,
      the grids, the public API -- sees the derived price with no change to
      any of them. `set_rates()` refuses a derived plan by name; the Rates
      grid draws it with no tick box. One level only: a parent cannot itself
      be derived, and a plan with children cannot become derived. Setting or
      changing a derivation re-derives every night from the business date
      (`rate_plan_rederive()`); removing it leaves the prices as the plan's
      own. A parent cannot be deleted while a plan is derived from it.
      Restrictions are never derived -- each plan keeps its own.
    - **Occupancy pricing**: "One Price For All Occupancies", a price per
      number of adults (`per_occupancy`, 0110), or per person: the loaded
      price is for the room type's BASE occupancy in adults; each adult above
      it adds the increase, each below takes off the decrease (0110; null
      decrease uses the increase), each child adds the child amount, floored
      at zero (`rate_plan_occupancy_rate()`).
      **`rate_plan_night_rate()` is the one place a night is priced for a
      party (0110)**: that night's own price for that many adults in
      `rate_plan_occupancy_days` if there is one (a derived plan reads its
      parent's and adjusts it; a single-price plan ignores them), else the
      rule above. The standard price must still be loaded for a night to
      sell. Applied
      wherever a night is priced from the plan -- `create_booking()` per room
      line's party, `create_public_booking()`, and `public_room_types()`,
      which takes the party now. A hand-typed room rate is never adjusted.
      **Known gap**: a percent-off offer is computed on the loaded price, not
      the per-person one (`promotion_night_discounts()` reads
      `rate_plan_days`), so on a per-person plan it discounts the base part.
    - **Attached tax**: `rate_plans.tax_rate_id`. The staff form seeds its tax
      field with the plan's when the plan is picked (still editable). The
      GUEST PAGE NOW CHARGES TAX: `create_public_booking()` splits each night
      with the plan's tax through `tax_split_for()` (apply_tax_rate() without
      `current_property_id()`), and the quote adds exclusive tax. **Until
      0109 every guest-page booking carried zero tax** -- worth telling the
      client, and a plan with no tax set still books tax-free online.
    - **Accounting category**: `rate_plans.accounting_category_id`, ahead of
      the room type's, ahead of the accommodation default, in the Accounting
      report's room split (`accounting_room_revenue()` names the plan beside
      the type only when the plan has its own account).
    - A tax or an account a plan uses is refused on delete by name, and a tax
      a plan uses counts as in use in Tax Information.
    - **"Affected Room Types" is READ, NOT SET.** A plan is sold on a room
      type exactly when that pair has prices loaded -- the rule this file
      already gives for the Rates grid, and why there is still no
      `rate_plan_room_types` table. The form lists each type with its priced
      nights (`rate_plan_coverage()`); since 0110 the form's Rates grid picks which types it prices.
    - **"SELL WITH EXTRAS" IS STORED, NOT CHARGED (0115)**:
      `rate_plan_extras`, the catalog extras sold with the rate, set by
      `set_rate_plan_extras()` (the whole set). Nothing posts an extra because
      of a rate -- when that would post (at booking, per night, at check-in)
      and at what price is a money rule to be asked for. A deleted extra
      comes off every plan; `merge_extra()` hands the merged-away extra's
      plans to the one kept.
    - **The guest page re-quotes on the details step**: the party is chosen
      there, after the price was shown, so a change asks
      `searchPublicStay()` again (newest reply wins) and the summary shows
      what will be charged; a condition the party breaks shows as an error
      above the button.
  - **A property always keeps one default plan.** `save_rate_plan()` promotes
    the first active plan if the last default is retired or stood down —
    otherwise a booking naming no plan has nowhere to fall back to.
  - **"Non-refundable" IS A RULE NOW, as of 0060.** This note used to say the
    opposite: a plan could be called non-refundable and priced like it, and
    nothing enforced or even recorded what that meant. `cancellation_policies`
    is that table, and `rate_plans.cancellation_policy_id` is the link. See
    the cancellation notes below.
  - `create_rate_plan()` still exists and still works. It is what the Inventory
    screen calls, and breaking it to rename it would be churn for no
    user-visible gain.
- **CANCELLATION POLICIES HANG OFF A RATE PLAN** (0060). The client: "for
  CANCELLATION POLICY each hotel have different policy. Flexible Cancellation:
  The hotel choose how many day in Advance the guest can cancel for free. Non
  Refundable: Means that the guests cannot cancel or modify and the hotel can
  charge the guest card anytime."
  - **Three kinds, because they behave differently rather than being one
    setting at three values.** `flexible` carries `free_cancellation_days` and
    a check constraint requires it; `non_refundable` and `custom` (0092) carry
    none and the same constraint forbids one. A custom policy is the hotel's
    own words: no date can be worked out from it, so the booking screen says
    "Custom terms" and claims no free window.
  - **THE FORM IS THE REFERENCE'S (0093)** -- deposits, refunds of deposits,
    other details, the cancellation choice, no-show, breakfast, "Use as
    default policy" -- in `cancellation-policy-panel.tsx`, stored as
    structured columns.
    - **Kind and days are DERIVED from the cancellation choice by
      `save_cancellation_policy_terms()`**, never sent: free at any time is
      flexible/0, no cancellation is non-refundable, free up to N days is
      flexible/N, free up to N HOURS is flexible/ceil(N/24) -- terms are dated
      by business date, so hours round UP to a whole day, never promising less
      time than the hotel gave -- and custom is custom.
    - **The sentence the choices add up to** (`cancellationPolicySummary()` in
      `src/lib/cancellation-policy.ts`, pure) is saved as `description`, which
      the guest page already shows as the policy's wording. So deposits,
      refunds, no-show and breakfast reach the guest in words, untranslated
      like every hotel's own wording. Nothing COLLECTS a deposit or charges a
      no-show from them -- see "Card capture is not built".
    - **One default per property** (partial unique index). A new rate plan
      with no policy takes it, by trigger on `rate_plans`. The default can be
      neither unticked nor deleted; tick another instead.
    - **Not built:** "Flexible Cancellation Fee based at cancellation period"
      (its fee schedule has not been seen). "Remaining balance to be paid on"
      offers arrival or departure -- PROVISIONAL, the reference's list was not
      seen open. The reference's LOCALE and translate buttons are not copied.
  - **Per rate plan, not per property.** "Each hotel have different policy" is
    satisfied by the rows being per-property; what a policy governs is a rate,
    because Flexible and Non-refundable are two things one hotel sells side by
    side at two prices. That is the whole point of a non-refundable rate.
  - **Null is "not set" and is NOT free cancellation.** Every screen says "Not
    set" rather than defaulting, because a default here would put words in a
    hotel's mouth about refunds. Same convention as the rest of the inventory.
  - **`set_rate_plan_cancellation_policy()` is its own function**, like
    `set_room_photo()`, for the same reason: an optional parameter on
    `save_rate_plan()` would be an overload for PostgREST to choose between,
    and renaming a plan would then say "and no cancellation policy" every time.
  - **`booking_cancellation_terms()` REPORTS AND DOES NOT ENFORCE.** Staff can
    always cancel — a hotel that cannot cancel its own booking is broken — so
    the terms appear on the booking screen and inside the cancel confirmation,
    and the button still works. What the policy decides is whether money is
    owed, not whether staff may act, and cancelling has never written off the
    balance.
    - Dated against the open `business_date`, not `now()`, like every other
      operational question here. Free when
      `business_date <= check_in - free_cancellation_days`, so the deadline day
      itself is still free and a policy of 0 days is free until arrival.
    - **A booking can carry more than one policy**, since `booking_rooms` holds
      a rate plan per room and a group booking may mix them. The strictest is
      reported and `is_mixed` says the rooms differ, rather than stating one
      room's terms as though they were the booking's.
  - **The guest is told before they agree.** `public_rate_plans()` carries the
    policy name, kind and days, and the booking page draws them under the plan
    picker. A guest accepting a non-refundable rate without being shown it is
    non-refundable is the one failure this feature exists to prevent. The
    hotel's own wording is NOT translated — only the label around it is.
  - **NOTHING CHARGES A CARD.** "The hotel can charge the guest card anytime"
    is a right the policy records, not one this system can exercise: there is
    no Stripe code and no keys (see "Card capture is not built"). A
    non-refundable booking means the charge stands and the folio still says
    what is owed; collecting it is the front desk's job until card capture
    exists. Do not let the interface imply otherwise.
  - **A policy CAN be deleted as of 0093, but only one no rate plan uses and
    that is not the default** -- `delete_cancellation_policy()` refuses the
    rest by name. `rate_plans` points at a policy under `on delete restrict`,
    so a booking keeps meaning what it was sold under. There is no Active
    switch any more (the reference has none); `is_active` stays true and the
    column is kept for the guest page's join.
  - **"Rates (Main)" and "Rates (All)" are the same field.** Main pins the
    property's default plan; All shows every plan. Two
    entries for one field is not duplication — changing the main rate is most
    of what anyone does here, and making them choose the plan first every time
    is a click that is always the same click. `?plan=` is ignored on Main
    rather than honoured, or a link carrying it would silently turn the pinned
    screen into the unpinned one.
- **Inventory is edited in bulk or not at all.** Every setter takes a date
  range, a set of room types and an optional set of weekdays, because "min stay
  two on every Friday and Saturday until March" is the actual job. Setting one
  cell is that with a one-day range; there is no second path for it.
- **There are nine setters, one per screen, and no generic one.** The field
  comes from the browser, so it selects a named RPC from a table in
  `src/lib/actions/inventory.ts`. Nothing is interpolated into SQL.
- **Rates are `is_revenue_staff()` — admin and manager.** Front desk reads them
  to quote a price and reads the restrictions to know why a stay will not sell.
- **Taking a booking goes through `create_booking()` and nothing else.** One
  transaction resolves or creates the customer, allocates the reference, writes
  the booking, writes one `booking_rooms` row per room and puts the rate on the
  nights `sync_booking_room_nights()` generates. A booking assembled from
  several calls leaves a half-made booking behind on any failure, holding
  inventory with no guest against it.
- **THE BOOKING FORM DEFAULTS TO THE PROPERTY'S OWN TAX RATE.** It used to
  seed the field empty, and empty is the "No tax" option, so a booking went
  out with no VAT unless somebody remembered to pick it every single time.
  **That was not theoretical**: sixteen of the nineteen bookings on the hosted
  property carry zero tax, against roughly £616 of VAT that belonged on them.
  `getTaxRates()` is already filtered to the active rates, so the first is the
  one this hotel charges. "No tax" stays in the list — a zero-rated booking is
  a real thing — but it is chosen rather than fallen into.
  - **The sixteen existing ones are NOT fixed by this.** They have no tax rate
    against them and `folio_items` is append-only, so putting VAT on them is
    reversing and reposting each folio deliberately. It has not been done and
    wants asking about.
- **THE BOOKING'S PARTY SIZE IS THE SUM OF ITS ROOMS**, not the Stay band's own
  figure. Those were two unrelated numbers: the Stay band went to
  `bookings.adults`, each room line carried its own occupancy, and nothing made
  them agree. On one room nobody noticed; on a group it was plainly wrong —
  twenty-seven rooms recorded "2 adults", and that is the figure the booking
  header and every report then showed.
  - **The Stay band is not removed**, it is wired up: it seeds each room as it
    is added, capped at what the type sleeps. That is what somebody typing "2
    adults" at the top of the form actually means, and it was previously a
    control that changed nothing anywhere.
  - A booking with no room lines still falls back to it, so the refusal that
    fires on an empty booking is the one that speaks.
- **The form says "Offer code", not "Promotion code."** The client had the
  section renamed; the schema still says `promotions` and deliberately stays
  that way.
- **A booking is priced per night off the rate plan**, not once for the stay: a
  Friday is not a Tuesday, and one figure across the stay is what daily rates
  exist to stop. A room line may name its own `rate_cents` instead, which then
  holds for every night. Neither means there is no price, and a booking with no
  price is a bill nobody can settle.
- **`create_booking()` enforces the inventory**, and says which refusal it is
  with a SQLSTATE rather than message text: `HP001` would oversell, `HP002`
  breaks a stay rule or a closed date. Both can be overridden, by
  `p_allow_overbook` and `p_ignore_restrictions` respectively — two different
  decisions, two different flags. One tickbox covering both would hide that
  selling a room that does not exist and selling against a commercial
  instruction are not the same act.
- **Availability is checked inside that transaction, not in the form.** A form
  can only check what it loaded; two receptionists selling the last room at the
  same moment both see it free. Overbooking is allowed but has to be asked for
  with `p_allow_overbook`, and the calendar then shows the night as negative.
- **Availability for a stay is its tightest night**, never an average. A room
  type with four free on Monday and none on Tuesday can sell nothing for a
  two-night stay.
- `bookings.reference` is the hotel's own, from `next_booking_reference()`
  (`BK-000123`). A channel's reference goes in `external_reference`.
- No room is assigned when a booking is taken. `assign_room()` does that, at
  check-in.
- **CHECK-IN AND CHECK-OUT GUARD THE ROOM, NOT ONLY THE DATES (0112).** An
  audit of the hosted property found BK-000010 checked in to four rooms that
  still held guests past their departure, and checking it out then marked
  those rooms vacant with the other guests still in them.
  - **`check_in_booking()` refuses a room another booking is still checked in
    to**, naming the guest and their departure, the same words
    `assign_room()` uses. The overlap check compares booked dates, and an
    overdue guest has none left, so it could never catch this.
  - **`check_out_booking()` dirties a room only when nobody else is checked in
    to it.** 0112 also put the four rooms left reading vacant back to
    `occupied` -- the one data repair, touching only rooms in that state.
  - **A PAST ARRIVAL IS REFUSED (HP004) AND THE OVERRIDE MOVES IT TO TODAY.**
    The audit charges only the night it closes, so checking in against an
    arrival days ago left every earlier night unbilled for ever (BK-000016,
    BK-000017), and somebody posted BK-000011's and 012's first night by hand
    as miscellaneous. The check-in dialog then offers "Move the arrival to
    today and check in" -- `p_move_arrival`, a deliberate second ask like
    `p_allow_overbook` -- which goes through `update_booking()`, so the
    nights and the activity log are the ones every date change has. A stay
    whose departure has passed as well is refused outright.
  - **Worth knowing**: a guest who really did arrive days ago and was never
    checked in cannot have those nights charged through this. That is rare,
    and charging past nights is a money decision to ask about, not to guess.
- **The booking screen is SEVEN tabs: Rooms, Extras, Guests, Folio,
  Attachments, Email, History.** It was five. Attachments and Email landed in
  0063, when the client asked for full parity with their reference — "Copy
  them too, I just want to clone the application" — having been told both were
  deliberately left out. They sit before History because that is where theirs
  are, and because History is a trail rather than something anybody adds to.
  - **ATTACHMENTS IS COMPLETE.** `booking_attachments` records what is in the
    private `booking-attachments` bucket.
    - **The bucket is PRIVATE, the opposite of `room-photos`.** A room
      photograph is marketing material that belongs on the hotel's website; an
      attachment on a reservation is a passport scan, a registration card, a
      company purchase order. Reading one is a **signed URL** minted under the
      reader's own session, so the storage policy decides, and it expires —
      a link pasted into a chat stops working.
    - The path is `<property_id>/<booking_id>/<uuid>-<name>`, checked twice:
      by the storage policy and again by `add_booking_attachment()`. The same
      belt and braces `set_room_photo()` has, for the same reason — the path
      is a string the browser chose.
    - **The file never passes through the server.** It goes straight from the
      browser under the user's own session, so nothing holds a service key.
      The action says where to put it, the browser puts it there, a second
      action records the row. If the row fails the browser removes the object
      it just uploaded, rather than leaving a file nothing points at.
    - **Delete is allowed**, unlike a folio row. A document on the wrong
      booking is a mistake to undo, not history to keep — same reasoning as a
      calendar note or a season. The row goes first and hands back the path,
      so the object is only removed once Postgres has agreed.
  - **EMAIL IS A RECORD OF CORRESPONDENCE AND DOES NOT SEND.** There is no
    mail provider in this repository and no API key in any environment, and a
    Send button that cannot send is the dead control this application keeps
    refusing to ship — see the user-menu note.
    - **The control says "Record", not "Send"**, because a control's label
      matches its result. That is the one thing keeping this tab honest; do
      not rename it without wiring a provider first.
    - What a front desk reads that tab for is "what have we already told
      them", which is what `booking_emails` holds: to, subject, body, when,
      and by whom.
    - **No update and no delete policy**, which is the opposite of an
      attachment and the same as a folio row. A correspondence log somebody
      can quietly edit is not evidence of anything.
    - **Wiring a provider later is an action and a key, not a migration.**
      `sent_at` is already there and `booking_email_status` already carries
      `sent` and `failed` beside `logged`.
- **The booking screen's first five tabs are Rooms, Extras, Guests, Folio, History**,
  which are the areas the client's reference PMS organises a reservation into.
  The header above them carries the reference, status, guest, dates, nights,
  party size, room count, source, settlement, channel reference, reservation
  value, balance and notes — that was already there and did not move.
  - **A CHARGED EXTRA IS STILL A FOLIO ITEM, AND THAT HAS NOT CHANGED.** 0069
    added a CATALOG (`extras`, see the Settings notes) -- the menu a front desk
    picks from -- but not a ledger: what the guest owes is still only ever in
    `folio_items`. An extra is a folio item
    that is not the room, which `folio_item_type` has expressed since 0002 and
    `extras_report()` has read since 0038. 0057 adds `item_type` to
    `booking_folio_lines()` — `effective_item_type`, per the reports rule, so a
    reversal and a discount land in the bucket they affect — and the tab
    filters the lines the Folio tab already holds by the report's own rule,
    `not in ('room_charge', 'tax', 'discount')`.
  - **The extras total is a column sum over those same rows**, not a second
    set of books. Deriving rather than fetching is what stops this screen and
    the folio balance ever disagreeing. Do not give CHARGED extras their own
    read, own total, or own table.
  - **The Extras tab charges from the catalog** (0069), through
    `charge_extra()`. The browser sends which extra and how many, never an
    amount: the price, the tax and the accounting category are read from the
    catalog in Postgres, and the posting is `post_charge()`, so the business
    date, the role check and append-only are the ones every charge already
    has. It lands on the booking's open primary folio, the same one a paid-out
    recharge uses. **Until 0069 nothing in the staff application could put an
    extra on a folio at all** -- the empty state sent people to the cashier,
    which could not do it either.
    - `canCharge` is every role `require_financial_staff()` admits (all but
      housekeeping), which is wider than `canEdit`: a cashier charges a
      minibar without being able to change the stay.
    - `extrasCatalog` and `canCharge` are REQUIRED props on
      `BookingDetailView`, so both frames -- the page and the calendar's panel
      -- had to pass them. The optional `bookingHref` is the precedent for
      why.
  - **The Guests tab shows ONE guest, because that is all there is.**
    `bookings.customer_id` is a single row and `booking_rooms` carries adults
    and children as counts with no names against them. So the tab shows the
    customer — contact plus the 0050 identity fields, nationality and country
    kept separate — and occupancy per room. It cannot name the second occupant
    of 101 and must not pretend to. It reuses `getCustomerForEdit()`.
  - **A bar on the calendar carries `?back=` with the board's own URL**, so
    opening a booking and coming back lands on the same dates and rail width
    rather than a board reset to today. The page accepts only a path beginning
    with a single `/` — the value reaches an href, and `//evil.example` is a
    link off this site wearing a path's clothes. Every other way in (the
    bookings list, search, the reports) sends no `back` and falls back to
    "All bookings".
  - **CLICKING A BAR NOW OPENS A POPUP OVER THE BOARD, as of this round.**
    This reverses what this file said. The client asked for their reference's
    behaviour directly — "jab koi bhi kisi booking ko open krta hai to vo
    popup hota hai uski puri details ke sath" — and they are right that
    navigating away to read a reference and a balance costs you the dates and
    rail width you were looking at.
    - **WHAT OPENS IS THE REAL `BookingDetailView`, not a summary of it.** The
      client's screenshot of their own popup settled this: it carries their
      full tab set — Rooms, Extras, Guests, Folios, Payment, History — a table
      of room lines and the OTA notes, which is the reservation screen in a
      panel rather than a reduced view of it.
    - **That is the same move the booking FORM dialog already makes.** It
      wraps the real `NewBookingForm`; this wraps the real detail view. One
      component rendered in two frames cannot drift, which is exactly what a
      second, smaller copy would do — and refusing the copy, not refusing the
      popup, was always the point of the old rule here.
    - **EVERY ROW THAT DRAWS A BAR MUST BE HANDED `bookingHref`.** It was
      missing on the room rows — the one that matters, since a booking with a
      room is nearly every booking — so clicking a live bar navigated to
      `/bookings/[id]` and the popup only ever opened from the Unassigned and
      Cancelled bands. The feature looked built and was not. The prop is
      optional in the type so a caller without one still works; that is what
      let the omission through, and it is why this is written down.
    - `?booking=<id>` on `/calendar`, URL state like the other two dialogs.
      The reads are the same ones `/bookings/[id]` makes and they run only
      when the dialog is opening, so an ordinary visit to the board costs
      nothing extra.
    - `inDialog` hides the back link and the reference heading, because the
      dialog's own title bar already carries both. Nothing else changes.
    - **IT IS A RIGHT-HAND PANEL, not a centred box** — `BookingDialog` takes
      `side` for this. The client sent their reference's popup and asked for
      it by shape: it comes in from the right, runs the full height of the
      window, and the board stays visible down the left. A centred dialog
      covered the dates you were reading, which is the one thing a popup was
      supposed to avoid.
      - **The booking FORM keeps the centred frame.** A panel the height of
        the screen for six fields is the wrong shape; only the reservation,
        which carries a room table and a folio, earns the panel.
      - **The close goes on the LEFT of a panel**, where the reference puts it
        and where a slide-over conventionally carries it — the panel arrives
        from the right, so the eye lands on its left edge. On the centred
        dialog it stays on the right.
      - **`meta` carries Total, Paid and Due along the top**, as theirs does.
        Read off the detail the server already loaded — `chargesCents`,
        `paymentsCents` and `balanceCents` — so nothing new is computed and
        the bar cannot disagree with the folio below it. Hidden below `sm`
        rather than wrapped: the reservation repeats every one of those
        figures a few centimetres down, so a phone loses nothing.
      - The panel is a flex COLUMN with the body scrolling, not a `max-h` on
        the body: that held up until the header wrapped on a narrow screen and
        pushed the totals off the end.
      - **Email and Attachments are NOT built.** The reference's panel carries
        those two tabs; there is no mail in this codebase and no attachment
        storage, so ours shows the five tabs it has. Copying the tab strip
        without the features behind it would be two more controls that do
        nothing.
- **`bookings.external_payload` is empty on every row and nothing fills it.**
  OTA bookings are entered by hand (open decision 2), so the channel's raw
  payload never arrives. The screen shows the source, the settlement and
  `external_reference` when present, and does not build a viewer for a column
  that has never held anything.
- **Changing a booking never touches posted money.** `update_booking()`
  refuses to drop a night the night audit has already charged, and
  `set_booking_room_rate()` leaves a charged night's rate alone. The folio is
  what the guest owes; moving the night underneath it would put the two out of
  step. A charge that should not stand is reversed on the folio, deliberately.
- **The arrival date is history once the guest arrives; the departure date is
  not.** Extending an in-house stay is the commonest change a front desk makes,
  and `sync_booking_room_nights()` already adds and removes only the nights
  that changed, leaving the rates on the rest alone. That is why a date change
  does not silently re-price a stay — and why extended nights arrive at zero
  and need a rate before the night audit runs.
- **`cancel_booking()` and `close_folio()` could never run until 0039.** Both
  assigned an enum column from a bare `CASE`, and Postgres resolves two unknown
  literals to `text`, which does not assign to an enum. The statement could not
  be planned, so every call raised before touching a row — the Cancel button on
  the booking screen had never worked, and surfaced the raw Postgres message.
  Found only because the no-show audit calls `cancel_booking()` rather than
  releasing a booking a second way; a second copy would have worked and left
  the button broken. **Cast at least one branch of any `CASE` assigned to an
  enum**, or better, decide it once into a typed variable as these now do.
- **Cancelling frees the inventory and does not write off the balance.** The
  rooms and their nights go to `canceled`, which every availability query
  excludes, and the outstanding amount is returned rather than cleared: a
  cancellation fee is a real charge and somebody still has to chase it.
- **ONE ROOM OF A BOOKING CAN BE CANCELLED WITHOUT THE BOOKING** (0065).
  `cancel_booking_room()` and `restore_booking_room()`, from the booking
  screen's Rooms tab. A group is one `bookings` row with several
  `booking_rooms`, so this is the cancel that operates at the row the guest
  actually dropped out of.
  - **`booking_rooms.canceled_separately` is a new column, and it is the whole
    reason this is more than an UPDATE.** Two things already in the schema
    would have silently undone a per-room cancellation, and neither could tell
    "cancelled because the booking was" from "cancelled on its own":
    - `sync_booking_room_status()` pushes `bookings.status` onto EVERY room
      whenever it changes. Cancel room 3 of a group, check the group in, and
      the trigger brought room 3 back as `checked_in` — a room on the house
      with a guest implied in it. **Tested against the hosted database inside
      a rolled-back transaction** before and after the fix.
    - `restore_booking()` set every room back to `confirmed`, so a room
      cancelled on its own beforehand came back with the group. Its
      availability check counted those rooms too, which would refuse restores
      that were perfectly sellable.
  - **It is NOT a second status.** `booking_rooms.status` still reads
    `canceled`, so every availability query, the calendar's Cancelled band and
    every report keep working untouched — a separately cancelled room frees
    its inventory exactly like any other. The column answers only "who
    cancelled it", which is a question only those two places ask.
  - **THE LAST LIVE ROOM IS REFUSED BY NAME**, pointing at the booking-level
    cancel. Cancelling every room one at a time would leave a booking still
    reading `confirmed` while holding nothing and billing nothing. The control
    is drawn only above one live room, so the refusal is a backstop rather
    than something anybody meets.
  - Refuses an in-house or departed room, exactly as `cancel_booking()` does:
    a guest in the room is checked out, never cancelled.
  - **The folio is not touched**, like every other cancellation here. Nights
    already charged stay charged and a cancellation fee stands until somebody
    reverses it deliberately.
  - **Logged by hand, and that is the exception rather than the rule.** The
    booking's own status has not moved, so
    `bookings_log_activity_after_status_change` does not fire — unlike
    `restore_booking()`, which is why that one logs nothing itself.
    `booking_activity()` already read `entity_type = 'booking_room'` rows, so
    it lands on the History tab with no change there.
  - **`booking_rooms_for_assignment()` now excludes cancelled lines.** It
    offered them before only because a line could not be cancelled while its
    booking was live; now one can, and putting a guest in it would be wrong.
  - **A room line shows its own status badge only when it differs from the
    booking's** — which since 0065 is possible, and is the point. Repeating
    the header's status on all twenty-seven rows of a group would be noise.
- **A ROOM'S NIGHTS ARE COLLAPSED ON A GROUP BOOKING.** Every room used to
  draw its whole nights table at once, which is fine on the one-room booking
  the screen was built for and unusable on a group: the hosted property's
  27-room booking over six nights is 162 night rows plus 27 table headers on
  screen together. The client, having taken a group booking and looked at it:
  "it's very, very big ... it takes the whole area."
  - **The summary line is the toggle, and it says enough to not need
    opening** — room or "No room assigned", type, occupancy, nights, value,
    and the status badge when it differs. Opening a room is for the per-night
    rates, which is a pricing job rather than a reading one.
  - **A ONE-ROOM BOOKING OPENS ITSELF.** There is nothing to shorten, and
    putting one short table behind a click would add a click to the commonest
    case to fix a problem it does not have.
  - **The toggle is its own button, not a wrapper round the header row.** The
    controls on the right are buttons, and a button inside a button is invalid
    HTML that browsers rearrange during parsing — the same trap the calendar's
    assign control hit as a child of its bar.
  - **Open rooms are seeded once per mount and survive `router.refresh()`**,
    so setting a rate does not collapse what somebody just opened.
  - **`BookingDetailView` IS NOW KEYED ON THE BOOKING ID in the calendar's
    dialog**, and that was a real defect this uncovered. `?booking=` changes
    while the element keeps its position, so React reconciled the same
    instance and nothing seeded with `useState` re-seeded — the open rooms of
    a twenty-seven-room group would have carried onto the next booking opened.
    **That is the same trap `NewBookingForm` hit with its dates**, which is
    twice now on this dialog; a component with seeded state behind a URL param
    needs a key.
- **The Offers screen is a card grid, cloned from the reference.**
  `src/components/promotions/promotions-screen.tsx` — an Active section, an
  Inactive section on a wash, and an "Add offer" tile at the end of the active
  grid. Everything a card shows was already in `promotions_list()`: the
  discount phrase, the room scope, the stay dates, and `arrival_days_of_week`,
  which is what the reference's seven little squares are.
  - **Null weekdays fills all seven squares, not none.** An offer with no
    weekday rule applies on every day; drawing that empty would say the
    opposite.
  - **The artwork band is drawn, not uploaded.** The reference's cards carry
    promo graphics; there is no image column and no storage bucket here, so
    each card draws its own discount figure on a tint picked deterministically
    from the offer's id — the same offer always looks the same, and neighbours
    differ. Real artwork is a column plus Supabase Storage plus an upload
    control, and wants asking for rather than assuming.
  - The bookings-taken and discount-given figures survive from the old list, on
    one truncated line. The reference has no equivalent, but they are the only
    thing on the screen that says whether an offer is working.
- **A promotion reduces a stay; it is not a second price list.** The rate plan
  still says what a room is worth. A promotion writes
  `booking_room_nights.discount_cents`, which has existed since 0002 and which
  the occupancy report and every revenue figure already net off, so nothing
  about how revenue is counted changes.
- **Three promotion kinds, and the shape takes a fourth.** `percent_off` and
  `amount_off` reduce every covered night; `free_nights` zeroes the cheapest
  qualifying nights and leaves the rest. That is a real difference in mechanic,
  which is why `promotion_night_discounts()` has a branch per kind rather than
  one formula pretending they are the same. Adding a kind is a value column, a
  check, and a branch. Inclusions ("rate includes breakfast") are not a kind:
  an inclusion is `rate_plan_meals`, and with a zero value there is nothing to
  post at all — see the meal notes below.
- **A promotion carries a code or it does not.** No code means it applies by
  itself to any qualifying stay; a code means somebody has to quote it, which
  is how a private or negotiated offer is run. A quoted code that matches
  nothing is refused rather than ignored.
- **Promotions never stack — the best single one wins**, by largest saving with
  `priority` as the tiebreak. Two forty percent offers applying together is
  sixty-four percent off and nobody notices until the month end.
- **A hand-priced room line gets no promotion.** Somebody has already decided
  what that room costs, and a discount on top would be a second reduction.
- **`save_property()` refuses a missing check-in, check-out or night audit
  time.** The columns are `not null` and every arrival and departure is timed
  against them, so there is no blank to fall back to. Until 0032 the null went
  straight into the UPDATE and a manager who cleared the field got the raw
  not-null violation back. `audit_close_time` joined them in 0064 and takes the
  same treatment: a cleared field is refused by name rather than quietly
  keeping the old value, which would read as a save that did not save.
  - **0064 DROPPED the five-parameter signature before creating the
    six-parameter one.** A changed parameter list is a new function, so
    `create or replace` would have left two `save_property` functions side by
    side and PostgREST would refuse to choose between them — the overload trap
    that keeps `set_room_photo()` and
    `set_rate_plan_cancellation_policy()` out of the functions they belong to.
- **A property is set up from `/settings`, not from SQL.** Room types, rooms,
  booking sources, tax rates and the property itself are all written through
  RPCs in `src/lib/actions/settings.ts`. Settings lives in the user menu, not
  the nav bar: the client fixed the nine top-level sections and this is not one
  of them.
- **SETTINGS HAS ITS OWN LEFT SIDEBAR, cloned from the reference** (0067).
  The client sent their old system's Settings and asked for it exactly:
  collapsible sections down a dark column, the form on the right with a label
  column ending in colons. **This is a sidebar INSIDE the Settings page, not an
  app sidebar** — the rule that the application's navigation is horizontal is
  untouched. Do not "tidy" it into tabs again.
  - **`src/lib/settings-tabs.ts` is the ONE list of tabs and sections.** The
    page used to keep its own allowed-tab list beside the component's, and the
    two drifted: `rate-plans` and `cancellation` were missing from the page's,
    so both screens silently opened on the property form — including from the
    two links on Inventory → Rates. Add a tab there and nowhere else.
  - **Only sections with something behind them are drawn.** The reference also
    carries Other; there is nothing of ours to put in it, and an empty section
    is a dead control. It goes in when its contents are built. Guest
    Configuration went in with 0073, Communications & Notifications with
    0074-0075, System Settings grew its three with 0076-0078.
  - **FINANCES AND INVENTORY are the reference's labels in its order**
    (0079): Custom Payment Types, Tax Information, Invoice Settings (0080),
    Pos Profiles (0084), Currencies (0083), Accounting Categories (0085),
    Payment Gateway (0086), Accounting Systems (0087);
    Settings (0088-0089), Room Type, Room Setup,
    Cancellation Policy, Rate Plans, Seasons and Events, Discounts (0090).
    Room Type and Room Setup moved there from Hotel Content, where the
    reference does not have them. Both sections now carry every item the
    reference lists. Tab ids did not change, so every existing link still
    lands.
  - **INVOICE SETTINGS (0080-0082) HAS A READER: THE PRINTABLE INVOICE.**
    Nothing printed an invoice before, so `/bookings/[id]/invoice` (linked
    as "Print invoice" on the Folio tab, new tab like the registration card)
    landed with the screen. Five cards, one row (`invoice_settings`), each
    saving only its own columns through its own function via
    `invoice_settings_row()`.
    - **General Invoice Settings — all live.** Company information overrides
      the hotel's name and address as issuer; blanks fall back to the hotel.
      *Show nights breakdown*: one line per night charged, or one per room
      (nights charged less any reversed). *Show room number for extras*: an
      extra carries the booking's room **only when the booking has exactly
      one** — an extra is posted to the booking, not a room, so on a group
      none is guessed. *Are you VAT Registered*: Net / VAT / Total columns
      and a VAT total, or amounts only. The row rules are the pure
      `invoiceRows()` in `src/lib/invoice.ts`.
    - **The invoice never recomputes money.** Lines come from
      `booking_invoice_lines()` over `folio_item_lines` (net and tax split,
      the room a night was charged for, a reversal naming the room of the
      night it reverses); Total, payments and Balance due are the booking's
      own figures, so the printout cannot disagree with the Folio tab.
    - **Logo and Default Notes — live.** The logo is in the PUBLIC
      `hotel-assets` bucket at `<property_id>/invoice-logo/<uuid>.<ext>`,
      checked by the storage policy and again by `set_invoice_logo()`, which
      hands back the replaced path so the old file is removed only after
      Postgres agreed — the room-photo pattern. **Raster only (0081)**: 0080
      allowed SVG, and an SVG in a public bucket runs script when its URL is
      opened directly. Default Notes print at the foot, 255 characters.
    - **Invoice number: the simple increment is live, the custom scheme is
      not.** The invoice prints the booking's primary folio number
      (`folio_number_seq`, the lowest on the booking, made on the first
      charge) — the reference's "simple increment number". The sequence is
      shared across properties, so one hotel's numbers can skip. The fields
      behind "Enable Custom Invoice Number Settings" have not been seen, so
      the switch is stored only.
    - **Rounding Options and Statement Settings are STORED, NOT YET LIVE.**
      Rounding "across whole system" would be a change to every money
      function, not a setting — all money is integer cents in Postgres, and
      None / 2 points is what the system does today. Only "None" and "2
      Points after dot" were seen; the other choices are the ordinary ones.
      There is no account statement yet for the reminder and terms to print
      on.
    - The LOCALE button and translate icons are not copied, as elsewhere.
  - **POS PROFILES (0084) AND CURRENCIES (0083) ARE STORED, NOT YET LIVE.**
    - **Pos Profiles**: "up to one profile per each pos type" is
      `unique (property_id, pos_type)`; the form opens inside the list card,
      as the reference's Create Pos Profile does, and offers only the types
      not yet taken. **THE TYPE LIST IS PROVISIONAL** — the reference's
      dropdown has not been seen open — so `known_pos_types()` holds ordinary
      outlets (Restaurant, Bar, Room Service, Spa, Shop). It and `POS_TYPES`
      in `src/lib/finance-profiles.ts` change together. No POS is connected;
      outlet charges are still posted from the booking's Extras tab.
    - **Currencies: THE DEFAULT IS NOT A ROW.** It is `properties.currency`,
      set in Hotel Details, shown first with a tick and no icons — the
      reference's default row carries none — so one place decides the
      hotel's currency. `currency_profiles` holds the additional ones, each
      with a rate that is "Live Exchange" or a fixed "1 EUR = 20.5 MXN",
      stored as integer millionths (`fixed_rate_micros`) and parsed from the
      typed string without a float. The default cannot be added as a
      profile, and a profile that later becomes the default in Hotel Details
      is not listed twice.
    - **Nothing converts money yet**: no currency switcher on the guest page,
      no foreign-currency invoice (itself a stored Hotel Feature), and "Live
      Exchange" would need a rate feed this project has neither the network
      access nor a key for. The natural first reader is a display-only
      switcher on the guest booking page.
  - **ACCOUNTING CATEGORIES (0085) ARE LEDGER ACCOUNTS, AND THE ACCOUNTING
    REPORT READS THEM.** The reference's list (Name, Internal Code, External
    Code, a pencil and a cross, a Create form inside the card) and Default
    Accounting Categories: four pickers for accommodation, extras, taxes and
    payments, one Save.
    - **NOT THE EXTRAS CATALOG'S "ACCOUNTING CATEGORY".** That one is
      `folio_item_type`, the report bucket a charge lands in (0069). This is
      the account a bookkeeper posts the bucket to. Two levels, one word --
      the reference uses it for both. Pointing an extra at one of these
      instead would be a change to `charge_extra()` and the Extras report,
      and has not been done.
    - **The four defaults are live**: the Accounting report names the account
      and its codes beside every line -- `room_charge` revenue to the
      accommodation default, every other revenue line to extras, every payment
      method to payments, and the Tax figure to taxes. A lookup in the page,
      not a sum; the figures are still Postgres's.
    - **A ROOM TYPE CAN NAME ITS OWN ACCOUNT (0108)**,
      `room_types.accounting_category_id`, null meaning the accommodation
      default, set on the Room Type form. The Accounting report then splits
      its room line per room type -- `accounting_room_revenue()`, room charges
      from `folio_item_lines` attributed to the night's sold type, a reversal
      to the night it reverses -- and posts each to its type's account. **The
      split is drawn only when it adds up to the report's own room line to
      the penny**; otherwise the single line stays, so the page can never
      show two different room totals. A category a room type uses is refused
      on delete by name, like a default.
    - **The reference ships four, and so does every property**: Accommodation,
      Extras, Taxes and Income, seeded by the migration and, for a property
      inserted later, by a trigger on `properties`. `accounting_defaults` is
      one row per property whose four columns are `not null` and point at a
      category `on delete restrict`, so a default can never be empty. A
      category that is a default is refused on delete BY NAME ("Taxes is the
      default for taxes"); any other is genuinely deleted, since nothing else
      points at one.
    - Names are unique per property, case-insensitively. Blank codes are
      stored as null.
  - **INVENTORY -> SETTINGS (0088-0089) IS LIVE, ALL THREE CARDS.**
    - **The two cut-offs govern the guest booking page only**; staff still
      take any booking through `create_booking()`. *Cut-off date*: no online
      stay may include a night after it. *Same-day time*: after it, on the
      HOTEL's clock (`properties.timezone`), nothing arriving today books
      online.
    - **Decided in one place, `public_booking_cutoff_reason()`**, which
      `public_room_types()` puts into `unavailable_reason` ahead of the stay
      rules. The guest page already shows that reason on each room, and
      `create_public_booking()` already refuses whatever it holds, with
      `HP002` -- so the page and a curl cannot disagree. The helper is
      security definer with no grant to anyone; the public surface did not
      grow. The reason is English, like the stay-rule reasons beside it.
    - **The six visibility ticks** take a restriction's entry out of the
      Inventory menu (`hiddenInventoryHrefs()`, joined to the Hotel Features
      list in `(app)/layout.tsx`), make its screen a refusal that links back
      here, and drop its row from the All screen.
    - **A FIELD CANNOT BE HIDDEN WHILE IT STILL HOLDS A VALUE** on a night from
      the business date on, on an active plan. `save_inventory_visibility()`
      refuses by name with the number of nights. A stop sell nobody can see is
      still stopping sales; hiding must never produce that. The All screen
      keeps a hidden row anyway if its window shows a value, which can happen
      looking back into the past.
    - **0089 exists because 0088's saves called `open_business_date()`,**
      which staff cannot execute -- every save raised a permission error. They
      read `business_dates` under RLS now. Found by the rolled-back test
      before any code shipped.
  - **INVENTORY -> ROOM TYPE AND ROOM SETUP (0091)**, cloned from the
    reference. `src/components/settings/room-panels.tsx`.
    - **Room Type**: Display Name (with the code), Room Type, Occupancy, a
      drag handle, a pencil and a cross, "+ Add Room Type".
      - **`display_name` is what a GUEST reads**; `name` stays the staff name
        every screen, report and grid uses. `public_room_types()` returns
        `coalesce(display_name, name)` in its existing `name` column -- same
        shape, so the booking flow was not touched. Null reads as the name.
      - **The drag order is `sort_order`**, which the calendar, the inventory
        grids and the guest page already sort by (`set_room_type_order()`,
        arrow keys on the handle as on Tax Information).
      - **A ROOM TYPE CAN BE DELETED IF NOTHING WAS BUILT ON IT**: no room, no
        booked room, no waitlist entry, no virtual type. Its prices,
        restrictions, offer links and facility ticks go with it by cascade.
        `delete_room_type()` refuses the rest by name. A BOOKED type still
        stays for ever.
      - **THE CROSS IS ON EVERY ROW AS OF 0108**, at the client's request
        ("Add Room Types option should have delete option"). It was drawn
        only on a type with no rooms, which on a set-up property is none of
        them. `delete_room_type(p_room_type_id, p_with_rooms)` now takes the
        type's rooms with it when asked, **provided none of those rooms was
        ever booked** -- a room typed in by mistake, a type set up and never
        sold. The confirmation says how many rooms go. A type with booked
        rooms is still refused by name, with the count: `booking_rooms`
        points at it under `on delete restrict` and a reservation keeps
        saying what it was sold as. **On the hosted property all four types
        have been booked**, so all four refuse; tell the client that is the
        rule working, not the button failing.
      - **The list carries Pictures, Available Facilities and Accounting
        Category** (0108), the client's "more information in Room Types":
        the first picture and a count, up to five facility icons and "+n",
        and the type's account or the accommodation default.
      - **A ROOM TYPE HAS ITS OWN PICTURES (0108)**, `room_type_photos`, up to
        twelve, uploaded on its form (`room-type-photos.tsx`) to the public
        `room-photos` bucket at `<property>/room-types/<type>/<uuid>.<ext>`.
        The browser uploads under its own session and `add_room_type_photo()`
        records the row, checking the path names this property and this type;
        a refused row takes its file back out, and deleting the type hands
        back its paths so the files go too. The room-photo pattern exactly.
      - Occupancy shows sleeps and, where the maximum is higher, "+ extra".
        The reference's children figure has no column here and is not faked.
    - **VIRTUAL ROOM TYPES ARE STORED, NOT YET SOLD** (`virtual_room_types`:
      display name + parent). Selling one means a booking, a rate row and an
      availability rule that resolve to the parent -- a change to how
      inventory is counted, to be asked for.
    - **Room Setup**: Name/Number, Room Type, Property, Priority, Available
      Online, Enabled, Key Code, Common Door Name, Color, Divider, a pencil
      and a cross, "+ Add Room" (one room, in a dialog) and "Use Booking Room
      id as Key Code". Search and paging stay, in Postgres -- the ~1,800 rule.
      "+ Add Rooms in a Run" stays beside Add Room; it is not the reference's
      but a large property cannot be entered one room at a time.
      - **AVAILABLE ONLINE IS LIVE**: `public_room_types()` counts only rooms
        available online as sellable on the guest page. Staff sell them all.
      - **ENABLED IS LIVE, AND A DISABLED ROOM IS LOCKED OUT OF ORDER.**
        `set_room_enabled()` sets it `ooo` -- which every availability,
        occupancy and house count already excludes, so no report was
        rewritten -- and two triggers hold it there: `rooms_disabled_stays_ooo`
        refuses any status change while disabled (check-in, the housekeeping
        menu and report, `set_room_status()`), and
        `booking_rooms_not_in_disabled_room` refuses putting a booking in one
        (`assign_room()` and anything else). A check constraint says the same.
        Disabling is refused while a guest is in the room or a live booking is
        assigned from the business date on; enabling returns it dirty.
      - **Color and Divider are live on the calendar rail**: the colour is an
        inset stripe on the room number (a style, since it is data), the
        divider a heavier rule under the row. `calendar_rooms()` returns both.
      - **Stored**: Priority (nothing allocates rooms automatically), Key
        Code, Common Door Name, and the key-code setting (no door-lock
        system). `set_room_setup()` is its own function, not parameters on
        `save_room()` -- the overload trap again.
  - **INVENTORY -> DISCOUNTS (0090) IS STORED, NOT YET APPLIED.** The
    reference's search box, list (Title sortable, Type filterable, Amount) and
    Add Discount dialog: Title, Amount with a % or currency prefix, Type as
    Percent or Fixed. Each row carries a ringed pencil and a ringed bin, as
    the reference's do (the first build had none, from a screenshot without
    them); Title and Amount both sort, Amount putting percentages before
    fixed sums since the two are not one scale.
    - **The amount is never a float.** Percent is `percent_bps` (1000 = 10.0 %)
      parsed from the typed string by `parsePercentBps()`; Fixed is
      `amount_cents` in the property's currency. A check constraint makes each
      kind carry exactly its own column, and switching kind drops the other.
    - **NOTHING TAKES A DISCOUNT OFF A STAY YET.** Applying one is a money
      change -- to a booking's nights before the audit, or to the folio after
      it -- and the folio path that exists, `post_discount()` (0003), posts
      every discount with a zero tax split and nothing in the app calls it.
      On a VAT-inclusive rate that overstates the tax. Fix that function, or
      discount the nights instead, when this is wired -- and ask first.
      Offers (promotions) are still what reduces a stay automatically.
    - Genuinely deleted: nothing points at a discount.
  - **CONNECTIVITY -> CHANNEL MANAGER (0097) IS STORED, NOT YET CONNECTED.**
    The reference's list (Title, Is Active, Is Synced, Synced At) and ADD
    CHANNEL offering Site Minder or Vertical Booking, each with its own form
    inside the card (`channel-manager-panel.tsx`). One connection per
    provider per property; the menu offers only the ones not yet added.
    Sales Channels (`channels`) sits after it in the same section.
    - **Nothing syncs.** There is no SiteMinder or Vertical Booking code and
      OTA bookings are still entered by hand (open decision 2). Is Synced
      reads No and Synced At is blank, which is true. When a sync lands it
      needs the idempotency keys and `channel_sync_log` that decision names.
    - **THE PASSWORD IS IN SUPABASE VAULT AND IS WRITE-ONLY.** A third party's
      login cannot sit in a row every member of staff can select -- the rule
      the payment gateway table keeps. `save_channel_manager()` writes it with
      `vault.create_secret()` and the row holds only `password_secret_id`;
      `authenticated` and `anon` have no access to the vault schema (tested),
      so no browser and no staff session can read it back. The form shows
      "Saved" and a blank field keeps it. A sync job reads it on the server.
      That is why the two writes are `security definer`: they check
      `is_revenue_staff()` and the property themselves, and the table grants
      staff SELECT only. `delete_channel_manager()` removes the secret too.
    - Site Minder: username, password, Hotel Code, Region, Days to sync, one
      "Room & Rate configuration" CSV. Vertical Booking: username, password,
      Requestor ID, Hotel ID, Days to sync (400 by default, as theirs), Room
      and Rate CSVs, "Sync as multi occupancy rates". Fields of the other
      provider are cleared on save. Hotel Code and Hotel ID are one column.
    - **The CSVs are stored as text on the row** (256 KB each, with the file
      name), downloadable again; their format has not been seen, so nothing
      parses them. **PROVISIONAL:** the Region list (EMEA, APAC, Americas) and
      the Days to sync choices beside 400 -- neither dropdown was seen open.
      Both are in `src/lib/channel-managers.ts` and the 0097 checks.
  - **CONNECTIVITY -> SALES CHANNELS (0099) IS `channels`, the booking
    sources** -- it replaced the Booking Sources screen, not a second list
    beside it (`sales-channels-panel.tsx`). The reference's Active | All |
    Draft, tickboxes and MERGE, Name / Abbreviation / Status and a pencil,
    the Create form under the table, ADD NEW SALES CHANNEL.
    - **Abbreviation is `code`** (unique per property, upper-cased, 12 at
      most), the one the calendar bar shows. **Draft is `is_active = false`**,
      which `create_booking()` has always refused -- and the guest page's
      direct channel too, so drafting the only Direct stops online booking.
    - **Kind and commission stay on the form** though the reference's has
      neither: settlement and the channel report's commission come from them.
    - **Associated Customer is `channels.customer_id`**, picked by search
      (`customers_page()`). STORED, NOT YET READ: nothing bills a channel's
      bookings to it. `merge_customers()` follows it.
    - **MERGE moves every booking of the others onto the one kept, then
      deletes the others** (`merge_channels()`, security definer like the
      customer merge, logged). Nothing else points at a channel. The moved
      bookings take the keeper's commission in the channel report, which
      reads it at run time; the dialog says so. With fewer than two ticked
      the button says to tick two rather than being disabled.
    - `save_channel()` was DROPPED and recreated with `p_customer_id` -- the
      overload trap.
  - **CONNECTIVITY -> KEY LOCK SYSTEMS (0102) AND HOUSEKEEPING SYSTEMS (0103)
    ARE STORED, NOT YET CONNECTED.** The reference's list ("No Data" when
    empty) and Add offering the category's systems -- Flexipass or Remotelock,
    and Sweeply -- one connection per provider. **One table,
    `system_connections`, one panel, `system-connections-panel.tsx`**: 0103
    renamed 0102's `key_lock_systems` and added `category`, which a check
    constraint ties to the provider, rather than copying the table, its policy
    and its two vault-touching functions for a second provider list. Add a
    third category there (a constraint line, a case in
    `save_system_connection()`, an entry in `SYSTEM_CATEGORIES`), not beside it.
    - Nothing talks to a lock and no door code is issued; what a lock
      connection will use is already on the rooms (Key Code, Common Door Name,
      "Use Booking Room id as Key Code", 0091). Nothing is sent to Sweeply;
      housekeeping status is still set from the calendar dot and the
      Housekeeping report.
    - **The secret is write-only in Supabase Vault**, exactly as a channel
      manager's password (0097): security definer writes, SELECT-only table,
      the form shows "Saved", deleting removes the secret.
    - **THE FIELDS ARE PROVISIONAL** -- no form was seen: RemoteLock Client ID
      + Client secret (its OAuth client credentials), Flexipass Account + API
      key, Sweeply Property ID + API key. Labels live in
      `src/lib/system-connections.ts`.
  - **OTHER -> TEMPLATES (0105) IS LIVE: THE HOTEL'S OWN INVOICE LAYOUT.**
    The reference's "Folio/invoice template" -- Preview Folio Number, a
    Liquid editor and a CSS editor (line numbers, full screen), Is Active,
    PREVIEW, LOAD DEFAULTS, SAVE TEMPLATE; "?" lists the variables and the
    columns icon stacks the editors (`templates-panel.tsx`). With Is Active
    ticked, `/bookings/[id]/invoice` prints the template instead of the
    built-in layout. One row per property per kind; only `folio` exists.
    - **ONE INVOICE, TWO LAYOUTS.** `loadInvoice()` in `src/lib/invoice-data.ts`
      is what both are filled from, so a template arranges the figures and
      can never arrive at different ones. `invoiceLiquidData()` hands a
      template money already FORMATTED by `money.ts` beside its `_cents`, so
      no template does arithmetic on money. `TEMPLATE_VARIABLES` in
      `invoice-template-defaults.ts` lists them for the "?" popover; the two
      change together. LOAD DEFAULTS is the built-in invoice written in Liquid.
    - **THIS IS BROWSER-TYPED HTML PRINTED IN EVERY STAFF SESSION, and it is
      only acceptable because of `src/lib/document-template.ts`, the one place
      a template is rendered.** Unsanitised, a manager could plant script that
      runs in an administrator's session. So:
      - **The output goes through `sanitize-html` on the server**: layout tags,
        images and links with class and style; no script, event handlers,
        `javascript:` URLs, iframes, objects, forms -- and no `id`, which can
        shadow a global the page's own scripts read.
      - **Output is escaped by default** (`outputEscape`): a guest's name comes
        from the public booking page and prints as text. `| raw` is the
        template author's explicit opt-out, and the sanitiser still runs after.
      - **The CSS cannot close its own `<style>`**: every `<` is written as a
        CSS escape (`safeCss()`).
      - **Liquid cannot read files**: `include`, `render` and `layout` look in
        a file system with nothing in it. Parse, render and memory limits stop
        a runaway loop; only own properties are readable. Each was tried
        against the engine, not assumed.
      - **The preview is in a sandboxed frame** (`sandbox=""`: no script, no
        same origin) as well, so a gap in the sanitiser could not reach the
        settings session either. The printed invoice cannot be framed that
        way -- a frame does not print past its own height -- so there the
        sanitiser is the defence.
    - **The rest of the app is still plain text, deliberately.** The notes
      elsewhere that say "no sanitiser in this codebase" were true when
      written; there is one now (`liquidjs` and `sanitize-html` are
      dependencies as of 0105), but moving the registration card, email
      templates or booking-engine documents to HTML is its own decision.
    - A template that fails to render prints the built-in layout, with the
      error above it on screen only. PREVIEW takes a folio number (a meeting
      room folio is refused by name) or, blank, fills a sample invoice dated
      by the business date. Not copied: the pencil beside the title, whose
      action has not been seen.
  - **COUNTRY-SPECIFIC SETTINGS IS NOT DRAWN.** The reference's is an empty
    page for this hotel ("settings that are specific for your country, if
    present"); an item with nothing behind it is a dead control. It goes in
    when a country needs something -- a fiscal invoice scheme, a police
    guest register.
  - **OTHER -> REACTIONS (0104) IS STORED, NOT YET RUN.** The reference's
    list (Title / Description, Event as bullets, Enabled, copy, edit, delete),
    the Triggers | Tasks switch, ADD REACTION and the form -- Task, Title,
    Description, Conditions (All / Any match, Add Condition, Add Group, two
    levels of nesting) and Triggers (Create new trigger) -- in
    `reactions-panel.tsx`. "Triggers" lists each event with the reactions it
    would fire; "Tasks" is the list. Copy opens the form as a new reaction.
    - **NOTHING FIRES A REACTION, and the two tasks have nothing to act on.**
      Both are about PREPAYMENTS -- convert them to charges on check-in,
      redeem them on cancellation -- and this schema has none: a payment
      taken before arrival is already a payment on the folio (the Deposit
      report's reading). Running either would change how money posts to
      append-only tables, which is to be asked for, not slipped in.
    - **A trigger is an event**, several per reaction, an array on the row.
      **Conditions are a jsonb tree** (`{match, items}` of `{field, op,
      value}` or nested groups) checked by `reaction_conditions_check()`:
      known fields and operators, greater/less than only on numbers, a
      channel, room type or rate plan that is on this property, a country
      code, at most three levels and thirty conditions. Rows with no field
      chosen are dropped on save.
    - **PROVISIONAL, because no dropdown was seen open**: tasks beyond the two
      shown, events beyond "After check in" and "After booking cancellation",
      and every condition field and operator. `src/lib/reactions.ts` and the
      0104 checks change together.
    - Cancel and Save use this app's buttons, not the reference's orange and
      green: those are not in the design tokens.
  - **CONNECTIVITY -> API KEY AND DEVELOPER KEYS (0101) OPEN A READ-ONLY
    PUBLIC API, at the client's request.** `/api/public/v1/<property>/` --
    the reference's "Endpoint" -- with `room-types`, `rate-plans`,
    `availability?from=&to=` and `rates?from=&to=&rate_plan=` (nights
    inclusive, at most 366). JSON `{ "data": ... }`, money as integer
    `rate_cents` with the currency beside it, a null rate is "no rate loaded".
    Screens in `api-keys-panel.tsx`; routes in `src/app/api/public/v1/`,
    helper `src/lib/public-api.ts`.
    - **THE ONE EXCEPTION TO "NO API ROUTES"**, and read-only. Writing through
      it (a booking push) is its own decision: it would go through
      `create_public_booking()`'s limits, never `create_booking()`'s.
    - **No service-role key, no session.** A route calls one `api_*`
      `security definer` function as `anon`; each calls `api_authorize()`
      FIRST -- unknown, revoked or other-hotel key raises HA401, a developer
      key without the endpoint's permission HA403, a bad range HA400 -- and
      the route maps those to 401/403/400, anything else to a bare 500. An
      unknown property answers exactly like a bad key. `api_authorize()` is
      granted to nobody.
    - **Keys: `Authorization: Bearer` or `X-Api-Key`, NEVER the query string**
      (a key in a URL lands in every access log). `api_keys` holds the hotel's
      one API Key (`kind = 'main'`, every permission) and named Developer Keys
      (permissions per endpoint, Is Active, delete). **Only a SHA-256 hash is
      stored**: a key is shown in full once, when made, then only as a hint.
      This is a deliberate difference from the reference, whose key stays on
      screen -- which is how a live one reached a screenshot in this project's
      chat. Regenerating the API Key, unticking Is Active or deleting stops a
      key at once. Revenue staff only, even for hints.
    - **One copy of the inventory logic.** `inventory_grid()` is now a wrapper
      round `inventory_grid_for(property, ...)`, which the API reads too --
      the `stay_rule_violation_for()` move. Output unchanged (tested).
    - `/api/public/` is excluded from the middleware matcher: no session to
      refresh, and it must never redirect to /login.
    - **Not done: rate limiting** (belongs in front of the API, like the guest
      endpoint's), CORS (server-to-server use; a key in browser code is a
      published key), and a last-used date (the read path writes nothing).
      **The permission names are ours** -- the reference's list was empty.
  - **CONNECTIVITY -> BOOKING WIDGET (0100) IS LIVE.** The reference's Saved
    Widgets (hash code, edit, delete, "Create new widget") and the widget form
    -- five texts with 0/255 counters, "Show occupancy options", "Use Checkout
    Date Instead Nights Count", month and weekday names, five colours with a
    swatch, a language -- in `booking-widget-panel.tsx`. Saving shows the
    embed code (Copy, Open).
    - **The embed code is an `<iframe>` of `/book/widget/<hash>`** (a static
      segment, so it wins over `/book/[propertyId]`, and public like all of
      `/book/`). An iframe, not a script tag: nothing of ours runs in the
      hotel's page and the hotel's page cannot reach into ours. The page
      clears the app's grey body so the widget sits on the hotel's own
      background.
    - **The widget is a plain GET form with `target="_top"`** to
      `/book/<property>` with `lang`, `from`, `to` and, with occupancy on,
      `adults` and `children` (`embed-widget.tsx`). Its calendar draws from
      names made on the server -- the hotel's own twelve and seven if it wrote
      exactly that many, else the language's (`customNames()`,
      `src/lib/i18n/calendar-names.ts`, now shared with the booking page) --
      and "today" is the hotel's, in its own zone.
    - **The hash is public** (it is on the hotel's website), so
      `public_booking_widget()` answers it with the look, the property id and
      the language, and nothing else. Eight hex, unique, kept on edit.
    - Blank texts fall back to the widget's defaults; a language the hotel no
      longer offers falls back to its default. **"Currency (optional)" is NOT
      copied**: one currency per property and nothing converts.
  - **CONNECTIVITY -> BOOKING ENGINE SETTINGS (0098) IS LIVE on the guest
    booking page.** `booking-engine-panel.tsx`: Booking Engine Profiles
    (Title, Slug, Link, ADD NEW PROFILE), then the Privacy Policy and the
    Terms & Conditions under one Save.
    - **A profile narrows the guest page to its room types**:
      `/book/<property>?profile=<slug>`. It is a presentation filter, NOT a
      security boundary -- `create_public_booking()` is unchanged. A profile
      with no room types ticked, an unknown slug or none shows every room.
      The edit form (Title, Slug, Room types) is PROVISIONAL: the
      reference's was not seen.
    - **Default and one profile per room type are not rows.** Default is the
      page as it is; each room type answers to `__room_type_<first 8 hex of
      its id>` (`room_type_profile_slug()` and `roomTypeProfileSlug()` agree),
      drawn italic and not editable, as the reference lists them. A hotel
      slug cannot start with `_`, so the two can never collide.
    - **The privacy policy and terms are linked beside the agreement tickbox**
      and open `/book/<property>/privacy` and `/terms` (the latter 404s when
      there are none). The hotel's words are not translated; the two link
      labels are, in all nineteen languages.
    - **PLAIN TEXT, NOT THE REFERENCE'S RICH-TEXT EDITOR** -- serving
      browser-typed HTML to anonymous guests with no sanitiser is the
      injection path the registration card already refused. "## " is a
      heading and "- " a bullet; `parseDocument()` makes blocks and
      `PlainDocument` draws text nodes only.
    - **No stored privacy text is the DEFAULT policy**, `DEFAULT_PRIVACY_POLICY`
      in `src/lib/booking-engine.ts`, and saving it unchanged stores nothing,
      so it stays the default. DROP IN'S inserts `{{hotel_*}}` placeholders
      at the cursor; the guest page fills them from the property's Hotel
      Details (the country by name), and an empty detail leaves no stray
      comma. **The default wording is ours, not a lawyer's** -- worth the
      hotel reading before relying on it.
  - **PAYMENT GATEWAY (0086) AND ACCOUNTING SYSTEMS (0087) ARE STORED, NOT
    YET LIVE, BY DECISION.** The client: gateways are connected per client, as
    each asks for one. A row says which gateway or ledger the hotel uses; no
    payment goes through one and nothing is exported to one.
    - **NEITHER TABLE HOLDS A CREDENTIAL, AND NEITHER EVER SHOULD.** Anybody
      the select policy admits can read a row. When a gateway or ledger is
      wired its secret key or OAuth token lives on the server, and a
      publishable key is the most a row could carry. See "Card capture is not
      built" for how a gateway is meant to land.
    - **Payment Gateways**: Title and Is Default, as the reference's. The
      providers are the two the reference lists, Stripe SCA and ChannexPCI --
      `known_payment_gateways()` and `PAYMENT_GATEWAYS` change together. The
      title starts as the provider's name and stays editable. One default per
      property by a partial unique index; ticking Default on one stands the
      old one down. The reference draws no cross on ChannexPCI -- a system
      gateway there; there are none here, so every row can be deleted.
    - **Accounting Systems**: the reference's empty state and Add button are
      all that has been seen, so the list (System, Is Enabled) and **THE
      PROVIDER LIST ARE PROVISIONAL** -- QuickBooks Online, Xero, Sage, in
      `known_accounting_systems()` and `ACCOUNTING_SYSTEMS`. One row per
      system. The Accounting Categories' External Code is what an export
      would key by.
  - **COMMUNICATIONS & NOTIFICATIONS IS STORED, NOT YET SENT** (0074, 0075) --
    Hotel Emails Preferences and Email Setup, cloned from the reference, all
    in one row per property, `hotel_email_settings`.
    - **Nothing in this system sends email.** There is no mail provider and
      no key in any environment (see the booking Email tab notes). These
      screens are the same standing as `audit_close_time` before its job: a
      hotel's choices kept so they are in place the day sending exists. Do
      not describe them to a client as working notifications.
    - **Six of the eight Email preferences are channel-manager events** --
      a booking, change or cancellation ARRIVING from an OTA, a missing
      booking, an overbooking on arrival, a rate-mapping error. None can occur
      while OTA bookings are entered by hand (open decision 2). They are
      copied because the client asked for the screen exactly; the ids are
      checked in `save_hotel_email_settings()` and listed in
      `src/lib/email-preferences.ts`. A kind never saved reads as active, as
      the reference ships every one ticked.
    - **"Booking Notification Email Address" on Email Setup and "Emails that
      will be used for notifications" on Hotel Emails Preferences are ONE
      column**, `notification_emails`. The reference shows the same addresses
      on both pages; two lists meant to be one would drift.
    - **Each Email Setup section saves only its own columns** through its own
      function, via `hotel_email_settings_row()`, which makes the row if it is
      not there. Saving General never clears Post Departure, and one colour
      changed merges over the stored set rather than resetting the others.
    - **Email Templates is the one part with a reader today**: the booking
      screen's Email tab offers them when recording a message and fills the
      subject and body, which stay editable. `emailTemplates` is a REQUIRED
      prop on `BookingDetailView`, like `extrasCatalog`.
    - **Bodies, footers and notes are plain text**, the same reason as the
      registration card's terms: the reference's rich-text editor would mean
      storing browser-typed HTML and sending it back out, with no sanitiser
      in this codebase. "Open template editor" opens a plain-text dialog.
  - **SYSTEM SETTINGS IS THREE SCREENS: Hotel Features (0076), Calendar
    Settings (0077) and Language Settings (0078)**, cloned from the
    reference, above Staff. Each is one row per property, read by everyone
    on the property and written by revenue staff under RLS.
    - **HOTEL FEATURES: FOUR SWITCHES ARE WIRED, SIXTEEN ARE STORED.**
      `src/lib/hotel-features.ts` is the list, with a `wired` flag on each.
      - *Enable Housekeeping Feature* off takes the Housekeeping Report out of
        the Reports menu, makes the report itself a refusal
        (`ReportFeatureOff`, which names the switch and links here), and
        removes the housekeeping dot from the calendar's room rows.
      - *Enable Housekeeping Status Modification Feature* off leaves the dot as
        a plain light rather than the menu, and drops the report's "Mark it"
        column. `CalendarBoard` takes `housekeeping: "off" | "view" | "edit"`
        as a REQUIRED prop.
      - *Enable Group Booking Feature* off takes "Add Group Booking" out of the
        Bookings menu and the group wording off `/bookings/new`. It does NOT
        stop a booking carrying several rooms: that is what
        `create_booking()` has always taken from the simple form, and refusing
        it would break a family booking two rooms.
      - *Enable Accounting Report* off does the same as housekeeping for the
        Accounting Report.
      - Menu entries are hidden by `hiddenNavHrefs()`, computed in
        `(app)/layout.tsx` and handed to `TopNav` as a REQUIRED prop, which
        filters one list for both the bar and the drawer.
      - **The two housekeeping switches default ON**, unlike the reference's
        screenshot, because that is what this application already did; a
        switch arriving must not quietly take a working screen away. The
        other eighteen default to the reference's ticks.
      - **`payment_edit` will never be wired as its label reads.** Payments
        are append-only; a correction is a reversing row.
      - The reference's "Superadmin settings" heading has nothing under it and
        is not drawn.
    - **CALENDAR SETTINGS: TEN OF SIXTEEN ARE WIRED.** Everything the board
      needs is set ONCE as CSS variables on its card (`--cal-radius`,
      `--cal-weekend`, `--cal-pay-*`, `--cal-company`, `--cal-group`), so no
      row or bar is handed the settings and a hotel's colour never becomes a
      Tailwind class. `CalendarBoard` takes `look` as a REQUIRED prop.
      - **The value badge carries the payment state** in the Unpaid / Partially
        Paid / Paid colours. It used to repeat the status colour, which the
        edge and the word already carry. The text colour follows the fill
        (`inkOn()`), because white is unreadable on the reference's own amber.
      - **Payment state is worked out in `calendar_room_bars()`, per booking.**
        Owed is the LARGER of what the stay is worth (its live nights, the
        bar's own value formula) and what its folios have been charged. The
        folio alone would call every future booking paid, since nothing is
        charged before the audit; the nights alone would ignore extras. A
        booking `prepaid_to_channel` is paid, because prepaid bookings never
        read as cash owed at this desk. Checked against the hosted bookings
        before it shipped.
      - **Company and group are a stripe** down the bar's leading edge, company
        winning when both apply. A group is more than one live room.
      - **Weekend Border Color** edges Saturday and Sunday columns, grid and
        header, with an inset box-shadow so no column changes width. The
        reference's default is nearly the grid-line colour; that is theirs.
      - *Use Rounded Corners* is the bar radius. *Show seasons* off removes the
        season names and fills but KEEPS THE STRIP: the paging chevrons live
        on it. *Hide cancellation area* removes the Cancelled band and skips
        its read. *Show channel abbreviation* shows `channels.code` on the bar;
        the calendar page nulls it when off, so the board never knows.
      - **Name order is decided in Postgres**, by `calendar_guest_name()`
        reading `last_name_first`, in both `calendar_room_bars()` and
        `calendar_bookings()`. Before 0077 the two disagreed -- the room rows
        said "Anna Smith" and the Cancelled band "Smith, Anna".
        `customer_display_name()` is untouched and still used everywhere else.
      - **Stored, not live:** Room Blocker Color (there is no room blocker),
        the two "intersect checkout date" switches (bars are whole columns,
        and half-column bars would collide in the lane packing), fixed width
        for zoom (columns are always fixed here) and Show waitlist.
      - Reset puts the form back to the reference's values and saves nothing
        until Save.
    - **LANGUAGE SETTINGS DRIVE THE GUEST BOOKING PAGE**, which is the only
      part of this system that speaks more than one language. The default is
      what a guest lands on without `?lang=`, a `?lang=` the hotel does not
      offer falls back to the default, and the picker lists only the supported
      set -- and is not drawn at all with one language, since a menu of one is
      a dead control. `public_language_settings()` is the one new function on
      the public surface; a failed read falls back to every language and
      English, so a preference can never take the booking page down.
      - Two cards, two Saves, two functions. Postgres refuses a default that is
        not supported, and unticking the default, by name.
      - **The nineteen codes are listed in Postgres too** (`known_locales()` and
        the table's check), because SQL cannot read `locales.ts`. Adding a
        language is a dictionary, a line there and both SQL lists.
      - The reference's "LOCALE: ES" button is not copied, as on Hotel Details.
      - These are the GUEST page's languages. The staff application's twelve
        are a different list, chosen per person in the user menu (0106).
  - **GUEST CONFIGURATION IS THREE SCREENS, AND EACH IS READ BY SOMETHING**
    (0073) -- Guest Registration Form, Identification Types, Guest Details
    Settings, as the reference's.
    - **Identification types** are the pick-list in the Identity band of a
      guest's Customers form (`customers.identification_type_id`). With one
      chosen, the number beside it is the DOCUMENT number, so those two
      labels on the form read "Document number" and "Document expiry" now;
      the columns are still `passport_number` and `passport_expiry`, which the
      Immigration report reads. A type still on a guest record is refused by
      name rather than deleted.
    - **Additional guest fields** (`guest_fields`: a label and a kind -- text,
      number, date or yes/no) appear in an "Additional details" band on the
      same form. Values live in `customers.custom_fields` as jsonb keyed by
      field id, written by `set_customer_details()`, which drops any key that
      is not a current field. The list saves as a whole, like the reference's
      single SAVE; `GuestDetailsPanel` is keyed on the saved list so rows added
      before a save pick up their ids -- without that, saving twice added them
      twice.
      - **`merge_customers()` carries both across, as of 0099.** The
        identification type travels WITH the document number it describes: a
        keeper with no number takes the duplicate's number and its type; a
        keeper with a number keeps its own type. Additional field values fill
        the keys the keeper lacks, and the keeper's own always win.
    - **The registration form** (`registration_form_settings`: two custom
      questions and the terms) prints on a booking's **Guest Registration
      Card**, `/bookings/[id]/registration`, linked from the Guests tab. The
      card fills in the stay and the guest's record -- identity, document,
      additional fields -- leaves blank lines where the record is blank so
      the guest can write, and ends with a signature line. The top bars are
      `print:hidden`, so Print gives the card alone.
    - **The terms are plain text, not the reference's rich-text editor.** HTML
      typed in a browser and printed back out is a script-injection path with
      no sanitiser in this codebase; line breaks are kept, which is what a
      card someone signs needs. The LOCALE picker and translate buttons are
      not copied either, as elsewhere.
  - **Hotel Details is `save_property_details()`; the times are
    `save_property_times()`.** Two functions because they are two forms with
    two Save buttons, and each saves only what it shows. `save_property()`
    still exists and is called by nothing.
  - **Hotel Properties is the reference's Properties list: one row, a pencil,
    and NO "Add New Property" and NO delete.** A staff login belongs to exactly
    one property — `staff_users.property_id` is a single column and
    `current_property_id()`, the root of every RLS policy, reads it. A property
    added from here would be one nobody could open, and every table points at a
    property under `on delete restrict`, so the trash can could only ever be
    refused. Both are the dead control this application does not ship. Adding
    them means staff belonging to several properties and a property switcher —
    a change to every policy, to be asked for rather than slipped in.
    - The pencil opens check-in, check-out and night audit times, which the
      reference's Hotel Details does not carry. The address column is written
      the reference's way round: postcode, city, region, then the street.
    - Their "LOCALE" picker is not copied. It chooses which language the
      hotel's content is edited in, and nothing here is stored per language.
  - **HOTEL CONTENT -> HOTEL POLICY is `property_policies`** (0068), cloned
    from the reference: Children, Pets, Smoking, Internet Access, Parking and
    Other Policies. Each of the five is one of the reference's listed options,
    "Custom policy" with the hotel's own words, or "Omit this policy".
    - **One row per property, and none until the page is first saved.** No row
      reads as every section omitted, never as "All ages welcome": a default
      here would put words in a hotel's mouth, the same reason a cancellation
      policy reads "Not set".
    - **The options live in `src/lib/hotel-policies.ts`**, and their ids are
      the values a check constraint allows. Adding an option is both: a line
      there and a constraint change in a migration.
    - **Custom text exists only beside "Custom policy"**, enforced by a check
      constraint. Switching away from Custom drops the text rather than
      refusing; choosing Custom with nothing written is refused by name.
    - The sentence above Save is the choices as a guest would read them,
      assembled by `hotelPolicySummary()` from the form as it stands.
    - **The guest booking page shows it** (0071), through
      `public_hotel_policies()`. The client: "if it's for guest, we should let
      them know" -- the hotel set it and knows it; the guest is who needs
      telling. The section titles and the listed options are translated into
      all nineteen guest languages; Custom text and Other Policies are the
      hotel's own words and are shown as written, like its cancellation
      wording. A hotel that never saved the page shows no policies card at
      all. It stays on screen through the details step, so a guest reads it
      before confirming.
    - The labels are the reference's exactly, "Free Wifi" beside "Free WiFi"
      included. Its prompt lines are kept, as the label of each group of
      options rather than explanation. "Let you guests know" was a typo and
      reads "your".
    - The reference's LOCALE picker and per-field translate button are not
      copied, for the same reason as on Hotel Properties.
  - **HOTEL CONTENT -> EXTRAS is a catalog: `extra_categories` and `extras`**
    (0069), cloned from the reference -- a categories table with Title and
    Taxes, then a searchable, paged extras table with Title, Category, Is
    Meal, Price, Taxes and Accounting Category.
    - **It is the menu, not the ledger.** A charged extra is a folio item that
      COPIES the title, type and price when posted and holds no foreign key
      back. So repricing, renaming or deleting an extra restates nothing
      already billed -- which is why an extra is genuinely DELETED, like a
      season, rather than retired like a tax rate.
    - **A category with extras in it is refused by name**, never cascaded.
    - **"Accounting Category" IS `folio_item_type`**, limited by a check
      constraint to the five a person may post: food and beverage, laundry,
      minibar, transport, miscellaneous. It is the bucket the Extras,
      Financial and Accounting reports already split by, so a new extra lands
      in the right report line with nothing else to set.
    - **"Is Meal" is not stored.** The fork and knife is drawn on any extra
      whose accounting category is food and beverage. A separate flag would be
      a second way to say one thing, free to disagree with the first.
    - **Tax is the extra's own rate, else its category's, else none**, decided
      in `charge_extra()`. The list shows an inherited rate faint and an own
      rate solid, so it is visible which one applies without a sentence
      saying so.
    - **The arrows icon is MERGE** (0071), which the client explained after it
      was first left out: "Merge <extra> to:" with a searchable picker, as
      theirs. `merge_extra()` keeps the target, removes the source from the
      catalog, and writes "Extra X merged into Y" to the activity log.
      - **Nothing in the ledger moves, and nothing has to.** A charged extra
        copied its title and price onto the folio item and points at no
        catalog row, and the Extras report groups by accounting category. So
        a merge is "these two are one thing, keep this one" -- which is what
        it is for -- and never a rewrite of posted money.
      - The reference's split between rows that can be deleted and rows that
        cannot is not copied: there are no system extras here, so every extra
        a hotel added, it can remove.
    - **A CATEGORY merges too** (0072), through the same dialog.
      `merge_extra_category()` moves every extra in the source to the target
      in one transaction, then removes the source, and logs how many moved.
      A moved extra with no tax rate of its own takes its NEW category's
      rate from then on; nothing already posted changes.
    - Search and paging are in the browser. The catalog is dozens of rows,
      not thousands, so the ~1,800 rule does not reach it -- the same
      judgement as meeting rooms.
  - **HOTEL CONTENT -> ROOM TYPE FACILITIES is `facilities`, and they are
    ticked on room types through `room_type_facilities`** (0070). The screen
    is the reference's: Icon (glyph and its name), Title, edit, delete,
    "+ Add Facility".
    - **The link is the point.** The reference's own name says facilities
      belong to room types, and a list attached to nothing would be a screen
      whose only effect was itself. The Room Types form carries a tick per
      facility and saves the set with `set_room_type_facilities()`, which
      takes the WHOLE set, for the same reason `set_rate_plan_meals()` does.
    - The room type saves first and the facilities second, so a new type has
      an id to tick against. Two calls rather than one transaction, which is
      acceptable here because it is content: a failure leaves the type saved
      with its old ticks, and says so.
    - **The icon is one of ten**, checked by `facilities_icon_known` and drawn
      by `facility-icon.tsx` from `FACILITY_ICONS` in `src/lib/facilities.ts`.
      There is no icon library in this app; ten strokes in one file were
      cheaper than adding one. Adding an icon is all three.
    - **A facility is genuinely deleted** and comes off every room type it was
      on -- it describes a room, it is not a record of anything that happened.
    - **The guest booking page shows them** under each room's name (0071),
      through its own `public_room_type_facilities()` rather than a change to
      `public_room_types()`, whose return shape the booking flow depends on.
      Titles are the hotel's own words and are not translated.
  - **Country is ISO alpha-2 under a check constraint**, the same list and the
    same reasoning as `customers.country`. Latitude and longitude are set
    together or not at all, and range-checked.
  - **`properties.slug` is read-only**, generated from the name once and unique.
    Nothing routes by it yet — the guest page is still `/book/[propertyId]`.
  - **The map is Leaflet, not Google Maps.** Google needs an API key and a
    billing account this project does not have. Leaflet with OpenStreetMap tiles
    (Map) and Esri imagery (Satellite) needs neither. Click or drag the pin to
    set the coordinates; typing them moves the pin. `location-map.tsx` is loaded
    with `ssr: false` because Leaflet touches `window` on import, and its
    wrapper is `relative z-0` because Leaflet's panes sit at z-index 400–1000 —
    the same stacking-context trap as the top nav and the calendar's room menu.
  - **The timezone list is computed on the server and handed down**, and the
    browser's own zone ("Your current timezone is") is read after mount. Either
    one done during render would differ between Node and the browser and cause
    a hydration mismatch.
  - **The Currency field is live everywhere.** It was stored and ignored by
    the staff screens until the formatters took the currency as a required
    argument -- see the money rules.
- **Rooms are created in runs**, because a property may hold ~1,800 of them and
  entering those one at a time is not a thing anyone would do. A run is capped
  at 500 and refuses by name if it would collide with rooms that already exist,
  before anything is written.
- **One room is corrected from the rooms list underneath it**, through
  `save_room()`, which 0030 shipped and nothing called until 0031. The list is
  `rooms_for_settings()` — searched and paged in Postgres like every other room
  read, because the ~1,800 rule does not stop at a settings screen. It returns
  the type and the floor; `rooms_page()` returns tonight's guest and nights
  left, which is why they are two reads and not one.
  - **Moving a room to another type rewrites nothing.** `booking_rooms` carries
    its own `room_type_id`, so a reservation records the type it was sold at
    and no booking, rate or night row moves with the room.
  - **A room that has never been booked is deleted from the list** (0055),
    through `delete_room()`. A room with bookings is refused by name and stays
    `ooo`; the list says which is which with `has_bookings` rather than letting
    somebody find out by clicking. The room's `room_status_history` goes with
    it — that log is about the room, and once the room is gone there is nothing
    for it to be evidence of. **There is still no delete for a payment
    method**: payments point at one under `on delete restrict`, so one no
    longer used is `is_active = false`. **A room type CAN be deleted as of
    0091, but only one nothing was built on** -- see the Room Type notes.
  - **A room carries a photograph** (0055). `rooms.photo_path` holds an object
    path in the public `room-photos` bucket, never a URL: a url column renders
    whatever the browser sent. The path is `<property_id>/<room_id>/<file>`,
    and that prefix is checked twice — by the storage policy on the upload and
    by `set_room_photo()` on the write — so a name invented in the browser
    cannot point a room at somebody else's file. The upload goes straight from
    the browser under the user's own session; nothing holds a service key.
    - `set_room_photo()` is its own function rather than a parameter on
      `save_room()`. An optional parameter there would be an overload for
      PostgREST to choose between, and a form saving a number and a floor would
      be saying "no photograph" every time somebody fixed a typo.
    - Each upload gets a fresh object name. Overwriting one path would leave
      the browser and any CDN showing the old picture, which reads as the
      upload having failed; the old file is removed once the new path is
      recorded.
  - Status is not settable here. It is changed where the work happens — the
    housekeeping report and the house board.
- **`payment_methods.affects_drawer` is not a setting.** A check constraint
  ties it to the kind — cash touches physical cash, nothing else does — so
  `save_payment_type()` derives it and takes no parameter for it. Offering
  the tickbox would be offering a choice the database refuses, on the one
  column the drawer total and every blind count are worked out from.
- **PAYMENT TYPES ARE A FREE LIST, as of 0079** — Finances -> Custom Payment
  Types, cloned from the reference: Title, Description, a pencil, "Add new
  payment type". This reverses what this file said, that
  `unique (property_id, kind)` bounded the screen to one method per kind.
  The reference lists Credit Card and Debit Card side by side, which that
  constraint made impossible.
  - **The constraint was dropped only after checking that nothing read a
    method BY its kind** — no function, no query. Titles are unique per
    property instead, case-insensitively.
  - **The kind still decides the money** and is picked in the edit dialog
    ("Kind"), because the reference's list has no column for it but the
    drawer needs it. UPI is in the enum from before and is neither offered
    nor accepted by `save_payment_type()`.
  - `save_payment_method()` was DROPPED, not left beside the new function:
    its per-kind refusal is exactly what 0079 lifts. The list is in the order
    types were added, as theirs is. No delete, as before — payments point at
    a type; one no longer used is unticked Active.
- **A payment method's kind is frozen once payments exist against it.** Moving
  a method across the cash line afterwards would restate every shift already
  counted. Renaming and retiring stay free; the name is what the cashier picks
  from, the kind is what the money means. The dialog shows a frozen kind as
  text rather than a select, so it is not offered only to be refused.
- **`set_room_status()` is how a room is marked clean**, and housekeeping can
  call it. Until 0030 `rooms.status` was only ever set by check-in and
  check-out, so a room went dirty on departure and stayed dirty for ever — the
  housekeeping report showed the work with no way to record it done. Occupied
  is not settable by hand in either direction: a room is occupied because a
  guest is in it, and check-in and check-out are what move it.
- **A tax rate that has posted charges against it cannot be moved.** It renames
  and retires freely, but the rate and its inclusion are frozen, because a
  folio item records which rate it used and changing it would restate history.
  Retire it and add a new one.
  - **THE LIST SHOWS HOW MANY CHARGES ARE POSTED AT EACH RATE** (0066), which
    is what makes that rule visible before somebody types a new figure rather
    than only in the refusal afterwards. Same move as the cancellation
    policies list carrying its rate-plan count, and for the same reason.
    `tax_rates_list()` replaces the direct table read so the count is worked
    out in Postgres; it is `security invoker`, so RLS decides what a caller
    counts rather than a second copy of the property rule living inside it.
  - **A NEW rate is seeded `inclusive`.** It seeded `exclusive`, which pointed
    every new rate away from what this property charges and what a hotel
    selling to the public does — consumer prices have to be shown with tax in.
  - **The window closes at the first charge.** Until the night audit posts a
    room charge on a booking carrying the rate, its figure and its inclusion
    are still editable in Settings; after that they are not. Worth knowing
    before telling a hotel they can change VAT whenever they like.
  - **TAX INFORMATION IS THE REFERENCE'S "TAXES AND FEES" (0079)**: Name,
    Type, Value, Applicable, a pencil and a bin, a drag handle per row.
    - **The order is real.** `tax_rates.sort_order`, set by dragging or by the
      arrow keys on the handle (`set_tax_rate_order()`), and the booking form
      seeds its tax with the FIRST ACTIVE rate — so the top of this list is
      the hotel's default. That is what "Applicable" says: "By default" for
      that one, "When chosen" for the others, "Retired" for inactive. The
      reference says "Always"; ours would be untrue, since a booking carries
      one rate and staff may pick another or none. A new rate goes to the
      foot, by trigger, so adding one never changes the default.
    - **Type is always "Tax" and the button says "Add tax".** There are no
      fees in this schema — a fee would need its own posting and its own
      report bucket — so offering "Fee" would be a choice that does nothing.
    - **The bin is drawn only on a rate nothing uses** (`in_use` from
      `tax_rates_list()`), and `delete_tax_rate()` refuses the rest by name.
      Bookings do not store a tax rate — the nights carry the computed
      figure — so extras, categories and folio items are the whole check.
    - The reference's LOCALE button is not copied, as elsewhere.
- **Password reset is three screens and no API route.** `/login` links to
  `/forgot-password`, which calls `resetPasswordForEmail` with a `redirectTo`
  of `<origin>/reset-password`; that page turns whatever the link carried into
  a session and then calls `updateUser`. Both are client components using the
  browser client, like `/login`, because the session cookies have to be set
  where the token lands. That keeps "no API routes except external webhooks"
  intact — there is no `/auth/callback` route handler.
  - **`/login`, `/forgot-password` and `/reset-password` live in the `(auth)`
    route group** (URLs unchanged), whose layout wraps them in `StaffI18n`.
    Nobody is signed in, so `getStaffLocale()` finds no `staff_users` row and
    falls back to the `staff_locale` cookie — the last choice made on this
    browser.
  - **The reset page handles all three link shapes** — `?code` (PKCE),
    `?token_hash&type` (the current email template) and `#access_token` (the
    older implicit flow, which the browser client picks up itself). Which one
    arrives depends on the project's auth flow and email template, and the page
    is the same page either way. It reads `window.location` rather than
    `useSearchParams` because the last of those lives in the fragment, which
    never reaches the server.
  - **The session decides whether the link worked, not the exchange.** A
    recovery token is single-use, so refreshing the reset page after it
    succeeded gets the second exchange refused even though the first left a
    good session behind — and React's development double-invoke does the same.
    The page therefore checks `getSession()` after a failed exchange and only
    reports the error when there is no session. Do not put the refusal back in
    front of that check.
  - **`/forgot-password` and `/reset-password` are public in middleware.**
    Bouncing `/reset-password` to `/login` would throw away the token in the
    URL, which is the one thing the email carries and cannot be asked for
    again. Only `/login` still redirects a signed-in user away: a recovery link
    signs its holder in *before* they reach the reset page, so redirecting
    signed-in users off it would make finishing the reset impossible.
  - **The redirect URL must be on Supabase's allow-list** or it silently falls
    back to `site_url`, dropping the token and making the link look broken.
    `supabase/config.toml` covers local development. The hosted project has its
    own list under Auth → URL Configuration.
  - **THE RESET EMAIL LINKS WITH A TOKEN HASH, NOT A PKCE CODE.** The browser
    client runs the PKCE flow, and Supabase's default template links to
    `{{ .ConfirmationURL }}`, which comes back as `?code=` -- exchangeable only
    in the browser that asked, because the verifier is in that browser's
    cookies. Ask at the desk, open the email on a phone, and the link is dead.
    `supabase/templates/recovery.html` links to
    `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`,
    which the page verifies with `verifyOtp()` on any device.
    `config.toml` uses it locally; **the hosted project needs it pasted under
    Auth → Email Templates → Reset Password, and its Site URL set to the
    deployed origin**, which is what `{{ .SiteURL }}` fills in. If a `?code=`
    link is still opened elsewhere, the page says so in the reader's language
    rather than showing Auth's "code verifier" text.
  - **Supabase's built-in email sender is not enough for staff.** It delivers
    only to members of the Supabase project's team, a few an hour. A
    receptionist who is not on the team gets no reset email at all, and the
    confirmation screen cannot say so (it never says whether an address has
    an account). Production needs custom SMTP under Auth → SMTP Settings.
    Checked when this was written: no reset had ever been requested on the
    hosted project.
  - **Auth's own messages are translated** (`src/lib/auth-messages.ts`):
    `authErrorText()` runs them through `tr.message()` on the sign-in, forgot
    and reset screens, with the common ones listed as keys ("Invalid login
    credentials", the "after {0} seconds" rate limit). One not listed shows as
    Auth wrote it.
  - **Neither screen says whether an email belongs to an account.** The
    confirmation is the same either way. This is the one place the "errors say
    what happened" rule gives way, deliberately.
- **Your own name is `save_own_profile()`, and it is the only self-service
  write.** `save_staff_user()` is administrator-only and so is the single
  UPDATE policy on `staff_users`, which left a receptionist unable to correct
  their own misspelt name. Widening the policy is not the fix: RLS sees the new
  row and not the old one, so it cannot say "the same row, but the role must
  not change", and `for update using (id = auth.uid())` would let anyone make
  themselves an admin. The function is `security definer` and takes one
  parameter — the name. `role` and `is_active` are not parameters, so no call
  can move them.
- **Changing your own password asks for the current one first.** `updateUser`
  does not: it trusts the session. A front desk terminal is left unlocked more
  often than anyone admits, so `/profile` re-authenticates with
  `signInWithPassword` before setting the new password. Somebody who has
  genuinely forgotten theirs uses the reset flow instead.
- **"Reload data" is `revalidatePath("/", "layout")`.** Reads are Server
  Components, so a figure can sit behind a change made on the machine next
  door. This is the button to reach for instead of teaching people to
  hard-reload, and it is why the item is labelled by its result rather than
  "Clear cache".
- **The guest booking page is `/book/[propertyId]`, and it is the only thing
  in this codebase that runs without a staff session.** A guest has no
  `staff_users` row, so `current_property_id()` is null and the ordinary reads
  see nothing. The property is therefore named in the URL and passed to ten
  `security definer` RPCs granted to `anon`: `public_property`,
  `public_rate_plans`, `public_room_types`, `create_public_booking`, and the
  read-only `public_hotel_policies`, `public_room_type_facilities` (0071),
  `public_room_type_content` (0072), `public_language_settings` (0078),
  `public_booking_engine` (0098) and `public_booking_widget` (0100). That is
  the entire public surface — no table, no view, none of the staff functions.
  - **The page takes `?from=&to=&adults=&children=`** (0100), which a Booking
    Widget sends. `stayFromWidget()` drops anything malformed or in the past
    rather than trusting a URL; a good stay opens the page searched, on the
    room step. Everything that decides a sale is still Postgres's.
  - **THE PAGE IS A FOUR-STEP FLOW CLONED FROM THE CLIENT'S CURRENT BOOKING
    ENGINE** (0072). They sent five screenshots of a live hotel's page and
    asked for ours to look like it: a stepper across the top, then Select
    dates (three months of calendar, arrival then departure), Select room
    (a card per room type with photographs and "From <price>"), Select rate
    (the room's description and facilities, then every published plan with
    its total and terms), and Your details (the form beside the booking
    policy, the hotel policy and a summary, behind an agreement tickbox).
    - **Theirs has five steps; Extras is the one not built.** A guest cannot
      buy an extra online here -- `create_public_booking()` takes a room and
      nothing else, and a guest-facing path that posts folio charges is a
      money change on the anonymous surface, to be asked for rather than
      slipped in. Nor are the card form ("there is no card capture"), the
      promotional code (the public booking takes none), a currency switcher
      (a property has one currency) or a logo (there is no logo column): each
      would be a control that does nothing. The hotel's name stands where
      their logo is.
    - **`searchPublicStay()` asks `public_room_types()` once per published
      plan** and lays the answers side by side, so step 2 can show the
      cheapest sellable plan as "From" and step 3 can list them all. Every
      rule is still decided in Postgres; the action only collates.
    - **No date is formatted in the browser.** Month and weekday names are
      worked out on the server in the guest's language and handed down, and
      "today" is the HOTEL's today in its own timezone, not the server's or
      the guest's. Formatting names in a client component is the hydration
      trap `formatStampInProperty()` exists for.
    - **Photographs are the type's own first, then its rooms'** (0108).
      `public_room_type_content()` returns up to eight: the room type's own
      pictures in their order, then photos of its rooms (per room since
      0055). This used to say there was no room TYPE photograph; there is
      now. A type with none draws a plain dark tint, never a broken image.
    - **A room type has a description** (0072, `room_types.description`),
      edited on the Room Types form and saved by its own
      `set_room_type_description()` -- the overload trap again, as with
      `set_room_photo()`.
  - **`current_property_id()` was deliberately not taught about a public
    context.** It is the root of every RLS policy in the database, so anything
    able to set it would put cross-property access one bug away. That is why
    the property is a parameter everywhere here instead.
  - **`create_public_booking()` is the one sanctioned exception to "taking a
    booking goes through `create_booking()` and nothing else".** It cannot
    reuse it, because `create_booking()` resolves the property through
    `current_property_id()`. What makes a second path acceptable is how much
    less it can do: one room type, one published plan, always `pending`, never
    overbooking, never ignoring a stay rule, and no parameter through which any
    of that could be asked for. It is still one transaction.
  - **The endpoint carries its own limits, because the form cannot.** The RPC
    is reachable with curl, so `max={12}` on an input is a suggestion to a
    browser and nothing more. `create_public_booking()` refuses a party larger
    than the room type's `max_occupancy`, a stay over 30 nights, an arrival
    more than 500 days out, and a sixth unconfirmed booking on one email.
    These guard a public endpoint; they are not the hotel's policy. A front
    desk can still take a ninety-night booking for thirty people through
    `create_booking()`.
    - Before 0036, fifty adults went into a room that sleeps three and a
      365-night stay was accepted. Both were confirmed against the endpoint,
      not theorised.
    - The pending cap stops an accident and a casual script, not a determined
      abuser with a second address. Real rate limiting belongs in front of the
      API rather than in a function, and has not been done.
  - **Three advisor warnings on this surface are expected and must not be
    "fixed".** `current_property_id()` and `current_role()` have to stay
    executable by `anon`: RLS policies call them whenever `anon` touches a
    table, and revoking would turn a clean empty result into a permission
    error. `rls_auto_enable()` is Supabase's own event-trigger function, not
    ours, and an event trigger cannot be usefully invoked over RPC.
  - **`rate_plans.is_public` is off by default and set by
    `set_rate_plan_public()`**, a tickbox on the Inventory screen. A Corporate
    or wholesaler rate stays invisible to strangers until somebody publishes
    it.
  - **Two failures, and they are not the same page.** An unknown or inactive
    property is a bare 404, so a stranger guessing property ids learns
    nothing. A real property with nothing published is a page that says the
    hotel is not taking online bookings — in the guest's language — because it
    used to 404 too, and the hotel's own staff clicked "Guest booking page" in
    their menu and got a black error with no clue. When a staff session is
    present that page also carries a "Staff only" panel naming the tickbox and
    linking to Inventory. A guest never sees it: the word "Inventory" is not
    theirs to read.
  - **`stay_rule_violation_for()` holds the logic and
    `stay_rule_violation()` is now a wrapper round it.** Two copies would drift
    the first time a rule changed.
  - **`properties.is_active` finally means something.** It had been honoured
    nowhere since 0001; the public reads are the first to check it.
  - **The guest page speaks nineteen languages; the staff app speaks twelve
    as of 0106** (see "The staff application speaks twelve languages"). Two
    lists, two dictionaries: `src/lib/i18n/locales.ts` and `dictionary.ts` for
    guests, `staff-locales.ts` and `staff/*.json` for staff. This note used to
    say the staff app stayed English because its terminology wanted a
    translator; the client asked for it anyway, and the staff translations are
    machine-made and flagged to the client for review by native speakers.
    `formatMoneyIn()` in `money.ts` writes the figure the way the reader's
    language writes it; the currency and the integer pence do not move.
- **What a rate includes is `rate_plan_meals`: one row per plan per meal.**
  There is no board-type enum, because "half board" *is* two rows and "B&B" is
  one — which handles a hotel that includes dinner but not breakfast without
  anybody adding an enum value. `set_rate_plan_meals()` takes the whole set at
  once, because "this plan is half board" is one decision and applying it as
  two calls leaves a moment where the plan is bed and breakfast.
- **An included meal is worth nothing until somebody prices it.**
  `rate_plan_meals.value_cents` is nullable and null on every row, and a null
  posts exactly as before: one accommodation line, nothing for the meal. Set a
  value in Inventory and `post_room_charge()` splits the night into a
  `room_charge` for the accommodation and a `food_beverage` line for the meals,
  so a £120 B&B night reads as £105 plus £15.
  - **The tax follows the money and the two lines always add up.** The night
    carries one tax figure, so it is apportioned by net with integer division
    and the remainder goes to accommodation. The pair totals exactly what the
    single line did; no penny is invented or lost.
  - **Nothing already posted is restated.** `folio_items` is append-only, so
    the split begins with the next night audit and every night charged before
    the value was set stays as it was. There is no backfill and there should
    not be one: rewriting how a historic night was composed moves revenue
    between buckets in months already reported.
  - **Meals priced above the night are refused, not posted.** A rate whose
    meals are worth more than the room is a configuration mistake, and the
    audit says so by name rather than posting a negative accommodation line.
  - **A stay booked before 0037 never splits**, because `booking_rooms` has no
    `rate_plan_id` on it and nothing records what that rate included.
  - The posting date is the night's own, while `meal_report()` dates breakfast
    to `stay_date + 1`. Both are right and they answer different questions: the
    folio records what the night's rate was made of, the report counts who eats
    when. Do not "fix" one to match the other.
- **`meal_report()` reads the booking, not the folio.** With no value there is
  no ledger row to count, and posting one anyway would put roughly 650,000
  zero-value rows a year into an append-only table to say what the booking
  already says. The stronger reason is timing: the night audit only posts
  nights that have passed, and the number a chef actually needs is tomorrow's.
  Reading the booking gives forward dates for free.
- **Breakfast on the 5th is eaten by guests who stayed the night of the 4th.**
  `meal_report()` dates breakfast to `stay_date + 1` and lunch and dinner to
  the night's own date. A guest arriving Monday and leaving Wednesday eats no
  breakfast on Monday and does eat one on Wednesday. Reverse that and every
  arrival and departure day is out by exactly one service — which looks fine in
  testing and annoys a chef every morning.
- **A stay booked before 0037 shows no meals.** `booking_rooms.rate_plan_id`
  did not exist, so nothing says what those rates included, and it cannot be
  backfilled. The report undercounts over historic dates by design; the screen
  says so rather than letting it read as a bug.
- **A customer is created, corrected and merged from the Customers screen.**
  Until 0048 a customer could only appear as a side effect of
  `create_booking()`, and could not be edited at all: the screen's three
  buttons — Create Customer, Merge Selected, Export to Excel — shipped
  `disabled` with "Available in Phase 2" on them, and so did the row
  tickboxes, which is why Merge could never have worked whatever anyone
  clicked.
  - **Merging was designed for in 0001 and built in 0048.**
    `customers.merged_into_id` has been on the table from the start, with a
    self-referencing foreign key under `on delete restrict`, and
    `customer_stats` has always filtered `where merged_into_id is null`. So the
    read side already hid a merged-away customer; only the write was missing.
  - **`merge_customers()` repoints the three tables that carry `customer_id`** —
    `bookings`, `folios` and `meeting_room_bookings` — then marks the
    duplicates. One transaction: a merge that moved the bookings and then failed
    would leave two customers both looking live, one holding the other's
    history. **Nothing is deleted**, so the merged row and its trail survive.
  - **It fills only the keeper's empty fields**, never overwrites. Somebody
    chose that row to keep, so its own details are the ones they meant — but a
    phone number held only by the duplicate would otherwise vanish from every
    screen once the duplicate drops off the list.
  - **Merging is `is_revenue_staff()`; creating and correcting is
    `is_front_office_staff()`.** Rewriting who a booking belonged to is more
    than a correction and cannot be undone from the application, so it is
    logged to `activity_log` as well.
  - **The export is a Server Action returning CSV, not a route.** "No API
    routes except external webhooks" still holds: the action returns the text
    and the browser makes the download out of a Blob. It exports the whole
    filtered list rather than the page on screen — exporting 25 of 4,000 rows
    because that is what the table was showing is the sort of thing nobody
    notices until they have built a mailing list from it — and caps at 10,000,
    saying so rather than handing over a short file that looks complete.
  - **Every field is quoted against CSV injection.** A leading `=`, `+`, `-` or
    `@` makes Excel treat a cell as a formula, so a customer name starting with
    one is prefixed with a quote.
- **Guest identity is five nullable columns on `customers`, added in 0050**:
  `nationality`, `country`, `passport_number`, `passport_expiry` and
  `date_of_birth`. They exist for the Immigration and Country reports.
  - **Nationality and country are not the same field and must not be merged.**
    A German passport holder living in Paris is a German national and a French
    booking. The immigration return wants the first; the Country report wants
    the second. Collapsing them would quietly make one of the two wrong.
  - **Both are ISO 3166-1 alpha-2, enforced by a check constraint**, because a
    free-text country column becomes "UK", "U.K.", "United Kingdom" and
    "England" within a fortnight and the report then counts four countries that
    are one. `src/lib/countries.ts` holds the list — not a table, because
    reference data that changes once every few years would otherwise be a
    migration every time a country is renamed and a join on every screen.
    `save_customer()` upper-cases what it is given rather than refusing "gb".
  - **Every field stays nullable and every existing row stays null.** These are
    taken at check-in, not at booking: a reservation is made over the phone
    with a name and a card, and a passport is seen when the guest walks in.
    Making any of it required would refuse every booking the guest booking page
    takes. The Immigration report shows incomplete rows, flagged and counted,
    rather than hiding them — an unfileable return that looks complete is the
    one failure this report exists to prevent.
  - `merge_customers()` fills these on the keeper the same way it fills a phone
    number. A passport held only on the duplicate would otherwise vanish the
    moment somebody tidied up two records of one guest.
- **The booking waitlist is a real table, added in 0051, and holds no
  inventory.** `booking_waitlist` records somebody who asked for dates the
  hotel could not sell. Nothing in it reserves a room, generates a night or
  appears in occupancy — an entry that quietly held a room would be an
  overbooking nobody asked for.
  - **It never mints a booking.** `set_waitlist_status(..., 'converted')` takes
    the booking that was made; it does not make one. Taking a reservation goes
    through `create_booking()` and nothing else, and a waitlist that could
    create one would be a second booking path with none of the inventory
    checks. The screen's "Book" button opens the ordinary booking form.
  - An entry carries either a `customer_id` or loose contact details, not
    necessarily both: an enquiry that never becomes a booking should not have
    to create a customer record to be written down.
  - **There is no delete policy.** An entry that came to nothing is `expired`
    or `canceled`; removing it loses the fact that somebody asked, which is the
    only thing the list is evidence of.
- **The Deposit report is derived and adds no column.** A deposit is any
  payment taken against a booking that has not checked in — a fact about the
  booking's status, not about the money. An `is_deposit` flag would be a second
  thing to set correctly and a new way for this report and the cashier drawer
  to disagree. Once the guest arrives the booking drops off: it is a part-paid
  folio from then on, which is the debtors report's question.
- **The Accounting report shows revenue and receipts over one range, and they
  are not meant to agree.** Revenue is what was earned in the range; receipts
  are what was collected in it. A guest who pays in March and leaves in April
  moves the two apart, correctly. They are one report rather than two because
  a bookkeeper checks one against the other, and two date pickers is how
  somebody ends up comparing March revenue with April receipts. Tax is shown
  against the revenue it belongs to and never as a category of its own, which
  would double it.
- **The End of day report takes one date and not a range.** The audit closes a
  day at a time and this is the record of one closing; a range of them is the
  Manager report, which is a different screen for a different question.
- **The Manager report computes nothing new.** Every figure is worked out in
  Postgres the same way the report it belongs to works it out, so the front
  page and the occupancy report cannot drift — which is the usual fate of a
  summary screen.
- **The Rate plan report counts pre-0037 nights under "Not recorded".**
  `booking_rooms.rate_plan_id` did not exist before then, so nothing says which
  plan those nights were on. They are labelled rather than dropped, because the
  totals have to tie to the occupancy report and a report that quietly excludes
  a stretch of history is worse than one that admits it.
- **Creating a login is not in the application.** `staff_users.id` references
  `auth.users`, so a new member of staff needs an auth account before a row can
  point at one. Settings manages the staff who already exist — name, role, and
  the `is_active` flag that 0016 made withdraw access everywhere. An
  administrator cannot demote or deactivate themselves, because that locks the
  property out of its own settings.
- Cashier scope: take payments, record paid-outs (money leaving the drawer,
  optionally recharged to a guest folio), close the shift with a blind cash
  count, next receptionist opens a fresh one. Shift close is a blind count —
  never reveal the expected figure before the counted amount is entered.
- Property scale: assume up to ~1,800 rooms per property. Any UI that renders
  one element per room, or any query that returns every room, is a bug.
- **Meeting rooms are a separate booking module, confirmed with the client.**
  Purpose is availability visibility: staff see at a glance which meeting room
  is free or booked on which date. Meeting room names are configured per
  property (Meeting Room A, Meeting Room B). The Meeting Rooms screen shows
  those rooms and their calendars; clicking a date opens a booking with event
  name and guest count required, comments and payment optional.
- **Meeting rooms never go in `rooms`, and their bookings never go in
    `bookings` or `booking_room_nights`.** Occupancy, ADR and RevPAR all
    aggregate over those tables. A meeting room in `rooms` would silently
    inflate every one of those figures. Use `meeting_rooms` and
    `meeting_room_bookings`.
- **Payment reuses the folio path.** `meeting_room_bookings.folio_id` is
    null when no money is taken. When there is a payment it posts
    `folio_items` and `payments` like any other charge, so append-only,
    `signed_amount_cents` and `affects_drawer` all keep applying. Never add an
    amount column to the booking row — that creates a second money system the
    cashier drawer cannot see.
- **Double-booking is prevented in Postgres, not in application code:**
    `exclude using gist (meeting_room_id with =, daterange(starts_on, ends_on,
    '[]') with &&) where (status = 'confirmed')`. Needs
    `create extension if not exists btree_gist` in the same migration.
- **The ~1,800 room rule does not apply here.** A property has a handful of
    meeting rooms, so a row-per-room calendar grid is correct. Do not build a
    house board for six meeting rooms.
- **Whole-day, and the range is inclusive at both ends.** A room booked
    "Monday to Wednesday" is occupied on the Wednesday, which is the `'[]'` in
    the exclusion constraint. This is the one place the module differs from
    room bookings, where `check_out` is the morning the guest leaves and is not
    a night stayed. Hourly or half-day slots would make these `starts_at` /
    `ends_at` and the constraint a `tstzrange` — a migration plus a calendar
    rewrite, so raise it rather than assuming.
- **`folios.booking_id` is nullable because of this module.** It was `not null`
    until 0029. A meeting room booking is not a `bookings` row and must never
    become one, so a folio now belongs to exactly one of the two. The same goes
    for `folio_items.booking_id` and `payments.booking_id`. The alternative — a
    second set of money tables — would put meeting room payments outside the
    cashier drawer, outside the financial report and outside the append-only
    rules.
- **Everything that reads money by property and business date was unaffected**:
    the financial report, the payments report and the cashier drawer never join
    on `booking_id`. What does join on it — the debtors report, daily checkout,
    the booking screen — keeps returning room bookings only. Daily checkout and
    the booking screen are right to. **Debtors is no longer among them**: as of
    0042 `debtors_report()` returns both kinds with a `kind` column, joining
    meeting rooms by `folio_id` rather than by a booking that does not exist.
- **The folio is made on the first charge and not before.** That is what makes
    `folio_id is null` mean "no money was taken" rather than "there is an empty
    folio nobody looked at". A booking with no customer cannot be charged at
    all, because a folio has to belong to somebody.

## Commands

```
pnpm dev
pnpm build
pnpm typecheck
pnpm supabase db reset        # once Supabase is added
pnpm supabase migration new <name>
pnpm i18n:extract              # regenerate the staff string catalog
pnpm i18n:check                # catalog current + all eleven dictionaries complete
```

## The staff application speaks twelve languages (0106)

The client asked for their reference's language switch: twelve languages
(en de el es fr id it pt ro sl-SI th is), chosen in the user menu, the whole
staff app changing with it. Built in full rather than per screen — a
half-translated app reads worse than an English one.

- **The choice is per person**, `staff_users.locale`, written by
  `save_own_locale()` (security definer, the `save_own_profile()` shape: one
  column on the caller's own active row; the UPDATE policy stays admin-only).
  Two receptionists on one desk may read different languages. The
  `staff_locale` cookie remembers the last choice on the browser for `/login`.
  The check constraint, `save_own_locale()` and `STAFF_LOCALES` in
  `src/lib/i18n/staff-locales.ts` list the same twelve and change together.
- **Every staff string goes through the translator.** Server Components use
  `await getT()` (cached per request), client components `useT()` from the
  `I18nProvider` the layouts put round every page, and the 404 `getCookieT()`
  (it makes no query). `useT()` throws outside the provider, like
  `useCurrency()`. Page titles are `generateMetadata = pageTitle(msg("…"))`.
- **The English text IS the key.** `tr("Take a booking")`, with `{name}`
  placeholders passed as values, and `tr.plural(n, one, other)` for counts —
  keyed by the `other` form, with each language's own plural categories (sl
  one/two/few/other, ro one/few/other, th and id other only). **Write whole
  sentences with placeholders**, never English fragments glued together: word
  order differs, and a fragment has nothing to translate against.
- **Text the database writes is translated too**, with `tr.message()`:
  refusals raised in plpgsql, activity-log summaries, fallback labels
  (`queries.ts` translates "Unnamed guest", channel and room-type fallbacks,
  and every field a report shows that SQL wrote). An exact match first, then
  PATTERN keys — `"Room {0} is {1}, so it is not ready for a guest"` — with
  each captured value looked up once, so enum words (`vacant_dirty`,
  `waiting`, `confirmed`) arrive translated. A pattern needs four letters of
  fixed text, so `"{0} — {1}"` never matches everything. A translation may
  drop a placeholder (where SQL interpolates English, such as "a season")
  but never invent one. Server Actions return errors through `localised()` /
  `localisedAs()` in `src/lib/i18n/localised.ts`.
  - **A new `raise exception` needs no code change to be translated — but it
    needs a dictionary entry in all eleven**, or it shows in English. The
    extractor finds it in the migrations.
  - **A message that OPENS on a value is extracted too, as of 0109** ("% is
    the main rate...", `format('%s needs at least %s adults...')`). The
    extractor's phrase test wanted a capital first, so fifty such refusals --
    every one naming a plan, a type or a tax -- had reached every language in
    English. They are translated now; `tr.message()` always matched them.
  - A message that would need English built in SQL (`global_search()`'s old
    subtitle) is better returned as raw fields and composed in TypeScript —
    that is what 0107 did.
- **`src/lib/i18n/staff/catalog.json` is generated** by `pnpm i18n:extract`
  (`scripts/i18n-extract.mjs`), which scans `src/` for `tr(`, `msg(`,
  `tr.plural(` and the migrations for `raise exception` and activity text.
  `pnpm i18n:check` fails on a missing key, a placeholder a translation
  invents, a wrong plural shape or a stale key. **Run both after adding any
  staff string**; `--check` on the extractor fails if the catalog is out of
  date. Country names are filled from `Intl.DisplayNames`
  (`scripts/i18n-countries.mjs`), not hand-translated.
- **Dictionaries are `src/lib/i18n/staff/<locale>.json`**, one chunk each,
  loaded only for the language in use. English has no file: the key is the
  text.
- **Dates and weekdays come from date-fns's own locale data** (`tr.date`,
  `tr.weekday`, `tr.stamp`, `tr.since`), never hand-written month names.
  `formatStampInProperty()` still does the time-zone work.
- **Money is NOT localised** — see the money rules. Figures stay en-GB.
- **The translations are machine-made.** The client has been told to have
  native speakers review them, accounting and cash terms first. Terms were
  kept consistent per language (e.g. German Buchung / Ratenplan /
  Geschäftstag / Nachtabschluss / Kassenschicht; Spanish reserva / fecha
  operativa / auditoría nocturna). Changing one term means changing every
  key that uses it.
- **The guest booking page is unaffected**: its nineteen languages, its own
  dictionary and its `?lang=` are a separate system for a different reader.

## Copy and interface writing

**THERE IS NO EXPLANATORY COPY IN THIS APPLICATION. Do not add any back.**

The client asked for it twice. The first time it was the legend and two
paragraphs under the calendar board; the second time it was everything —
"they're a lot of written stuff with explanations in the system delete all",
and "I think is the prompt", which is the point: a screen covered in prose
explaining itself reads as leftover AI output, not as a product. The reference
system labels a control and says nothing else.

What went, and how it is kept gone:

- **`PageHeader` has no `subtitle` prop.** Every screen carried a line under
  its title saying what the screen was for. The prop was removed rather than
  ignored, so every one of the thirty-odd call sites was a compile error and
  none was missed. `ReportShell`, `InventoryPage` and `SCREENS` in
  `field-spec.ts` lost theirs with it.
- **`ReportTable` has no `note` prop.** All twenty-two reports carried a
  methodology footnote — "dated by business date, not by the clock", "sellable
  is the number of rooms not currently out of order". Gone the same way.
- **The calendar rail's bands carry a label and a count, nothing else.**
  "Nothing waiting", "Rooms back on sale", "every booking has a room" are gone.
- **Settings keeps one note**, and only because removing it leaves an
  administrator hunting for an "Add staff" button that deliberately does not
  exist. Nine others went.

**What deliberately stays, and is not the thing being complained about:**

- **Refusals.** "This report is not available to your role", "You can read the
  inventory but not change it" — a screen that refuses has to say why.
- **Errors**, which still say what happened and how to fix it.
- **Empty states**, cut to the action: "None yet. Add at least cash and card."
- **One clause on a control whose consequence is not obvious** — the overbook
  and ignore-restrictions tickboxes, the merge warning, the close-day
  confirmation. These were cut to a single sentence, not deleted: a tickbox
  that oversells the hotel needs to say so.
- The password reset screens, which are recovery paths for somebody already
  stuck and are not part of the staff application proper.

- Empty states say what to do, not "No data".
- Errors say what happened and how to fix it.
- A control's label matches its result: a button saying "Close shift" produces
  a confirmation saying "Shift closed".
- Keyboard focus must be visible. Front desk staff work fast and use tab.

## Phase plan

- **Phase 1 — done.** Schema, auth, roles, and the swap from mock to Supabase.
- **Phase 3 — done.** Cashier on real data, check-in and check-out, the night
  audit, hardening, all the reports, and the property settings that let a
  property be set up without hand-written SQL.
- **Phase 2 — done.** Availability calendar, booking creation, the booking
  screen with edit and cancel, all nine Inventory screens, promotions and
  meeting rooms.
- **Reports — done.** All twenty-two. The first thirteen shipped by 0038; the
  other nine (manager, folio, immigration, country, deposit, rate plan,
  accounting, end of day, booking waitlist) landed in 0050–0052, which also
  added the guest identity fields and the waitlist table they needed.

### What still renders `<ComingSoon />`

Nothing — the component is deleted, along with the `(app)/[...stub]` catch-all
that used it. That route matched every unmatched path under the app and told
anybody who mistyped a URL that the screen was scheduled for "Phase 2", long
after every screen in the nav was built and on real data. There is a real 404
at `src/app/not-found.tsx` now, deliberately outside the `(app)` layout: that
layout reads the property from the database to title the page, and a wrong
address is not worth a query.

**There are no disabled controls left in the staff application.** If you are
about to add one, read the user-menu note above first — the client has objected
to a control that does nothing once already, and was right to.

## Card capture is not built

There is no Stripe code in this repository and no keys in any environment. Card
capture was scoped — capture the card at booking, charge it later — and then
deliberately deferred rather than half-built against keys nobody has.

When it is built: card details go to Stripe from the browser via Elements and a
SetupIntent, and never touch this server or this database. What is stored is a
token. A webhook is the one sanctioned API route, which is what the "no API
routes except external webhooks" rule already allows for. Do not put a secret
key in a `NEXT_PUBLIC_` variable, a client component, or anywhere the browser
can reach.

## Open decisions — do not silently choose

Assumed below. If an assumption is wrong the schema changes, so raise it rather
than proceeding.

1. **Multi-property.** Assumed yes; `property_id` on all tenant tables.
2. **Channel manager.** Assumed OTA bookings are entered manually for now. If a
   real channel manager is connected later, bookings become partly
   externally-owned and need idempotency keys plus a `channel_sync_log`.
   `external_reference` and `external_payload` exist to allow this.
3. **Cashier float.** Assumed fixed float: each shift opens at a set amount and
   surplus cash is dropped to the safe. Not carry-forward.
4. **Paid-out default.** Assumed recharged to the guest folio by default, with
   an explicit toggle for house expense.
5. **Denomination counting at close.** Assumed not needed in v1.
6. **Room scale — partly settled by the calendar decision.** The client asked
   for a calendar showing every room and the guest in each, which means at
   least one screen draws a row per room and one query returns them all. That
   is now true of `calendar_rooms()` and nothing else. The ceiling itself is
   still unconfirmed, so the rule below still governs every other screen — but
   it is no longer absolute, and "the client operates at 1,800" can no longer
   be used on its own to refuse a room-level view they have asked for.

   **Original note, still true of everywhere but the calendar:** The ~1,800
   figure came from a passing remark in client feedback. It drives the house
   board design and two query signatures, so confirm it before writing
   migrations. The hosted property is set up with 120 rooms, which is a working
   size and not a confirmation of the ceiling — do not read it as one and do
   not relax a query on the strength of it. Nothing in the codebase can answer
   this and no amount of looking will: it is a question for the hotel.
7. **Rate model — settled.** A rate plan per room type per date, with
   restrictions layered on top: `rate_plans`, `rate_plan_days`,
   `room_type_days`. See the inventory notes above.
8. **Promotions — settled.** A discount (percentage or amount) or free nights,
   optionally behind a code, best single one wins. See the promotion notes
   above. **Inclusions are settled too**: an inclusion is `rate_plan_meals`,
   never a promotion kind, and as of 0041 it can carry a value that splits the
   night between accommodation and F&B. Every value ships null, so the split is
   off until a hotel turns it on.
9. **Meeting room granularity — settled and built: whole day.** `starts_on` /
   `ends_on` as dates, exclusion constraint on an inclusive `daterange`.
   Hourly or half-day slots would be a migration plus a calendar rewrite.
10. **Tax rate and inclusion — settled: 20% inclusive.** The hosted property
    carries one active rate, "VAT 20%", with `inclusion = 'inclusive'`, so a
    £120 rate is £100 of room and £20 of VAT rather than £144 on the folio.
    - **IT HAD DRIFTED TO `exclusive` AND WAS PUT BACK.** Somebody changed it
      in Settings, or it was never what this note claimed; either way the
      hosted rate read `exclusive`, which on a £120 room is £144 to the guest
      rather than £120. Corrected through `save_tax_rate()` as the admin under
      RLS, which is how every other row on this property went in — never a
      hand-written UPDATE on the table.
    - **It was only correctable because nothing had used it.** Zero
      `folio_items` carried a `tax_rate_id`, so `save_tax_rate()`'s freeze
      check passed. **Had one charge been posted at that rate it would have
      been refused**, and the answer would have been to retire it and add a
      new one. Check `folio_items` before assuming a rate can be moved.
    - **If the client wants exclusive, that is now a NEW rate rather than an
      edit**, the moment the first charge posts against this one.
    That is what a UK hotel selling to the public does, since consumer prices
    have to be shown with tax in. A property selling mainly to businesses that
    reclaim it would want exclusive instead — and that is a new rate, not an
    edit: a rate with posted charges against it is frozen, because a folio item
    records which rate it used.
11. **No-show policy at night audit — SETTLED THE OTHER WAY, AS OF 0064: A
    NO-SHOW IS A PERSON'S DECISION AND THE AUDIT MAKES NONE.** This entry used
    to say the opposite — that `close_business_date()` swept every `confirmed`
    booking whose arrival had been reached and nobody had checked in, released
    its rooms and billed the first night. 0040 built that; 0064 removed it.
    - **The client settled it when told the audit would run unattended:** "No
      show should be manual because sometimes people arrive late because of a
      delayed flight or whatever reason", and "we don't want it to
      automatically cancelled reservations of guests that have not arrived at
      the property. It would generate chaos for the hotel."
    - **They are right, and the cost of being wrong is asymmetric.** A guest
      landing at 4am on a delayed flight, whose room went back on sale at 2am
      and who was billed a fee nobody discussed with them, is an argument at
      the desk and a reversal on the folio. The opposite mistake — a room held
      a few hours too long — costs the hotel one morning's attention.
    - **NOTHING WAS LOST, because the manual path predates the sweep.** The
      cancel dialog on the booking screen carries a "Mark no show" tickbox,
      which calls the same `cancel_booking(..., p_no_show => true)` the sweep
      called. 0064 deleted a caller, not a capability. Everything the old note
      said about the FEE still holds wherever a no-show is marked by hand: it
      is `miscellaneous` and never `room_charge`, because `post_charge()`
      refuses `room_charge` outright and a room charge against a room nobody
      slept in would break the tie between the financial and occupancy
      reports.
    - **The consequence to know about.** A booking whose guest never arrives
      now stays `confirmed` and holds its rooms, night after night, until
      somebody deals with it. It is never billed — `close_business_date()`
      posts only nights whose status is `checked_in` — but the room reads as
      sold and cannot be resold. **The overdue-arrivals list is built (0112)**:
      `dashboard_arrivals()` on the business date also returns every pending
      or confirmed booking whose arrival has passed, the Arrivals tab marks
      each "Overdue", and "Close the day" warns about every booking due today
      or earlier that is not checked in -- a warning, never a refusal, and
      nothing is marked no-show for anybody.
    - **`close_business_date()` lost two return columns** with the sweep,
      `no_shows_marked` and `no_show_fees_cents`. Dropped rather than left
      returning zero, so the regenerated types made every call site a compile
      error and none was missed. The confirmation dialog lost the two rows and
      the paragraph that explained them.
    - **Whether a no-show fee is VATable is still a question for the
      accountant.** A hand-marked one carries the tax the night carried.
12. **Cancellation dating.** `bookings` has no `cancelled_at`. The cancellation
    report is therefore ranged on arrival date and shows a cancelled-on column
    read from the activity log, which is blank for any status change made
    outside the application. If the client wants "cancellations received this
    week", that is a column plus a backfill, not a screen.
13. **Channel commission.** The channel report works commission out from
    `channels.commission_bps` on the room revenue. Nothing records a commission
    being invoiced or paid, so the figure is what is owed, never a balance. A
    real channel ledger is its own model.

14. **Meeting room debts in the debtors report — settled: one list, with a
    kind.** `debtors_report()` returns room bookings and meeting room bookings
    together, ranked by what is owed, each row saying which it is. It is one
    question — who owes this hotel money — and answering it in two places is
    how a debt gets missed.
    - Meeting rooms join by `folio_id`, because a meeting room booking has no
      `bookings` row and must never get one.
    - **`check_out` means different things on the two sides.** For a room
      booking it is the departure morning and not a night stayed; for a meeting
      room `ends_on` is a day the room was held, since that module is inclusive
      at both ends. Overdue counts from each one's own last day, and the screen
      says so. The column is headed "Last day" rather than "Departure".
    - The status cast is lossless today — `meeting_room_booking_status` is
      `(pending, confirmed, canceled)` and every label exists in
      `booking_status`. Add one that does not and the report raises rather than
      mislabelling a row, which is the right failure and wants an explicit
      mapping here.

15. **Inviting a new member of staff.** Creating an auth account needs either
    the Supabase dashboard or a server action holding the service-role key.
    The second bypasses RLS, which the brief discourages, so it has not been
    built. Until it is, a new person is invited in Supabase Auth and then
    appears in Settings to be named and given a role.

16. **Cancellation policy — settled and built (0060, 0092-0093): three
    kinds, per rate plan.** Flexible with a free-cancellation window in days,
    non-refundable, and custom (the hotel's own words). See the cancellation notes above. **What is NOT settled is
    charging the card**: the client's "the hotel can charge the guest card
    anytime" needs card capture, which is deferred, so the policy records the
    right and cannot exercise it.
