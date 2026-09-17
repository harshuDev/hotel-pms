"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session and returns to the sign-in page.
 *
 * A Server Action, not a Server Component, because it has to clear the auth
 * cookies — which is exactly what a Server Component cannot do.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
