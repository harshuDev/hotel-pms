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

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { nullableArg } from "@/lib/supabase/database";

import type {
  ActivityItem,
  ActivityKind,
  Booking,
  BookableRoomType,
  BookingActivityItem,
  BookingDetail,
  BookingNight,
  BookingRoomLine,
  BookingStatus,
  Channel,
  ChannelSetting,
  Customer,
  CustomerKind,
  SeriesPoint,
  PaidOut,
  PaidOutCategory,
  PaymentMethod,
  Shift,
  ShiftPayment,
  StaffRole,
  StaffUser,
  OccupancyRow,
  OccupancySummary,
  DebtorRow,
  AvailabilityCell,
  CalendarBar,
  CalendarSeason,
  RoomTypeStatus,
  BookingAttachment,
  BookingEmail,
  BookingProductionRow,
  CancellationRow,
  ChannelKind,
  ChannelProductionRow,
  ChannelRevenueRow,
  CheckoutRow,
  ExtrasRow,
  FinancialPaymentMethod,
  FinancialRow,
  FolioItemType,
  HousekeepingFloor,
  HousekeepingRoomsPage,
  FolioLine,
  InventoryCell,
  MeetingRoomBooking,
  MeetingRoomCell,
  MeetingRoomStatus,
  Promotion,
  PromotionKind,
  PropertySettings,
  RatePlan,
  CancellationPolicy,
  CancellationPolicyKind,
  BookingCancellationTerms,
  RoomTypeSetting,
  StaffSetting,
  AccountingRow,
  RatesGridCell,
  CalendarRoom,
  CalendarNote,
  CalendarRoomBar,
  CountryRow,
  DepositRow,
  EndOfDayRow,
  FolioReportRow,
  ImmigrationRow,
  ManagerRow,
  MealReportRow,
  RatePlanReportRow,
  WaitlistRow,
  WaitlistStatus,
  MealType,
  PaymentMethodKind,
  PaymentMethodSetting,
  RoomSetting,
  RoomSettingsPage,
  TaxRateSetting,
  InHouseRow,
  PaymentMethodTotal,
  PaymentRow,
  ReservationsRow,
  RoomStatus,
  HouseStateCounts,
  HouseSummary,
  Room,
  RoomFilters,
  RoomsPage,
  RoomState,
  Settlement,
  TaxRate,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Returns the property belonging to the authenticated staff user's property.
 *
 * RLS is responsible for restricting this query to the current property.
 *
 * Wrapped in cache() because the app layout and its generateMetadata both want
 * the property name — the bar shows it, the browser tab is titled with it —
 * and they run in the same request. Without this that is two round trips on
 * every navigation for one row that cannot have changed between them.
 */
export const getProperty = cache(async () => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("properties")
    .select("id, name, timezone, currency")
    .single();

  if (error) {
    throw new Error(`Failed to load property: ${error.message}`);
  }

  return data;
});

/* -------------------------------------------------------------------------- */
/* Staff                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The signed-in member of staff. RLS restricts staff_users to the caller's
 * own property, and auth.uid() narrows it to the one row.
 */
export const getCurrentStaffUser = cache(async (): Promise<StaffUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("staff_users")
    .select("id, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load the signed-in user: ${error.message}`);
  }
  if (!data) return null;

  return {
    id: data.id,
    fullName: data.full_name,
    role: data.role as StaffRole,
  };
});

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
      unread: boolean;
    }[]
  ).map((row) => ({
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    emphasis: row.emphasis ?? [],
    createdAt: row.created_at,
    // Measured against this staff user's own last clear.
    unread: row.unread,
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
  customer_number: number;
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
        ref: String(row.customer_number),
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

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Occupancy, ADR and RevPAR per night.
 *
 * Room revenue is rate less discount and excludes tax, so it will not match a
 * booking's Total on the bookings list — that figure is what the guest is
 * billed.
 */
export async function getOccupancyReport(
  from: string,
  to: string,
): Promise<OccupancyRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("occupancy_report", {
    p_from: from,
    p_to: to,
  });

  if (error) {
    throw new Error(`Failed to load the occupancy report: ${error.message}`);
  }

  return (
    (data ?? []) as {
      stay_date: string;
      rooms_sold: number;
      sellable_rooms: number;
      occupancy_pct: number;
      room_revenue_cents: number;
      adr_cents: number;
      revpar_cents: number;
    }[]
  ).map((row) => ({
    date: row.stay_date,
    roomsSold: row.rooms_sold,
    sellableRooms: row.sellable_rooms,
    occupancyPct: Number(row.occupancy_pct),
    roomRevenueCents: row.room_revenue_cents,
    adrCents: row.adr_cents,
    revparCents: row.revpar_cents,
  }));
}

/**
 * Period totals, which are not the averages of the rows: ADR over a period is
 * total revenue over total rooms sold, never the mean of each night's ADR.
 */
export async function getOccupancySummary(
  from: string,
  to: string,
): Promise<OccupancySummary> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("occupancy_report_summary", {
    p_from: from,
    p_to: to,
  });

  if (error) {
    throw new Error(`Failed to load the occupancy totals: ${error.message}`);
  }

  const row = (
    (data ?? []) as {
      nights: number;
      rooms_sold: number;
      room_nights_available: number;
      occupancy_pct: number;
      room_revenue_cents: number;
      adr_cents: number;
      revpar_cents: number;
    }[]
  )[0];

  if (!row) {
    throw new Error("The occupancy totals came back empty.");
  }

  return {
    nights: row.nights,
    roomsSold: row.rooms_sold,
    roomNightsAvailable: row.room_nights_available,
    occupancyPct: Number(row.occupancy_pct),
    roomRevenueCents: row.room_revenue_cents,
    adrCents: row.adr_cents,
    revparCents: row.revpar_cents,
  };
}

/** Bookings with money still owed, largest first. */
export async function getDebtorsReport(): Promise<DebtorRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("debtors_report");

  if (error) {
    throw new Error(`Failed to load the debtors report: ${error.message}`);
  }

  return (
    (data ?? []) as {
      kind: string;
      booking_id: string;
      reference: string;
      customer_name: string | null;
      status: BookingStatus;
      check_in: string;
      check_out: string;
      charges_cents: number;
      payments_cents: number;
      outstanding_cents: number;
      days_overdue: number;
    }[]
  ).map((row) => ({
    kind: row.kind === "meeting_room" ? "meeting_room" : "room",
    bookingId: row.booking_id,
    reference: row.reference,
    customerName: row.customer_name ?? "Unnamed guest",
    status: row.status,
    checkIn: row.check_in,
    checkOut: row.check_out,
    chargesCents: row.charges_cents,
    paymentsCents: row.payments_cents,
    outstandingCents: row.outstanding_cents,
    daysOverdue: row.days_overdue,
  }));
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How many nights the calendar covers.
 *
 * A month. A fortnight meant the board ran out four columns past what fits on
 * screen, so scrolling right hit the end almost at once and the calendar read
 * as "one week only". The chevrons page by this, and the date jump goes
 * anywhere beyond it.
 */
export const CALENDAR_NIGHTS = 35;

/**
 * How many days BEFORE the business date the board opens on.
 *
 * The client: "in the calendar I want the hotels to be able to see past dates
 * too", pointing at the reference, whose board has several days of history to
 * the left of today rather than starting on it.
 *
 * Nothing was stopping a past date being shown -- the chevrons and the date
 * picker have always gone anywhere, and past nights are already shaded -- but
 * the board opened with today hard against the left edge, so "what happened
 * this week" meant paging back a whole month and then hunting for it. A week
 * of history is the useful amount: yesterday's departures and the last few
 * nights' occupancy are what somebody actually looks back at.
 *
 * CALENDAR_NIGHTS went from 30 to 35 with it, so the four weeks of forward
 * view the board had are still there.
 */
export const CALENDAR_LOOKBACK = 7;

/**
 * How many bars one room type may draw before the board stops and counts.
 *
 * The board is the read the ~1,800 room rule bites hardest on. A bar is per
 * booking rather than per room, so the rule is not broken outright, but a full
 * house over a fortnight is thousands of bars and a row that draws them all is
 * the key-board grid again by another name. The query caps, and returns the
 * true total so the screen can say what it left out.
 */
export const CALENDAR_MAX_BARS_PER_TYPE = 40;

/**
 * Rooms available per room type per night.
 *
 * By type rather than by room: a property may run ~1,800 rooms, and neither a
 * query that returns all of them nor a grid that draws one row each is
 * allowed. A handful of types is the same size whatever the hotel.
 */
export async function getCalendarAvailability(
  from: string,
  days: number = CALENDAR_NIGHTS,
): Promise<AvailabilityCell[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("calendar_availability", {
    p_from: from,
    p_days: days,
  });

  if (error) {
    throw new Error(`Failed to load the calendar: ${error.message}`);
  }

  return (
    (data ?? []) as {
      stay_date: string;
      room_type_id: string;
      room_type_code: string;
      room_type_name: string;
      total_rooms: number;
      out_of_order: number;
      sellable: number;
      sold: number;
      available: number;
    }[]
  ).map((row) => ({
    date: row.stay_date,
    roomTypeId: row.room_type_id,
    roomTypeCode: row.room_type_code,
    roomTypeName: row.room_type_name,
    totalRooms: row.total_rooms,
    outOfOrder: row.out_of_order,
    sellable: row.sellable,
    sold: row.sold,
    available: row.available,
  }));
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The money reports raise this rather than returning an empty page, so that
 * housekeeping is told it has no access instead of being shown a hotel that
 * appears to have taken nothing.
 *
 * The string is raised by require_money_reports() in migration 0022. If it is
 * reworded there, reword it here.
 */
export class ReportAccessError extends Error {
  constructor() {
    super("Your role does not have access to the revenue reports.");
    this.name = "ReportAccessError";
  }
}

function rethrow(error: { message: string }, what: string): never {
  if (error.message.includes("REPORT_ACCESS_DENIED")) {
    throw new ReportAccessError();
  }
  throw new Error(`Failed to load the ${what}: ${error.message}`);
}

/** Every payment taken in the range, reversals signed negative. */
export async function getPaymentsReport(
  from: string,
  to: string,
): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payments_report", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "payments report");

  return (
    (data ?? []) as {
      payment_id: string;
      business_date: string;
      paid_at: string;
      method_name: string;
      method_kind: FinancialPaymentMethod;
      affects_drawer: boolean;
      booking_id: string;
      reference: string;
      guest_name: string | null;
      received_by: string | null;
      external_reference: string | null;
      is_reversal: boolean;
      amount_cents: number;
    }[]
  ).map((row) => ({
    paymentId: row.payment_id,
    businessDate: row.business_date,
    paidAt: row.paid_at,
    methodName: row.method_name,
    methodKind: row.method_kind,
    affectsDrawer: row.affects_drawer,
    bookingId: row.booking_id,
    reference: row.reference,
    guestName: row.guest_name ?? "Unnamed guest",
    receivedBy: row.received_by,
    externalReference: row.external_reference,
    isReversal: row.is_reversal,
    amountCents: row.amount_cents,
  }));
}

/** The same payments, totalled by method. */
export async function getPaymentsByMethod(
  from: string,
  to: string,
): Promise<PaymentMethodTotal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payments_report_by_method", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "payment totals");

  return (
    (data ?? []) as {
      method_name: string;
      method_kind: FinancialPaymentMethod;
      affects_drawer: boolean;
      payment_count: number;
      reversal_count: number;
      net_cents: number;
    }[]
  ).map((row) => ({
    methodName: row.method_name,
    methodKind: row.method_kind,
    affectsDrawer: row.affects_drawer,
    paymentCount: row.payment_count,
    reversalCount: row.reversal_count,
    netCents: row.net_cents,
  }));
}

