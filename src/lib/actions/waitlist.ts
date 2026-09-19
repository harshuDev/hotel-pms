"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { WaitlistStatus } from "@/lib/types";

/**
 * Writes behind the Booking Waitlist report.
 *
 * The report would be a screen that can only ever be empty without these: a
 * waitlist nobody can add to is a list of nothing. The rule about not shipping
 * a control that cannot do anything applies to a whole screen as much as to a
 * menu item.
 *
 * Both go through RPCs, so the role check and the property scoping live in
 * Postgres. Nothing here decides who may write.
 */

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

function failure(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export interface AddToWaitlistInput {
  checkIn: string;
  checkOut: string;
  customerId: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** Empty means any room type — somebody who just wants a room that night. */
  roomTypeId: string | null;
  adults: number;
  children: number;
  notes: string;
}

export async function addToWaitlist(
  input: AddToWaitlistInput,
): Promise<Result<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("add_to_waitlist", {
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_customer_id: input.customerId,
    p_contact_name: input.contactName.trim() || null,
    p_contact_email: input.contactEmail.trim() || null,
    p_contact_phone: input.contactPhone.trim() || null,
    p_room_type_id: input.roomTypeId,
    p_adults: input.adults,
    p_children: input.children,
    p_notes: input.notes.trim() || null,
  });

  if (error) return failure(error.message);

  revalidatePath("/reports/waitlist");
  return { ok: true, data: { id: data as string } };
}

/**
 * Move an entry along.
 *
 * `bookingId` is required for "converted" and refused for everything else —
 * the database enforces both, because a converted entry that names no booking
 * and an open one that does are each a row that contradicts itself.
 *
 * This does NOT create the booking. Taking a reservation goes through
 * `create_booking()` and nothing else; a waitlist that could mint one would be
 * a second booking path with none of the inventory checks on it.
 */
export async function setWaitlistStatus(
  id: string,
  status: WaitlistStatus,
  bookingId: string | null = null,
): Promise<Result> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_waitlist_status", {
    p_id: id,
    p_status: status,
    p_booking_id: bookingId,
  });

  if (error) return failure(error.message);

  revalidatePath("/reports/waitlist");
  return { ok: true };
}
