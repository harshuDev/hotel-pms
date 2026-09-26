"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";
import type { Settlement } from "@/lib/types";

/**
 * Changing a booking after it has been taken.
 *
 * Every rule about what may change lives in Postgres, not here: posted money
 * is never touched, the arrival date is history once the guest has arrived,
 * and a night already charged cannot be dropped. These are the thin wrappers.
 */

function revalidateBooking(bookingId: string) {
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/bookings");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function updateBooking(input: {
  bookingId: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  channelId?: string;
  settlement?: Settlement;
  guestNotes?: string;
  internalNotes?: string;
  externalReference?: string;
  allowOverbook?: boolean;
}): Promise<ActionResult<null> & { block?: "overbook" }> {
  if (input.checkIn && input.checkOut && input.checkOut <= input.checkIn) {
    return { ok: false, error: "The departure date must be after the arrival date." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_booking", {
    p_booking_id: input.bookingId,
    p_check_in: input.checkIn ?? null,
    p_check_out: input.checkOut ?? null,
    p_adults: input.adults ?? null,
    p_children: input.children ?? null,
    p_channel_id: input.channelId ?? null,
    p_settlement: input.settlement ?? null,
    p_arrival_time: null,
    p_departure_time: null,
    p_guest_notes: input.guestNotes || null,
    p_internal_notes: input.internalNotes || null,
    p_external_reference: input.externalReference || null,
    p_allow_overbook: input.allowOverbook ?? false,
  });

  if (error) {
    return {
      ok: false,
      error: error.message,
      block: error.code === "HP001" ? "overbook" : undefined,
    };
  }

  revalidateBooking(input.bookingId);
  return { ok: true, data: null };
}

/** Prices the nights an extension added, which come in at zero. */
export async function setBookingRoomRate(input: {
  bookingId: string;
  bookingRoomId: string;
  rateCents: number;
  from?: string;
  to?: string;
}): Promise<ActionResult<{ nightsPriced: number }>> {
  if (!Number.isSafeInteger(input.rateCents) || input.rateCents < 0) {
    return { ok: false, error: "A nightly rate cannot be negative." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_booking_room_rate", {
    p_booking_room_id: input.bookingRoomId,
    p_rate_cents: input.rateCents,
    p_from: input.from ?? null,
    p_to: input.to ?? null,
    p_tax_rate_id: null,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBooking(input.bookingId);
  return { ok: true, data: { nightsPriced: Number(data ?? 0) } };
}

export async function cancelBooking(input: {
  bookingId: string;
  noShow: boolean;
  reason: string;
}): Promise<ActionResult<{ outstandingCents: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: input.bookingId,
    p_no_show: input.noShow,
    p_reason: input.reason || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBooking(input.bookingId);
  return { ok: true, data: { outstandingCents: Number(data ?? 0) } };
}

/**
 * Cancelling ONE room out of a group booking (0065).
 *
 * The client: "Group bookings allow the receptionist to be able to cancel a
 * reservation." A group is one booking carrying several rooms, and until this
 * the only cancel was `cancelBooking()`, which takes the whole thing down —
 * five rooms booked, one guest drops out, and the desk could cancel all five
 * or none.
 *
 * Postgres refuses the LAST live room by name and says to cancel the booking
 * instead, so this can never quietly leave a confirmed reservation holding no
 * rooms at all. It refuses an in-house room too: a guest in the room is
 * checked out, never cancelled.
 */
export async function cancelBookingRoom(input: {
  bookingId: string;
  bookingRoomId: string;
  reason: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_booking_room", {
    p_booking_room_id: input.bookingRoomId,
    p_reason: input.reason || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBooking(input.bookingId);
  return { ok: true, data: null };
}

/**
 * Putting one of those rooms back (0065).
 *
 * The mirror of the above and the reason it is safe to ship: a destructive
 * control with no undo is one misclick from a reservation nobody can rebuild,
 * and every other cancel in this application has one.
 *
 * `allowOverbook` is a deliberate second call for the same reason it is on
 * `restoreBooking()` — cancelling gave the room back to the house and somebody
 * may have sold it since, so the default refuses with `HP001` and the caller
 * asks again having read what it said.
 */
export async function restoreBookingRoom(input: {
  bookingId: string;
  bookingRoomId: string;
  allowOverbook?: boolean;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_booking_room", {
    p_booking_room_id: input.bookingRoomId,
    p_allow_overbook: input.allowOverbook ?? false,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBooking(input.bookingId);
  return { ok: true, data: null };
}

/**
 * Putting a cancelled booking back on the house (0061).
 *
 * `allowOverbook` is a deliberate second call, not a flag the first screen
 * sets: the rooms were freed when the booking was cancelled and somebody may
 * have sold them since, so the default refuses with `HP001` and the caller
 * has to ask again, having read what it said. Same shape as taking a booking
 * that would oversell.
 */
export async function restoreBooking(
  bookingId: string,
  allowOverbook = false,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_booking", {
    p_booking_id: bookingId,
    p_allow_overbook: allowOverbook,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBooking(bookingId);
  // The board draws cancelled bars in their own band, so it moves too.
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

export async function confirmBooking(
  bookingId: string,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_booking", {
    p_booking_id: bookingId,
  });

  if (error) return { ok: false, error: error.message };

  revalidateBooking(bookingId);
  return { ok: true, data: null };
}

/**
 * Charges an extra from the property's catalog (0069) to the booking's open
 * folio. The price, the tax and the accounting category all come from the
 * catalog inside Postgres -- the browser sends which extra and how many, never
 * an amount -- and the posting itself is `post_charge()`, so the business
 * date, the role check and the append-only rules are the ones every other
 * charge already has.
 */
export async function chargeExtra(input: {
  bookingId: string;
  extraId: string;
  quantity: number;
}): Promise<ActionResult<null>> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, error: "The quantity must be a whole number, 1 or more." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("charge_extra", {
    p_booking_id: input.bookingId,
    p_extra_id: input.extraId,
    p_quantity: input.quantity,
  });
  if (error) return { ok: false, error: error.message };
  revalidateBooking(input.bookingId);
  return { ok: true, data: null };
}