/** Charges that are not the room, by type. */
export async function getExtrasReport(
  from: string,
  to: string,
): Promise<ExtrasRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("extras_report", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "extras report");

  return (
    (data ?? []) as {
      item_type: FolioItemType;
      item_count: number;
      reversal_count: number;
      net_cents: number;
      tax_cents: number;
      gross_cents: number;
    }[]
  ).map((row) => ({
    itemType: row.item_type,
    itemCount: row.item_count,
    reversalCount: row.reversal_count,
    netCents: row.net_cents,
    taxCents: row.tax_cents,
    grossCents: row.gross_cents,
  }));
}

/** Departures on one business date and what they left owing. */
export async function getDailyCheckout(date: string): Promise<CheckoutRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_checkout_report", {
    p_date: date,
  });
  if (error) rethrow(error, "checkout report");

  return (
    (data ?? []) as {
      booking_id: string;
      reference: string;
      guest_name: string | null;
      room_numbers: string | null;
      channel_name: string | null;
      check_in: string;
      check_out: string;
      nights: number;
      charges_cents: number;
      payments_cents: number;
      outstanding_cents: number;
    }[]
  ).map((row) => ({
    bookingId: row.booking_id,
    reference: row.reference,
    guestName: row.guest_name ?? "Unnamed guest",
    roomNumbers: row.room_numbers,
    channelName: row.channel_name,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: row.nights,
    chargesCents: row.charges_cents,
    paymentsCents: row.payments_cents,
    outstandingCents: row.outstanding_cents,
  }));
}

/** Revenue posted and money received, business date by business date. */
export async function getFinancialReport(
  from: string,
  to: string,
): Promise<FinancialRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("financial_report", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "financial report");

  return (
    (data ?? []) as {
      business_date: string;
      room_revenue_cents: number;
      extras_revenue_cents: number;
      discounts_cents: number;
      tax_cents: number;
      charges_cents: number;
      payments_cents: number;
      drawer_payments_cents: number;
    }[]
  ).map((row) => ({
    businessDate: row.business_date,
    roomRevenueCents: row.room_revenue_cents,
    extrasRevenueCents: row.extras_revenue_cents,
    discountsCents: row.discounts_cents,
    taxCents: row.tax_cents,
    chargesCents: row.charges_cents,
    paymentsCents: row.payments_cents,
    drawerPaymentsCents: row.drawer_payments_cents,
  }));
}

/** Bookings made in the range — production, dated by when they were booked. */
export async function getBookingReport(
  from: string,
  to: string,
): Promise<BookingProductionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_report", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`Failed to load the booking report: ${error.message}`);

  return (
    (data ?? []) as {
      booking_id: string;
      reference: string;
      guest_name: string | null;
      channel_name: string | null;
      channel_kind: ChannelKind | null;
      status: BookingStatus;
      settlement: Settlement;
      booked_on: string;
      check_in: string;
      check_out: string;
      nights: number;
      room_count: number;
      room_nights: number;
      value_cents: number;
    }[]
  ).map((row) => ({
    bookingId: row.booking_id,
    reference: row.reference,
    guestName: row.guest_name ?? "Unnamed guest",
    channelName: row.channel_name,
    channelKind: row.channel_kind,
    status: row.status,
    settlement: row.settlement,
    bookedOn: row.booked_on,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: row.nights,
    roomCount: row.room_count,
    roomNights: row.room_nights,
    valueCents: row.value_cents,
  }));
}

