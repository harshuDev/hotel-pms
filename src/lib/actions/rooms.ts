"use server";

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
