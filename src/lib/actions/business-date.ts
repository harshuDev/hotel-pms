"use server";
import { localised, localisedAs } from "@/lib/i18n/localised";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";

export interface CloseDayResult {
  closedDate: string;
  nextDate: string;
}

/**
 * Runs the night audit: closes the open business date and opens the next one.
 * It posts no room charges (0125): a stay is charged when the guest checks
 * out.
 *
 * The RPC is the gate, not this action — it refuses anyone who is not an
 * administrator or manager, and refuses while a cashier shift is still open.
 *
 * IT NO LONGER MARKS ANYBODY A NO-SHOW (0064). It used to sweep every
 * confirmed booking whose arrival had been reached and nobody had checked in,
 * release its rooms and bill the first night. The client asked for that to be
 * a person's decision: "sometimes people arrive late because of a delayed
 * flight or whatever reason". The manual path is the booking screen's "Mark no
 * show", which calls the same `cancel_booking(..., p_no_show => true)` the
 * sweep called, so nothing was lost but the automatic trigger.
 *
 * A guest who never arrived is billed nothing — but their rooms stay held
 * until somebody acts.
 */
export async function closeBusinessDate(): Promise<
  ActionResult<CloseDayResult>
> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("close_business_date");

  if (error) {
    return { ok: false, error: await localisedAs("The day did not close", error.message) };
  }

  const row = (
    (data ?? []) as {
      closed_date: string;
      next_date: string;
    }[]
  )[0];

  if (!row) {
    return {
      ok: false,
      error: await localised("The day closed but returned no summary. Check the activity feed."),
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/cashier");
  revalidatePath("/bookings");

  return {
    ok: true,
    data: {
      closedDate: row.closed_date,
      nextDate: row.next_date,
    },
  };
}
