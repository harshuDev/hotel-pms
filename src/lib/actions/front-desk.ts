"use server";

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
    return { ok: false, error: `The booking's rooms did not load: ${error.message}` };
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
    return { ok: false, error: `Available rooms did not load: ${error.message}` };
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

  if (error) return { ok: false, error: `The room was not assigned: ${error.message}` };

  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

export async function checkIn(bookingId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_in_booking", {
    p_booking_id: bookingId,
  });

  if (error) return { ok: false, error: `The check-in did not go through: ${error.message}` };

  revalidatePath("/dashboard");
  revalidatePath("/bookings");
  return { ok: true, data: null };
}

export async function checkOut(
  bookingId: string,
): Promise<ActionResult<{ outstandingCents: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_out_booking", {
    p_booking_id: bookingId,
  });

  if (error) return { ok: false, error: `The check-out did not go through: ${error.message}` };

  const row = ((data ?? []) as { outstanding_cents: number }[])[0];

  revalidatePath("/dashboard");
  revalidatePath("/bookings");
  revalidatePath("/cashier");
  return { ok: true, data: { outstandingCents: row?.outstanding_cents ?? 0 } };
}
