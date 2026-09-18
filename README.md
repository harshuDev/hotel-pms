# Hotel PMS

A custom property management system: front desk operations, channel-connected
bookings, rates and availability, a cashier shift and drawer, meeting rooms,
and twelve reports.

`CLAUDE.md` at the repo root is the working document — the rules that hold
across the codebase, the domain decisions behind them, and the ones still open.
Read it before changing anything. This file is the short version.

## Running locally

```bash
pnpm install
cp .env.example .env.local     # fill in from `pnpm supabase start`
pnpm dev
```

Open http://localhost:3000.

For the database:

```bash
pnpm supabase start
pnpm supabase db reset         # applies every migration from scratch
pnpm supabase gen types typescript --local > src/lib/database.types.ts
```

`supabase/seed.sql` is development data only — a property, rooms, bookings and
folios with fixed UUIDs. `db reset` picks it up by default. Do not run it
against a hosted database.

## What is real

All of it. Every read and write goes to Supabase; there is no mock layer.
Thirty-four routes are built on real data — the dashboard, the availability
calendar, bookings with edit and cancel, customers, all nine Inventory screens,
promotions, meeting rooms, the cashier, check-in and check-out, the night
audit, property settings, and twelve reports.

One screen is not built: **Reports → Meal**. It needs a model of what a rate
includes, which is the same piece of work as a "rate includes breakfast"
promotion, and that decision is still open.

## How data moves

- **Reads** are Server Components calling `src/lib/queries.ts`, which is the
  only place a page touches Supabase. Each read is a Postgres view or RPC —
  aggregation never happens in the client. `CLAUDE.md` lists every query
  against the function behind it.
- **Writes** are Server Actions in `src/lib/actions/`. Each is a thin wrapper;
  the role gates and the refusals live in Postgres, so they apply however the
  row is written.
- **RLS does the filtering.** Reads run with the signed-in user's session and
  nothing bypasses it. Every tenant table carries `property_id` and a policy.
- **Types** come from `src/lib/database.types.ts`, generated from the schema
  and never edited. `src/lib/supabase/database.ts` is the type the clients are
  built with and corrects one thing the generator gets wrong; the comment there
  explains it.

## Scale

Assume up to ~1,800 rooms per property. No query returns every room and no
screen renders one element per room. The dashboard shows house state as a
segmented bar over a clickable legend with the room list behind a toggle, so
its collapsed height is the same at 40 rooms and at 1,800. The calendar's rows
are room types rather than rooms. The housekeeping report is a floor summary
plus a list paged in Postgres.

Meeting rooms are the one exception: a property has a handful, so a
row-per-room calendar is correct there.

## Money

Integer minor units — pence — in `bigint` columns and fields ending `_cents`.
Never a float, never `numeric`. Tax rates are basis points (`_bps`).
`src/lib/money.ts` is the only place a number becomes a string, and
`formatDue()` holds the display inversion that shows an outstanding balance as
negative; the stored value is positive when the guest owes the hotel.

`folio_items`, `payments` and `paid_outs` are append-only. A posted row is
never updated or deleted — a correction inserts a reversing row, and every
total sums a generated `signed_amount_cents`.

## Dates

`business_date` is the hotel operating day and `created_at` is wall-clock.
They are different columns and never interchangeable; all operational
reporting groups by the former. A partial unique index permits exactly one
open business date per property, and the night audit is what advances it.

## Navigation

Horizontal across the top, matching the system the client's staff already work
in. There is no sidebar. `src/components/top-nav.tsx` renders the blue bar and
`src/lib/nav.ts` is the single source of sections, so the desktop bar and the
mobile drawer cannot drift apart. Inventory, Bookings and Reports open as
dropdowns built on the shared primitive in `src/components/menu.tsx`, which
handles hover intent, click-outside, Escape and arrow keys in one place.

Below it, a slim strip carries the property name and the business date. It
stays visible on every screen because every decision at a front desk is made
relative to that date.

## Design

Chrome is dark blue; content sits on near-white. One accent carries the active
nav marker, the revenue line, today's marker and key figures — nothing else.
The accent token is still named `brass` from an earlier palette: the name is
historical, the value is blue, and renaming it to `accent` is a safe mechanical
change that has not been made.

Due-out rooms and pending bookings share a separate amber token, because on the
accent they became indistinguishable from the active nav marker. Status colours
stay semantic — emerald ready, amber due out, rose owing, slate departed —
because they carry meaning rather than decoration.

Type is Archivo for display and figures over Public Sans for UI text, which was
drawn for dense tables and holds up at 12px. All figures are tabular-lining so
columns align.

The pace chart stitches 28 days back to 28 days forward: solid bars are nights
already sold, pale bars are rooms on the books, the accent line is revenue, and
a dashed marker sits on today. That answers "are we ahead or behind", which two
separate sparklines never could.
