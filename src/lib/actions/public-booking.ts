"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions/cashier";
import type { HotelPolicies } from "@/lib/hotel-policies";
import type { FacilityIcon } from "@/lib/facilities";
import { resolveLanguageSettings, type LanguageSettings } from "@/lib/language-settings";

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
  /** The hotel's own zone, so "today" on the calendar is the hotel's today. */
  timezone: string;
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
    currency: row.currency.trim(),
    timezone: row.timezone,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
  };
}

/**
 * Which languages the hotel offers its guests, and which one they land on
 * (0078). A failed read falls back to every language and English, which is
 * what the page did before the setting existed -- a guest should never lose
 * the booking page over a preference.
 */
export async function getPublicLanguageSettings(propertyId: string): Promise<LanguageSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_language_settings", {
    p_property_id: propertyId,
  });
  if (error) return resolveLanguageSettings(null);
  return resolveLanguageSettings(data?.[0]);
}

/**
 * The hotel's policies, for the guest (0071). Null when the hotel has never
 * saved them -- which the page draws as nothing at all, rather than as a
 * policy the hotel did not state.
 */
export async function getPublicHotelPolicies(
  propertyId: string,
): Promise<HotelPolicies | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_hotel_policies", {
    p_property_id: propertyId,
  });
  if (error || !data || data.length === 0) return null;
  const r = data[0];
  return {
    children: r.children,
    childrenCustom: r.children_custom,
    pets: r.pets,
    petsCustom: r.pets_custom,
    smoking: r.smoking,
    smokingCustom: r.smoking_custom,
    internet: r.internet,
    internetCustom: r.internet_custom,
    parking: r.parking,
    parkingCustom: r.parking_custom,
    otherPolicies: r.other_policies,
  };
}

export interface PublicFacility {
  title: string;
  icon: FacilityIcon;
}

/**
 * Each room type's facilities (0071), keyed by room type. Titles are the
 * hotel's own words and are not translated, like its cancellation wording.
 */
export async function getPublicRoomTypeFacilities(
  propertyId: string,
): Promise<Record<string, PublicFacility[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_room_type_facilities", {
    p_property_id: propertyId,
  });
  if (error || !data) return {};
  const byType: Record<string, PublicFacility[]> = {};
  for (const row of data) {
    (byType[row.room_type_id] ??= []).push({
      title: row.title,
      icon: row.icon as FacilityIcon,
    });
  }
  return byType;
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

/**
 * What the guest page shows about each room type beyond its name (0072): the
 * hotel's description and the photographs of its rooms, as public URLs. The
 * bucket is public and the path is resolved against it, so nothing in the
 * column can point the browser anywhere else.
 */
export interface PublicRoomContent {
  description: string | null;
  photos: string[];
}

export async function getPublicRoomTypeContent(
  propertyId: string,
): Promise<Record<string, PublicRoomContent>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_room_type_content", {
    p_property_id: propertyId,
  });
  if (error || !data) return {};
  const byType: Record<string, PublicRoomContent> = {};
  for (const row of data) {
    byType[row.room_type_id] = {
      description: row.description,
      photos: (row.photo_paths ?? []).map(
        (path: string) => supabase.storage.from("room-photos").getPublicUrl(path).data.publicUrl,
      ),
    };
  }
  return byType;
}

/** One room type for a stay, priced on every published rate plan. */
export interface PublicStayRoom {
  roomTypeId: string;
  name: string;
  baseOccupancy: number;
  maxOccupancy: number;
  available: number;
  nights: number;
  offers: {
    ratePlanId: string;
    /** Null when a night has no rate on this plan. Not the same as free. */
    totalCents: number | null;
    /** Why this stay cannot be sold on this plan, as a sentence, or null. */
    unavailableReason: string | null;
  }[];
}

/**
 * The rebuilt page's step 2 and 3 in one round trip: every room type for the
 * dates, with its total on each published plan. Step 2 shows the cheapest
 * sellable one as "From"; step 3 lists them all. Availability and every rule
 * are still decided by public_room_types() -- this only asks it once per plan
 * and puts the answers side by side.
 */
export async function searchPublicStay(input: {
  propertyId: string;
  from: string;
  to: string;
}): Promise<ActionResult<PublicStayRoom[]>> {
  if (input.to <= input.from) {
    return { ok: false, error: "Departure must be after arrival." };
  }
  const plans = await getPublicRatePlans(input.propertyId);
  if (plans.length === 0) return { ok: true, data: [] };

  const supabase = await createClient();
  const results = await Promise.all(
    plans.map((plan) =>
      supabase.rpc("public_room_types", {
        p_property_id: input.propertyId,
        p_rate_plan_id: plan.ratePlanId,
        p_from: input.from,
        p_to: input.to,
      }),
    ),
  );

  const byType = new Map<string, PublicStayRoom>();
  for (let i = 0; i < plans.length; i++) {
    const { data, error } = results[i];
    if (error) return { ok: false, error: error.message };
    for (const row of data ?? []) {
      let room = byType.get(row.room_type_id);
      if (!room) {
        room = {
          roomTypeId: row.room_type_id,
          name: row.name,
          baseOccupancy: row.base_occupancy,
          maxOccupancy: row.max_occupancy,
          available: Number(row.available ?? 0),
          nights: row.nights,
          offers: [],
        };
        byType.set(row.room_type_id, room);
      }
      room.offers.push({
        ratePlanId: plans[i].ratePlanId,
        totalCents: row.total_cents === null ? null : Number(row.total_cents),
        unavailableReason: row.unavailable_reason,
      });
    }
  }
  return { ok: true, data: [...byType.values()] };
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
