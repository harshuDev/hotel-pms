/**
 * ============================================================================
 * THE QUERY LAYER
 * ============================================================================
 * Every read in the application, backed by Supabase.
 *
 * RLS decides what each query can see; none of these functions filter by
 * property themselves. Aggregation happens in Postgres views and RPCs, never
 * here. Money stays in integer pence all the way to money.ts.
 *
 * Writes do not live here — they are Server Actions in src/lib/actions.
 * ============================================================================
 */

import { createClient } from "@/lib/supabase/server";

import type {
  ActivityItem,
  ActivityKind,
  Booking,
  BookingStatus,
  Customer,
  CustomerKind,
  SeriesPoint,
  PaidOut,
  PaidOutCategory,
  PaymentMethod,
  Shift,
  ShiftPayment,
  HouseStateCounts,
  HouseSummary,
  Room,
  RoomFilters,
  RoomsPage,
  RoomState,
  Settlement,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Returns the property belonging to the authenticated staff user's property.
 *
 * RLS is responsible for restricting this query to the current property.
 */
export async function getProperty() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("properties")
    .select("id, name, timezone, currency")
    .single();

  if (error) {
    throw new Error(`Failed to load property: ${error.message}`);
  }

  return data;
}

/* -------------------------------------------------------------------------- */
/* Business date                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Returns the currently open hotel business date.
 *
 * Business date is deliberately read from business_dates rather than derived
 * from the calendar date.
 */
export async function getBusinessDate(): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("business_dates")
    .select("business_date")
    .eq("status", "open")
    .single();

  if (error) {
    throw new Error(`Failed to load business date: ${error.message}`);
  }

  return data.business_date;
}

/* -------------------------------------------------------------------------- */
/* Dashboard movements and charts                                             */
/* -------------------------------------------------------------------------- */

/** A row of the booking_totals view, as the three booking RPCs return it. */
interface BookingRow {
  booking_id: string;
  reference: string;
  status: BookingStatus;
  settlement: Settlement;
  customer_id: string;
  customer_name: string | null;
  channel_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  booked_at: string;
  booked_on: string;
  room_count: number;
  room_type_name: string | null;
  room_number: string | null;
  total_cents: number;
  balance_cents: number;
}

function toBooking(row: BookingRow): Booking {
  return {
    id: row.booking_id,
    reference: row.reference,
    customerId: row.customer_id,
    customerName: row.customer_name ?? "Unnamed guest",
    channelName: row.channel_name,
    settlement: row.settlement,
    status: row.status,
    arrivalDate: row.check_in,
    departureDate: row.check_out,
    // The property-local calendar date, not the raw timestamp: the column
    // renders a date and must not shift with the server's timezone.
    bookedAt: row.booked_on,
    nights: row.nights,
    roomCount: row.room_count,
    roomTypeName: row.room_type_name ?? "Unassigned",
    roomNumber: row.room_number,
    adults: row.adults,
    children: row.children,
    totalCents: row.total_cents,
    balanceCents: row.balance_cents,
  };
}

/** Guests arriving on the business date. Canceled and no-show reservations
 * are not movements, and the RPC already excludes them. */
export async function getArrivals(date: string): Promise<Booking[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("dashboard_arrivals", {
    p_date: date,
  });

  if (error) {
    throw new Error(`Failed to load arrivals: ${error.message}`);
  }

  return ((data ?? []) as BookingRow[]).map(toBooking);
}

/** Guests departing on the business date. */
export async function getDepartures(date: string): Promise<Booking[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("dashboard_departures", {
    p_date: date,
  });

  if (error) {
    throw new Error(`Failed to load departures: ${error.message}`);
  }

  return ((data ?? []) as BookingRow[]).map(toBooking);
}

export const PACE_DAYS = 28;

/**
 * Occupancy for the 28 nights starting on the business date.
 *
 * `from` is the business date, never a date derived from server time.
 */
export async function getOccupancyForecast(
  from: string,
  days: number = PACE_DAYS,
): Promise<SeriesPoint[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("occupancy_forecast", {
    p_from: from,
    p_days: days,
  });

  if (error) {
    throw new Error(`Failed to load the occupancy forecast: ${error.message}`);
  }

  return (
    (data ?? []) as { series_date: string; occupancy_pct: number }[]
  ).map((row) => ({ date: row.series_date, value: Number(row.occupancy_pct) }));
}