/** The same production, totalled by channel. */
export async function getBookingByChannel(
  from: string,
  to: string,
): Promise<ChannelProductionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_report_by_channel", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`Failed to load the channel totals: ${error.message}`);

  return (
    (data ?? []) as {
      channel_name: string;
      channel_kind: ChannelKind | null;
      commission_bps: number;
      booking_count: number;
      canceled_count: number;
      room_nights: number;
      value_cents: number;
    }[]
  ).map((row) => ({
    channelName: row.channel_name,
    channelKind: row.channel_kind,
    commissionBps: row.commission_bps,
    bookingCount: row.booking_count,
    canceledCount: row.canceled_count,
    roomNights: row.room_nights,
    valueCents: row.value_cents,
  }));
}

/** What is on the books to arrive, arrival date by arrival date. */
export async function getReservationsReport(
  from: string,
  to: string,
): Promise<ReservationsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reservations_report", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`Failed to load the reservations report: ${error.message}`);

  return (
    (data ?? []) as {
      arrival_date: string;
      booking_count: number;
      pending_count: number;
      room_count: number;
      adults: number;
      children: number;
      room_nights: number;
      value_cents: number;
    }[]
  ).map((row) => ({
    arrivalDate: row.arrival_date,
    bookingCount: row.booking_count,
    pendingCount: row.pending_count,
    roomCount: row.room_count,
    adults: row.adults,
    children: row.children,
    roomNights: row.room_nights,
    valueCents: row.value_cents,
  }));
}

/** Cancellations and no-shows, by the date they were due to arrive. */
export async function getCancellationReport(
  from: string,
  to: string,
): Promise<CancellationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancellation_report", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`Failed to load the cancellation report: ${error.message}`);

  return (
    (data ?? []) as {
      booking_id: string;
      reference: string;
      guest_name: string | null;
      channel_name: string | null;
      status: BookingStatus;
      booked_on: string;
      cancelled_on: string | null;
      check_in: string;
      check_out: string;
      nights: number;
      room_count: number;
      room_nights: number;
      lost_value_cents: number;
    }[]
  ).map((row) => ({
    bookingId: row.booking_id,
    reference: row.reference,
    guestName: row.guest_name ?? "Unnamed guest",
    channelName: row.channel_name,
    status: row.status,
    bookedOn: row.booked_on,
    cancelledOn: row.cancelled_on,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: row.nights,
    roomCount: row.room_count,
    roomNights: row.room_nights,
    lostValueCents: row.lost_value_cents,
  }));
}

/** Room nights and revenue by channel, over the nights stayed. */
export async function getChannelReport(
  from: string,
  to: string,
): Promise<ChannelRevenueRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("channel_report", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`Failed to load the channel report: ${error.message}`);

  return (
    (data ?? []) as {
      channel_name: string;
      channel_kind: ChannelKind | null;
      commission_bps: number;
      booking_count: number;
      room_nights: number;
      room_revenue_cents: number;
      commission_cents: number;
      net_revenue_cents: number;
    }[]
  ).map((row) => ({
    channelName: row.channel_name,
    channelKind: row.channel_kind,
    commissionBps: row.commission_bps,
    bookingCount: row.booking_count,
    roomNights: row.room_nights,
    roomRevenueCents: row.room_revenue_cents,
    commissionCents: row.commission_cents,
    netRevenueCents: row.net_revenue_cents,
  }));
}

/** House state by floor. Floors are a handful whatever the room count. */
export async function getHousekeepingSummary(): Promise<HousekeepingFloor[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("housekeeping_summary");
  if (error) throw new Error(`Failed to load the housekeeping summary: ${error.message}`);

  return (
    (data ?? []) as {
      floor: number | null;
      room_count: number;
      vacant_clean: number;
      vacant_dirty: number;
      occupied: number;
      due_out: number;
      arriving: number;
      ooo: number;
    }[]
  ).map((row) => ({
    floor: row.floor,
    roomCount: row.room_count,
    vacantClean: row.vacant_clean,
    vacantDirty: row.vacant_dirty,
    occupied: row.occupied,
    dueOut: row.due_out,
    arriving: row.arriving,
    ooo: row.ooo,
  }));
}

export const HOUSEKEEPING_PAGE_SIZE = 120;

/**
 * A page of rooms for a housekeeper to walk. Paginated in Postgres: a property
 * may run around 1,800 rooms and no query here returns all of them.
 */
export async function getHousekeepingRooms(filters: {
  floor?: number | null;
  state?: RoomState | null;
  page?: number;
}): Promise<HousekeepingRoomsPage> {
  const supabase = await createClient();
  const page = Math.max(filters.page ?? 1, 1);

  const { data, error } = await supabase.rpc("housekeeping_rooms", {
    p_floor: filters.floor ?? null,
    p_state: filters.state ?? null,
    p_limit: HOUSEKEEPING_PAGE_SIZE,
    p_offset: (page - 1) * HOUSEKEEPING_PAGE_SIZE,
  });
  if (error) throw new Error(`Failed to load the room list: ${error.message}`);

  const rows = (data ?? []) as {
    room_id: string;
    number: string;
    floor: number | null;
    room_type_name: string;
    housekeeping_status: RoomStatus;
    state: RoomState;
    guest_name: string | null;
    nights_left: number | null;
    total_count: number;
  }[];

  return {
    rooms: rows.map((row) => ({
      roomId: row.room_id,
      number: row.number,
      floor: row.floor,
      roomTypeName: row.room_type_name,
      housekeepingStatus: row.housekeeping_status,
      state: row.state,
      guestName: row.guest_name,
      nightsLeft: row.nights_left,
    })),
    totalCount: rows[0]?.total_count ?? 0,
  };
}

/** Everyone staying tonight. */
export async function getInHouseReport(): Promise<InHouseRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("in_house_report");
  if (error) throw new Error(`Failed to load the in house report: ${error.message}`);

  return (
    (data ?? []) as {
      booking_id: string;
      reference: string;
      guest_name: string | null;
      room_number: string | null;
      room_type_name: string;
      channel_name: string | null;
      check_in: string;
      check_out: string;
      nights: number;
      nights_stayed: number;
      nights_left: number;
      adults: number;
      children: number;
      balance_cents: number;
    }[]
  ).map((row) => ({
    bookingId: row.booking_id,
    reference: row.reference,
    guestName: row.guest_name ?? "Unnamed guest",
    roomNumber: row.room_number,
    roomTypeName: row.room_type_name,
    channelName: row.channel_name,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: row.nights,
    nightsStayed: row.nights_stayed,
    nightsLeft: row.nights_left,
    adults: row.adults,
    children: row.children,
    balanceCents: row.balance_cents,
  }));
}

/* -------------------------------------------------------------------------- */
/* Taking a booking                                                           */
/* -------------------------------------------------------------------------- */

/** Active booking sources, for the new booking form. */
export async function getChannels(): Promise<Channel[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("channels")
    .select("id, name, kind, commission_bps")
    .eq("is_active", true)
    .order("kind")
    .order("name");

  if (error) {
    throw new Error(`Failed to load the booking sources: ${error.message}`);
  }

  return (
    (data ?? []) as {
      id: string;
      name: string;
      kind: ChannelKind;
      commission_bps: number;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    commissionBps: row.commission_bps,
  }));
}

/** Active tax rates. Empty until the property's VAT policy is settled. */
export async function getTaxRates(): Promise<TaxRate[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tax_rates")
    .select("id, name, rate_bps, inclusion")
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new Error(`Failed to load the tax rates: ${error.message}`);
  }

  return (
    (data ?? []) as {
      id: string;
      name: string;
      rate_bps: number;
      inclusion: "inclusive" | "exclusive";
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    rateBps: row.rate_bps,
    inclusion: row.inclusion,
  }));
}

