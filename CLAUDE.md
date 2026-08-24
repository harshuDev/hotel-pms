# Hotel PMS Portal

Custom property management system for a hotel. Front desk operations,
channel-connected bookings, and a cashier shift/drawer feature.

## Where this project currently stands

The front end is **built and deployed**. Dashboard, bookings list, customers
list and the cashier shift screen all work, running on generated mock data.
There is no database yet.

**Do not rebuild or restyle existing screens unless asked.** The remaining
Phase 1 work is the Supabase schema and swapping the data layer underneath the
components that already exist.

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

- **Chrome** `chrome-900/800/700/600` — deep cool slate. Sidebar and dark fills.
- **Content** `ink`, `ink-muted`, `ink-faint` on `shell` (#F1F4F7) and white cards.
- **Accent** `brass` (#B4813C) — ONE accent, used sparingly: active nav marker,
  revenue line, today's marker, key figures. Nothing else gets brass.
- **Status colours stay semantic** — emerald ready, brass due out, rose owing,
  slate departed. These carry meaning; don't restyle them decoratively.
- **Type** `font-display` (Archivo) for headings and figures with
  `tracking-tightest`. `font-sans` (Public Sans) for everything else.
- All figures carry the `tnum` class so columns align.
- Cards use `rounded-lg border border-line shadow-card`.

The room rack on the dashboard is the signature element — a key-board grid, one
tile per room, coloured by state. Preserve it.

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
  UI, offers.
- **Phase 3** — cashier wired to real data, reports, hardening.

Out of scope right now: calendar, booking creation, rate editing, offers,
reports. Those routes render `<ComingSoon />` and should stay that way.

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