/**
 * Room revenue for the 28 nights ending on the business date.
 *
 * Rate less discount, excluding tax, so this does not match a booking's Total
 * on the bookings list — that figure is what the guest is billed.
 */
export async function getRevenueSeries(
  from: string,
  days: number = PACE_DAYS,
): Promise<SeriesPoint[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("revenue_series", {
    p_from: from,
    p_days: days,
  });

  if (error) {
    throw new Error(`Failed to load the revenue series: ${error.message}`);
  }

  return (
    (data ?? []) as { series_date: string; revenue_cents: number }[]
  ).map((row) => ({ date: row.series_date, value: row.revenue_cents }));
}

/** Paginated read of activity_log, classified in Postgres. */
export async function getActivity(limit = 40): Promise<ActivityItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("activity_feed", {
    p_limit: limit,
    p_offset: 0,
  });

  if (error) {
    throw new Error(`Failed to load activity: ${error.message}`);
  }

  return (
    (data ?? []) as {
      id: string;
      kind: ActivityKind;
      summary: string;
      emphasis: string[] | null;
      created_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    emphasis: row.emphasis ?? [],
    createdAt: row.created_at,
    // Nothing tracks per-user read state yet, so no row can honestly claim to
    // be unread. Needs a last-seen timestamp per staff user.
    unread: false,
  }));
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                    */
/* -------------------------------------------------------------------------- */

export interface BookingFilters {
  q?: string;
  status?: string;
  page?: number;
  perPage?: number;
}

const BOOKING_STATUSES: readonly BookingStatus[] = [
  "pending",
  "confirmed",
  "checked_in",
  "checked_out",
  "canceled",
  "no_show",
];

/**
 * Status arrives from the query string, so an unrecognised value would reach
 * Postgres as an invalid enum and fail the page. Anything unknown is simply
 * no filter.
 */
function toStatusFilter(status: string | undefined): BookingStatus | null {
  return BOOKING_STATUSES.includes(status as BookingStatus)
    ? (status as BookingStatus)
    : null;
}

export async function getBookings(
  filters: BookingFilters = {},
): Promise<{
  rows: Booking[];
  total: number;
  page: number;
  perPage: number;
}> {
  const supabase = await createClient();

  const perPage = filters.perPage ?? 25;
  const page = Math.max(1, filters.page ?? 1);

  const { data, error } = await supabase.rpc("bookings_page", {
    p_q: filters.q?.trim() || null,
    p_status: toStatusFilter(filters.status),
    p_limit: perPage,
    p_offset: (page - 1) * perPage,
  });

  if (error) {
    throw new Error(`Failed to load bookings: ${error.message}`);
  }

  const rows = (data ?? []) as (BookingRow & { total_count: number })[];

  return {
    rows: rows.map(toBooking),
    // count(*) over () on the full filtered set; absent when the page is empty.
    total: rows[0]?.total_count ?? 0,
    page,
    perPage,
  };
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

export interface CustomerFilters {
  q?: string;
  kind?: string;
  page?: number;
  perPage?: number;
}

interface CustomerRow {
  customer_id: string;
  kind: CustomerKind;
  name: string | null;
  national_id_number: string | null;
  email: string | null;
  phone: string | null;
  exclude_from_email: boolean;
  booking_count: number;
  last_booking_date: string | null;
  total_revenue_cents: number;
  balance_cents: number;
  total_count: number;
}

/** Same guard as the bookings list: an unknown kind is no filter. */
function toKindFilter(kind: string | undefined): CustomerKind | null {
  return kind === "personal" || kind === "company" ? kind : null;
}

export async function getCustomers(
  filters: CustomerFilters = {},
): Promise<{
  rows: Customer[];
  total: number;
  page: number;
  perPage: number;
}> {
  const supabase = await createClient();

  const perPage = filters.perPage ?? 25;
  const page = Math.max(1, filters.page ?? 1);

  const { data, error } = await supabase.rpc("customers_page", {
    p_q: filters.q?.trim() || null,
    p_kind: toKindFilter(filters.kind),
    p_limit: perPage,
    p_offset: (page - 1) * perPage,
  });

  if (error) {
    throw new Error(`Failed to load customers: ${error.message}`);
  }

  const rows = (data ?? []) as CustomerRow[];

  return {
    rows: rows.map(
      (row): Customer => ({
        id: row.customer_id,
        // There is no customer number column; this is the head of the id,
        // which is stable and unique but not something staff can quote.
        ref: row.customer_id.slice(0, 8).toUpperCase(),
        kind: row.kind,
        name: row.name ?? "Unnamed customer",
        nationalIdNumber: row.national_id_number,
        email: row.email,
        phone: row.phone,
        excludeFromEmail: row.exclude_from_email,
        bookingCount: row.booking_count,
        totalRevenueCents: row.total_revenue_cents,
        lastBookingDate: row.last_booking_date,
        balanceCents: row.balance_cents,
      }),
    ),
    total: rows[0]?.total_count ?? 0,
    page,
    perPage,
  };
}

/* -------------------------------------------------------------------------- */
/* Cashier                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Whether this staff user may see a drawer's expected cash before it is
 * counted. Admins and managers may; anyone who can operate a drawer may not,
 * because that figure is the answer to their own blind count.
 */
export async function getCanSeeDrawerTotal(): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("can_see_drawer_total");

  if (error) {
    throw new Error(`Failed to read drawer permissions: ${error.message}`);
  }

  return data === true;
}

