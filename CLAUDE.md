# Hotel PMS Portal

Custom property management system for a hotel. Front desk operations,
channel-connected bookings, and a cashier shift/drawer feature.

## Where this project currently stands

The front end is **built and deployed**, and every read and write in it goes to
Supabase. `src/lib/mock/` is deleted. Migrations `0001` through `0045` are
applied to the hosted database.

Working on real data: dashboard (house board, movements, pace, activity feed),
bookings list, customers, the availability calendar, cashier (open a shift,
take payments, record paid-outs, blind close), check-in and check-out, the
night audit that advances the business date, taking a booking, all nine
Inventory screens, the booking screen with edit and cancel, promotions,
meeting rooms, property settings, the guest booking page, and thirteen reports — occupancy, debtors, payments,
financial, extras, daily checkout, booking, reservations, cancellation,
channel, housekeeping, in house and meal.

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
two exceptions that Postgres will not let anyone undo: there is no delete for a
room, a room type or a tax rate, because bookings and folio items point at them
under `on delete restrict`. A room that should not exist is `ooo`; a tax rate
that should not apply is retired.

As of 0030 all of this can be created from `/settings` rather than by hand in
SQL, and as of 0031 an individual room and the payment methods can be corrected
there too. Until a channel exists, no booking can be taken at all: every
booking must have a source.

The night audit advances the business date one day at a time, posts that
night's room charges and records no-shows, so it is run once per day rather
than caught up automatically. Nothing runs it on a schedule: "Close the day"
on the dashboard is the only caller, and it refuses while a cashier shift is
still open on the date being closed.

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
2. **Dashboard, not Front Desk.** The route `/dashboard` is labelled
   "Dashboard" in the nav, the page `<h1>` and the page title. "Front Desk"
   survives only as a booking channel value in mock data — do not rename that.
3. **Promotions, not Offers.** The nav label is "Promotions"; the route is
   still `/offers`. Renaming the route is optional and has not been done.
4. **Navigation is horizontal, across the top. There is no sidebar.** The
   client confirmed this is what "move the main headline to the top" meant.
   `src/components/side-nav.tsx` is deleted — do not reintroduce it, and do
   not restore a sidebar layout when touching `src/app/(app)/layout.tsx`.
   - `src/components/top-nav.tsx` is the blue bar: logo slot, nine sections,
     search button, user menu. Sticky at `top-0`, `h-14`.
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
   - **The user menu is Profile, Guest booking page, Settings, Reload data and
     Log out. There is no Language item and no footnote.** Both were removed
     after the client asked what the point of a control that changes nothing
     was. A disabled row was tried twice — silent, then labelled "English" —
     and read as broken the first time and pointless the second. **Do not add a
     control to this menu that cannot do anything.** The nineteen languages
     live on the guest booking page, where the reader might not speak English;
     if the staff app is ever translated, the switcher goes back here. The logo
     is a placeholder until the client sends an asset, and search renders
     disabled until the lookup is built.
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
| `getCalendarSeasons(from, n)`       | `calendar_seasons(from, n)`        |
| `getSeasonSettings()`               | `seasons` table                    |
| `getRoomStatusByType()`             | `room_status_by_type()`            |
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
| `getBookingDetail(id)`              | `booking_detail(id)`              |
| `getBookingRoomLines(id)`           | `booking_room_lines(id)`          |
| `getBookingNights(id)`              | `booking_nights(id)`              |
| `getBookingFolioLines(id)`          | `booking_folio_lines(id)`         |
| `getBookingActivity(id)`            | `booking_activity(id)`            |
| `getPromotions()`                   | `promotions_list()`               |
| `getMeetingRoomCalendar(from, n)`   | `meeting_room_calendar(from, n)`  |
| `getMeetingRoomBooking(id)`         | `meeting_room_booking_detail(id)` |
| `getPropertySettings()`             | `properties` row                  |
| `getRoomTypeSettings()`             | `room_types` with room counts     |
| `getChannelSettings()`              | `channels`                        |
| `getTaxRateSettings()`              | `tax_rates`                       |
| `getStaffSettings()`                | `staff_users`                     |
| `getRoomsForSettings({ q, page })`  | `rooms_for_settings(...)`         |
| `getPaymentMethodSettings()`        | `payment_methods` incl. retired   |
| `getMealReport(from, to)`           | `meal_report(from, to)`           |

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
- No API routes except external webhooks.
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

