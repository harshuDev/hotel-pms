/**
 * ============================================================================
 * THE SWAP POINT
 * ============================================================================
 * Every function below is async and returns exactly the shape the real
 * Supabase query will return. When Phase 1 database work is done, create
 * src/lib/queries.ts with the same signatures backed by Supabase, change the
 * imports in the pages, and delete src/lib/mock/ entirely.
 *
 * No component reads mock data directly. That is the whole point.
 * ============================================================================
 */

import {
  BOOKINGS,
  CUSTOMERS,
  activityFeed,
  occupancySeries,
  openShift,
  revenueSeries,
  PROPERTY,
  TODAY,
  iso,
} from "@/lib/mock/data";
import type {
  ActivityItem,
  Booking,
  Customer,
  SeriesPoint,
  Shift,
} from "@/lib/types";

export async function getProperty() {
  return PROPERTY;
}

export async function getBusinessDate(): Promise<string> {
  return iso(TODAY);
}

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

export interface BookingFilters {
  q?: string;
  status?: string;
  page?: number;
  perPage?: number;
}

export async function getBookings(
  filters: BookingFilters = {},
): Promise<{ rows: Booking[]; total: number; page: number; perPage: number }> {
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
  return { rows: rows.slice(start, start + perPage), total, page, perPage };
}

export interface CustomerFilters {
  q?: string;
  kind?: string;
  page?: number;
  perPage?: number;
}

export async function getCustomers(
  filters: CustomerFilters = {},
): Promise<{ rows: Customer[]; total: number; page: number; perPage: number }> {
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
  return { rows: rows.slice(start, start + perPage), total, page, perPage };
}

export async function getOpenShift(): Promise<Shift> {
  return openShift();
}

export async function searchBookingsForPayment(q: string): Promise<Booking[]> {
  if (!q.trim()) return [];
  const term = q.toLowerCase();
  return BOOKINGS.filter(
    (b) =>
      b.balanceCents > 0 &&
      (b.reference.toLowerCase().includes(term) ||
        b.customerName.toLowerCase().includes(term)),
  ).slice(0, 6);
}

/* Rooms and house state — mirrors a rooms + booking_rooms join */
import { ROOMS, houseSummary } from "@/lib/mock/data";
import type { HouseSummary, Room } from "@/lib/types";

export async function getRooms(): Promise<Room[]> {
  return ROOMS;
}

export async function getHouseSummary(): Promise<HouseSummary> {
  return houseSummary();
}
