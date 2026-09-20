"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ROOM_PHOTO_BUCKET } from "@/lib/queries";
import type { ActionResult } from "@/lib/actions/cashier";
import type {
  CancellationPolicyKind,
  HousekeepingChoice,
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
 * Deleting a room.
 *
 * The rule used to be that there is no delete for a room at all, on the
 * grounds that `booking_rooms` points at one under `on delete restrict`. That
 * is still true of a room somebody has stayed in, and `delete_room()` refuses
 * those by name. It is not true of a room that has never been booked — a run
 * of 60 entered as 50, a number typed wrong, a cupboard counted as sellable —
 * and those are the rooms a hotel actually wants rid of.
 *
 * The photograph goes with it. Nothing points at the object once the row is
 * gone, so leaving it would be a file in a bucket that no screen can ever
 * show or remove.
 */
export async function deleteRoom(
  roomId: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  /*
   * Read the path BEFORE the row goes, and read it from the database rather
   * than taking it from the browser: a path sent up with the request could
   * name another room's photograph, and the storage policy — which only
   * checks the property — would happily delete it.
   */
  const { data: room } = await supabase
    .from("rooms")
    .select("photo_path")
    .eq("id", roomId)
    .maybeSingle();

  const { error } = await supabase.rpc("delete_room", { p_room_id: roomId });
  if (error) return { ok: false, error: error.message };

  if (room?.photo_path) {
    // Best effort, and deliberately not fatal: the room is already gone, and
    // failing the whole action over a leftover file would report a delete
    // that did happen as one that did not.
    await supabase.storage.from(ROOM_PHOTO_BUCKET).remove([room.photo_path]);
  }

  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: { id: roomId } };
}

/**
 * Recording which uploaded file is a room's photograph, or taking it off.
 *
 * The upload itself happens in the browser, straight to Supabase Storage under
 * the signed-in user's session, so the storage policy decides whether it is
 * allowed. Nothing here holds a service key and nothing bypasses RLS.
 *
 * `set_room_photo()` then checks the path really is under this property and
 * this room before it stores it — the browser chose the name, so the database
 * does not take its word for it.
 */
export async function setRoomPhoto(input: {
  roomId: string;
  /** The new object path, or null to take the photograph off. */
  path: string | null;
  /** The path being replaced, so the old file does not linger in the bucket. */
  previousPath: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_room_photo", {
    p_room_id: input.roomId,
    p_photo_path: input.path,
  });

  if (error) return { ok: false, error: error.message };

  if (input.previousPath && input.previousPath !== input.path) {
    await supabase.storage.from(ROOM_PHOTO_BUCKET).remove([input.previousPath]);
  }

  revalidateSettings();
  return { ok: true, data: { id: input.roomId } };
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
  // The calendar rail draws a dot per room and a summary dot per type, and
  // the status is settable from that rail now, so the board has to move too.
  revalidatePath("/calendar");
  revalidateSettings();
  return { ok: true, data: null };
}

/**
 * The housekeeping menu on the calendar rail (0062).
 *
 * One call for the four points on the clean-to-broken scale, because that is
 * one decision at a front desk. The mapping from a choice to a status plus its
 * inspected flag lives in Postgres, so the menu and the data cannot drift.
 *
 * ONLY "broken" CHANGES WHAT THE HOTEL CAN SELL — it is `ooo`. Clean, dirty
 * and inspected are information for reception and housekeeping, exactly as the
 * client described, and move no availability figure.
 */
export async function setRoomHousekeeping(input: {
  roomId: string;
  choice: HousekeepingChoice;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_housekeeping", {
    p_room_id: input.roomId,
    p_choice: input.choice,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/reports/housekeeping");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidateSettings();
  return { ok: true, data: null };
}

/**
 * The guest's own request, which is not a point on that scale.
 *
 * Its own action because it is a toggle on an OCCUPIED room rather than a
 * state of the room's cleanliness — "set this room to do not disturb" would
 * otherwise have to answer "and is it clean?", which has no sensible answer.
 * Postgres refuses it on a room with nobody in it.
 */
export async function setRoomDoNotDisturb(
  roomId: string,
  on: boolean,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_do_not_disturb", {
    p_room_id: roomId,
    p_on: on,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/reports/housekeeping");
  revalidatePath("/calendar");
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

/**
 * Creating and correcting a rate plan.
 *
 * A hotel sells several: Room Only, Bed and Breakfast, Non-refundable. Until
 * 0054 one could be created — from a corner of the Inventory screen — and never
 * renamed, retired or reordered, which is why the hosted property has exactly
 * one. Rate plans belong in Settings with the room types and the tax rates,
 * because setting them up is part of setting up the property rather than part
 * of pricing a week.
 *
 * There is no delete, for the same reason there is none for a room or a tax
 * rate: `rate_plan_days` and `booking_rooms` point at a plan, so one no longer
 * sold is `is_active = false`. A booking taken on it keeps saying what it was
 * sold on.
 */
export async function saveRatePlan(input: {
  id: string | null;
  code: string;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_rate_plan", {
    p_code: input.code,
    p_name: input.name,
    p_description: input.description.trim() || null,
    p_is_default: input.isDefault,
    p_is_active: input.isActive,
    p_id: input.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  // Every Inventory screen reads the plans, and the Rates grid draws a row per
  // plan per room type, so it moves the moment one is added or retired.
  revalidatePath("/inventory", "layout");
  return { ok: true, data: { id: data as string } };
}

/**
 * A cancellation policy (0060).
 *
 * Thin, like every other write here: the role gate is the RLS policy on
 * `cancellation_policies`, so it applies however the row is written rather
 * than only when it is written through this file.
 *
 * There is no delete. `rate_plans.cancellation_policy_id` points at a policy
 * under `on delete restrict`, and a booking taken on one keeps meaning what it
 * was sold under, so a policy no longer offered is retired.
 */
export async function saveCancellationPolicy(input: {
  id: string | null;
  name: string;
  kind: CancellationPolicyKind;
  /** Flexible only. Ignored by the RPC on a non-refundable policy. */
  freeCancellationDays: number | null;
  description: string;
  isActive: boolean;
  sortOrder: number;
}): Promise<ActionResult<{ id: string }>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "Give the policy a name the guest will read." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_cancellation_policy", {
    p_name: input.name,
    p_kind: input.kind,
    p_free_cancellation_days:
      input.kind === "flexible" ? (input.freeCancellationDays ?? 0) : null,
    p_description: input.description.trim() || null,
    p_is_active: input.isActive,
    p_sort_order: input.sortOrder,
    p_id: input.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  // The guest booking page quotes the terms, and a booking screen reads them.
  revalidatePath("/book", "layout");
  revalidatePath("/bookings", "layout");
  return { ok: true, data: { id: data as string } };
}

/**
 * Which policy a rate is sold on.
 *
 * Its own action rather than a field on `saveRatePlan()`, matching the RPC:
 * an optional parameter there would be an overload for PostgREST to choose
 * between, and renaming a plan would otherwise say "and no cancellation
 * policy" unless the form remembered to send it back. Null clears it.
 */
export async function setRatePlanCancellationPolicy(
  ratePlanId: string,
  cancellationPolicyId: string | null,
): Promise<ActionResult<null>> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_rate_plan_cancellation_policy", {
    p_rate_plan_id: ratePlanId,
    p_cancellation_policy_id: cancellationPolicyId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  revalidatePath("/inventory", "layout");
  revalidatePath("/book", "layout");
  revalidatePath("/bookings", "layout");
  return { ok: true, data: null };
}
