"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";

/**
 * The guest booking page.
 *
 * These are the only calls in the codebase made without a staff session. They
 * reach four security definer RPCs granted to `anon` and nothing else — no
 * table, no view, none of the staff functions. The property is named in every
 * call because current_property_id() is null for a guest, and 0034 deliberately
 * did not teach it otherwise.
 *
 * Everything that decides whether a stay can be sold — availability, the stay
 * rules, whether a rate is published, whether a price exists — is decided in
 * Postgres inside the booking transaction. What is below only carries the
 * answer to the page.
 */

export interface PublicProperty {
  propertyId: string;
  name: string;
  currency: string;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export interface PublicRatePlan {
  ratePlanId: string;
  code: string;
  name: string;
  description: string | null;
  /**
   * The cancellation terms, which a guest has to be shown BEFORE they agree
   * to them (0060). Null when the hotel has set no policy on this rate —
   * which is "not set" and is deliberately NOT drawn as free cancellation.
   *
   * The name and description are the hotel's own words and are not
   * translated; only the label around them is.
   */
  cancellationName: string | null;
  cancellationKind: "flexible" | "non_refundable" | null;
  cancellationFreeDays: number | null;
  cancellationDescription: string | null;
}

export interface PublicRoomType {
  roomTypeId: string;
  code: string;
  name: string;
  baseOccupancy: number;
  maxOccupancy: number;
  available: number;
  nights: number;
  /** Null when a night of the stay has no rate loaded. Not the same as free. */
  totalCents: number | null;
  /** Why this stay cannot be sold, as a sentence, or null when it can. */
  unavailableReason: string | null;
}

export async function getPublicProperty(
  propertyId: string,
): Promise<PublicProperty | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_property", {
    p_property_id: propertyId,
  });

  if (error || !data || data.length === 0) return null;

  const row = data[0];
  return {
    propertyId: row.property_id,
    name: row.name,
    currency: row.currency,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
  };
}

export async function getPublicRatePlans(
  propertyId: string,
): Promise<PublicRatePlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_rate_plans", {
    p_property_id: propertyId,
  });

  if (error) return [];

  return (data ?? []).map((row) => ({
    ratePlanId: row.rate_plan_id,
    code: row.code,
    name: row.name,
    description: row.description,
    cancellationName: row.cancellation_name,
    cancellationKind: row.cancellation_kind,
    cancellationFreeDays: row.cancellation_free_days,
    cancellationDescription: row.cancellation_description,
  }));
}

export async function searchPublicRooms(input: {
  propertyId: string;
  ratePlanId: string;
  from: string;
  to: string;
}): Promise<ActionResult<PublicRoomType[]>> {
  if (input.to <= input.from) {
    return { ok: false, error: "Departure must be after arrival." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_room_types", {
    p_property_id: input.propertyId,
    p_rate_plan_id: input.ratePlanId,
    p_from: input.from,
    p_to: input.to,
  });

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      roomTypeId: row.room_type_id,
      code: row.code,
      name: row.name,
      baseOccupancy: row.base_occupancy,
      maxOccupancy: row.max_occupancy,
      available: Number(row.available ?? 0),
      nights: row.nights,
      totalCents: row.total_cents === null ? null : Number(row.total_cents),
      unavailableReason: row.unavailable_reason,
    })),
  };
}

export async function requestPublicBooking(input: {
  propertyId: string;
  ratePlanId: string;
  roomTypeId: string;
  from: string;
  to: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  adults: number;
  children: number;
  notes: string;
}): Promise<ActionResult<{ reference: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_public_booking", {
    p_property_id: input.propertyId,
    p_rate_plan_id: input.ratePlanId,
    p_room_type_id: input.roomTypeId,
    p_check_in: input.from,
    p_check_out: input.to,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_email: input.email,
    p_phone: input.phone || null,
    p_adults: input.adults,
    p_children: input.children,
    p_notes: input.notes || null,
  });

  // The refusals are sentences written for a guest, so they are passed through
  // rather than replaced. HP001 and HP002 arrive here as ordinary messages.
  if (error) return { ok: false, error: error.message };

  const row = (data ?? [])[0];
  if (!row) return { ok: false, error: "The booking did not go through." };

  return { ok: true, data: { reference: row.reference } };
}
