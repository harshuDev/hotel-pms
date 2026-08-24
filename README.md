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

| Function                | Becomes                          |
| ----------------------- | -------------------------------- |
| `getArrivals(date)`     | `dashboard_arrivals(p_date)`     |
| `getDepartures(date)`   | `dashboard_departures(p_date)`   |
| `getOccupancyForecast()`| `occupancy_forecast(from, 28)`   |
| `getRevenueSeries()`    | `revenue_series(from, 28)`       |
| `getActivity()`         | paginated read of `activity_log` |
| `getBookings(filters)`  | paginated `booking_totals` query |
| `getCustomers(filters)` | paginated `customer_stats` query |
| `getOpenShift()`        | open row in `cashier_shifts`     |

To go live: create `src/lib/queries.ts` with the same signatures backed by
Supabase, change the imports in the page files, delete `src/lib/mock/`.
No component changes.

## Money

All currency is integer minor units (paise). `src/lib/money.ts` is the only
place a number becomes a string. `formatDue()` holds the display inversion
that shows an outstanding balance as a negative — the stored value is always
positive when the guest owes the hotel.

## Built

**Front desk** — the house strip (occupancy, arrivals, ADR, drawer, outstanding,
housekeeping), the room rack, today's movements, the pace chart, activity feed.
**Bookings** — searchable, filterable, paginated.
**Customers** — searchable, personal/company tabs.
**Cashier** — take payment, record paid-out, blind-count close with variance.

Everything else in the navigation is a scoped placeholder for Phase 2 or 3.

## Design notes

The room rack is the centrepiece and it comes from the hotel's own world: the
old pigeonhole key board behind a front desk, where you read the state of the
house by which keys were hanging. Forty tiles, coloured by state, grouped by
floor. Clicking a legend entry isolates that state.

Chrome is a deep cool slate; content sits on near-white. One accent — brass,
after key tags and bell pulls — carries the active nav marker, the revenue
line, today's marker on the chart, and nothing else. Status colours stay
semantic (green ready, amber due out, rose owing) because those carry meaning,
not decoration.

Type is Archivo for display and numbers (a signage grotesque — door plates,
floor markers) over Public Sans for UI text, which was drawn for dense data
tables and holds up at 12px. All figures are tabular-lining so columns align.

The charts changed on purpose. Two flat sparklines were replaced by one
timeline that stitches 28 days back to 28 days forward: solid bars are nights
already sold, pale bars are rooms on the books, the brass line is revenue, and
a dashed marker sits on today. That answers "are we ahead or behind", which
two separate sparklines never could.
