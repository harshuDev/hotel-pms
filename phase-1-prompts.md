# Phase 1 — Claude Code session prompts

Session 0 (project bootstrap) is already done — the front end is built and
deployed on mock data. Start at Session 1. One session per step, `/clear`
between each, commit and push after each.

Every prompt below assumes `CLAUDE.md` is at the repo root and has been read.
If a session starts drifting, `/clear` and restate — don't correct inside a
long context.

**Standing instruction — paste at the start of every session below, all of
which touch the schema:**

> Before writing code, give me a plan: files you'll create or change, and the
> key decisions you're making. Wait for my approval. Don't write code yet.

Schema mistakes are the expensive ones — they ripple through every later
session and through the mock-to-real data swap.

**Before Session 1:** confirm the five open decisions with the client (listed
in `CLAUDE.md` under "Open decisions"). They change the tables these
migrations create.

**Before Session 1:** local Supabase must be running —
`pnpm supabase start` (Docker Desktop open first), `.env.local` filled in
from its output.

---

## Session 1 — Migration 0001, core tables

```
Create supabase/migrations/0001_core.sql.

Tables (all with id uuid primary key default gen_random_uuid(),
created_at timestamptz default now()):

properties
  name, timezone text, currency char(3), check_in_time time,
  check_out_time time, is_active bool default true

staff_users
  id references auth.users(id) on delete cascade,
  property_id references properties, full_name, role, is_active bool
  role: admin | manager | front_desk | cashier | housekeeping

room_types
  property_id, code, name, base_occupancy int, max_occupancy int, sort_order int
  unique (property_id, code)

rooms
  property_id, room_type_id, number, floor,
  status: vacant_clean | vacant_dirty | occupied | ooo
  unique (property_id, number)

room_status_history
  room_id, status, changed_at timestamptz, changed_by references staff_users
  (append-only; feeds the future Housekeeping report)

customers
  property_id,
  kind: personal | company,
  first_name, last_name, company_name,
  national_id_number, email, phone,
  exclude_from_email bool default false,
  merged_into_id references customers(id)   -- soft merge, never delete
  index on (property_id, lower(email)) and on (property_id, phone)

channels
  property_id, code, name,
  kind: direct | ota | wholesaler | gds | offline,
  commission_bps int default 0, is_active bool

activity_log
  property_id, actor_id references staff_users, entity_type, entity_id uuid,
  action, summary text, metadata jsonb, created_at
  index on (property_id, created_at desc)

Use Postgres enum types for every enum listed above, named <thing>_kind or
<thing>_status.

Then:
- Create `public.current_property_id()` as a stable security definer function
  returning the property_id from staff_users for auth.uid().
- Create `public.current_role()` returning the caller's role.
- Enable RLS on every table.
- Policy on each: `using (property_id = current_property_id())`.
- staff_users: readable by all staff in the property, writable only by admin.
- activity_log: select only, no insert/update/delete for any role
  (it will be written by triggers with security definer).

Verify: `pnpm supabase db reset` runs clean, then generate types into
src/lib/database.types.ts.
```

Commit: `feat(db): core schema + RLS`

---

## Session 2 — Migration 0002, bookings

```
Create supabase/migrations/0002_bookings.sql.

rate_plans
  property_id, code, name, meal_plan, is_active

rates
  rate_plan_id, room_type_id, date, amount_cents bigint
  unique (rate_plan_id, room_type_id, date)

bookings
  property_id, reference text, customer_id, channel_id,
  external_reference text, external_payload jsonb,
  status: pending | confirmed | checked_in | checked_out | canceled | no_show,
  settlement: at_property | prepaid_to_channel | virtual_card,
  commission_cents bigint default 0,   -- captured at booking time, never recomputed
  booked_at timestamptz, business_date date, notes text
  unique (property_id, reference)
  index on (property_id, status), (property_id, booked_at desc)

booking_rooms
  booking_id, room_type_id, room_id (nullable until assigned), rate_plan_id,
  check_in date, check_out date, adults int, children int,
  status (same enum as bookings)
  check (check_out > check_in)

booking_room_nights
  booking_room_id, date, amount_cents bigint
  unique (booking_room_id, date)
  index on (date)

booking_room_nights is the source of truth for occupancy and room revenue.
One row per room per night. Do not add a total column to bookings.

Add a trigger function `log_booking_activity()` that writes to activity_log on
insert and on status change for bookings and booking_rooms. Summary text
should read like the existing live feed component, e.g.
  "New booking via Front Desk from JORGE DIAS CASILLAS worth $1754"
  "Cancelled booking from Camra Comier"
  "Booking modification via BookingCom for Elany Alejandra Vera Luque"
Make it security definer so it can write to a table staff can't insert into.

RLS on all new tables, same property_id pattern.

Verify: db reset clean, regenerate types.
```

Commit: `feat(db): bookings + activity triggers`

---

## Session 3 — Migration 0003, money and cashier

