"use server";

import { revalidatePath } from "next/cache";
import { localised } from "@/lib/i18n/localised";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";
import type { StaffRole } from "@/lib/types";

/*
 * The platform team's actions (0135): move between hotels, add a hotel, and
 * put an invited login on a hotel's staff. Postgres decides who may do each;
 * these only carry the request and the refusal.
 *
 * Switching or creating a hotel changes what current_property_id() returns,
 * so every screen has to be read again -- hence the whole layout.
 */

export async function switchProperty(propertyId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("switch_property", { p_property_id: propertyId });
  if (error) return { ok: false, error: await localised(error.message) };

  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

export async function createProperty(input: {
  name: string;
  country: string;
  currency: string;
  timezone: string;
}): Promise<ActionResult<{ id: string }>> {
  if (input.name.trim() === "") {
    return { ok: false, error: await localised("A hotel needs a name") };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_property", {
    p_name: input.name,
    p_country: input.country,
    p_currency: input.currency,
    p_timezone: input.timezone,
  });
  if (error) return { ok: false, error: await localised(error.message) };

  revalidatePath("/", "layout");
  return { ok: true, data: { id: data as string } };
}

export async function addStaffMember(input: {
  email: string;
  fullName: string;
  role: StaffRole;
}): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_staff_by_email", {
    p_email: input.email,
    p_full_name: input.fullName,
    p_role: input.role,
  });
  if (error) return { ok: false, error: await localised(error.message) };

  revalidatePath("/settings", "layout");
  return { ok: true, data: { id: data as string } };
}
