"use server";
import { localisedAs } from "@/lib/i18n/localised";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";

export interface BookingRoomSlot {
  bookingRoomId: string;
  roomTypeName: string;
  roomId: string | null;
  roomNumber: string | null;
}

export interface AvailableRoom {
  roomId: string;
  number: string;
  floor: number | null;
  roomTypeName: string;
}

/** The rooms on a booking, and whether each has a physical room yet. */
export async function loadBookingRooms(
  bookingId: string,
): Promise<ActionResult<BookingRoomSlot[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_rooms_for_assignment", {
    p_booking_id: bookingId,
  });

  if (error) {
    return { ok: false, error: await localisedAs("The booking's rooms did not load", error.message) };
  }

  return {
    ok: true,
    data: (
      (data ?? []) as {
        booking_room_id: string;
        room_type_name: string;
        room_id: string | null;
        room_number: string | null;
      }[]
    ).map((row) => ({
      bookingRoomId: row.booking_room_id,
      roomTypeName: row.room_type_name,
      roomId: row.room_id,
      roomNumber: row.room_number,
    })),
  };
}

/** Clean, free rooms of the type that was sold. */
export async function loadAvailableRooms(
  bookingRoomId: string,
): Promise<ActionResult<AvailableRoom[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "available_rooms_for_booking_room",
    { p_booking_room_id: bookingRoomId },
  );

  if (error) {
    return { ok: false, error: await localisedAs("Available rooms did not load", error.message) };
  }

  return {
    ok: true,
    data: (
      (data ?? []) as {
        room_id: string;
        number: string;
        floor: number | null;
        room_type_name: string;
      }[]
    ).map((row) => ({
      roomId: row.room_id,
      number: row.number,
      floor: row.floor,
      roomTypeName: row.room_type_name,
    })),
  };
}

export async function assignRoom(
  bookingRoomId: string,
  roomId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_room", {
    p_booking_room_id: bookingRoomId,
    p_room_id: roomId,
  });

  if (error) return { ok: false, error: await localisedAs("The room was not assigned", error.message) };

  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

/**
 * A late arrival is a deliberate second call, like `allowOverbook` (0112,
 * 0132): the first attempt is refused -- HP004 when the arrival has passed,
 * HP005 when the departure has too -- and only then is the desk offered to
 * check the guest in on the booked dates (`booked`; every night is charged
 * at check-out since 0125) or, while nights remain, to move the arrival to
 * today (`move`).
 */
export async function checkIn(
  bookingId: string,
  how: "ask" | "move" | "booked" = "ask",
): Promise<ActionResult & { block?: "late" | "departed" }> {
  const supabase = await createClient();
  const { error } =
    how === "booked"
      ? await supabase.rpc("check_in_booking_as_booked", { p_booking_id: bookingId })
      : await supabase.rpc("check_in_booking", {
          p_booking_id: bookingId,
          p_move_arrival: how === "move",
        });

  if (error) {
    return {
      ok: false,
      error: await localisedAs("The check-in did not go through", error.message),
      block: error.code === "HP004" ? "late" : error.code === "HP005" ? "departed" : undefined,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/bookings");
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

export interface CheckoutCharges {
  nights: number;
  roomChargesCents: number;
  /** The folio balance before the room charges post. */
  balanceCents: number;
}

/**
 * What checking out now would post (0125): room charges are not posted
 * nightly but at check-out, so the folio balance alone would call an
 * uncharged stay settled.
 */
export async function loadCheckoutCharges(
  bookingId: string,
): Promise<ActionResult<CheckoutCharges>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("booking_checkout_charges", {
    p_booking_id: bookingId,
  });
  if (error) return { ok: false, error: await localisedAs("The room charges could not be read", error.message) };
  const row = (data ?? [])[0];
  return {
    ok: true,
    data: {
      nights: row?.nights ?? 0,
      roomChargesCents: Number(row?.room_charges_cents ?? 0),
      balanceCents: Number(row?.balance_cents ?? 0),
    },
  };
}

export async function checkOut(
  bookingId: string,
): Promise<ActionResult<{ outstandingCents: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_out_booking", {
    p_booking_id: bookingId,
  });

  if (error) return { ok: false, error: await localisedAs("The check-out did not go through", error.message) };

  const row = ((data ?? []) as { outstanding_cents: number }[])[0];

  revalidatePath("/dashboard");
  revalidatePath("/bookings");
  revalidatePath("/cashier");
  return { ok: true, data: { outstandingCents: row?.outstanding_cents ?? 0 } };
}