- **Rows stay room types.** The reference runs a small property — its rail rows
  look like individual rooms, which is why hovering its dot says "Room clean
  status is: Dirty" in the singular. Ours does not get to assume that scale.
  See the note on `getCalendarBookings()` above.
- **The dot on the rail is housekeeping, not availability.** It used to report
  how tight the window was, which every cell on that row already says. It now
  reads `room_status_by_type()` — rose while anything waits to be cleaned,
  slate when the whole type is out of order, emerald when there is nothing to
  do — and its tooltip gives the breakdown in a receptionist's words. Counts
  per type, never a room list, so it is the same size at 40 rooms and at 1,800.
- **The rail's pencil goes to Settings.** Hovering a room type shows an edit
  affordance, as the reference does, linking to
  `/settings?tab=room-types&edit=<id>`, which opens that type's form on
  arrival. It is a way in, not a second editor: renaming still happens in one
  place. It appears on focus as well as hover, because hover alone hides it
  from anyone working by tab.
- **The corner carries a date jump.** Paging a fortnight at a time is fine for
  next week and useless for next November, which is where the client's own
  calendar was sitting. It is a plain GET form, so it needs no client
  JavaScript, and `HEAD_H` is tall enough for three rows — at two the controls
  shared a line and the "−" was pushed off the end of the rail.
- **The board keeps the availability figure**, faint at the foot of each cell,
  because that is what this screen used to be and is the only thing on it that
  answers "can I sell tonight". It sits in a reserved strip rather than behind
  the bars: overlaid, it vanished under every booking, and cells without one
  still showed a number, so the row read as half broken.
- **Bars carry booking status on their edge** — amber pending, blue confirmed,
  green in house, grey departed — where the reference's are uniform. The
  information was already there.
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
- **Column width is fixed and the card is `w-fit`.** Bars are positioned by
  arithmetic over that width; letting columns stretch to fill would put every
  bar in the wrong place.
- **One scroller, and everything freezes against it with `sticky`.** The board
  is a single element that scrolls both ways: the date header and the season
  band hold their place down the page, the room-type rail holds its place
  across, and the corner holds both. Two panes syncing their scroll positions
  is the other way to build this and it drifts by a pixel on a trackpad; one
  scroller cannot drift from itself. The sticky offsets are arithmetic over
  `HEAD_H` and `SEASON_H`, so those two must be exactly as tall as declared —
  padding them by eye opens a gap where rows show through.
- **The season band is real, and a season changes no price.** 0044 added
  `seasons`: a named date range per property, managed in Settings. It labels
  the calendar and nothing else — rates stay in `rate_plan_days`, because a
  season that quietly moved rates would be a second price list nobody could
  see. Seasons cannot overlap (an exclusion constraint, since two bands over
  one date has no sensible drawing) and the last day is included.
  - A season is genuinely deleted, unlike a room, a room type or a payment
    method. Nothing points at one, so removing it loses no history.
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
- **Cancelled bookings get their own row**, never the live ones, where they
  would read as sold. `calendar_bookings()` returns them only when asked.
- **The reference's "Holding Area" row was not cloned.** Nothing in this schema
  matches it and guessing would put bookings somewhere arbitrary. Ask the
  client what it holds before building it.

**The house board, not a room rack.** The dashboard shows house state as a
segmented status bar plus a clickable legend, with an on-demand room list
behind a "View rooms" toggle —
`src/components/dashboard/house-board.tsx`. It replaced a key-board grid that
rendered one tile per room. That grid was the nicest thing on the page at 40
rooms and unusable at 1,800, which is the scale the client actually operates
at. **Do not reintroduce a grid of one tile per room**, on the dashboard or
anywhere else. Collapsed height must stay constant regardless of room count.

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
- **All nine Inventory screens are one grid with a different column brought
  forward.** `inventory_grid()` reads it, `src/components/inventory/` renders
  it, and `SCREENS` in `field-spec.ts` says what each one shows and sets. Do
  not build a tenth screen by copying a ninth.
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
- **`save_property()` refuses a missing check-in or check-out time.** The
  columns are `not null` and every arrival and departure is timed against them,
  so there is no blank to fall back to. Until 0032 the null went straight into
  the UPDATE and a manager who cleared the field got the raw not-null violation
  back.
