import {
  addDays,
  format,
  subDays,
  differenceInCalendarDays,
  subHours,
} from "date-fns";
import type {
  ActivityItem,
  ActivityKind,
  Booking,
  BookingStatus,
  Channel,
  Customer,
  PaidOut,
  PaymentMethod,
  RoomType,
  SeriesPoint,
  Settlement,
  Shift,
  ShiftPayment,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Deterministic PRNG so the demo never reshuffles between renders.    */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260825);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min;
const chance = (p: number) => rand() < p;

const TODAY = new Date(2026, 7, 25); // fixed so the demo is stable
const iso = (d: Date) => format(d, "yyyy-MM-dd");

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

export const PROPERTY = {
  name: "Grand Ferndale",
  timezone: "Asia/Kolkata",
  currency: "INR",
};

export const ROOM_TYPES: RoomType[] = [
  { id: "rt1", code: "STD", name: "Standard Double" },
  { id: "rt2", code: "DLX", name: "Deluxe King" },
  { id: "rt3", code: "STE", name: "Executive Suite" },
  { id: "rt4", code: "FAM", name: "Family Room" },
];

export const CHANNELS: Channel[] = [
  { id: "ch1", name: "Front Desk", kind: "direct", commissionBps: 0 },
  { id: "ch2", name: "BookingCom", kind: "ota", commissionBps: 1500 },
  { id: "ch3", name: "Expedia", kind: "ota", commissionBps: 1800 },
  { id: "ch4", name: "Hotelbeds", kind: "wholesaler", commissionBps: 2000 },
  { id: "ch5", name: "Offline", kind: "offline", commissionBps: 0 },
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  { id: "pm1", name: "Cash", affectsDrawer: true },
  { id: "pm2", name: "Card", affectsDrawer: false },
  { id: "pm3", name: "UPI", affectsDrawer: false },
  { id: "pm4", name: "Bank Transfer", affectsDrawer: false },
  { id: "pm5", name: "OTA Prepaid", affectsDrawer: false },
];

const FIRST = [
  "Keiko", "Jorge", "Camra", "Jaccar", "Elany", "Natalia", "Fidel", "Aaron",
  "Abbey", "Abel", "Priya", "Rohan", "Meera", "Dev", "Ana", "Luis", "Sofia",
  "Marco", "Yuki", "Hassan", "Ingrid", "Tomas", "Nadia", "Olek", "Farah",
];
const LAST = [
  "Lopez", "Casillas", "Comier", "Ximena", "Vera Luque", "Rodriguez", "Murphy",
  "Frater", "Marquez", "Reyes", "Sharma", "Iyer", "Nair", "Kapoor", "Silva",
  "Costa", "Tanaka", "Rahman", "Larsen", "Novak", "Haddad", "Petrov",
];
const COMPANIES = [
  "Ferndale Travel Group",
  "Meridian Corporate Stays",
  "Blue Compass Tours",
  "Sanchez & Partners LLP",
  "Northgate Logistics",
];

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