```
Create supabase/migrations/0003_money.sql.

Read the "Immutability" and "Sign convention" sections of CLAUDE.md first and
follow them exactly.

payment_methods
  property_id, code, name, affects_drawer bool, sort_order, is_active

products
  property_id, code, name,
  category: extra | meal | minibar | misc,
  price_cents bigint, tax_rate_bps int

ar_accounts
  property_id, customer_id, credit_limit_cents bigint, status

folios
  property_id, booking_id, customer_id,
  kind: guest | master | ar,
  ar_account_id (nullable),
  status: open | closed,
  opened_at, closed_at, business_date

folio_items
  folio_id, business_date, product_id (nullable),
  type: room_charge | fnb | extra | tax | misc | discount | paid_out_recharge,
  description, qty int default 1,
  amount_cents bigint, tax_cents bigint default 0,
  reverses_id references folio_items(id),
  posted_by references staff_users, created_at

payments
  folio_id, shift_id NOT NULL, business_date,
  payment_method_id, amount_cents bigint, reference text,
  reverses_id references payments(id),
  taken_by references staff_users, created_at

cashier_shifts
  property_id, user_id, business_date,
  opened_at, closed_at,
  opening_float_cents bigint,
  declared_cash_cents bigint,
  expected_cash_cents bigint,     -- snapshot written at close, never recomputed
  variance_cents bigint,
  closing_note text, closed_by, approved_by,
  status: open | closed | approved

paid_outs
  property_id, shift_id NOT NULL, business_date,
  amount_cents bigint,
  category: taxi | guest_purchase | medical | supplies | staff_advance | other,
  reason text, payee text,
  recharge_folio_id references folios(id),   -- null = house expense
  receipt_ref text, receipt_url text,
  reverses_id references paid_outs(id),
  created_by, created_at

cash_movements
  shift_id, kind: drop_to_safe | bank_deposit | float_in | float_out,
  amount_cents bigint, note, created_by, created_at

On folio_items, payments and paid_outs add:
  signed_amount_cents bigint generated always as
    (amount_cents * case when reverses_id is null then 1 else -1 end) stored

Constraints:
- Partial unique index: only one shift per property may have status = 'open'.
- Trigger rejecting insert into payments or paid_outs whose shift_id points at
  a shift that is not 'open'. Raise a clear error message.
- Trigger rejecting UPDATE or DELETE on folio_items, payments, paid_outs.
  Message should say to post a reversing row instead.

RLS: standard property scoping, plus
- insert on payments, paid_outs, cash_movements: role in (cashier, front_desk, admin)
- update on cashier_shifts status to 'approved': role in (manager, admin)

Verify: db reset clean. Then write a throwaway SQL script proving the
immutability triggers fire — try an UPDATE on a payment and confirm it errors.
Delete the script after.
```

Commit: `feat(db): folios, payments, cashier shifts`

---

## Session 4 — Migration 0004, inventory

```
Create supabase/migrations/0004_inventory.sql.

availability
  property_id, room_type_id, date, rooms_to_sell int
  unique (room_type_id, date)
  -- allotment for sale, distinct from the physical room count

restrictions
  property_id, room_type_id, rate_plan_id (nullable = applies to all plans), date,
  closed_to_arrival bool default false,
  closed_to_departure bool default false,
  stop_sell bool default false,
  close_out bool default false,
  min_stay_through int, min_stay_arrival int, max_stay int,
  updated_at, updated_by
  unique (room_type_id, rate_plan_id, date)  -- handle the nullable in the index

offers
  property_id, name,
  discount_type: percent | fixed,
  discount_value numeric,       -- percent, so numeric is fine here, not money
  starts_on date, ends_on date,
  days_of_week bool[7],         -- index 0 = Monday
  booking_window_start date, booking_window_end date,
  min_stay int, is_active bool, image_url text

offer_room_types (offer_id, room_type_id)
offer_translations (offer_id, locale, name, description)

RLS on all. No UI this phase — schema only.

Verify: db reset clean, regenerate types.
```

Commit: `feat(db): inventory restrictions + offers`

---

## Session 5 — Migration 0005, dashboard views

```
Create supabase/migrations/0005_views.sql.

All of these take the property from current_property_id() and must respect RLS.

1. view `folio_balances`
   folio_id, property_id,
   charges_cents  = sum of folio_items.signed_amount_cents + tax
   payments_cents = sum of payments.signed_amount_cents
   balance_cents  = charges - payments
   Positive balance = guest owes the hotel.

2. view `booking_totals`
   booking_id, property_id, reference, nights, room_count,
   total_cents (from booking_room_nights), due_cents (from folio_balances)

3. function `dashboard_arrivals(p_date date)`
   booking_rooms with check_in = p_date and status not in (canceled, no_show).
   Returns reference, guest name, room type, room number, adults, children,
   status, balance_cents.

4. function `dashboard_departures(p_date date)`
   Same shape, check_out = p_date.

5. function `occupancy_forecast(p_from date, p_days int)`
   For each date: occupied_rooms (count of booking_room_nights on non-canceled
   bookings), sellable_rooms (count of rooms not ooo), occupancy_pct.
   Must return a row for every date in the range even when zero — generate_series,
   left join. Do not let empty dates disappear.

6. function `revenue_series(p_from date, p_days int)`
   Per business_date: sum of folio_items.signed_amount_cents where type is a
   revenue type. Same generate_series rule.

Every function: `language sql stable security invoker`.

Verify: db reset clean, then call each function with a sample range and confirm
the row count equals p_days.
```

