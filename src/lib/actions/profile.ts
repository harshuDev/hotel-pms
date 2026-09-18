"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";

/**
 * Your own account.
 *
 * Distinct from `saveStaffUser`, which is how an administrator changes somebody
 * else and can move their role. This one reaches a single column on a single
 * row — your own name — and the RPC behind it takes no role parameter at all,
 * so it cannot be the path to a promotion.
 */
export async function saveOwnProfile(input: {
  fullName: string;
}): Promise<ActionResult<null>> {
  if (input.fullName.trim() === "") {
    return { ok: false, error: "Your name cannot be blank." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_own_profile", {
    p_full_name: input.fullName,
  });

  if (error) return { ok: false, error: error.message };

  // The name is in the top bar on every screen.
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/**
 * Throw away the server's cached render of every screen.
 *
 * Reads are Server Components, so a figure on the dashboard can be a few
 * moments behind a change somebody else made — or behind a night audit run on
 * the machine next door. This is the "I do not believe what I am looking at"
 * button a front desk reaches for, and it beats teaching people to hard-reload.
 */
export async function clearCache(): Promise<ActionResult<null>> {
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}
