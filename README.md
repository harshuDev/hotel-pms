# Grand Ferndale — Property Management System

Client-facing demo of a custom PMS with a Cashier shift feature.

## Running locally

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000

## What is real and what is not

Everything on screen renders from `src/lib/mock/` — a deterministic generator
producing 140 bookings, 64 customers, 28 days of occupancy and revenue, and an
open cashier shift. There is no database yet.

**This is not throwaway code.** Every page reads through
`src/lib/mock/queries.ts`, whose functions are async and return exactly the
shape the Supabase queries will return:

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

To go live: create `src/lib/queries.ts` with the same signatures backed by
Supabase, change the imports in the page files, delete `src/lib/mock/`.
No component changes.

## Money

All currency is integer minor units (paise). `src/lib/money.ts` is the only
place a number becomes a string. `formatDue()` holds the display inversion
that shows an outstanding balance as a negative — the stored value is always
positive when the guest owes the hotel.

## Built

**Dashboard** — the house strip (occupancy, arrivals, ADR, drawer, outstanding,
housekeeping), the house board, today's movements, the pace chart, activity feed.
**Bookings** — searchable, filterable, paginated.
**Customers** — searchable, personal/company tabs.
**Cashier** — take payment, record paid-out, blind-count close with variance.

Everything else in the navigation is a scoped placeholder for Phase 2 or 3.

## Navigation

Navigation runs horizontally across the top, matching the system the client's
staff already work in. `src/components/top-nav.tsx` renders it; the section
list lives in `src/lib/nav.ts` so the desktop bar and the mobile drawer never
drift apart. Inventory, Bookings and Reports open as dropdown panels built on
the shared primitive in `src/components/menu.tsx`, which handles hover intent,
click-outside, Escape and arrow-key navigation in one place.

Below the blue bar, a slim strip carries the property name and the business
date. The business date is the hotel operating day, not wall-clock date, and it
stays visible on every screen because every decision at a front desk is made
relative to it.

## Design notes

The house board reads the state of the whole property in one line: a segmented
status bar over a clickable legend, with a searchable room list behind a
toggle. Its collapsed height is constant whether the property has 40 rooms or
1,800 — the client operates at the top of that range, and a per-room grid stops
being readable long before it gets there. Clicking a legend entry isolates that
state.

Chrome is dark blue; content sits on near-white. One accent carries the active
nav underline, the revenue line, today's marker on the chart, and nothing else.
Due-out rooms and pending bookings sit on a separate amber token, because they
previously shared the accent and became indistinguishable from it. The accent
token is still named `brass` from the earlier palette — the name is historical,
the value is blue, and renaming it to `accent` is a safe mechanical change that
hasn't been made yet.

Status colours stay semantic (green ready, amber due out, rose owing) because
those carry meaning, not decoration.

Type is Archivo for display and numbers (a signage grotesque — door plates,
floor markers) over Public Sans for UI text, which was drawn for dense data
tables and holds up at 12px. All figures are tabular-lining so columns align.

The charts changed on purpose. Two flat sparklines were replaced by one
timeline that stitches 28 days back to 28 days forward: solid bars are nights
already sold, pale bars are rooms on the books, the accent line is revenue, and
a dashed marker sits on today. That answers "are we ahead or behind", which
two separate sparklines never could.