Commit: `feat(db): dashboard views and RPCs`

---

## Session 6 — Seed data

```
Create supabase/seed.sql. This runs on `supabase db reset`.

Seed realistically — flat or empty data hides bugs in the dashboard.

- 1 property: timezone Asia/Kolkata, currency INR, check-in 14:00, check-out 11:00
- 5 staff_users across the roles (create matching auth.users rows)
- 4 room_types, 40 rooms spread across them, a few marked vacant_dirty and one ooo
- payment_methods: Cash (affects_drawer true), Card, UPI, Bank Transfer,
  OTA Prepaid (all four false)
- channels: Front Desk (direct), Booking.com (ota, 1500 bps),
  Expedia (ota, 1800 bps), Hotelbeds (wholesaler, 2000 bps), Offline (offline)
- 3 rate_plans, rates for every room_type for the next 120 days with some
  weekend uplift so the numbers aren't uniform
- 60 customers, 5 of them companies, 2 companies with ar_accounts
- 120 bookings spread from 45 days ago to 90 days ahead:
    ~55% pending, ~30% confirmed, ~10% canceled, ~5% no_show
    mix of channels; all Hotelbeds and ~half of Expedia are prepaid_to_channel
    generate booking_room_nights for every one
- Folios for all past and in-house bookings, with room_charge items posted per
  night, and payments on roughly 70% of them so some balances are outstanding
- 3 closed cashier_shifts with a small variance on one, and 1 open shift
- 6 paid_outs, 4 recharged to a folio, 2 house expense

Occupancy should land somewhere in the 40-70% range on most days, with a couple
of spikes. Revenue should be visibly lumpy.

Verify: after db reset, call occupancy_forecast and revenue_series and confirm
the values vary day to day and are not zero.
```

Commit: `feat(db): realistic seed data`

This session is worth the effort. Building against an empty database is how
you end up staring at a flat line with no idea whether the query is wrong or
the data is.

---

## Session 7 — Auth

```
Implement Supabase auth with @supabase/ssr.

- src/lib/supabase/server.ts, client.ts, middleware.ts using the modern
  cookie-based SSR pattern (getAll/setAll, not the deprecated helpers)
- middleware.ts at project root: refresh session, redirect unauthenticated
  users to /login, redirect authenticated users away from /login
- /login page: email + password, matching the existing design system
  (chrome/brass tokens, Archivo/Public Sans), clear error states.
  Error copy says what went wrong, not "An error occurred".
- src/lib/auth.ts: getCurrentUser() returning the staff_users row joined with
  the property, cached with React cache()
- requireRole(roles: Role[]) helper for server components, throws/redirects
- Sign out action, wired into the existing SideNav user footer

Do not build a sign-up flow. Staff are created by an admin.

Verify: log in as the seeded front desk user, confirm the session survives a
refresh, confirm /dashboard redirects to /login when signed out.
```

Commit: `feat(auth): supabase session + role helpers`

---

## Session 8 — Swap the dashboard to live data

```
Read CLAUDE.md's "The swap point" section first.

Create src/lib/queries.ts implementing every function currently in
src/lib/mock/queries.ts, with identical signatures, backed by the Supabase
functions and views built in Sessions 1-5:

  getProperty, getBusinessDate, getArrivals, getDepartures,
  getOccupancyForecast, getRevenueSeries, getActivity, getBookings,
  getCustomers, getRooms, getHouseSummary, getOpenShift,
  searchBookingsForPayment

Then change the imports in every page under src/app/(app)/ from
@/lib/mock/queries to @/lib/queries. Do not change any component — if a
component seems to need a change, the query is returning the wrong shape;
fix the query.

Once every page is confirmed working against the real database, delete
src/lib/mock/ entirely.

Verify: every dashboard card, the bookings list, the customers list and the
cashier screen all show real seeded data instead of generated mock data, with
no visual change.
```

Commit: `feat(data): swap mock layer for Supabase`

---

## Phase 1 done — check before moving on

- [ ] `pnpm supabase db reset` runs clean from zero
- [ ] `pnpm typecheck` and `pnpm lint` pass
- [ ] Every table has RLS enabled and at least one policy
- [ ] Logging in as a front_desk user cannot insert a payment outside an open shift
- [ ] Immutability triggers reject UPDATE on folio_items, payments, paid_outs
- [ ] Dashboard charts show 28 non-zero, varying data points from the real database
- [ ] Login works, sign out works, session survives refresh
- [ ] Both list pages sort, filter and paginate against Supabase
- [ ] No currency value formatted anywhere except formatMoney / formatDue
- [ ] src/lib/mock/ has been deleted
- [ ] Every nav item leads somewhere real

Then take a Supabase project backup, and start Phase 2 (calendar, booking
creation, inventory restrictions UI, offers).