/** Payment methods configured for the property. `affects_drawer` is the only
 * thing that decides whether a payment touches physical cash. */
export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payment_methods")
    .select("id, name, affects_drawer")
    // is_active is how a method is retired; a retired one must stop being
    // offered without disturbing the payments already posted against it.
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new Error(`Failed to load payment methods: ${error.message}`);
  }

  return (
    (data ?? []) as { id: string; name: string; affects_drawer: boolean }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    affectsDrawer: row.affects_drawer,
  }));
}

/** Bookings with something still owed, for the payment and recharge pickers. */
export async function getPayableBookings(limit = 20): Promise<Booking[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("booking_totals")
    .select("*")
    .gt("balance_cents", 0)
    .order("check_in")
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load payable bookings: ${error.message}`);
  }

  return ((data ?? []) as BookingRow[]).map(toBooking);
}

/**
 * The signed-in cashier's own open shift, with everything posted against it.
 *
 * Null when they have none — the screen then offers to open one. The expected
 * drawer figure is deliberately absent: close_cashier_shift() is the only
 * thing that reveals it, after the count is in.
 */
export async function getOpenShift(): Promise<Shift | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("current_cashier_shift");

  if (error) {
    throw new Error(`Failed to load the cashier shift: ${error.message}`);
  }

  const header = (
    (data ?? []) as {
      shift_id: string;
      cashier_name: string;
      business_date: string;
      status: Shift["status"];
      opened_at: string;
      opening_balance_cents: number;
    }[]
  )[0];

  if (!header) return null;

  const [paymentsResult, paidOutsResult] = await Promise.all([
    supabase.rpc("cashier_shift_payments", { p_shift_id: header.shift_id }),
    supabase.rpc("cashier_shift_paid_outs", { p_shift_id: header.shift_id }),
  ]);

  if (paymentsResult.error) {
    throw new Error(
      `Failed to load shift payments: ${paymentsResult.error.message}`,
    );
  }
  if (paidOutsResult.error) {
    throw new Error(
      `Failed to load shift paid-outs: ${paidOutsResult.error.message}`,
    );
  }

  const payments: ShiftPayment[] = (
    (paymentsResult.data ?? []) as {
      payment_id: string;
      booking_reference: string;
      guest_name: string | null;
      payment_method_id: string;
      method_name: string;
      affects_drawer: boolean;
      amount_cents: number;
      paid_at: string;
    }[]
  ).map((row) => ({
    id: row.payment_id,
    bookingRef: row.booking_reference,
    guestName: row.guest_name ?? "Unnamed guest",
    methodId: row.payment_method_id,
    methodName: row.method_name,
    affectsDrawer: row.affects_drawer,
    // Signed, so a reversed payment subtracts rather than double-counting.
    amountCents: row.amount_cents,
    createdAt: row.paid_at,
  }));

  const paidOuts: PaidOut[] = (
    (paidOutsResult.data ?? []) as {
      movement_id: string;
      amount_cents: number;
      category: PaidOutCategory;
      reason: string;
      payee: string | null;
      recharge_booking_reference: string | null;
      created_at: string;
    }[]
  ).map((row) => ({
    id: row.movement_id,
    amountCents: row.amount_cents,
    category: row.category,
    reason: row.reason,
    payee: row.payee ?? "—",
    rechargeBookingRef: row.recharge_booking_reference,
    createdAt: row.created_at,
  }));

  return {
    id: header.shift_id,
    userName: header.cashier_name,
    businessDate: header.business_date,
    openedAt: header.opened_at,
    openingFloatCents: header.opening_balance_cents,
    status: header.status,
    payments,
    paidOuts,
  };
}

/**
 * The float the last shift opened at, offered as the default for the next one.
 *
 * CLAUDE.md assumes a fixed float. Nothing in the schema stores that amount,
 * so this carries the previous shift's figure forward rather than inventing a
 * number. A property setting would make it authoritative.
 */
export async function getSuggestedOpeningFloat(): Promise<number | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("cashier_shifts")
    .select("opening_balance_cents")
    .order("opened_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load the previous float: ${error.message}`);
  }

  return (data ?? [])[0]?.opening_balance_cents ?? null;
}

