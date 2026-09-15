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
 * - Rooms: MOCK
 * - House summary: MOCK
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
  ROOMS,
  houseSummary,
} from "@/lib/mock/data";

import type {
  ActivityItem,
  Booking,
  Customer,
  SeriesPoint,
  Shift,
  HouseSummary,
  Room,
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
/* Rooms and house state — currently mock-backed                              */
/* -------------------------------------------------------------------------- */

export async function getRooms(): Promise<Room[]> {
  return ROOMS;
}

export async function getHouseSummary(): Promise<HouseSummary> {
  return houseSummary();
}
