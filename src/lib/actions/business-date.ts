"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";

export interface CloseDayResult {
  closedDate: string;
  nextDate: string;
  roomChargesPosted: number;
  roomChargesCents: number;
  /** Confirmed bookings whose guest never arrived, released by this run. */
  noShowsMarked: number;
  /** The first night billed for each of them. Zero when no rate was loaded. */
  noShowFeesCents: number;
}

/**
 * Runs the night audit: records no-shows, posts the night's room charges,
 * closes the open business date and opens the next one, all in one
 * transaction.
 *
 * The RPC is the gate, not this action — it refuses anyone who is not an
 * administrator or manager, and refuses while a cashier shift is still open.
 *
 * The no-show step releases the rooms of any confirmed booking whose arrival
 * has been reached and who never checked in, and bills the first night. That
 * is money moving without anybody typing, so the dialog reports it rather than
 * letting it happen quietly.
 */
export async function closeBusinessDate(): Promise<
  ActionResult<CloseDayResult>
> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("close_business_date");

  if (error) {
    return { ok: false, error: `The day did not close: ${error.message}` };
  }

  const row = (
    (data ?? []) as {
      closed_date: string;
      next_date: string;
      room_charges_posted: number;
      room_charges_cents: number;
      no_shows_marked: number;
      no_show_fees_cents: number;
    }[]
  )[0];

  if (!row) {
    return {
      ok: false,
      error: "The day closed but returned no summary. Check the activity feed.",
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
      roomChargesPosted: row.room_charges_posted,
      roomChargesCents: row.room_charges_cents,
      noShowsMarked: row.no_shows_marked,
      noShowFeesCents: row.no_show_fees_cents,
    },
  };
}