- **A property is set up from `/settings`, not from SQL.** Room types, rooms,
  booking sources, tax rates and the property itself are all written through
  RPCs in `src/lib/actions/settings.ts`. Settings lives in the user menu, not
  the nav bar: the client fixed the nine top-level sections and this is not one
  of them.
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
  - **There is no delete**, for a room or a room type or a payment method:
    bookings and payments point at them under `on delete restrict`. A room out
    of service is `ooo`; a method no longer taken is `is_active = false`.
  - Status is not settable here. It is changed where the work happens — the
    housekeeping report and the house board.
- **`payment_methods.affects_drawer` is not a setting.** A check constraint
  ties it to the kind — cash touches physical cash, nothing else does — so
  `save_payment_method()` derives it and takes no parameter for it. Offering
  the tickbox would be offering a choice the database refuses, on the one
  column the drawer total and every blind count are worked out from.
  `unique (property_id, kind)` bounds the whole screen too: a property has at
  most one method per kind, so the list is the eight kinds, each configured or
  not, never free-form.
- **A payment method's kind is frozen once payments exist against it.** Moving
  a method across the cash line afterwards would restate every shift already
  counted. Renaming and retiring stay free; the name is what the cashier picks
  from, the kind is what the money means.
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
- **Password reset is three screens and no API route.** `/login` links to
  `/forgot-password`, which calls `resetPasswordForEmail` with a `redirectTo`
  of `<origin>/reset-password`; that page turns whatever the link carried into
  a session and then calls `updateUser`. Both are client components using the
  browser client, like `/login`, because the session cookies have to be set
  where the token lands. That keeps "no API routes except external webhooks"
  intact — there is no `/auth/callback` route handler.
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
  see nothing. The property is therefore named in the URL and passed to four
  `security definer` RPCs granted to `anon`: `public_property`,
  `public_rate_plans`, `public_room_types` and `create_public_booking`. That is
  the entire public surface — no table, no view, none of the staff functions.
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
  - **The guest page speaks nineteen languages and the staff app speaks
    English.** `src/lib/i18n/` holds the locale list and a flat dictionary.
    Guest copy is ordinary — dates, a room, a price, a name. Staff copy is
    hotel and accounting terminology where a wrong word in a cash screen is an
    operational risk, and that wants a translator rather than a best guess.
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
```

## Copy and interface writing

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
- **Reports — done.** All thirteen, Meal included as of 0038.

### What still renders `<ComingSoon />`

Nothing. Every route in the nav is built and on real data.

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
6. **Room scale — still open, and only the client can close it.** The ~1,800
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
    That is what a UK hotel selling to the public does, since consumer prices
    have to be shown with tax in. A property selling mainly to businesses that
    reclaim it would want exclusive instead — and that is a new rate, not an
    edit: a rate with posted charges against it is frozen, because a folio item
    records which rate it used.
11. **No-show policy at night audit — settled: mark and charge the first
    night.** `close_business_date()` now sweeps every `confirmed` booking whose
    arrival date has been reached and which nobody checked in. It calls
    `cancel_booking(..., p_no_show => true)` — the existing release path, not a
    second one — so the rooms and nights go to `no_show` and back on sale, and
    it posts the arrival night as a fee on the folio.
    - **`pending` is deliberately not swept.** The guest booking page creates
      pending bookings; billing somebody for a stay the hotel never confirmed
      is a mistake, not a no-show.
    - **The fee is `miscellaneous`, not `room_charge`.** `post_charge()`
      refuses `room_charge` outright, and rightly: a room charge belongs to a
      night somebody occupied and is keyed to `booking_room_night_id` by a
      unique index. Posting a no-show as room revenue would put room revenue
      against a room nobody slept in and break the tie between the financial
      report and the occupancy report. It lands in extras, where a fee belongs.
    - **The amount is the arrival night exactly** — rate less discount as the
      net and the night's own tax as the tax, summed over every room on the
      booking. A booking with no rate loaded is marked and charged nothing,
      because there is nothing to bill and a made-up figure is worse.
    - **Whether a no-show fee is VATable is a question for the accountant.** It
      currently carries the tax the night carried. If the answer is that it
      should not, that is a change to the audit.
    - The sweep uses `check_in <= business_date`, not `=`, so a backlog cannot
      accumulate silently if the audit is not run for a few days.
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
