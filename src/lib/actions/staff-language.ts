"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  STAFF_LANG_COOKIE,
  isStaffLocale,
} from "@/lib/i18n/staff";
import type { ActionResult } from "@/lib/actions/cashier";

/**
 * Sets the staff app's language for this browser.
 *
 * Validated against the reference's twelve codes rather than trusted: the
 * value comes from the browser and lands in a cookie every server render
 * reads. Anything else is refused, not stored and ignored later.
 *
 * A year, because nobody wants to pick their language every morning, and
 * `lax` because it is only ever read on our own pages.
 */
export async function setStaffLanguage(
  lang: string,
): Promise<ActionResult<null>> {
  if (!isStaffLocale(lang)) {
    return { ok: false, error: "That language is not offered." };
  }

  const jar = await cookies();
  jar.set(STAFF_LANG_COOKIE, lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
  });

  // The frame is rendered by the (app) layout, so the whole layout re-renders.
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}
