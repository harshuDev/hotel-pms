"use server";
import { localised } from "@/lib/i18n/localised";
import { cookies } from "next/headers";
import { STAFF_LOCALE_COOKIE, isStaffLocale } from "@/lib/i18n/staff-locales";

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
    return { ok: false, error: await localised("Your name cannot be blank.") };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_own_profile", {
    p_full_name: input.fullName,
  });

  if (error) return { ok: false, error: await localised(error.message) };

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

/**
 * The language the staff app is read in, for the signed-in person (0106).
 * Saved on their own row, so it follows them to any machine, and left in a
 * cookie, so /login on this browser opens in it before anybody signs in.
 * The caller reloads the page, which is what the confirmation says will
 * happen: every Server Component on screen is re-rendered in the new language.
 */
export async function saveOwnLocale(locale: string): Promise<ActionResult<null>> {
  if (!isStaffLocale(locale)) {
    return { ok: false, error: await localised("Choose a language from the list") };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_own_locale", { p_locale: locale });
  if (error) return { ok: false, error: await localised(error.message) };

  (await cookies()).set(STAFF_LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}
