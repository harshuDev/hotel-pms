"use server";
import { localised } from "@/lib/i18n/localised";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";
import type { RpcName } from "@/lib/supabase/database";
import type { InventoryField, MealType } from "@/lib/types";
import type { MealPlan } from "@/lib/meal-plans";
import type { RatePlanExtra } from "@/lib/rate-plan-extras";

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
  /**
   * The Postgres function that sets it. Typed to the names the database
   * actually exposes, so a typo in this table is a compile error rather than
   * a PostgREST 404 the first time somebody edits that screen.
   */
  rpc: RpcName;
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
    return { ok: false, error: await localised("That is not something Inventory can set.") };
  }
  if (edit.roomTypeIds.length === 0) {
    return { ok: false, error: await localised("Pick at least one room type.") };
  }
  if (edit.to < edit.from) {
    return { ok: false, error: await localised("The last date must not be before the first.") };
  }
  if (spec.needsPlan && !edit.ratePlanId) {
    return { ok: false, error: await localised("Pick a rate plan first.") };
  }
  if (spec.kind !== "flag" && edit.value !== null) {
    if (typeof edit.value !== "number" || !Number.isSafeInteger(edit.value)) {
      return { ok: false, error: await localised("Enter a whole number, or leave it blank to clear.") };
    }
    if (edit.value < 0) {
      return { ok: false, error: await localised("That cannot be negative.") };
    }
    if (spec.kind === "nights" && edit.value === 0) {
      return { ok: false, error: await localised("A stay rule of zero nights means nothing. Leave it blank to clear it.") };
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

  if (error) return { ok: false, error: await localised(error.message) };

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
    return { ok: false, error: await localised("A rate plan needs a code and a name.") };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_rate_plan", {
    p_code: input.code,
    p_name: input.name,
    p_description: input.description || null,
    p_is_default: input.isDefault,
  });

  if (error) return { ok: false, error: await localised(error.message) };

  revalidatePath("/inventory", "layout");
  return { ok: true, data: { id: data as string } };
}

/**
 * Publishing a rate to the guest booking page.
 *
 * Its own action rather than part of a general rate plan editor, because what
 * it changes is who may see a price. A Corporate or wholesaler rate stays
 * invisible to strangers until somebody deliberately does this.
 */
export async function setRatePlanPublic(input: {
  ratePlanId: string;
  isPublic: boolean;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_rate_plan_public", {
    p_rate_plan_id: input.ratePlanId,
    p_is_public: input.isPublic,
  });

  if (error) return { ok: false, error: await localised(error.message) };

  revalidatePath("/inventory", "layout");
  // What a guest can see has changed.
  revalidatePath("/book", "layout");
  return { ok: true, data: null };
}

/**
 * What a rate plan includes.
 *
 * Takes the whole set rather than one meal at a time: "this plan is half
 * board" is one decision, and applying it as two calls leaves a moment where
 * the plan is bed and breakfast.
 */
export async function setRatePlanMeals(input: {
  ratePlanId: string;
  meals: MealType[];
}): Promise<ActionResult<{ count: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_rate_plan_meals", {
    p_rate_plan_id: input.ratePlanId,
    p_meals: input.meals,
  });

  if (error) return { ok: false, error: await localised(error.message) };

  revalidatePath("/inventory", "layout");
  revalidatePath("/reports/meal");
  return { ok: true, data: { count: Number(data ?? 0) } };
}

/**
 * The rate's Meal Type (0115): one of the reference's eight. Postgres turns it
 * into the meals it means, so the choice and `rate_plan_meals` never disagree;
 * `meals` is read only for Custom Meal Plan.
 */
export async function setRatePlanMealPlan(input: {
  ratePlanId: string;
  mealPlan: MealPlan;
  meals: MealType[];
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_rate_plan_meal_plan", {
    p_rate_plan_id: input.ratePlanId,
    p_meal_plan: input.mealPlan,
    p_meals: input.mealPlan === "custom" ? input.meals : null,
  });
  if (error) return { ok: false, error: await localised(error.message) };
  revalidatePath("/inventory", "layout");
  revalidatePath("/reports/meal");
  return { ok: true, data: null };
}

/**
 * Sell With Extras (0115): the whole set of catalog extras sold with the rate,
 * each with how it is charged (0118) -- added to the bill at check-in, each
 * night or at check-out, or included in the rate and split out of the room
 * charge.
 */
export async function setRatePlanExtras(input: {
  ratePlanId: string;
  extras: RatePlanExtra[];
}): Promise<ActionResult<null>> {
  for (const x of input.extras) {
    if (!Number.isSafeInteger(x.quantity) || x.quantity < 1 || x.quantity > 99) {
      return { ok: false, error: await localised("The quantity must be between 1 and 99") };
    }
    if (x.priceCents !== null && (!Number.isSafeInteger(x.priceCents) || x.priceCents < 0)) {
      return { ok: false, error: await localised("A price cannot be negative") };
    }
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_rate_plan_extras", {
    p_rate_plan_id: input.ratePlanId,
    p_extras: input.extras.map((x) => ({
      extra_id: x.extraId,
      posting: x.posting,
      frequency: x.posting === "added" && x.chargeOn === "each_night" ? "per_night" : x.frequency,
      per_unit: x.perUnit,
      quantity: x.quantity,
      price_cents: x.priceCents,
      charge_on: x.posting === "added" ? x.chargeOn ?? "each_night" : null,
    })),
  });
  if (error) return { ok: false, error: await localised(error.message) };
  revalidatePath("/settings");
  return { ok: true, data: null };
}

