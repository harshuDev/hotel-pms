/**
 * ============================================================================
 * THE SWAP POINT
 * ============================================================================
 * Real Supabase-backed queries for the PMS application.
 *
 * During the migration, functions that have not yet been converted remain
 * backed by the mock data. This lets us migrate the application incrementally
 * without changing the UI all at once.
 *
 * Migration status:
 * - Property: REAL Supabase
 * - Business date: REAL Supabase
 * - Arrivals: MOCK
 * - Departures: MOCK
 * - Occupancy forecast: MOCK
 * - Revenue series: MOCK
 * - Activity: MOCK
 * - Bookings: MOCK
 * - Customers: MOCK
 * - Cashier: MOCK
 * - Rooms: REAL Supabase
 * - House summary: REAL Supabase
 * ============================================================================
 */

import { createClient } from "@/lib/supabase/server";

import {
  BOOKINGS,
  CUSTOMERS,
  activityFeed,
  occupancySeries,
  openShift,
  revenueSeries,
} from "@/lib/mock/data";

import type {
  ActivityItem,
  Booking,
  Customer,
  SeriesPoint,
  Shift,
  HouseStateCounts,
  HouseSummary,
  Room,
  RoomFilters,
  RoomsPage,
  RoomState,
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
/* Dashboard — currently mock-backed                                          */
/* -------------------------------------------------------------------------- */

/** Mirrors dashboard_arrivals(p_date) */
export async function getArrivals(date: string): Promise<Booking[]> {
  return BOOKINGS.filter(
    (b) =>
      b.arrivalDate === date &&
      b.status !== "canceled" &&
      b.status !== "no_show",
  ).sort((a, b) => a.customerName.localeCompare(b.customerName));
}

/** Mirrors dashboard_departures(p_date) */
export async function getDepartures(date: string): Promise<Booking[]> {
  return BOOKINGS.filter(
    (b) =>
      b.departureDate === date &&
      b.status !== "canceled" &&
      b.status !== "no_show",
  ).sort((a, b) => a.customerName.localeCompare(b.customerName));
}

/** Mirrors occupancy_forecast(p_from, 28) */
export async function getOccupancyForecast(): Promise<SeriesPoint[]> {
  return occupancySeries();
}

/** Mirrors revenue_series(p_from, 28) */
export async function getRevenueSeries(): Promise<SeriesPoint[]> {
  return revenueSeries();
}

/** Mirrors a paginated read of activity_log */
export async function getActivity(): Promise<ActivityItem[]> {
  return activityFeed();
}

/* -------------------------------------------------------------------------- */
/* Bookings — currently mock-backed                                            */
/* -------------------------------------------------------------------------- */

export interface BookingFilters {
  q?: string;
  status?: string;
  page?: number;
  perPage?: number;
}

export async function getBookings(
  filters: BookingFilters = {},
): Promise<{
  rows: Booking[];
  total: number;
  page: number;
  perPage: number;
}> {
  const perPage = filters.perPage ?? 25;
  const page = Math.max(1, filters.page ?? 1);
  let rows = BOOKINGS;

  if (filters.status && filters.status !== "all") {
    rows = rows.filter((b) => b.status === filters.status);
  }

  if (filters.q) {
    const q = filters.q.toLowerCase();

    rows = rows.filter(
      (b) =>
        b.reference.toLowerCase().includes(q) ||
        b.customerName.toLowerCase().includes(q),
    );
  }

  const total = rows.length;
  const start = (page - 1) * perPage;

  return {
    rows: rows.slice(start, start + perPage),
    total,
    page,
    perPage,
  };
}

/* -------------------------------------------------------------------------- */
/* Customers — currently mock-backed                                           */
/* -------------------------------------------------------------------------- */

export interface CustomerFilters {
  q?: string;
  kind?: string;
  page?: number;
  perPage?: number;
}

export async function getCustomers(
  filters: CustomerFilters = {},
): Promise<{
  rows: Customer[];
  total: number;
  page: number;
  perPage: number;
}> {
  const perPage = filters.perPage ?? 25;
  const page = Math.max(1, filters.page ?? 1);
  let rows = CUSTOMERS;

  if (filters.kind && filters.kind !== "all") {
    rows = rows.filter((c) => c.kind === filters.kind);
  }

  if (filters.q) {
    const q = filters.q.toLowerCase();

    rows = rows.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q),
    );
  }

  const total = rows.length;
  const start = (page - 1) * perPage;

  return {
    rows: rows.slice(start, start + perPage),
    total,
    page,
    perPage,
  };
}

/* -------------------------------------------------------------------------- */
/* Cashier — currently mock-backed                                             */
/* -------------------------------------------------------------------------- */

export async function getOpenShift(): Promise<Shift> {
  return openShift();
}

/**
 * Phase 4 query names.
 * These preserve the mock swap point until Supabase cashier queries
 * are migrated.
 */
export async function getCurrentCashierShift(): Promise<Shift> {
  return getOpenShift();
}

export async function getCashierShiftTransactions() {
  const shift = await getOpenShift();
  return shift.payments;
}

export async function getCashMovements() {
  const shift = await getOpenShift();
  return shift.paidOuts;
}

export async function getRecentCashPayments() {
  const shift = await getOpenShift();

  return shift.payments.filter((payment) => payment.affectsDrawer);
}

export async function getCashierShiftHistory(): Promise<Shift[]> {
  return [];
}

export async function searchBookingsForPayment(
  q: string,
): Promise<Booking[]> {
  if (!q.trim()) return [];

  const term = q.toLowerCase();

  return BOOKINGS.filter(
    (b) =>
      b.balanceCents > 0 &&
      (b.reference.toLowerCase().includes(term) ||
        b.customerName.toLowerCase().includes(term)),
  ).slice(0, 6);
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
  drawer_cents: number;
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
