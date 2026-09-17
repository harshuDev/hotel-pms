"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";

/**
 * Marks the feed read up to now for the signed-in member of staff.
 *
 * One timestamp each, so clearing your feed does not clear anyone else's.
 */
export async function markActivitySeen(): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("mark_activity_seen");

  if (error) {
    return { ok: false, error: `The feed was not cleared: ${error.message}` };
  }

  revalidatePath("/dashboard");
  return { ok: true, data: null };
}
