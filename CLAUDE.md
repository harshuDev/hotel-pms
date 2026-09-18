# Hotel PMS Portal

Custom property management system for a hotel. Front desk operations,
channel-connected bookings, and a cashier shift/drawer feature.

## Where this project currently stands

The front end is **built and deployed**, and every read and write in it goes to
Supabase. `src/lib/mock/` is deleted. Migrations `0001` through `0032` are
applied to the hosted database.

Working on real data: dashboard (house board, movements, pace, activity feed),
bookings list, customers, the availability calendar, cashier (open a shift,
take payments, record paid-outs, blind close), check-in and check-out, the
night audit that advances the business date, taking a booking, all nine
Inventory screens, the booking screen with edit and cancel, promotions,
meeting rooms, property settings, and twelve reports — occupancy, debtors, payments,
financial, extras, daily checkout, booking, reservations, cancellation,
channel, housekeeping and in house.

The hosted database holds one property, one staff user, an open business date
and seven payment methods. **It has no room types, rooms, channels, rate plans
or tax rates yet** — but as of 0030 all of those can be created from
`/settings` rather than by hand in SQL, and as of 0031 an individual room and
the payment methods can be corrected there too, so the property can be set up
and kept right from the application. Until a channel exists, no booking can be taken at all: every
booking must have a source.

The open business date is behind real time. The night audit advances it one
day at a time and posts that night's room charges, so it is run once per day
rather than caught up automatically.

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
   - The logo is a placeholder until the client sends an asset, search renders
     disabled until the lookup is built, and the user menu items are disabled
     until auth exists. None of these are bugs.
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
  an inclusion posts to the folio rather than taking money off a night.
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
    the booking screen — keeps returning room bookings only. That is right for
    all but debtors, which is a known gap: a meeting room debt is not chased by
    that report.
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
- **Reports — done** except Meal, which has no schema behind it.

### What still renders `<ComingSoon />`

- **Reports → Meal** — no meal plan or board type exists. It needs the same
  inclusions model a "rate includes breakfast" promotion would, so the two are
  one piece of work.

Every other route in the nav is built and on real data.

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
6. **Room scale.** The ~1,800 figure came from a passing remark in client
   feedback and has not been confirmed. It now drives the house board design
   and two query signatures, so confirm it before writing migrations.
7. **Rate model — settled.** A rate plan per room type per date, with
   restrictions layered on top: `rate_plans`, `rate_plan_days`,
   `room_type_days`. See the inventory notes above.
8. **Promotions — settled.** A discount (percentage or amount) or free nights,
   optionally behind a code, best single one wins. See the promotion notes
   above. Still open within it: **inclusions** — "rate includes breakfast" —
   which are a different mechanic because they post to the folio rather than
   reducing a night, and which would also unblock the Meal report.
9. **Meeting room granularity — settled and built: whole day.** `starts_on` /
   `ends_on` as dates, exclusion constraint on an inclusive `daterange`.
   Hourly or half-day slots would be a migration plus a calendar rewrite.
10. **Tax rate and inclusion.** `tax_rates` is empty. 20% is easy; whether the
    property quotes VAT-inclusive or exclusive is a policy decision that
    changes every charge by a sixth.
11. **No-show policy at night audit.** `close_business_date()` deliberately
    leaves unarrived bookings alone. Marking them no-show writes off revenue,
    so it needs saying out loud first.
12. **Cancellation dating.** `bookings` has no `cancelled_at`. The cancellation
    report is therefore ranged on arrival date and shows a cancelled-on column
    read from the activity log, which is blank for any status change made
    outside the application. If the client wants "cancellations received this
    week", that is a column plus a backfill, not a screen.
13. **Channel commission.** The channel report works commission out from
    `channels.commission_bps` on the room revenue. Nothing records a commission
    being invoiced or paid, so the figure is what is owed, never a balance. A
    real channel ledger is its own model.

14. **Meeting room debts are not in the debtors report.** That report is per
    room booking and joins `bookings`; a meeting room folio has no booking to
    join to. The balance shows on the meeting room booking itself. Widening the
    report means it returns two different kinds of thing, which is a reporting
    decision rather than a bug to fix quietly.

15. **Inviting a new member of staff.** Creating an auth account needs either
    the Supabase dashboard or a server action holding the service-role key.
    The second bypasses RLS, which the brief discourages, so it has not been
    built. Until it is, a new person is invited in Supabase Auth and then
    appears in Settings to be named and given a role.