/**
 * Room types and how many of each are free for a whole stay.
 *
 * The figure is the tightest night in the range, not the average: a type with
 * four free on Monday and none on Tuesday can sell nothing for a two-night
 * stay, and an average would say two.
 */
export async function getBookableRoomTypes(
  from: string,
  to: string,
): Promise<BookableRoomType[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("bookable_room_types", {
    p_from: from,
    p_to: to,
  });

  if (error) {
    throw new Error(`Failed to load what can be sold: ${error.message}`);
  }

  return (
    (data ?? []) as {
      room_type_id: string;
      code: string;
      name: string;
      base_occupancy: number;
      max_occupancy: number;
      total_rooms: number;
      available: number;
    }[]
  ).map((row) => ({
    roomTypeId: row.room_type_id,
    code: row.code,
    name: row.name,
    baseOccupancy: row.base_occupancy,
    maxOccupancy: row.max_occupancy,
    totalRooms: row.total_rooms,
    available: row.available,
  }));
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

/** How many nights an Inventory screen shows at once. */
export const INVENTORY_NIGHTS = 28;

/** The rate plans this property sells, default first. */
export async function getRatePlans(): Promise<RatePlan[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("rate_plans")
    .select(
      "id, code, name, description, is_default, is_active, is_public, cancellation_policy_id, rate_plan_meals(meal, value_cents)",
    )
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("sort_order")
    .order("name");

  if (error) {
    throw new Error(`Failed to load the rate plans: ${error.message}`);
  }

  return (
    (data ?? []) as {
      id: string;
      code: string;
      name: string;
      description: string | null;
      is_default: boolean;
      is_active: boolean;
      is_public: boolean;
      cancellation_policy_id: string | null;
      rate_plan_meals: { meal: MealType; value_cents: number | null }[];
    }[]
  ).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    isActive: row.is_active,
    isPublic: row.is_public,
    meals: (row.rate_plan_meals ?? []).map((m) => m.meal),
    // Only the priced ones. A meal with no value is worth nothing and posts
    // nothing, so leaving it out of the map says exactly that.
    mealValues: Object.fromEntries(
      (row.rate_plan_meals ?? [])
        .filter((m) => m.value_cents !== null)
        .map((m) => [m.meal, m.value_cents as number]),
    ) as Partial<Record<MealType, number>>,
    cancellationPolicyId: row.cancellation_policy_id,
  }));
}

/**
 * The property's cancellation policies (0060).
 *
 * Read by anyone on the property — a receptionist taking a booking has to be
 * able to say what the terms are — and written only by revenue staff, which
 * the RLS policy decides rather than a second copy of the rule here.
 */
