"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";
import type { ChannelKind, RoomStatus, StaffRole } from "@/lib/types";

/**
 * Setting a property up.
 *
 * Everything here had to be inserted by hand in SQL until now, which is why a
 * fresh property could not be made usable from the application at all. Each of
 * these is a thin wrapper: the role gates and the refusals live in Postgres,
 * where they apply however the row is written.
 */

function revalidateSettings() {
  revalidatePath("/settings", "layout");
  // A room type, a channel or a tax rate changes what these can offer.
  revalidatePath("/bookings/new");
  revalidatePath("/inventory", "layout");
  revalidatePath("/dashboard");
}

export async function saveProperty(input: {
  name: string;
  timezone: string;
  currency: string;
  checkInTime: string;
  checkOutTime: string;
}): Promise<ActionResult<null>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "The property needs a name." };
  }
  if (input.currency.trim().length !== 3) {
    return { ok: false, error: "A currency is three letters, like GBP." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_property", {
    p_name: input.name,
    p_timezone: input.timezone,
    p_currency: input.currency.toUpperCase(),
    p_check_in_time: input.checkInTime || null,
    p_check_out_time: input.checkOutTime || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: null };
}

export async function saveRoomType(input: {
  id: string | null;
  code: string;
  name: string;
  baseOccupancy: number;
  maxOccupancy: number;
}): Promise<ActionResult<{ id: string }>> {
  if (input.code.trim() === "" || input.name.trim() === "") {
    return { ok: false, error: "A room type needs a code and a name." };
  }
  if (input.maxOccupancy < input.baseOccupancy) {
    return { ok: false, error: "The maximum occupancy cannot be below the base." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_room_type", {
    p_id: input.id,
    p_code: input.code,
    p_name: input.name,
    p_base_occupancy: input.baseOccupancy,
    p_max_occupancy: input.maxOccupancy,
    p_sort_order: null,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}

/**
 * Rooms are made in runs. The client operates properties with up to ~1,800
 * rooms, and entering those one at a time is not a thing anyone would do.
 */
export async function createRooms(input: {
  roomTypeId: string;
  first: number;
  last: number;
  floor: number | null;
  prefix: string;
}): Promise<ActionResult<{ created: number }>> {
  if (!Number.isSafeInteger(input.first) || !Number.isSafeInteger(input.last)) {
    return { ok: false, error: "Give a run of whole room numbers." };
  }
  if (input.last < input.first) {
    return { ok: false, error: "Give the run lowest first." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_rooms", {
    p_room_type_id: input.roomTypeId,
    p_first: input.first,
    p_last: input.last,
    p_floor: input.floor,
    p_prefix: input.prefix,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { created: Number(data ?? 0) } };
}

/**
 * Marking a room clean.
 *
 * rooms.status was only ever set by check-in and check-out until now, so a
 * room went dirty on departure and stayed dirty for ever. Housekeeping can
 * call this one — they are the people holding the vacuum.
 */
export async function setRoomStatus(input: {
  roomId: string;
  status: RoomStatus;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_status", {
    p_room_id: input.roomId,
    p_status: input.status,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/reports/housekeeping");
  revalidatePath("/dashboard");
  revalidateSettings();
  return { ok: true, data: null };
}

export async function saveChannel(input: {
  id: string | null;
  code: string;
  name: string;
  kind: ChannelKind;
  commissionBps: number;
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  if (input.code.trim() === "" || input.name.trim() === "") {
    return { ok: false, error: "A booking source needs a code and a name." };
  }
  if (input.commissionBps < 0 || input.commissionBps > 10000) {
    return { ok: false, error: "Commission must be between 0 and 100 percent." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_channel", {
    p_id: input.id,
    p_code: input.code,
    p_name: input.name,
    p_kind: input.kind,
    p_commission_bps: input.commissionBps,
    p_is_active: input.isActive,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}

export async function saveTaxRate(input: {
  id: string | null;
  name: string;
  rateBps: number;
  inclusion: "inclusive" | "exclusive";
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "A tax rate needs a name." };
  }
  if (!Number.isSafeInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10000) {
    return { ok: false, error: "A tax rate must be between 0 and 100 percent." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_tax_rate", {
    p_id: input.id,
    p_name: input.name,
    p_rate_bps: input.rateBps,
    p_inclusion: input.inclusion,
    p_is_active: input.isActive,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}

/**
 * Changing a member of staff who already has a login.
 *
 * Creating one is not here: `staff_users.id` references `auth.users`, so a new
 * member of staff needs an auth account before a row can point at one, and
 * that is an invite flow with its own decisions about who may send one.
 */
export async function saveStaffUser(input: {
  id: string;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  if (input.fullName.trim() === "") {
    return { ok: false, error: "A member of staff needs a name." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_staff_user", {
    p_id: input.id,
    p_full_name: input.fullName,
    p_role: input.role,
    p_is_active: input.isActive,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}
