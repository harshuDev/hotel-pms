# Hotel PMS Portal

Custom property management system for a hotel. Front desk operations,
channel-connected bookings, and a cashier shift/drawer feature.

## Where this project currently stands

The front end is **built and deployed**, and every read and write in it goes to
Supabase. `src/lib/mock/` is deleted. Migrations `0001` through `0024` are
applied to the hosted database.

Working on real data: dashboard (house board, movements, pace, activity feed),
bookings list, customers, the availability calendar, cashier (open a shift,
take payments, record paid-outs, blind close), check-in and check-out, the
night audit that advances the business date, taking a booking, and twelve
reports — occupancy,
debtors, payments, financial, extras, daily checkout, booking, reservations,
cancellation, channel, housekeeping and in house.

The hosted database holds one property, one staff user, an open business date
and seven payment methods. **It has no rooms, customers or bookings**, so most
screens render correctly and empty until data is imported.

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
  cash. Cash true; card, UPI, bank transfer, OTA prepaid false.
- `booking_room_nights` holds one row per room per night at that night's rate.
  Occupancy, ADR, RevPAR and the revenue chart all derive from it with a
  GROUP BY. Generate these rows on booking create and modify.
- **Taking a booking goes through `create_booking()` and nothing else.** One
  transaction resolves or creates the customer, allocates the reference, writes
  the booking, writes one `booking_rooms` row per room and puts the rate on the
  nights `sync_booking_room_nights()` generates. A booking assembled from
  several calls leaves a half-made booking behind on any failure, holding
  inventory with no guest against it.
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
- Currently assumed whole-day booking (`starts_on` / `ends_on`, dates). If
    the client wants hourly or half-day slots, these become `starts_at` /
    `ends_at` timestamps and the constraint becomes `tstzrange` — a migration
    plus a calendar rewrite. Confirm before building.

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
- **Phase 3 — mostly done.** Cashier on real data, check-in and check-out, the
  night audit, hardening, and the first two reports.
- **Phase 2 — in progress.** Availability calendar and booking creation are
  built. Remaining: booking edit, inventory restrictions, promotions, meeting
  rooms.
- **Reports — done** except Meal, which has no schema behind it.

### What still renders `<ComingSoon />`

Buildable on the schema as it stands:

- Booking edit. `create_booking()` takes a booking; changing one afterwards
  still means going through the tables.

Blocked on a schema that does not exist yet, and on a decision (see below):

- **Inventory** — all nine routes. There is no rate, availability or
  restriction model anywhere in the schema.
- **Promotions** (`/offers`) — no model.
- **Meeting Rooms** — no `meeting_rooms` or `meeting_room_bookings` tables.
- **Reports → Meal** — no meal plan, board type or rate plan exists.

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
7. **Rate model.** Nothing stores a rate. `booking_room_nights.room_rate_cents`
   is written per night with no rate plan behind it, so Inventory has nothing
   to edit. A rate plan per room type per date, with restrictions layered on
   top, is a schema design, not a screen.
8. **Promotions.** No model. What a promotion adjusts — rate, length of stay,
   a fixed discount — decides the shape.
9. **Meeting room granularity.** Still whole-day (`starts_on` / `ends_on`) as
   assumed. Hourly or half-day slots make these `starts_at` / `ends_at` and the
   exclusion constraint a `tstzrange`. Confirm before the tables are written,
   because it is a migration plus a calendar rewrite afterwards.
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
