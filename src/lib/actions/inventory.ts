"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";
import type { InventoryField } from "@/lib/types";

/**
 * Inventory writes.
 *
 * Every screen is a bulk edit over a date range, a set of room types and an
 * optional set of weekdays, because "min stay two on every Friday and Saturday
 * until March" is the actual job. Setting one cell is that with a one-day
 * range, so there is no second path for it.
 *
 * The field comes from the browser, so it never reaches SQL: it selects one of
 * nine named RPCs from a table declared here. Nothing is interpolated.
 */

interface FieldSpec {
  /** The Postgres function that sets it. */
  rpc: string;
  /** The value parameter that function takes. */
  param: string;
  /** Whether the write belongs to a rate plan or to the room type itself. */
  needsPlan: boolean;
  kind: "money" | "nights" | "count" | "flag";
}

const FIELDS: Record<InventoryField, FieldSpec> = {
  rate: { rpc: "set_rates", param: "p_rate_cents", needsPlan: true, kind: "money" },
  min_stay_through: {
    rpc: "set_min_stay_through",
    param: "p_min_stay_through",
    needsPlan: true,
    kind: "nights",
  },
  min_stay_arrival: {
    rpc: "set_min_stay_arrival",
    param: "p_min_stay_arrival",
    needsPlan: true,
    kind: "nights",
  },
  max_stay: { rpc: "set_max_stay", param: "p_max_stay", needsPlan: true, kind: "nights" },
  closed_to_arrival: {
    rpc: "set_closed_to_arrival",
    param: "p_closed_to_arrival",
    needsPlan: true,
    kind: "flag",
  },
  closed_to_departure: {
    rpc: "set_closed_to_departure",
    param: "p_closed_to_departure",
    needsPlan: true,
    kind: "flag",
  },
  stop_sell: { rpc: "set_stop_sell", param: "p_stop_sell", needsPlan: true, kind: "flag" },
  allotment: {
    rpc: "set_allotment",
    param: "p_allotment",
    needsPlan: false,
    kind: "count",
  },
  close_out: {
    rpc: "set_close_out",
    param: "p_close_out",
    needsPlan: false,
    kind: "flag",
  },
};

export interface InventoryEdit {
  field: InventoryField;
  ratePlanId: string | null;
  roomTypeIds: string[];
  from: string;
  to: string;
  /** Postgres numbering: 0 Sunday to 6 Saturday. Empty means every day. */
  daysOfWeek: number[];
  /** Null clears the value, which for a rule means "no rule". */
  value: number | boolean | null;
}

export async function applyInventory(
  edit: InventoryEdit,
): Promise<ActionResult<{ nightsWritten: number }>> {
  const spec = FIELDS[edit.field];
  if (!spec) {
    return { ok: false, error: "That is not something Inventory can set." };
  }
  if (edit.roomTypeIds.length === 0) {
    return { ok: false, error: "Pick at least one room type." };
  }
  if (edit.to < edit.from) {
    return { ok: false, error: "The last date must not be before the first." };
  }
  if (spec.needsPlan && !edit.ratePlanId) {
    return { ok: false, error: "Pick a rate plan first." };
  }
  if (spec.kind !== "flag" && edit.value !== null) {
    if (typeof edit.value !== "number" || !Number.isSafeInteger(edit.value)) {
      return { ok: false, error: "Enter a whole number, or leave it blank to clear." };
    }
    if (edit.value < 0) {
      return { ok: false, error: "That cannot be negative." };
    }
    if (spec.kind === "nights" && edit.value === 0) {
      return { ok: false, error: "A stay rule of zero nights means nothing. Leave it blank to clear it." };
    }
  }

  const supabase = await createClient();

  const args: Record<string, unknown> = {
    p_room_type_ids: edit.roomTypeIds,
    p_from: edit.from,
    p_to: edit.to,
    p_days_of_week: edit.daysOfWeek.length > 0 ? edit.daysOfWeek : null,
    [spec.param]: spec.kind === "flag" ? Boolean(edit.value) : edit.value,
  };
  if (spec.needsPlan) args.p_rate_plan_id = edit.ratePlanId;

  const { data, error } = await supabase.rpc(spec.rpc, args);

  if (error) return { ok: false, error: error.message };

  // Everything downstream of a price or a closed date.
  revalidatePath("/inventory", "layout");
  revalidatePath("/calendar");
  revalidatePath("/bookings/new");

  return { ok: true, data: { nightsWritten: Number(data ?? 0) } };
}

export async function createRatePlan(input: {
  code: string;
  name: string;
  description: string;
  isDefault: boolean;
}): Promise<ActionResult<{ id: string }>> {
  if (input.code.trim() === "" || input.name.trim() === "") {
    return { ok: false, error: "A rate plan needs a code and a name." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_rate_plan", {
    p_code: input.code,
    p_name: input.name,
    p_description: input.description || null,
    p_is_default: input.isDefault,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/inventory", "layout");
  return { ok: true, data: { id: data as string } };
}
