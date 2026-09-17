"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";
import type { PromotionKind } from "@/lib/types";

/**
 * Setting up a promotion.
 *
 * The value that matters depends on the kind — a percentage, a fixed amount,
 * or a pair of night counts — so the ones that do not apply are sent as null
 * rather than as zero. A zero percent promotion and no percent at all are
 * different things, and the check constraint in Postgres refuses the first.
 */

export interface PromotionInput {
  id: string | null;
  name: string;
  code: string;
  description: string;
  kind: PromotionKind;
  percentBps: number | null;
  amountOffCents: number | null;
  freeNights: number | null;
  paidNights: number | null;
  sellFrom: string;
  sellTo: string;
  stayFrom: string;
  stayTo: string;
  minNights: number | null;
  maxNights: number | null;
  minAdvanceDays: number | null;
  maxAdvanceDays: number | null;
  arrivalDaysOfWeek: number[];
  ratePlanIds: string[];
  roomTypeIds: string[];
  priority: number;
  isActive: boolean;
}

export async function savePromotion(
  input: PromotionInput,
): Promise<ActionResult<{ id: string }>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "Give the promotion a name." };
  }

  switch (input.kind) {
    case "percent_off":
      if (!input.percentBps || input.percentBps <= 0 || input.percentBps > 10000) {
        return { ok: false, error: "Enter a percentage between 0 and 100." };
      }
      break;
    case "amount_off":
      if (!input.amountOffCents || input.amountOffCents <= 0) {
        return { ok: false, error: "Enter how much comes off each night." };
      }
      break;
    case "free_nights":
      if (!input.freeNights || input.freeNights <= 0 || !input.paidNights || input.paidNights <= 0) {
        return { ok: false, error: "Enter how many nights are paid for and how many are free." };
      }
      break;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_promotion", {
    p_id: input.id,
    p_name: input.name,
    p_code: input.code || null,
    p_description: input.description || null,
    p_kind: input.kind,
    p_percent_bps: input.kind === "percent_off" ? input.percentBps : null,
    p_amount_off_cents: input.kind === "amount_off" ? input.amountOffCents : null,
    p_free_nights: input.kind === "free_nights" ? input.freeNights : null,
    p_paid_nights: input.kind === "free_nights" ? input.paidNights : null,
    p_sell_from: input.sellFrom || null,
    p_sell_to: input.sellTo || null,
    p_stay_from: input.stayFrom || null,
    p_stay_to: input.stayTo || null,
    p_min_nights: input.minNights,
    p_max_nights: input.maxNights,
    p_min_advance_days: input.minAdvanceDays,
    p_max_advance_days: input.maxAdvanceDays,
    p_arrival_days_of_week:
      input.arrivalDaysOfWeek.length > 0 ? input.arrivalDaysOfWeek : null,
    p_rate_plan_ids: input.ratePlanIds.length > 0 ? input.ratePlanIds : null,
    p_room_type_ids: input.roomTypeIds.length > 0 ? input.roomTypeIds : null,
    p_priority: input.priority,
    p_is_active: input.isActive,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/offers");
  revalidatePath("/bookings/new");
  return { ok: true, data: { id: data as string } };
}
