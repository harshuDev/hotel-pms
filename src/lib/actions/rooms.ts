"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getRooms } from "@/lib/queries";
import type { RoomFilters, RoomsPage } from "@/lib/types";

/**
 * The house board is a client component and loads its room list on demand, so
 * it cannot read through a Server Component. This action keeps that read on
 * the server — same query layer, same RLS, no API route.
 */
export async function loadRooms(filters: RoomFilters): Promise<RoomsPage> {
  return getRooms(filters);
}

/**
 * Putting a booking in a room, and taking it back out.
 *
 * Both go through RPCs, so every rule lives in Postgres: who may do it, that
 * the room is the type the booking was sold, that nothing else holds the room
 * over those nights, and — only for a stay that has already started — that the
 * room is actually ready. Nothing here re-checks any of that. A room picker in
 * a browser can only test what it loaded, and two receptionists placing the
 * last room at the same moment would both see it free.
 */

type Result = { ok: true } | { ok: false; error: string };

/** Postgres raises these with a message meant to be read; pass it through. */
function failure(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export async function assignRoom(
  bookingRoomId: string,
  roomId: string,
): Promise<Result> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("assign_room", {
    p_booking_room_id: bookingRoomId,
    p_room_id: roomId,
  });

  if (error) return failure(error.message);

  // The board reads rooms and bars; both move when this does.
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function unassignRoom(bookingRoomId: string): Promise<Result> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("unassign_room", {
    p_booking_room_id: bookingRoomId,
  });

  if (error) return failure(error.message);

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true };
}