/* -------------------------------------------------------------------------- */
/* Rooms and house state                                                      */
/* -------------------------------------------------------------------------- */

/** Rows returned by the rooms_page RPC. */
interface RoomsPageRow {
  room_id: string;
  number: string;
  floor: number | null;
  room_type_name: string;
  state: RoomState;
  guest_name: string | null;
  nights_left: number | null;
  total_count: number;
}

/** Row returned by the house_summary RPC. */
interface HouseSummaryRow {
  business_date: string | null;
  total_rooms: number;
  sellable_rooms: number;
  occupied_rooms: number;
  due_out_rooms: number;
  arriving_rooms: number;
  vacant_clean_rooms: number;
  vacant_dirty_rooms: number;
  ooo_rooms: number;
  expected_arrivals: number;
  expected_departures: number;
  occupancy_pct: number;
  adr_cents: number;
  drawer_cents: number | null;
  outstanding_cents: number;
}

/** Kept local: importing this module from a client component would pull in
 * next/headers. The house board holds its own matching page size. */
const ROOMS_PER_PAGE = 240;

/**
 * Filtered, paginated room list for the open business date.
 *
 * Every part of the filter runs in Postgres. A property may have ~1,800
 * rooms, so this is only ever called when the house board's room list is
 * expanded — the collapsed board reads its counts from getHouseSummary().
 */
export async function getRooms(filters: RoomFilters = {}): Promise<RoomsPage> {
  const supabase = await createClient();

  const perPage = filters.perPage ?? ROOMS_PER_PAGE;
  const page = Math.max(1, filters.page ?? 1);

  const { data, error } = await supabase.rpc("rooms_page", {
    p_q: filters.q?.trim() || null,
    p_state: filters.state ?? null,
    p_limit: perPage,
    p_offset: (page - 1) * perPage,
  });

  if (error) {
    throw new Error(`Failed to load rooms: ${error.message}`);
  }

  const rows = (data ?? []) as RoomsPageRow[];

  return {
    rows: rows.map(
      (row): Room => ({
        id: row.room_id,
        number: row.number,
        floor: row.floor,
        typeName: row.room_type_name,
        state: row.state,
        guestName: row.guest_name,
        nightsLeft: row.nights_left,
      }),
    ),
    // count(*) over () on the full filtered set; absent when the page is empty.
    total: rows[0]?.total_count ?? 0,
    page,
    perPage,
  };
}

/**
 * House state and the dashboard's headline figures for the open business
 * date. One row, aggregated in Postgres, no room list.
 */
export async function getHouseSummary(): Promise<HouseSummary> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("house_summary");

  if (error) {
    throw new Error(`Failed to load house summary: ${error.message}`);
  }

  const row = ((data ?? []) as HouseSummaryRow[])[0];

  if (!row) {
    throw new Error(
      "House summary returned no rows. Check that the property has an open business date.",
    );
  }

  const states: HouseStateCounts = {
    occupied: row.occupied_rooms,
    due_out: row.due_out_rooms,
    arriving: row.arriving_rooms,
    vacant_clean: row.vacant_clean_rooms,
    vacant_dirty: row.vacant_dirty_rooms,
    ooo: row.ooo_rooms,
  };

  return {
    sellable: row.sellable_rooms,
    // Physical occupancy: a room due out is still occupied until check-out.
    occupied: row.occupied_rooms + row.due_out_rooms,
    arrivals: row.expected_arrivals,
    departures: row.expected_departures,
    vacantDirty: row.vacant_dirty_rooms,
    ooo: row.ooo_rooms,
    occupancyPct: Number(row.occupancy_pct),
    drawerCents: row.drawer_cents,
    outstandingCents: row.outstanding_cents,
    adrCents: row.adr_cents,
    totalRooms: row.total_rooms,
    states,
  };
}
