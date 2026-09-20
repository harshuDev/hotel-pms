# Hotel PMS Portal

Custom property management system for a hotel. Front desk operations,
channel-connected bookings, and a cashier shift/drawer feature.

## Where this project currently stands

The front end is **built and deployed**, and every read and write in it goes to
Supabase. `src/lib/mock/` is deleted. Migrations `0001` through `0055` are
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
two exceptions that Postgres will not let anyone undo: there is no delete for a
room type or a tax rate, because bookings and folio items point at them under
`on delete restrict`. A tax rate that should not apply is retired.

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
   - **The user menu is Profile, Guest booking page, Settings, Reload data and
     Log out. There is no Language item and no footnote.** Both were removed
     after the client asked what the point of a control that changes nothing
     was. A disabled row was tried twice — silent, then labelled "English" —
     and read as broken the first time and pointless the second. **Do not add a
     control to this menu that cannot do anything.** The nineteen languages
     live on the guest booking page, where the reader might not speak English;
     if the staff app is ever translated, the switcher goes back here. The logo
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
  — it should return only the public booking surface and the two policy
  helpers. Four older functions held it through PUBLIC instead and needed
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
    more use than the per-type dot above it: "101 is dirty" is actionable in a
    way that "something in Deluxe is dirty" was not. The type keeps its
    summary dot as well.
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
- **The corner carries a date picker that draws a month.**
  `src/components/calendar/date-jump.tsx`. It was an `<input type="date">`, on
  the grounds that a plain GET form needs no client JavaScript; the client asked
  for a calendar they can see and click, and the native control shows one only
  behind a small icon in an 18px field on a dark rail, which nobody reads as a
  calendar. Picking a day navigates, and "Today" returns to the business date.
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
- **Two standing rows sit under the room types: Holding area and Cancelled.**
  Both draw through one `ExtraRow` component, because the only thing that
  differs is the label, and both keep a row's height when empty so the board
  does not jump as bookings move in and out.
  - **Holding holds `pending` bookings** — the client settled this: it is what
    nobody has confirmed yet. It needs no migration, since
    `calendar_bookings()` already returns the status; the page filters them out
    of `barsByType` and passes them separately. A pending booking is not sold,
    and a bar sitting on a room type reads as though it were. This is the same
    argument that keeps cancelled bookings off the live rows.
  - **Cancelled** never goes among the live rows either.
    `calendar_bookings()` returns those only when asked.
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
  - **`assign_room()` only demands a clean room for a stay that has already
    started** (0053). It used to demand `vacant_clean` always, which was right
    while check-in was the only caller and wrong the moment the front desk
    started placing future bookings: a room occupied tonight is a perfectly
    good room for next March. The overlap check is what protects the guest and
    is unchanged.
  - **The control is a sibling of the bar, not a child of it.** A `<button>`
    inside an `<a>` is invalid HTML and browsers rearrange it during parsing,
    so it vanished; and `Bars` is a Server Component, so the wrapper meant to
    stop the click carried an `onClick` React cannot serialise and the page
    500'd. As a sibling it needs neither. **That is the third time this
    boundary has bitten** — after the calendar's `hrefFor` closure and the
    search button's `onSearchClick`.
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
- **The board opens a week BEFORE the business date, not on it.** The client:
  "in the calendar I want the hotels to be able to see past dates too".
  Nothing had ever stopped a past date being shown — the chevrons and the date
  picker go anywhere, and past nights are already shaded `board-past` — but
  the default window put today hard against the left edge, so looking back
  meant paging a whole month and hunting. `CALENDAR_LOOKBACK` is 7 and
  `CALENDAR_NIGHTS` went from 30 to 35 with it, so the four weeks of forward
  view are still there. Both "Today" controls, the rail's and the date
  picker's, return to that same window rather than to a board starting on
  today — two Todays landing in different places reads as a bug.
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
- **Rate plans are created and corrected in Settings** (`?tab=rate-plans`),
  through `save_rate_plan()`. Until 0054 a plan could be created — from a
  corner of the Inventory screen — and never renamed, retired or reordered,
  which is why the hosted property had exactly one. Setting up what the hotel
  sells belongs beside the room types and the tax rates, not inside a week's
  pricing.
  - **There is no delete**, like a room type or a tax rate: `rate_plan_days`
    and `booking_rooms` point at a plan, so one no longer sold is
    `is_active = false` and a booking taken on it keeps saying what it was sold
    as.
  - **A property always keeps one default plan.** `save_rate_plan()` promotes
    the first active plan if the last default is retired or stood down —
    otherwise a booking naming no plan has nowhere to fall back to.
  - **"Non-refundable" is a name, not yet a rule.** A plan can be called that
    and priced like it today; what actually refuses a refund is a cancellation
    policy, and there is no cancellation policy table yet. Do not pretend
    otherwise in the interface.
  - `create_rate_plan()` still exists and still works. It is what the Inventory
    screen calls, and breaking it to rename it would be churn for no
    user-visible gain.
  - **"Rates (Main)" and "Rates (All)" are the same field.** Main pins the
    property's default plan and hides the switcher; All lets you pick. Two
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
  - **A room that has never been booked is deleted from the list** (0055),
    through `delete_room()`. A room with bookings is refused by name and stays
    `ooo`; the list says which is which with `has_bookings` rather than letting
    somebody find out by clicking. The room's `room_status_history` goes with
    it — that log is about the room, and once the room is gone there is nothing
    for it to be evidence of. **There is still no delete for a room type or a
    payment method**: bookings and payments point at those under
    `on delete restrict`, so one no longer used is `is_active = false`.
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
```

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
