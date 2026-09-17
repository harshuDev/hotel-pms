"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";
import type { BookableRoomType, BookingStatus, Settlement } from "@/lib/types";

/**
 * Taking a booking.
 *
 * The whole booking goes to Postgres in one call. Splitting it — booking here,
 * rooms there, rates after — would leave a half-made booking behind on any
 * failure, holding inventory with no guest anyone can see. create_booking()
 * also re-checks availability inside its own transaction, which is the only
 * place the check is worth anything: two receptionists selling the last room
 * at the same moment both see it free in their own form.
 */

export interface RoomLine {
  roomTypeId: string;
  /** Null takes the nightly rate off the rate plan, which varies by night. */
  rateCents: number | null;
  quantity: number;
  adults: number;
  children: number;
}

export interface NewBooking {
  checkIn: string;
  checkOut: string;
  rooms: RoomLine[];
  channelId: string;
  customerId: string | null;
  newCustomer: {
    kind: "personal" | "company";
    firstName: string;
    lastName: string;
    companyName: string;
    email: string;
    phone: string;
  } | null;
  adults: number;
  children: number;
  status: Extract<BookingStatus, "pending" | "confirmed">;
  settlement: Settlement;
  taxRateId: string | null;
  guestNotes: string;
  internalNotes: string;
  externalReference: string;
  /** Sell a room the house does not have. */
  allowOverbook: boolean;
  ratePlanId: string | null;
  /** Sell against a stop sell, a closed date or a stay rule. */
  ignoreRestrictions: boolean;
  /** Quoted for a private offer. Blank still gets any automatic promotion. */
  promotionCode: string;
}

export interface BookingTaken {
  bookingId: string;
  reference: string;
  /** Null when nothing qualified. */
  promotionName: string | null;
  discountCents: number;
}

/**
 * Why create_booking() refused, when the refusal is one a person can wave
 * through. Postgres raises these as custom SQLSTATEs rather than message text,
 * so the wording can change without breaking the form.
 */
export type BookingBlock = "overbook" | "restriction";

const BLOCK_BY_SQLSTATE: Record<string, BookingBlock> = {
  HP001: "overbook",
  HP002: "restriction",
};

export type CreateBookingResult =
  | { ok: true; data: BookingTaken }
  | { ok: false; error: string; block?: BookingBlock };

export async function createBooking(
  input: NewBooking,
): Promise<CreateBookingResult> {
  // Cheap checks first, so an obviously wrong form comes back without a round
  // trip. Postgres repeats every one of them — these are for speed, not safety.
  if (input.checkOut <= input.checkIn) {
    return { ok: false, error: "The departure date must be after the arrival date." };
  }
  if (input.rooms.length === 0) {
    return { ok: false, error: "Add at least one room to the booking." };
  }
  if (!input.customerId && !input.newCustomer) {
    return { ok: false, error: "Pick an existing guest, or enter a new one." };
  }
  for (const line of input.rooms) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      return { ok: false, error: "Each room line needs a whole number of rooms." };
    }
    if (line.rateCents !== null) {
      if (!Number.isSafeInteger(line.rateCents) || line.rateCents < 0) {
        return { ok: false, error: "A nightly rate cannot be negative." };
      }
    } else if (!input.ratePlanId) {
      return {
        ok: false,
        error: "Give a nightly rate, or pick a rate plan that has one loaded.",
      };
    }
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_booking", {
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_rooms: input.rooms.map((line) => ({
      room_type_id: line.roomTypeId,
      quantity: line.quantity,
      rate_cents: line.rateCents,
      adults: line.adults,
      children: line.children,
    })),
    p_channel_id: input.channelId,
    p_customer_id: input.customerId,
    p_customer: input.newCustomer
      ? {
          kind: input.newCustomer.kind,
          first_name: input.newCustomer.firstName,
          last_name: input.newCustomer.lastName,
          company_name: input.newCustomer.companyName,
          email: input.newCustomer.email,
          phone: input.newCustomer.phone,
        }
      : null,
    p_adults: input.adults,
    p_children: input.children,
    p_status: input.status,
    p_settlement: input.settlement,
    p_tax_rate_id: input.taxRateId,
    p_guest_notes: input.guestNotes || null,
    p_internal_notes: input.internalNotes || null,
    p_external_reference: input.externalReference || null,
    p_allow_overbook: input.allowOverbook,
    p_rate_plan_id: input.ratePlanId,
    p_ignore_restrictions: input.ignoreRestrictions,
    p_promotion_code: input.promotionCode || null,
  });

  if (error) {
    // Postgres raises these with the message worth showing; it already reads
    // as a sentence, so it is not wrapped in one. The SQLSTATE says whether
    // the form should offer to wave it through.
    return {
      ok: false,
      error: error.message,
      block: BLOCK_BY_SQLSTATE[error.code ?? ""],
    };
  }

  const row = (
    (data ?? []) as {
      booking_id: string;
      reference: string;
      promotion_name: string | null;
      discount_cents: number;
    }[]
  )[0];
  if (!row) {
    return {
      ok: false,
      error: "The booking was not returned. Check the bookings list before taking it again.",
    };
  }

  // Everything that counts rooms or money for these dates.
  revalidatePath("/bookings");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");

  return {
    ok: true,
    data: {
      bookingId: row.booking_id,
      reference: row.reference,
      promotionName: row.promotion_name,
      discountCents: row.discount_cents ?? 0,
    },
  };
}

/** What is free for a stay, reloaded when the dates change. */
export async function loadAvailability(
  from: string,
  to: string,
): Promise<ActionResult<BookableRoomType[]>> {
  if (to <= from) {
    return { ok: false, error: "The departure date must be after the arrival date." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bookable_room_types", {
    p_from: from,
    p_to: to,
  });

  if (error) {
    return { ok: false, error: `Availability did not load: ${error.message}` };
  }

  return {
    ok: true,
    data: (
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
    })),
  };
}

/** Guest lookup for the booking form. */
export async function searchCustomers(
  q: string,
): Promise<ActionResult<{ id: string; name: string; detail: string }[]>> {
  if (btrimLength(q) < 2) return { ok: true, data: [] };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("customers_page", {
    p_q: q,
    p_kind: null,
    p_limit: 8,
    p_offset: 0,
  });

  if (error) {
    return { ok: false, error: `The guest lookup failed: ${error.message}` };
  }

  return {
    ok: true,
    data: (
      (data ?? []) as {
        customer_id: string;
        customer_number: number;
        name: string;
        email: string | null;
        phone: string | null;
      }[]
    ).map((row) => ({
      id: row.customer_id,
      name: row.name,
      detail:
        [row.email, row.phone].filter(Boolean).join(" · ") ||
        `Customer ${row.customer_number}`,
    })),
  };
}

function btrimLength(value: string) {
  return value.trim().length;
}