/**
 * What one included meal is worth.
 *
 * One meal at a time, unlike setRatePlanMeals(): "this plan is half board" and
 * "breakfast on it is worth £15" are different decisions, and bundling them
 * would mean re-stating the board type to re-price a breakfast.
 *
 * Null clears the value, which puts that meal back to being worth nothing and
 * posting nothing. This is the shipped state of every meal.
 *
 * Setting a value changes how the night audit posts from the next run onward:
 * the night's room charge splits into accommodation and food_beverage. Nothing
 * already posted moves — folio_items is append-only — so this does not restate
 * a figure any report has already shown.
 */
export async function setRatePlanMealValue(input: {
  ratePlanId: string;
  meal: MealType;
  valueCents: number | null;
}): Promise<ActionResult<null>> {
  if (input.valueCents !== null) {
    if (!Number.isSafeInteger(input.valueCents) || input.valueCents < 0) {
      return { ok: false, error: await localised("A meal cannot be worth less than nothing.") };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_rate_plan_meal_value", {
    p_rate_plan_id: input.ratePlanId,
    p_meal: input.meal,
    p_value_cents: input.valueCents,
  });

  if (error) return { ok: false, error: await localised(error.message) };

  revalidatePath("/inventory", "layout");
  revalidatePath("/reports/meal");
  // The split reaches every revenue figure from the next night audit.
  revalidatePath("/reports/financial");
  revalidatePath("/reports/extras");
  return { ok: true, data: null };
}

/**
 * Setting the rate on several (room type, rate plan) pairs at once.
 *
 * The Rates screen draws plans nested under room types, so a selection is a set
 * of pairs rather than a set of room types on one plan. `set_rates()` takes one
 * plan and an array of types, so this groups the selection by plan and makes
 * one call per plan — each its own transaction, exactly as applying to several
 * room types already was.
 *
 * It routes through `applyInventory()` rather than calling the RPC directly, so
 * the validation lives in one place: a negative rate is refused here the same
 * way it is on the nine single-field screens.
 */
export async function applyRates(edit: {
  pairs: { roomTypeId: string; ratePlanId: string }[];
  from: string;
  to: string;
  daysOfWeek: number[];
  /** Null clears the rate back to "not loaded", which is not zero. */
  value: number | null;
}): Promise<ActionResult<{ nightsWritten: number }>> {
  if (edit.pairs.length === 0) {
    return { ok: false, error: await localised("Tick at least one rate to apply this to.") };
  }

  const byPlan = new Map<string, string[]>();
  for (const pair of edit.pairs) {
    const list = byPlan.get(pair.ratePlanId);
    if (list) list.push(pair.roomTypeId);
    else byPlan.set(pair.ratePlanId, [pair.roomTypeId]);
  }

  let nightsWritten = 0;
  for (const [ratePlanId, roomTypeIds] of byPlan) {
    const result = await applyInventory({
      field: "rate",
      ratePlanId,
      // Duplicates would write the same night twice; harmless, but the count
      // would then overstate what was done.
      roomTypeIds: [...new Set(roomTypeIds)],
      from: edit.from,
      to: edit.to,
      daysOfWeek: edit.daysOfWeek,
      value: edit.value,
    });
    // Stop on the first refusal rather than pressing on: a half-applied bulk
    // edit is worse than one that says what went wrong and changed nothing
    // further.
    if (!result.ok) return result;
    nightsWritten += result.data.nightsWritten;
  }

  return { ok: true, data: { nightsWritten } };
}

/**
 * A price for a number of adults on one plan, over a range of nights (0110),
 * for the selected room types. Null clears it, which puts that party back on
 * the standard price -- not "not sold", which only the standard price says.
 */
export async function applyOccupancyRates(edit: {
  pairs: { roomTypeId: string; ratePlanId: string }[];
  from: string;
  to: string;
  daysOfWeek: number[];
  adults: number;
  value: number | null;
}): Promise<ActionResult<{ nightsWritten: number }>> {
  if (edit.pairs.length === 0) {
    return { ok: false, error: await localised("Tick at least one rate to apply this to.") };
  }
  if (edit.to < edit.from) {
    return { ok: false, error: await localised("The last date must not be before the first.") };
  }
  if (edit.value !== null && (!Number.isSafeInteger(edit.value) || edit.value < 0)) {
    return { ok: false, error: await localised("That is not an amount. Try 120 or 120.50.") };
  }
  const byPlan = new Map<string, string[]>();
  for (const pair of edit.pairs) {
    byPlan.set(pair.ratePlanId, [...(byPlan.get(pair.ratePlanId) ?? []), pair.roomTypeId]);
  }
  const supabase = await createClient();
  let nightsWritten = 0;
  for (const [ratePlanId, roomTypeIds] of byPlan) {
    const { data, error } = await supabase.rpc("set_occupancy_rates", {
      p_rate_plan_id: ratePlanId,
      p_room_type_ids: [...new Set(roomTypeIds)],
      p_from: edit.from,
      p_to: edit.to,
      p_days_of_week: edit.daysOfWeek.length > 0 ? edit.daysOfWeek : null,
      p_adults: edit.adults,
      p_rate_cents: edit.value,
    });
    if (error) return { ok: false, error: await localised(error.message) };
    nightsWritten += Number(data ?? 0);
  }
  revalidatePath("/inventory", "layout");
  revalidatePath("/bookings/new");
  return { ok: true, data: { nightsWritten } };
}