function buildCustomers(): Customer[] {
  const out: Customer[] = [];
  for (let i = 0; i < 64; i++) {
    const isCompany = i < COMPANIES.length;
    const name = isCompany
      ? COMPANIES[i]
      : `${pick(FIRST)} ${pick(LAST)}`;
    const hasEmail = chance(0.78);
    const slug = name.toLowerCase().replace(/[^a-z]+/g, ".").slice(0, 18);
    out.push({
      id: `cu${i + 1}`,
      ref: String(2000000 + int(100000, 5999999)),
      kind: isCompany ? "company" : "personal",
      name,
      nationalIdNumber: chance(0.35) ? String(int(10000000, 99999999)) : null,
      email: hasEmail
        ? `${slug}@${pick(["gmail.com", "guest.booking.com", "m.expediapartner.com", "outlook.com"])}`
        : null,
      phone: chance(0.6) ? `+91 ${int(70000, 99999)} ${int(10000, 99999)}` : null,
      excludeFromEmail: chance(0.12),
      bookingCount: 0,
      totalRevenueCents: 0,
      lastBookingDate: null,
      balanceCents: 0,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const CUSTOMERS = buildCustomers();

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

const STATUS_WEIGHTS: [BookingStatus, number][] = [
  ["pending", 0.4],
  ["confirmed", 0.22],
  ["checked_out", 0.18],
  ["checked_in", 0.08],
  ["canceled", 0.09],
  ["no_show", 0.03],
];

function weightedStatus(arrival: Date): BookingStatus {
  const offset = differenceInCalendarDays(arrival, TODAY);
  const r = rand();
  if (offset < -1) return r < 0.86 ? "checked_out" : r < 0.95 ? "canceled" : "no_show";
  if (offset <= 0) return r < 0.7 ? "checked_in" : r < 0.9 ? "confirmed" : "canceled";
  let acc = 0;
  for (const [s, w] of STATUS_WEIGHTS) {
    acc += w;
    if (r < acc) return s;
  }
  return "pending";
}

function nightlyRate(rtId: string, date: Date): number {
  const base = { rt1: 320000, rt2: 480000, rt3: 850000, rt4: 610000 }[rtId] ?? 320000;
  const dow = date.getDay();
  const weekend = dow === 5 || dow === 6 ? 1.28 : 1;
  return Math.round(base * weekend * (0.92 + rand() * 0.2));
}

function buildBookings(): Booking[] {
  const out: Booking[] = [];
  for (let i = 0; i < 140; i++) {
    const arrival = addDays(TODAY, int(-45, 90));
    const nights = chance(0.62) ? int(1, 3) : int(4, 10);
    const departure = addDays(arrival, nights);
    const roomCount = chance(0.82) ? 1 : int(2, 4);
    const rt = pick(ROOM_TYPES);
    const channel = pick(CHANNELS);
    const status = weightedStatus(arrival);
    const customer = pick(CUSTOMERS);

    let totalCents = 0;
    for (let n = 0; n < nights; n++) {
      totalCents += nightlyRate(rt.id, addDays(arrival, n)) * roomCount;
    }
    if (status === "canceled" || status === "no_show") totalCents = 0;

    const settlement: Settlement =
      channel.kind === "wholesaler"
        ? "prepaid_to_channel"
        : channel.kind === "ota" && chance(0.5)
          ? "virtual_card"
          : "at_property";

    // Settled bookings are mostly paid; future ones mostly are not.
    let paidCents = 0;
    if (totalCents > 0) {
      if (settlement !== "at_property") paidCents = totalCents;
      else if (status === "checked_out") paidCents = chance(0.88) ? totalCents : Math.round(totalCents * 0.5);
      else if (status === "checked_in") paidCents = chance(0.5) ? Math.round(totalCents * 0.5) : 0;
      else if (status === "confirmed") paidCents = chance(0.4) ? Math.round(totalCents * 0.3) : 0;
    }

    const bookedAt = subDays(arrival, int(2, 120));

    out.push({
      id: `bk${i + 1}`,
      reference: `GFEF-${int(1000000, 9999999)}-${pick(["A", "C"])}`,
      customerId: customer.id,
      customerName: customer.name,
      channelName: channel.name,
      settlement,
      status,
      arrivalDate: iso(arrival),
      departureDate: iso(departure),
      bookedAt: iso(bookedAt > TODAY ? subDays(TODAY, int(1, 20)) : bookedAt),
      nights,
      roomCount,
      roomTypeName: rt.name,
      roomNumber:
        status === "checked_in" || status === "checked_out"
          ? String(int(1, 4) * 100 + int(1, 20))
          : null,
      adults: int(1, 2 + roomCount),
      children: chance(0.25) ? int(1, 2) : 0,
      totalCents,
      balanceCents: totalCents - paidCents,
    });
  }

  // Guarantee the demo has arrivals and departures today and tomorrow.
  const force = (date: Date, field: "arrivalDate" | "departureDate", n: number) => {
    for (let k = 0; k < n; k++) {
      const b = out[int(0, out.length - 1)];
      if (b.status === "canceled" || b.status === "no_show") continue;
      b[field] = iso(date);
      if (field === "arrivalDate") {
        b.departureDate = iso(addDays(date, b.nights));
        b.status = differenceInCalendarDays(date, TODAY) === 0 ? "confirmed" : "pending";
      }
    }
  };
  force(TODAY, "arrivalDate", 6);
  force(addDays(TODAY, 1), "arrivalDate", 4);
  force(TODAY, "departureDate", 5);
  force(addDays(TODAY, 1), "departureDate", 3);

  return out.sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate));
}

export const BOOKINGS = buildBookings();

// Roll booking figures up onto customers.
for (const c of CUSTOMERS) {
  const mine = BOOKINGS.filter((b) => b.customerId === c.id);
  c.bookingCount = mine.length;
  c.totalRevenueCents = mine
    .filter((b) => b.status === "checked_out")
    .reduce((s, b) => s + b.totalCents, 0);
  c.balanceCents = mine.reduce((s, b) => s + b.balanceCents, 0);
  c.lastBookingDate = mine.length
    ? mine.map((b) => b.arrivalDate).sort().at(-1)!
    : null;
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

const SELLABLE_ROOMS = 40;

export function occupancySeries(): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 0; i < 28; i++) {
    const d = addDays(TODAY, i);
    const key = iso(d);
    const occupied = BOOKINGS.filter(
      (b) =>
        b.status !== "canceled" &&
        b.status !== "no_show" &&
        b.arrivalDate <= key &&
        b.departureDate > key,
    ).reduce((s, b) => s + b.roomCount, 0);
    out.push({
      date: key,
      value: Math.min(100, Math.round((occupied / SELLABLE_ROOMS) * 1000) / 10),
    });
  }
  return out;
}

export function revenueSeries(): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = subDays(TODAY, i);
    const key = iso(d);
    const value = BOOKINGS.filter(
      (b) =>
        b.status !== "canceled" &&
        b.status !== "no_show" &&
        b.arrivalDate <= key &&
        b.departureDate > key,
    ).reduce((s, b) => s + Math.round(b.totalCents / Math.max(1, b.nights)), 0);
    out.push({ date: key, value });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Live feed                                                           */
/* ------------------------------------------------------------------ */

export function activityFeed(): ActivityItem[] {
  const out: ActivityItem[] = [];
  const pool = BOOKINGS.slice(0, 60);
  for (let i = 0; i < 34; i++) {
    const b = pool[i % pool.length];
    const kind: ActivityKind =
      b.status === "canceled"
        ? "CANCELLATION"
        : pick(["BOOKING", "BOOKING", "MODIFICATION", "PAYMENT", "CHECKIN", "CHECKOUT"]);

    let summary: string;
    const emphasis = [b.customerName, b.channelName];
    switch (kind) {
      case "CANCELLATION":
        summary = `Cancelled booking from ${b.customerName}`;
        break;
      case "MODIFICATION":
        summary = `Booking modification via ${b.channelName} for ${b.customerName}`;
        break;
      case "PAYMENT":
        summary = `Payment received for ${b.customerName} on ${b.reference}`;
        break;
      case "CHECKIN":
        summary = `${b.customerName} checked in to room ${b.roomNumber ?? "—"}`;
        break;
      case "CHECKOUT":
        summary = `${b.customerName} checked out of room ${b.roomNumber ?? "—"}`;
        break;
      default:
        summary = `New booking via ${b.channelName} from ${b.customerName}`;
    }

    out.push({
      id: `af${i + 1}`,
      kind,
      summary,
      emphasis,
      createdAt: subHours(TODAY, i * int(3, 14) + 2).toISOString(),
      unread: i < 5,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cashier shift                                                       */
/* ------------------------------------------------------------------ */

export const OPENING_FLOAT_CENTS = 500000; // fixed float, per CLAUDE.md

export function openShift(): Shift {
  const payments: ShiftPayment[] = [];
  const settled = BOOKINGS.filter((b) => b.balanceCents > 0).slice(0, 7);
  settled.forEach((b, i) => {
    const m = pick(PAYMENT_METHODS.filter((x) => x.id !== "pm5"));
    payments.push({
      id: `sp${i + 1}`,
      bookingRef: b.reference,
      guestName: b.customerName,
      methodId: m.id,
      methodName: m.name,
      affectsDrawer: m.affectsDrawer,
      amountCents: Math.round(b.balanceCents / (chance(0.5) ? 1 : 2) / 100) * 100,
      createdAt: subHours(TODAY, 8 - i).toISOString(),
    });
  });

  const paidOuts: PaidOut[] = [
    {
      id: "po1",
      amountCents: 45000,
      category: "taxi",
      reason: "Airport transfer for arriving guest",
      payee: "City Cabs",
      rechargeBookingRef: settled[0]?.reference ?? null,
      createdAt: subHours(TODAY, 6).toISOString(),
    },
    {
      id: "po2",
      amountCents: 128000,
      category: "guest_purchase",
      reason: "Pharmacy run requested by room 312",
      payee: "Apollo Pharmacy",
      rechargeBookingRef: settled[1]?.reference ?? null,
      createdAt: subHours(TODAY, 4).toISOString(),
    },
    {
      id: "po3",
      amountCents: 32000,
      category: "supplies",
      reason: "Printer paper for front desk",
      payee: "Stationery Mart",
      rechargeBookingRef: null,
      createdAt: subHours(TODAY, 2).toISOString(),
    },
  ];

  return {
    id: "sh-current",
    userName: "Shekher",
    businessDate: iso(TODAY),
    openedAt: subHours(TODAY, 9).toISOString(),
    openingFloatCents: OPENING_FLOAT_CENTS,
    status: "open",
    payments,
    paidOuts,
  };
}

export { TODAY, iso };

/* ------------------------------------------------------------------ */
/* Room rack — the state of the house right now                        */
/* ------------------------------------------------------------------ */

import type { HouseSummary, Room, RoomState } from "@/lib/types";

export function buildRooms(): Room[] {
  const rack = mulberry32(881122);
  const r = () => rack();
  const rooms: Room[] = [];

  for (let floor = 1; floor <= 4; floor++) {
    for (let n = 1; n <= 10; n++) {
      const roll = r();
      let state: RoomState;
      if (roll < 0.42) state = "occupied";
      else if (roll < 0.54) state = "due_out";
      else if (roll < 0.66) state = "arriving";
      else if (roll < 0.84) state = "vacant_clean";
      else if (roll < 0.96) state = "vacant_dirty";
      else state = "ooo";

      const occupiedNow =
        state === "occupied" || state === "due_out" || state === "arriving";

      rooms.push({
        id: `rm${floor}${String(n).padStart(2, "0")}`,
        number: `${floor}${String(n).padStart(2, "0")}`,
        floor,
        typeName: ROOM_TYPES[Math.floor(r() * ROOM_TYPES.length)].name,
        state,
        guestName: occupiedNow
          ? `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`
          : null,
        nightsLeft:
          state === "occupied"
            ? Math.floor(r() * 5) + 1
            : state === "due_out"
              ? 0
              : null,
      });
    }
  }
  return rooms;
}

export const ROOMS = buildRooms();

export function houseSummary(): HouseSummary {
  const sellable = ROOMS.filter((x) => x.state !== "ooo").length;
  const occupied = ROOMS.filter(
    (x) => x.state === "occupied" || x.state === "due_out",
  ).length;
  const arrivals = ROOMS.filter((x) => x.state === "arriving").length;
  const departures = ROOMS.filter((x) => x.state === "due_out").length;

  const shift = openShift();
  const drawerCents =
    shift.openingFloatCents +
    shift.payments.filter((p) => p.affectsDrawer).reduce((s, p) => s + p.amountCents, 0) -
    shift.paidOuts.reduce((s, p) => s + p.amountCents, 0);

  const outstandingCents = BOOKINGS.filter(
    (b) => b.status === "checked_in" || b.status === "confirmed",
  ).reduce((s, b) => s + Math.max(0, b.balanceCents), 0);

  const inHouse = BOOKINGS.filter((b) => b.status === "checked_in");
  const adrCents = inHouse.length
    ? Math.round(
        inHouse.reduce((s, b) => s + b.totalCents / Math.max(1, b.nights), 0) /
          inHouse.length,
      )
    : 0;

  return {
    sellable,
    occupied,
    arrivals,
    departures,
    vacantDirty: ROOMS.filter((x) => x.state === "vacant_dirty").length,
    ooo: ROOMS.filter((x) => x.state === "ooo").length,
    occupancyPct: Math.round((occupied / sellable) * 1000) / 10,
    drawerCents,
    outstandingCents,
    adrCents,
  };
}
