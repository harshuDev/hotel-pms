"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";

/**
 * Meeting room writes.
 *
 * Double-booking is prevented by an exclusion constraint in Postgres, not
 * here. A form can only check what it loaded, so two people booking the same
 * room for the same day at the same moment both see it free; only one of them
 * gets past the database.
 */

export interface MeetingRoomBookingInput {
  meetingRoomId: string;
  eventName: string;
  guestCount: number;
  startsOn: string;
  /** Inclusive: the room is occupied on this day too. */
  endsOn: string;
  customerId: string | null;
  comments: string;
}

export async function bookMeetingRoom(
  input: MeetingRoomBookingInput,
): Promise<ActionResult<{ bookingId: string; reference: string }>> {
  if (input.eventName.trim() === "") {
    return { ok: false, error: "Give the event a name." };
  }
  if (!Number.isSafeInteger(input.guestCount) || input.guestCount < 1) {
    return { ok: false, error: "How many people is it for?" };
  }
  if (input.endsOn < input.startsOn) {
    return { ok: false, error: "The last day must not be before the first." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("book_meeting_room", {
    p_meeting_room_id: input.meetingRoomId,
    p_event_name: input.eventName,
    p_guest_count: input.guestCount,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_customer_id: input.customerId,
    p_comments: input.comments || null,
    p_status: "confirmed",
  });

  if (error) return { ok: false, error: error.message };

  const row = ((data ?? []) as { booking_id: string; reference: string }[])[0];
  if (!row) {
    return {
      ok: false,
      error: "The booking was not returned. Check the calendar before trying again.",
    };
  }

  revalidatePath("/meeting-rooms");
  return { ok: true, data: { bookingId: row.booking_id, reference: row.reference } };
}

export async function cancelMeetingRoomBooking(input: {
  bookingId: string;
  reason: string;
}): Promise<ActionResult<{ outstandingCents: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_meeting_room_booking", {
    p_booking_id: input.bookingId,
    p_reason: input.reason || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/meeting-rooms");
  return { ok: true, data: { outstandingCents: Number(data ?? 0) } };
}

/**
 * Charges the room hire to a folio.
 *
 * The folio is made on the first charge and not before, which is what makes
 * "no folio" mean "no money was taken" rather than "there is an empty folio
 * nobody looked at". Everything after that is the ordinary charge path.
 */
export async function chargeMeetingRoomBooking(input: {
  bookingId: string;
  amountCents: number;
  description: string;
}): Promise<ActionResult<null>> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "A charge must be more than nothing." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("charge_meeting_room_booking", {
    p_booking_id: input.bookingId,
    p_amount_cents: input.amountCents,
    p_description: input.description || null,
    p_tax_rate_id: null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/meeting-rooms");
  revalidatePath("/cashier");
  return { ok: true, data: null };
}

export async function saveMeetingRoom(input: {
  id: string | null;
  name: string;
  capacity: number | null;
  description: string;
}): Promise<ActionResult<{ id: string }>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "Give the meeting room a name." };
  }
  if (input.capacity !== null && (!Number.isSafeInteger(input.capacity) || input.capacity < 1)) {
    return { ok: false, error: "A capacity has to be a whole number of seats." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_meeting_room", {
    p_id: input.id,
    p_name: input.name,
    p_capacity: input.capacity,
    p_description: input.description || null,
    p_sort_order: null,
    p_is_active: true,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/meeting-rooms");
  return { ok: true, data: { id: data as string } };
}
