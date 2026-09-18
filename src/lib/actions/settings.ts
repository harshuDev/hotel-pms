"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";
import type {
  ChannelKind,
  PaymentMethodKind,
  RoomStatus,
  StaffRole,
} from "@/lib/types";

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
 * Correcting one room.
 *
 * createRooms() makes them in runs and nothing could touch one afterwards, so a
 * number typed wrong, a room on the wrong type or a missing floor meant going
 * back to SQL. Moving a room to another type is safe: booking_rooms carries its
 * own room_type_id, so no booking, rate or night row is rewritten by the move.
 *
 * There is no delete. A room that reservations point at cannot be removed
 * without taking their history with it, and a room out of service is `ooo`,
 * which is what that status is for.
 */
export async function saveRoom(input: {
  id: string | null;
  number: string;
  roomTypeId: string;
  floor: number | null;
}): Promise<ActionResult<{ id: string }>> {
  if (input.number.trim() === "") {
    return { ok: false, error: "A room needs a number." };
  }
  if (input.roomTypeId === "") {
    return { ok: false, error: "Pick the room type this room belongs to." };
  }
  if (input.floor !== null && !Number.isSafeInteger(input.floor)) {
    return { ok: false, error: "A floor is a whole number, or leave it blank." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_room", {
    p_id: input.id,
    p_number: input.number,
    p_room_type_id: input.roomTypeId,
    p_floor: input.floor,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}

/**
 * Payment methods.
 *
 * affects_drawer is not passed and is not a choice: a check constraint on the
 * table ties it to the kind — cash touches physical cash, nothing else does —
 * and the whole blind count rests on that being true. The kind itself is frozen
 * by Postgres once payments exist against the method.
 *
 * There is no delete either. A method a payment points at cannot go without
 * taking the payment with it, so retiring one is `isActive: false`, which every
 * other read of the table already filters on.
 */
export async function savePaymentMethod(input: {
  id: string | null;
  name: string;
  kind: PaymentMethodKind;
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "A payment method needs a name." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_payment_method", {
    p_id: input.id,
    p_name: input.name,
    p_kind: input.kind,
    p_is_active: input.isActive,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  // What the cashier may take a payment by has changed.
  revalidatePath("/cashier");
  return { ok: true, data: { id: data as string } };
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
/**
 * A season: a named date range that labels the calendar.
 *
 * It changes no price. Pricing is `rate_plan_days` and stays there — a season
 * that quietly moved rates would be a second price list nobody could see.
 *
 * Seasons may not overlap, which Postgres enforces with an exclusion
 * constraint rather than this action: two bands over one date has no sensible
 * drawing, and the rule belongs where every writer meets it.
 */
export async function saveSeason(input: {
  id: string | null;
  name: string;
  startsOn: string;
  endsOn: string;
}): Promise<ActionResult<{ id: string }>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "A season needs a name." };
  }
  if (!input.startsOn || !input.endsOn) {
    return { ok: false, error: "A season needs a first and a last day." };
  }
  if (input.endsOn < input.startsOn) {
    return { ok: false, error: "A season cannot end before it starts." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_season", {
    p_name: input.name,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_id: input.id,
  });

  if (error) {
    // The exclusion constraint is the likely refusal, and its raw text names a
    // constraint rather than the thing the manager did.
    if (error.message.includes("seasons_no_overlap")) {
      return {
        ok: false,
        error: "Those dates overlap a season that already exists. Seasons cannot overlap.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: { id: data as string } };
}

/**
 * Unlike a room, a room type or a tax rate, a season really is deleted.
 * Nothing points at one — it is a label over dates — so removing it loses no
 * history and there is nothing to retire it from.
 */
export async function deleteSeason(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_season", { p_id: id });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

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