export async function getCancellationPolicies(): Promise<CancellationPolicy[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("cancellation_policies_list");

  if (error) {
    throw new Error(`Failed to load the cancellation policies: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as CancellationPolicyKind,
    freeCancellationDays: row.free_cancellation_days,
    description: row.description,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    ratePlanCount: row.rate_plan_count,
  }));
}

/**
 * What a booking may be cancelled under, dated against the open business date.
 *
 * Null when the booking has no rooms left to cancel. The RPC reports the
 * STRICTEST policy across the rooms and flags a mixed booking, rather than
 * stating one room's terms as though they were the whole booking's.
 */
export async function getBookingCancellationTerms(
  bookingId: string,
): Promise<BookingCancellationTerms | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("booking_cancellation_terms", {
    p_booking_id: bookingId,
  });

  if (error) {
    throw new Error(`Failed to load the cancellation terms: ${error.message}`);
  }

  const row = (data ?? [])[0];
  if (!row) return null;

  return {
    policyName: row.policy_name,
    kind: row.kind as CancellationPolicyKind | null,
    freeCancellationDays: row.free_cancellation_days,
    freeUntil: row.free_until,
    isFreeNow: row.is_free_now,
    isMixed: row.is_mixed,
    hasNoPolicy: row.has_no_policy,
  };
}

/**
 * The bookings on the calendar board, as bars.
 *
 * Capped per room type in Postgres. Every row carries `typeTotal`, the real
 * number overlapping the window for that type, so a short board says so rather
 * than quietly drawing forty and letting somebody plan against it.
 */
export async function getCalendarBookings(
  from: string,
  days: number = CALENDAR_NIGHTS,
  maxPerType: number = CALENDAR_MAX_BARS_PER_TYPE,
  /** Cancelled and no-show rooms instead of live ones, for their own row. */
  includeCanceled = false,
): Promise<CalendarBar[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("calendar_bookings", {
    p_from: from,
    p_days: days,
    p_max_per_type: maxPerType,
    p_include_canceled: includeCanceled,
  });

  if (error) {
    throw new Error(`Failed to load the calendar bookings: ${error.message}`);
  }

  return (
    (data ?? []) as {
      room_type_id: string;
      booking_id: string;
      booking_room_id: string;
      reference: string;
      guest_name: string;
      status: BookingStatus;
      room_number: string | null;
      check_in: string;
      check_out: string;
      guests: number;
      value_cents: number;
      has_notes: boolean;
      type_total: number;
    }[]
  ).map((row) => ({
    roomTypeId: row.room_type_id,
    bookingId: row.booking_id,
    bookingRoomId: row.booking_room_id,
    reference: row.reference,
    guestName: row.guest_name,
    status: row.status,
    roomNumber: row.room_number,
    checkIn: row.check_in,
    checkOut: row.check_out,
    guests: row.guests,
    valueCents: row.value_cents,
    hasNotes: row.has_notes,
    typeTotal: row.type_total,
  }));
}

/**
 * Housekeeping state per room type, for the dot on the calendar rail.
 *
 * The dot used to repeat availability, which every cell on that row already
 * shows. It reports what needs cleaning instead.
 */
export async function getRoomStatusByType(): Promise<RoomTypeStatus[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("room_status_by_type");

  if (error) {
    throw new Error(`Failed to load the room status: ${error.message}`);
  }

  return (
    (data ?? []) as {
      room_type_id: string;
      total_rooms: number;
      vacant_clean: number;
      vacant_dirty: number;
      occupied: number;
      out_of_order: number;
    }[]
  ).map((row) => ({
    roomTypeId: row.room_type_id,
    totalRooms: row.total_rooms,
    vacantClean: row.vacant_clean,
    vacantDirty: row.vacant_dirty,
    occupied: row.occupied,
    outOfOrder: row.out_of_order,
  }));
}

/** Every season on the property, for the Settings screen. */
export async function getSeasonSettings(): Promise<CalendarSeason[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("seasons")
    .select("id, name, starts_on, ends_on")
    .order("starts_on");

  if (error) {
    throw new Error(`Failed to load the seasons: ${error.message}`);
  }

  return (
    (data ?? []) as { id: string; name: string; starts_on: string; ends_on: string }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  }));
}

/** The seasons touching a calendar window. They label the board, nothing more. */
export async function getCalendarSeasons(
  from: string,
  days: number = CALENDAR_NIGHTS,
): Promise<CalendarSeason[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("calendar_seasons", {
    p_from: from,
    p_days: days,
  });

  if (error) {
    throw new Error(`Failed to load the seasons: ${error.message}`);
  }

  return (
    (data ?? []) as {
      id: string;
      name: string;
      starts_on: string;
      ends_on: string;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  }));
}

/**
 * The inventory grid: one row per room type per night.
 *
 * All nine Inventory screens read this. They are the same grid with a
 * different column brought forward, so a separate query each would be nine
 * ways to disagree about the same night.
 */
export async function getInventoryGrid(
  ratePlanId: string | null,
  from: string,
  days: number = INVENTORY_NIGHTS,
): Promise<InventoryCell[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("inventory_grid", {
    // Null is a real argument here: it reads the grid with no plan selected,
    // which is the room-type half — allotment and close-out — on its own.
    p_rate_plan_id: nullableArg(ratePlanId),
    p_from: from,
    p_days: days,
  });

  if (error) {
    throw new Error(`Failed to load the inventory: ${error.message}`);
  }

  return (
    (data ?? []) as {
      stay_date: string;
      room_type_id: string;
      room_type_code: string;
      room_type_name: string;
      rate_cents: number | null;
      min_stay_through: number | null;
      min_stay_arrival: number | null;
      max_stay: number | null;
      closed_to_arrival: boolean;
      closed_to_departure: boolean;
      stop_sell: boolean;
      allotment: number | null;
      close_out: boolean;
      physical_rooms: number;
      out_of_order: number;
      sold: number;
      sellable: number;
    }[]
  ).map((row) => ({
    date: row.stay_date,
    roomTypeId: row.room_type_id,
    roomTypeCode: row.room_type_code,
    roomTypeName: row.room_type_name,
    rateCents: row.rate_cents,
    minStayThrough: row.min_stay_through,
    minStayArrival: row.min_stay_arrival,
    maxStay: row.max_stay,
    closedToArrival: row.closed_to_arrival,
    closedToDeparture: row.closed_to_departure,
    stopSell: row.stop_sell,
    allotment: row.allotment,
    closeOut: row.close_out,
    physicalRooms: row.physical_rooms,
    outOfOrder: row.out_of_order,
    sold: row.sold,
    sellable: row.sellable,
  }));
}

/* -------------------------------------------------------------------------- */
/* One booking                                                                */
/* -------------------------------------------------------------------------- */

/** Everything the booking screen shows above its tabs. Null when not found. */
export async function getBookingDetail(
  bookingId: string,
): Promise<BookingDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_detail", {
    p_booking_id: bookingId,
  });

  if (error) throw new Error(`Failed to load the booking: ${error.message}`);

  const row = (
    (data ?? []) as {
      booking_id: string;
      reference: string;
      status: BookingStatus;
      settlement: Settlement;
      customer_id: string;
      customer_name: string | null;
      customer_email: string | null;
      customer_phone: string | null;
      channel_id: string;
      channel_name: string | null;
      check_in: string;
      check_out: string;
      nights: number;
      adults: number;
      children: number;
      arrival_time: string | null;
      departure_time: string | null;
      guest_notes: string | null;
      internal_notes: string | null;
      external_reference: string | null;
      booked_on: string;
      booked_by: string | null;
      room_count: number;
      rooms_assigned: number;
      reservation_value_cents: number;
      charges_cents: number;
      payments_cents: number;
      balance_cents: number;
      business_date: string | null;
    }[]
  )[0];

  if (!row) return null;

  return {
    bookingId: row.booking_id,
    reference: row.reference,
    status: row.status,
    settlement: row.settlement,
    customerId: row.customer_id,
    customerName: row.customer_name ?? "Unnamed guest",
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    channelId: row.channel_id,
    channelName: row.channel_name,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: row.nights,
    adults: row.adults,
    children: row.children,
    arrivalTime: row.arrival_time,
    departureTime: row.departure_time,
    guestNotes: row.guest_notes,
    internalNotes: row.internal_notes,
    externalReference: row.external_reference,
    bookedOn: row.booked_on,
    bookedBy: row.booked_by,
    roomCount: row.room_count,
    roomsAssigned: row.rooms_assigned,
    reservationValueCents: row.reservation_value_cents,
    chargesCents: row.charges_cents,
    paymentsCents: row.payments_cents,
    balanceCents: row.balance_cents,
    businessDate: row.business_date,
  };
}

export async function getBookingRoomLines(
  bookingId: string,
): Promise<BookingRoomLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_room_lines", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(`Failed to load the rooms: ${error.message}`);

  return (
    (data ?? []) as {
      booking_room_id: string;
      room_type_id: string;
      room_type_name: string;
      room_id: string | null;
      room_number: string | null;
      status: BookingStatus;
      check_in: string;
      check_out: string;
      nights: number;
      adults: number;
      children: number;
      value_cents: number;
      tax_cents: number;
      discount_cents: number;
      nights_charged: number;
    }[]
  ).map((row) => ({
    bookingRoomId: row.booking_room_id,
    roomTypeId: row.room_type_id,
    roomTypeName: row.room_type_name,
    roomId: row.room_id,
    roomNumber: row.room_number,
    status: row.status,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: row.nights,
    adults: row.adults,
    children: row.children,
    valueCents: row.value_cents,
    taxCents: row.tax_cents,
    discountCents: row.discount_cents,
    nightsCharged: row.nights_charged,
  }));
}

export async function getBookingNights(
  bookingId: string,
): Promise<BookingNight[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_nights", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(`Failed to load the nights: ${error.message}`);

  return (
    (data ?? []) as {
      booking_room_id: string;
      room_type_name: string;
      room_number: string | null;
      stay_date: string;
      room_rate_cents: number;
      tax_cents: number;
      discount_cents: number;
      status: BookingStatus;
      charged: boolean;
    }[]
  ).map((row) => ({
    bookingRoomId: row.booking_room_id,
    roomTypeName: row.room_type_name,
    roomNumber: row.room_number,
    stayDate: row.stay_date,
    roomRateCents: row.room_rate_cents,
    taxCents: row.tax_cents,
    discountCents: row.discount_cents,
    status: row.status,
    charged: row.charged,
  }));
}

export async function getBookingFolioLines(
  bookingId: string,
): Promise<FolioLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_folio_lines", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(`Failed to load the folio: ${error.message}`);

  return (
    (data ?? []) as {
      line_id: string;
      folio_id: string;
      folio_number: number;
      business_date: string;
      posted_at: string;
      kind: "charge" | "payment";
      description: string;
      is_reversal: boolean;
      amount_cents: number;
      item_type: FolioLine["itemType"];
    }[]
  ).map((row) => ({
    lineId: row.line_id,
    folioId: row.folio_id,
    folioNumber: row.folio_number,
    businessDate: row.business_date,
    postedAt: row.posted_at,
    kind: row.kind,
    description: row.description,
    isReversal: row.is_reversal,
    amountCents: row.amount_cents,
    itemType: row.item_type,
  }));
}

export async function getBookingActivity(
  bookingId: string,
): Promise<BookingActivityItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_activity", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(`Failed to load the activity: ${error.message}`);

  return (
    (data ?? []) as {
      activity_id: string;
      action: string;
      summary: string;
      actor: string | null;
      created_at: string;
    }[]
  ).map((row) => ({
    activityId: row.activity_id,
    action: row.action,
    summary: row.summary,
    actor: row.actor,
    createdAt: row.created_at,
  }));
}

/* -------------------------------------------------------------------------- */
/* Promotions                                                                 */
/* -------------------------------------------------------------------------- */

export async function getPromotions(): Promise<Promotion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("promotions_list");
  if (error) throw new Error(`Failed to load the promotions: ${error.message}`);

  return (
    (data ?? []) as {
      promotion_id: string;
      code: string | null;
      name: string;
      description: string | null;
      kind: PromotionKind;
      percent_bps: number | null;
      amount_off_cents: number | null;
      free_nights: number | null;
      paid_nights: number | null;
      sell_from: string | null;
      sell_to: string | null;
      stay_from: string | null;
      stay_to: string | null;
      min_nights: number | null;
      max_nights: number | null;
      min_advance_days: number | null;
      max_advance_days: number | null;
      arrival_days_of_week: number[] | null;
      priority: number;
      is_active: boolean;
      rate_plan_names: string | null;
      room_type_names: string | null;
      bookings_taken: number;
      discount_given_cents: number;
    }[]
  ).map((row) => ({
    promotionId: row.promotion_id,
    code: row.code,
    name: row.name,
    description: row.description,
    kind: row.kind,
    percentBps: row.percent_bps,
    amountOffCents: row.amount_off_cents,
    freeNights: row.free_nights,
    paidNights: row.paid_nights,
    sellFrom: row.sell_from,
    sellTo: row.sell_to,
    stayFrom: row.stay_from,
    stayTo: row.stay_to,
    minNights: row.min_nights,
    maxNights: row.max_nights,
    minAdvanceDays: row.min_advance_days,
    maxAdvanceDays: row.max_advance_days,
    arrivalDaysOfWeek: row.arrival_days_of_week,
    priority: row.priority,
    isActive: row.is_active,
    ratePlanNames: row.rate_plan_names,
    roomTypeNames: row.room_type_names,
    bookingsTaken: row.bookings_taken,
    discountGivenCents: row.discount_given_cents,
  }));
}

/** Room types, for the promotion form's scoping. */
export async function getRoomTypes(): Promise<
  { id: string; code: string; name: string }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("room_types")
    .select("id, code, name")
    .order("sort_order")
    .order("name");

  if (error) throw new Error(`Failed to load the room types: ${error.message}`);
  return (data ?? []) as { id: string; code: string; name: string }[];
}

/* -------------------------------------------------------------------------- */
/* Meeting rooms                                                              */
/* -------------------------------------------------------------------------- */

/** How many days the meeting room calendar shows at once. */
export const MEETING_ROOM_DAYS = 14;

/**
 * One row per meeting room per day.
 *
 * The ~1,800 room rule does not apply here: a property has a handful of
 * meeting rooms, so a cell per room per day is the right shape and is what the
 * client asked for.
 */
export async function getMeetingRoomCalendar(
  from: string,
  days: number = MEETING_ROOM_DAYS,
): Promise<MeetingRoomCell[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("meeting_room_calendar", {
    p_from: from,
    p_days: days,
  });

  if (error) {
    throw new Error(`Failed to load the meeting rooms: ${error.message}`);
  }

  return (
    (data ?? []) as {
      meeting_room_id: string;
      meeting_room_name: string;
      capacity: number | null;
      stay_date: string;
      booking_id: string | null;
      reference: string | null;
      event_name: string | null;
      guest_count: number | null;
      customer_name: string | null;
      status: MeetingRoomStatus | null;
      starts_on: string | null;
      ends_on: string | null;
      is_first_day: boolean | null;
    }[]
  ).map((row) => ({
    meetingRoomId: row.meeting_room_id,
    meetingRoomName: row.meeting_room_name,
    capacity: row.capacity,
    date: row.stay_date,
    bookingId: row.booking_id,
    reference: row.reference,
    eventName: row.event_name,
    guestCount: row.guest_count,
    customerName: row.customer_name,
    status: row.status,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    isFirstDay: row.is_first_day,
  }));
}

export async function getMeetingRoomBooking(
  bookingId: string,
): Promise<MeetingRoomBooking | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("meeting_room_booking_detail", {
    p_booking_id: bookingId,
  });

  if (error) {
    throw new Error(`Failed to load the booking: ${error.message}`);
  }

  const row = (
    (data ?? []) as {
      booking_id: string;
      reference: string;
      meeting_room_id: string;
      meeting_room_name: string;
      event_name: string;
      guest_count: number;
      customer_id: string | null;
      customer_name: string | null;
      starts_on: string;
      ends_on: string;
      days: number;
      status: MeetingRoomStatus;
      comments: string | null;
      folio_id: string | null;
      folio_number: number | null;
      charges_cents: number;
      payments_cents: number;
      balance_cents: number;
      booked_by: string | null;
      created_at: string;
    }[]
  )[0];

  if (!row) return null;

  return {
    bookingId: row.booking_id,
    reference: row.reference,
    meetingRoomId: row.meeting_room_id,
    meetingRoomName: row.meeting_room_name,
    eventName: row.event_name,
    guestCount: row.guest_count,
    customerId: row.customer_id,
    customerName: row.customer_name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    days: row.days,
    status: row.status,
    comments: row.comments,
    folioId: row.folio_id,
    folioNumber: row.folio_number,
    chargesCents: row.charges_cents,
    paymentsCents: row.payments_cents,
    balanceCents: row.balance_cents,
    bookedBy: row.booked_by,
    createdAt: row.created_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Property settings                                                          */
/* -------------------------------------------------------------------------- */

export async function getPropertySettings(): Promise<PropertySettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, name, timezone, currency, check_in_time, check_out_time, audit_close_time",
    )
    .single();

  if (error) throw new Error(`Failed to load the property: ${error.message}`);

  const row = data as {
    id: string;
    name: string;
    timezone: string;
    currency: string;
    check_in_time: string | null;
    check_out_time: string | null;
    audit_close_time: string;
  };

  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    currency: row.currency,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    auditCloseTime: row.audit_close_time,
  };
}

/** Room types with how many rooms each has, so an empty one is obvious. */
export async function getRoomTypeSettings(): Promise<RoomTypeSetting[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("room_types")
    .select("id, code, name, base_occupancy, max_occupancy, sort_order, rooms(count)")
    .order("sort_order")
    .order("name");

  if (error) throw new Error(`Failed to load the room types: ${error.message}`);

  return (
    (data ?? []) as {
      id: string;
      code: string;
      name: string;
      base_occupancy: number;
      max_occupancy: number;
      sort_order: number;
      rooms: { count: number }[];
    }[]
  ).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    baseOccupancy: row.base_occupancy,
    maxOccupancy: row.max_occupancy,
    sortOrder: row.sort_order,
    roomCount: row.rooms?.[0]?.count ?? 0,
  }));
}

export async function getChannelSettings(): Promise<ChannelSetting[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channels")
    .select("id, code, name, kind, commission_bps, is_active")
    .order("kind")
    .order("name");

  if (error) throw new Error(`Failed to load the booking sources: ${error.message}`);

  return (
    (data ?? []) as {
      id: string;
      code: string;
      name: string;
      kind: ChannelKind;
      commission_bps: number;
      is_active: boolean;
    }[]
  ).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    commissionBps: row.commission_bps,
    isActive: row.is_active,
  }));
}

/** Every tax rate, retired ones included — this is where they are managed. */
export async function getTaxRateSettings(): Promise<TaxRateSetting[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_rates")
    .select("id, name, rate_bps, inclusion, is_active")
    .order("is_active", { ascending: false })
    .order("name");

  if (error) throw new Error(`Failed to load the tax rates: ${error.message}`);

  return (
    (data ?? []) as {
      id: string;
      name: string;
      rate_bps: number;
      inclusion: "inclusive" | "exclusive";
      is_active: boolean;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    rateBps: row.rate_bps,
    inclusion: row.inclusion,
    isActive: row.is_active,
  }));
}

export async function getStaffSettings(): Promise<StaffSetting[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_users")
    .select("id, full_name, role, is_active")
    .order("is_active", { ascending: false })
    .order("full_name");

  if (error) throw new Error(`Failed to load the staff: ${error.message}`);

  return (
    (data ?? []) as {
      id: string;
      full_name: string;
      role: StaffRole;
      is_active: boolean;
    }[]
  ).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
  }));
}

const SETTINGS_ROOMS_PER_PAGE = 50;

/**
 * The rooms list behind the settings screen.
 *
 * Paginated in Postgres for the same reason everything else is: a property may
 * hold ~1,800 rooms, and a settings screen is no more entitled to load them all
 * than the dashboard is. rooms_page() is the house board's read and returns
 * tonight's guest and nights left; this one returns the type and the floor,
 * which are what actually get corrected here.
 */
/** The bucket room photographs live in. Created by migration 0055. */
export const ROOM_PHOTO_BUCKET = "room-photos";

/**
 * An object path turned into something an <img> can load.
 *
 * The bucket is public, so this is a plain URL and needs no signing round
 * trip — which matters on a list that draws one per row. It resolves against
 * one known bucket, so a path that somehow got into the column cannot point
 * the browser anywhere else.
 */
function roomPhotoUrl(
  supabase: { storage: { from: (b: string) => { getPublicUrl: (p: string) => { data: { publicUrl: string } } } } },
  path: string | null,
): string | null {
  if (!path) return null;
  return supabase.storage.from(ROOM_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function getRoomsForSettings(filters: {
  q?: string;
  page?: number;
} = {}): Promise<RoomSettingsPage> {
  const supabase = await createClient();

  const perPage = SETTINGS_ROOMS_PER_PAGE;
  const page = Math.max(1, filters.page ?? 1);

  const { data, error } = await supabase.rpc("rooms_for_settings", {
    p_q: filters.q?.trim() || null,
    p_limit: perPage,
    p_offset: (page - 1) * perPage,
  });

  if (error) throw new Error(`Failed to load the rooms: ${error.message}`);

  const rows = (data ?? []) as {
    room_id: string;
    number: string;
    floor: number | null;
    room_type_id: string;
    room_type_name: string;
    status: RoomSetting["status"];
    // The generator cannot express a nullable column in a RETURNS TABLE, so
    // it comes back typed non-null. It is nullable in Postgres and null on
    // every room nobody has photographed.
    photo_path: string | null;
    has_bookings: boolean;
    total_count: number;
  }[];

  return {
    rows: rows.map((row) => ({
      id: row.room_id,
      number: row.number,
      floor: row.floor,
      roomTypeId: row.room_type_id,
      roomTypeName: row.room_type_name,
      status: row.status,
      photoPath: row.photo_path,
      photoUrl: roomPhotoUrl(supabase, row.photo_path),
      hasBookings: row.has_bookings,
    })),
    total: rows[0]?.total_count ?? 0,
    page,
    perPage,
  };
}

/**
 * Payment methods, including the retired ones.
 *
 * Every other read of this table filters on is_active, because a retired method
 * must stop being offered. This one is the screen that retires them, so it has
 * to show what it has already put away.
 *
 * The payment count comes back with the row because it is what freezes the
 * kind: once money has come in through a method, moving it across the cash line
 * would restate every blind count that separated the two.
 */
export async function getPaymentMethodSettings(): Promise<PaymentMethodSetting[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_methods")
    .select("id, name, kind, affects_drawer, is_active, payments(count)")
    .order("is_active", { ascending: false })
    .order("name");

  if (error) {
    throw new Error(`Failed to load the payment methods: ${error.message}`);
  }

  return (
    (data ?? []) as {
      id: string;
      name: string;
      kind: PaymentMethodKind;
      affects_drawer: boolean;
      is_active: boolean;
      payments: { count: number }[];
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    affectsDrawer: row.affects_drawer,
    isActive: row.is_active,
    paymentCount: row.payments?.[0]?.count ?? 0,
  }));
}

/**
 * Covers per meal per service date.
 *
 * Read from the booking rather than the folio: an included meal is worth
 * nothing, so there is no ledger row to count, and reading the booking means
 * the kitchen gets forward dates — the night audit only posts nights that have
 * already passed, and tomorrow's breakfast number is the one a chef needs.
 */
export async function getMealReport(
  from: string,
  to: string,
): Promise<MealReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("meal_report", {
    p_from: from,
    p_to: to,
  });

  if (error) rethrow(error, "meal report");

  return (data ?? []).map((row) => ({
    serviceDate: row.service_date,
    meal: row.meal as MealType,
    adultCovers: Number(row.adult_covers ?? 0),
    childCovers: Number(row.child_covers ?? 0),
    totalCovers: Number(row.total_covers ?? 0),
  }));
}

/* -------------------------------------------------------------------------- */
/* The nine reports added to match the client's reference system              */
/* -------------------------------------------------------------------------- */

/**
 * The manager's front page: occupancy, rate and revenue for each date.
 *
 * Every figure is worked out in Postgres the same way the report it comes from
 * works it out, so this page and the occupancy report can never disagree.
 */
export async function getManagerReport(
  from: string,
  to: string,
): Promise<ManagerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("manager_report", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "manager report");

  return (data ?? []).map((row) => ({
    businessDate: row.business_date,
    roomsSold: Number(row.rooms_sold ?? 0),
    sellableRooms: Number(row.sellable_rooms ?? 0),
    occupancyPct: Number(row.occupancy_pct ?? 0),
    adrCents: Number(row.adr_cents ?? 0),
    revparCents: Number(row.revpar_cents ?? 0),
    roomRevenueCents: Number(row.room_revenue_cents ?? 0),
    otherRevenueCents: Number(row.other_revenue_cents ?? 0),
    totalRevenueCents: Number(row.total_revenue_cents ?? 0),
    paymentsCents: Number(row.payments_cents ?? 0),
    arrivals: Number(row.arrivals ?? 0),
    departures: Number(row.departures ?? 0),
  }));
}

/** Every folio charged or paid in the range, meeting rooms included. */
export async function getFolioReport(
  from: string,
  to: string,
): Promise<FolioReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("folio_report", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "folio report");

  return (data ?? []).map((row) => ({
    folioId: row.folio_id,
    folioNumber: Number(row.folio_number ?? 0),
    kind: row.kind,
    status: row.status,
    reference: row.reference,
    guestName: row.guest_name,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    chargesCents: Number(row.charges_cents ?? 0),
    paymentsCents: Number(row.payments_cents ?? 0),
    balanceCents: Number(row.balance_cents ?? 0),
  }));
}

/** Who slept here, on what document. Front office only. */
export async function getImmigrationReport(
  from: string,
  to: string,
): Promise<ImmigrationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("immigration_report", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "immigration report");

  return (data ?? []).map((row) => ({
    bookingId: row.booking_id,
    reference: row.reference,
    guestName: row.guest_name,
    roomNumber: row.room_number,
    nationality: row.nationality,
    country: row.country,
    passportNumber: row.passport_number,
    passportExpiry: row.passport_expiry,
    nationalIdNumber: row.national_id_number,
    dateOfBirth: row.date_of_birth,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: Number(row.nights ?? 0),
    isComplete: row.is_complete,
  }));
}

/** Room nights by country of residence, not nationality. */
export async function getCountryReport(
  from: string,
  to: string,
): Promise<CountryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("country_report", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "country report");

  return (data ?? []).map((row) => ({
    country: row.country,
    bookings: Number(row.bookings ?? 0),
    guests: Number(row.guests ?? 0),
    roomNights: Number(row.room_nights ?? 0),
    revenueCents: Number(row.revenue_cents ?? 0),
  }));
}

/**
 * Money held against stays that have not started.
 *
 * Takes no range: a deposit is held as of now, and a date filter on it would
 * answer a question nobody asks.
 */
export async function getDepositReport(): Promise<DepositRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("deposit_report");
  if (error) rethrow(error, "deposit report");

  return (data ?? []).map((row) => ({
    bookingId: row.booking_id,
    reference: row.reference,
    guestName: row.guest_name,
    status: row.status,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: Number(row.nights ?? 0),
    chargesCents: Number(row.charges_cents ?? 0),
    depositCents: Number(row.deposit_cents ?? 0),
    stayValueCents: Number(row.stay_value_cents ?? 0),
    daysToArrival: Number(row.days_to_arrival ?? 0),
  }));
}

/** How each rate plan sold. Stays sold before 0037 group under "Not recorded". */
export async function getRatePlanReport(
  from: string,
  to: string,
): Promise<RatePlanReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rate_plan_report", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "rate plan report");

  return (data ?? []).map((row) => ({
    ratePlanId: row.rate_plan_id,
    planName: row.plan_name,
    isPublic: row.is_public,
    bookings: Number(row.bookings ?? 0),
    roomNights: Number(row.room_nights ?? 0),
    grossCents: Number(row.gross_cents ?? 0),
    discountCents: Number(row.discount_cents ?? 0),
    netCents: Number(row.net_cents ?? 0),
    adrCents: Number(row.adr_cents ?? 0),
  }));
}

/** Revenue by category and money received by method, in one range. */
export async function getAccountingReport(
  from: string,
  to: string,
): Promise<AccountingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accounting_report", {
    p_from: from,
    p_to: to,
  });
  if (error) rethrow(error, "accounting report");

  return (data ?? []).map((row) => ({
    section: row.section,
    code: row.code,
    label: row.label,
    netCents: Number(row.net_cents ?? 0),
    taxCents: Number(row.tax_cents ?? 0),
    grossCents: Number(row.gross_cents ?? 0),
  }));
}

/** One date, as the night audit left it. One date and not a range, by design. */
export async function getEndOfDayReport(
  date: string,
): Promise<EndOfDayRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("end_of_day_report", {
    p_date: date,
  });
  if (error) rethrow(error, "end of day report");

  const row = (data ?? [])[0];
  if (!row) return null;

  return {
    businessDate: row.business_date,
    dateStatus: row.date_status,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    arrivals: Number(row.arrivals ?? 0),
    departures: Number(row.departures ?? 0),
    inHouse: Number(row.in_house ?? 0),
    noShows: Number(row.no_shows ?? 0),
    roomsSold: Number(row.rooms_sold ?? 0),
    sellableRooms: Number(row.sellable_rooms ?? 0),
    occupancyPct: Number(row.occupancy_pct ?? 0),
    roomRevenueCents: Number(row.room_revenue_cents ?? 0),
    otherRevenueCents: Number(row.other_revenue_cents ?? 0),
    taxCents: Number(row.tax_cents ?? 0),
    paymentsCents: Number(row.payments_cents ?? 0),
    drawerCents: Number(row.drawer_cents ?? 0),
    shiftsOpen: Number(row.shifts_open ?? 0),
  };
}

/** Who is waiting for dates the hotel could not sell. */
export async function getWaitlistReport(
  from: string,
  to: string,
  status: WaitlistStatus | null,
): Promise<WaitlistRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_waitlist_report", {
    p_from: from,
    p_to: to,
    // Null means every status. A default of "waiting" would hide the
    // conversions, which are the only evidence the list is worth keeping.
    p_status: status,
  });
  if (error) rethrow(error, "waitlist report");

  return (data ?? []).map((row) => ({
    id: row.id,
    guestName: row.guest_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    roomTypeName: row.room_type_name,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: Number(row.nights ?? 0),
    adults: Number(row.adults ?? 0),
    children: Number(row.children ?? 0),
    status: row.status as WaitlistStatus,
    convertedReference: row.converted_reference,
    notes: row.notes,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
  }));
}

/* -------------------------------------------------------------------------- */
/* The room calendar                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every room, as a calendar row.
 *
 * This is the one read that deliberately returns the whole house. The client
 * asked for a calendar showing every room and the guest in it, which is what
 * every property management system does and what a receptionist needs to answer
 * "who is in 101". The row is thin — a number, a floor, a type and a status —
 * and the board groups rooms under their type so a very large property collapses
 * to a handful of headers rather than one enormous list.
 */
export async function getCalendarRooms(): Promise<CalendarRoom[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("calendar_rooms");
  if (error) throw new Error(`Failed to load the rooms: ${error.message}`);

  return (data ?? []).map((row) => ({
    roomId: row.room_id,
    roomNumber: row.room_number,
    floor: row.floor,
    roomTypeId: row.room_type_id,
    roomTypeName: row.room_type_name,
    roomStatus: row.room_status,
    isInspected: row.is_inspected,
    doNotDisturb: row.do_not_disturb,
    sortOrder: row.sort_order,
  }));
}

/** The bars, keyed to a room. A null `roomId` means nothing is allocated yet. */
/**
 * The day notes touching a calendar window.
 *
 * One call for the whole board rather than one per column, shaped like
 * `getCalendarSeasons()`.
 */
export async function getCalendarNotes(
  from: string,
  days: number = CALENDAR_NIGHTS,
): Promise<CalendarNote[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("calendar_notes_for", {
    p_from: from,
    p_days: days,
  });
  if (error) throw new Error(`Failed to load the calendar notes: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    noteDate: row.note_date,
    body: row.body,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getCalendarRoomBars(
  from: string,
  nights: number = CALENDAR_NIGHTS,
): Promise<CalendarRoomBar[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("calendar_room_bars", {
    p_from: from,
    p_nights: nights,
  });
  if (error) throw new Error(`Failed to load the calendar: ${error.message}`);

  return (data ?? []).map((row) => ({
    roomId: row.room_id,
    roomTypeId: row.room_type_id,
    bookingId: row.booking_id,
    bookingRoomId: row.booking_room_id,
    reference: row.reference,
    guestName: row.guest_name,
    status: row.status,
    checkIn: row.check_in,
    checkOut: row.check_out,
    guests: Number(row.guests ?? 0),
    valueCents: Number(row.value_cents ?? 0),
    hasNotes: row.has_notes,
    isAssigned: row.is_assigned,
    unassignedTotal: Number(row.unassigned_total ?? 0),
    ratePlanName: row.rate_plan_name,
  }));
}

/**
 * The Rates screen: every active plan crossed with every room type and night.
 *
 * A second read beside `getInventoryGrid()` rather than a wider version of it.
 * That one feeds nine screens each about ONE field across room types, and every
 * one of them would have to grow a rate-plan dimension it has no use for. This
 * is one field across two dimensions — a different question, and the client's:
 * "you will see the room and then below the room all the rates".
 */
export async function getRatesGrid(
  from: string,
  days: number = INVENTORY_NIGHTS,
): Promise<RatesGridCell[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inventory_rates_grid", {
    p_from: from,
    p_days: days,
  });
  if (error) throw new Error(`Failed to load the rates: ${error.message}`);

  return (data ?? []).map((row) => ({
    ratePlanId: row.rate_plan_id,
    ratePlanCode: row.rate_plan_code,
    ratePlanName: row.rate_plan_name,
    ratePlanIsDefault: row.rate_plan_is_default,
    ratePlanSort: row.rate_plan_sort,
    roomTypeId: row.room_type_id,
    roomTypeCode: row.room_type_code,
    roomTypeName: row.room_type_name,
    roomTypeSort: row.room_type_sort,
    date: row.date,
    // Null is "not loaded", which is not zero and not free. Kept as null all
    // the way to the cell so the screen can say so.
    rateCents: row.rate_cents === null ? null : Number(row.rate_cents),
  }));
}

/** Files attached to one booking, newest first (0063). */
export async function getBookingAttachments(
  bookingId: string,
): Promise<BookingAttachment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_attachments_list", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(`Failed to load the attachments: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  }));
}

/** Correspondence recorded against one booking, newest first (0063). */
export async function getBookingEmails(
  bookingId: string,
): Promise<BookingEmail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_emails_list", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(`Failed to load the correspondence: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    toAddress: row.to_address,
    subject: row.subject,
    body: row.body,
    status: row.status,
    sentAt: row.sent_at,
    sentByName: row.sent_by_name,
  }));
}
