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
