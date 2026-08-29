# Hotel PMS Portal

Custom property management system for a hotel. Front desk operations,
channel-connected bookings, and a cashier shift/drawer feature.

## Where this project currently stands

The front end is **built and deployed**. Dashboard, bookings list, customers
list and the cashier shift screen all work, running on generated mock data.
There is no database yet.

A client revision round has been applied on top of the original build: the
palette moved from brass/slate to the client's white/blue/dark-blue scheme, the
per-room grid on the dashboard was replaced with a compact house board, the
property name moved from the sidebar into a top bar, and several nav items were
renamed and reordered. See "Client revision round" below before changing any UI.

**Do not rebuild or restyle existing screens unless asked.** The remaining
Phase 1 work is the Supabase schema and swapping the data layer underneath the
components that already exist.

## Client revision round — do not revert these

The client compared this build against their reference system (Reservation
Centric) and asked for five changes. All five are shipped. Treat them as the
current design, not as drift.

1. **Nav order and labels.** Sidebar order is fixed: Dashboard, Calendar,
   Inventory, Bookings, Promotions, Reports, Customers, Cashier, Meeting Rooms.
2. **Dashboard, not Front Desk.** The route `/dashboard` is labelled
   "Dashboard" in the nav, the page `<h1>` and the page title. "Front Desk"
   survives only as a booking channel value in mock data — do not rename that.
3. **Promotions, not Offers.** The nav label is "Promotions"; the route is
   still `/offers`. Renaming the route is optional and has not been done.
4. **Headline at the top.** The property name and business date live in
   `src/components/top-bar.tsx`, rendered by `src/app/(app)/layout.tsx`. The
   sidebar no longer carries a brand block and `SideNav` takes no props. Each
   page still prints its own title below the top bar.
5. **No per-room grid.** See the house board note in the design system section.

## Stack

- Next.js 15 (App Router), TypeScript strict, React 19
- Tailwind 3, no component library — plain components in `src/components`
- Supabase (Postgres, Auth, Realtime, RLS) — not yet added
- Recharts, date-fns
- pnpm

## The swap point — read this before touching data

Every page reads through `src/lib/mock/queries.ts`. Those functions are async
and return exactly the shape the real Supabase queries will return:

| Function                 | Becomes                           |
| ------------------------ | --------------------------------- |
| `getArrivals(date)`      | `dashboard_arrivals(p_date)`      |
| `getDepartures(date)`    | `dashboard_departures(p_date)`    |
| `getOccupancyForecast()` | `occupancy_forecast(from, 28)`    |
| `getRevenueSeries()`     | `revenue_series(from, 28)`        |
| `getActivity()`          | paginated read of `activity_log`  |
| `getBookings(filters)`   | paginated `booking_totals` query  |
| `getCustomers(filters)`  | paginated `customer_stats` query  |
| `getRooms()`             | `rooms` joined to `booking_rooms` |
| `getHouseSummary()`      | house state aggregate             |
| `getOpenShift()`         | open row in `cashier_shifts`      |

To go live: create `src/lib/queries.ts` with identical signatures backed by
Supabase, change the imports in the page files, delete `src/lib/mock/`.
**No component changes.** If a swap seems to require changing a component, the
query is returning the wrong shape — fix the query, not the component.

**Two signatures must change during the swap, for room-count scale.** The
client operates properties with up to ~1,800 rooms. `getRooms()` currently
returns every room and the dashboard filters in the browser, which is fine on
mock data and wrong against Postgres:

- `getHouseSummary()` must return the six room-state counts, so the collapsed
  house board needs no room list at all.
- `getRooms({ q, state, page })` must be filtered and paginated server-side,
  called only when the room list is expanded.

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
- **Due out** uses `warn` (#D97706), not the accent. These were the same colour
  before the palette change, which made a due-out room indistinguishable from
  the active nav marker. Keep them separate.
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
- Cashier scope: take payments, record paid-outs (money leaving the drawer,
  optionally recharged to a guest folio), close the shift with a blind cash
  count, next receptionist opens a fresh one. Shift close is a blind count —
  never reveal the expected figure before the counted amount is entered.
- Property scale: assume up to ~1,800 rooms per property. Any UI that renders
  one element per room, or any query that returns every room, is a bug.

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

- **Phase 1** — schema, auth, and swapping the mock layer for Supabase.
  Project setup and the front end are already done. Remaining: migrations
  0001–0005, seed data, auth and roles, then the swap.
- **Phase 2** — calendar grid, booking create and edit, inventory restrictions
  UI, promotions.
- **Phase 3** — cashier wired to real data, reports, hardening.

Out of scope right now: calendar, booking creation, rate editing, promotions,
reports, meeting rooms. Those routes render `<ComingSoon />` and should stay
that way.

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
6. **Meeting rooms.** Scope unknown. The nav entry and placeholder route exist;
   nothing else. Whether this means bookable function space with its own rate
   plans, or a simple internal room-booking calendar, changes the schema
   materially. Ask before designing tables.
7. **Headline placement.** The property name moved to the top bar; per-page
   titles stayed in place. If the client meant page titles should move up
   instead, that touches every route — confirm before building it.
