"use server";

import type { InventoryVisibility } from "@/lib/inventory-settings";
import type { CancellationTerms } from "@/lib/cancellation-policy";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { nullableArg } from "@/lib/supabase/database";
import { ROOM_PHOTO_BUCKET } from "@/lib/queries";
import { parseMoney } from "@/lib/money";
import type { ActionResult } from "@/lib/actions/cashier";
import type { HotelPolicies } from "@/lib/hotel-policies";
import type { ExtraItemType } from "@/lib/extras";
import type { FacilityIcon } from "@/lib/facilities";
import type { GuestFieldKind } from "@/lib/guest-config";
import type { CalendarSettings } from "@/lib/calendar-settings";
import { HOTEL_ASSETS_BUCKET } from "@/lib/invoice-settings";
import type {
  HousekeepingChoice,
  ChannelKind,
  PaymentMethodKind,
  RoomStatus,
  StaffRole,
} from "@/lib/types";

/**
 * Setting a property up.
 *
 * Everything here had to be inserted by hand in SQL until now, which is why a
 * fresh property could not be made usable from the application at all. Each of
 * these is a thin wrapper: the role gates and the refusals live in Postgres,
 * where they apply however the row is written.
 */

function revalidateSettings() {
  revalidatePath("/settings", "layout");
  // A room type, a channel or a tax rate changes what these can offer.
  revalidatePath("/bookings/new");
  revalidatePath("/inventory", "layout");
  revalidatePath("/dashboard");
}

export async function saveProperty(input: {
  name: string;
  timezone: string;
  currency: string;
  checkInTime: string;
  checkOutTime: string;
  auditCloseTime: string;
}): Promise<ActionResult<null>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "The property needs a name." };
  }
  if (input.currency.trim().length !== 3) {
    return { ok: false, error: "A currency is three letters, like GBP." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_property", {
    p_name: input.name,
    p_timezone: input.timezone,
    p_currency: input.currency.toUpperCase(),
    p_check_in_time: input.checkInTime || null,
    p_check_out_time: input.checkOutTime || null,
    // Empty becomes null and Postgres refuses it by name, exactly as it does
    // for the two times above. A cleared field that silently kept the old
    // value would read as a save that did not save.
    p_audit_close_time: input.auditCloseTime || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: null };
}

/**
 * Settings > Hotel Profile > Hotel Details (0067).
 *
 * Every field the client's reference keeps about a hotel. The refusals live in
 * `save_property_details()`, where they hold however the row is written; this
 * only turns the form's strings into what the function takes. An empty field
 * is null, which clears it.
 */
export async function saveHotelDetails(input: {
  name: string;
  timezone: string;
  currency: string;
  propertyType: string;
  companyName: string;
  companyRegistrationId: string;
  country: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postcode: string;
  latitude: string;
  longitude: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
}): Promise<ActionResult<null>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "The hotel needs a name." };
  }

  // Coordinates arrive as text from two inputs and a map. Blank is "no
  // location"; anything else must be a number, said here rather than handed
  // to Postgres as NaN.
  const coord = (v: string): number | null | "bad" => {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : "bad";
  };
  const latitude = coord(input.latitude);
  const longitude = coord(input.longitude);
  if (latitude === "bad" || longitude === "bad") {
    return { ok: false, error: "Latitude and longitude are numbers, like 51.5014 and -0.1419." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_property_details", {
    p_name: input.name,
    p_timezone: input.timezone,
    p_currency: input.currency,
    p_property_type: input.propertyType,
    p_company_name: input.companyName,
    p_company_registration_id: input.companyRegistrationId,
    p_country: input.country,
    p_address_line1: input.addressLine1,
    p_address_line2: input.addressLine2,
    p_city: input.city,
    p_region: input.region,
    p_postcode: input.postcode,
    p_latitude: latitude,
    p_longitude: longitude,
    p_phone: input.phone,
    p_fax: input.fax,
    p_email: input.email,
    p_website: input.website,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  // The name and the timezone reach the top bar and the browser tab.
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/** Settings > Hotel Profile > Hotel Properties: the three times (0067). */
export async function saveHotelTimes(input: {
  checkInTime: string;
  checkOutTime: string;
  auditCloseTime: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_property_times", {
    p_check_in_time: input.checkInTime || nullableArg<string>(null),
    p_check_out_time: input.checkOutTime || nullableArg<string>(null),
    p_audit_close_time: input.auditCloseTime || nullableArg<string>(null),
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: null };
}

export async function saveHotelPolicies(
  input: HotelPolicies,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  // The optional texts go as null rather than omitted: the function drops a
  // custom text whose section is not "custom", and a blank means "nothing".
  const { error } = await supabase.rpc("save_property_policies", {
    p_children: input.children,
    p_children_custom: nullableArg(input.childrenCustom),
    p_pets: input.pets,
    p_pets_custom: nullableArg(input.petsCustom),
    p_smoking: input.smoking,
    p_smoking_custom: nullableArg(input.smokingCustom),
    p_internet: input.internet,
    p_internet_custom: nullableArg(input.internetCustom),
    p_parking: input.parking,
    p_parking_custom: nullableArg(input.parkingCustom),
    p_other_policies: nullableArg(input.otherPolicies),
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: null };
}

/* -- Hotel Content -> Extras (0069) --------------------------------------- */

function revalidateExtras() {
  revalidateSettings();
  // The booking screen's Extras tab charges from this catalog.
  revalidatePath("/bookings", "layout");
  revalidatePath("/calendar");
}

export async function saveExtraCategory(input: {
  id: string | null;
  title: string;
  taxRateId: string | null;
}): Promise<ActionResult<{ id: string }>> {
  if (input.title.trim() === "") {
    return { ok: false, error: "An extra category needs a title." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_extra_category", {
    // Null is a new category; an id is the one being renamed.
    p_id: nullableArg(input.id),
    p_title: input.title,
    // Null is "no tax of its own".
    p_tax_rate_id: nullableArg(input.taxRateId),
  });
  if (error) return { ok: false, error: error.message };
  revalidateExtras();
  return { ok: true, data: { id: data } };
}

export async function deleteExtraCategory(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_extra_category", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateExtras();
  return { ok: true, data: null };
}

export async function saveExtra(input: {
  id: string | null;
  categoryId: string;
  title: string;
  /** As typed, e.g. "24" or "24.50". Parsed to pence here, never as a float. */
  price: string;
  taxRateId: string | null;
  itemType: ExtraItemType;
}): Promise<ActionResult<{ id: string }>> {
  if (input.title.trim() === "") return { ok: false, error: "An extra needs a title." };
  if (input.categoryId === "") return { ok: false, error: "Pick a category for the extra." };

  let priceCents: number;
  try {
    priceCents = parseMoney(input.price);
  } catch {
    return { ok: false, error: "The price is a number, like 24 or 24.50." };
  }
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    return { ok: false, error: "The price is a number, like 24 or 24.50." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_extra", {
    p_id: nullableArg(input.id),
    p_category_id: input.categoryId,
    p_title: input.title,
    p_price_cents: priceCents,
    // Null is "use the category's rate".
    p_tax_rate_id: nullableArg(input.taxRateId),
    p_item_type: input.itemType,
  });
  if (error) return { ok: false, error: error.message };
  revalidateExtras();
  return { ok: true, data: { id: data } };
}

/**
 * Folds one extra into another (0071): the target stays, the source leaves
 * the catalog, and the activity log records which went where. Nothing posted
 * moves -- a charged extra is a folio item carrying its own copy.
 */
export async function mergeExtra(input: {
  sourceId: string;
  targetId: string;
}): Promise<ActionResult<null>> {
  if (!input.targetId) return { ok: false, error: "Choose the extra to merge into." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_extra", {
    p_source_id: input.sourceId,
    p_target_id: input.targetId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateExtras();
  return { ok: true, data: null };
}

/**
 * Folds one extra category into another (0072): its extras move to the
 * target, then it goes. Returns how many extras moved, for the message.
 */
export async function mergeExtraCategory(input: {
  sourceId: string;
  targetId: string;
}): Promise<ActionResult<{ moved: number }>> {
  if (!input.targetId) return { ok: false, error: "Choose the category to merge into." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_extra_category", {
    p_source_id: input.sourceId,
    p_target_id: input.targetId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateExtras();
  return { ok: true, data: { moved: data ?? 0 } };
}

export async function deleteExtra(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_extra", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateExtras();
  return { ok: true, data: null };
}

/* -- Hotel Content -> Room Type Facilities (0070) ------------------------- */

export async function saveFacility(input: {
  id: string | null;
  title: string;
  icon: FacilityIcon;
}): Promise<ActionResult<{ id: string }>> {
  if (input.title.trim() === "") return { ok: false, error: "A facility needs a title." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_facility", {
    // Null is a new facility; an id is the one being corrected.
    p_id: nullableArg(input.id),
    p_title: input.title,
    p_icon: input.icon,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: { id: data } };
}

export async function deleteFacility(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_facility", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/** What the guest booking page says about a room type (0072). Blank clears it. */
export async function setRoomTypeDescription(input: {
  roomTypeId: string;
  description: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_type_description", {
    p_room_type_id: input.roomTypeId,
    p_description: input.description,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/** The whole set for one room type, as `set_rate_plan_meals()` takes its set. */
export async function setRoomTypeFacilities(input: {
  roomTypeId: string;
  facilityIds: string[];
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_type_facilities", {
    p_room_type_id: input.roomTypeId,
    p_facility_ids: input.facilityIds,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/* -- Settings -> Guest Configuration (0073) ------------------------------- */

function revalidateGuestConfig() {
  revalidateSettings();
  // The Customers form draws the identification types and the extra fields,
  // and a booking's registration card prints the form settings.
  revalidatePath("/customers");
  revalidatePath("/bookings", "layout");
}

export async function saveIdentificationType(input: {
  id: string | null;
  title: string;
}): Promise<ActionResult<{ id: string }>> {
  if (input.title.trim() === "") {
    return { ok: false, error: "An identification type needs a title." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_identification_type", {
    // Null is a new type; an id is the one being renamed.
    p_id: nullableArg(input.id),
    p_title: input.title,
  });
  if (error) return { ok: false, error: error.message };
  revalidateGuestConfig();
  return { ok: true, data: { id: data } };
}

export async function deleteIdentificationType(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_identification_type", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateGuestConfig();
  return { ok: true, data: null };
}

/** The whole list at once, as the reference's single Save does. */
export async function saveGuestFields(
  fields: { id: string | null; label: string; kind: GuestFieldKind }[],
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_guest_fields", {
    p_fields: fields.map((f) => ({ id: f.id ?? "", label: f.label, kind: f.kind })),
  });
  if (error) return { ok: false, error: error.message };
  revalidateGuestConfig();
  return { ok: true, data: null };
}

export async function saveRegistrationForm(input: {
  question1: string;
  question2: string;
  terms: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_registration_form", {
    p_question_1: input.question1,
    p_question_2: input.question2,
    p_terms: input.terms,
  });
  if (error) return { ok: false, error: error.message };
  revalidateGuestConfig();
  return { ok: true, data: null };
}

/* -- Communications & Notifications -> Hotel Emails Preferences (0074) ---- */

export async function saveHotelEmailSettings(input: {
  notificationEmails: string[];
  preferences: Record<string, boolean>;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_hotel_email_settings", {
    p_emails: input.notificationEmails,
    p_preferences: input.preferences,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/* -- System Settings -> Hotel Features (0076) ------------------------------ */

export async function saveHotelFeatures(
  features: Record<string, boolean>,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_hotel_features", { p_features: features });
  if (error) return { ok: false, error: error.message };
  // The switches take menu items out of the nav and change the calendar's
  // housekeeping dots, so every page under the app layout is affected.
  revalidatePath("/", "layout");
  return { ok: true, data: null };
}

/* -- System Settings -> Calendar Settings (0077) --------------------------- */

export async function saveCalendarSettings(
  input: CalendarSettings,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_calendar_settings", {
    p_room_blocker_color: input.roomBlockerColor,
    p_unpaid_booking_color: input.unpaidBookingColor,
    p_paid_booking_color: input.paidBookingColor,
    p_partially_paid_booking_color: input.partiallyPaidBookingColor,
    p_company_booking_color: input.companyBookingColor,
    p_group_booking_color: input.groupBookingColor,
    p_weekend_border_color: input.weekendBorderColor,
    p_rounded_corners: input.roundedCorners,
    p_bookings_intersect_checkout: input.bookingsIntersectCheckout,
    p_booking_marker_intersect_checkout: input.bookingMarkerIntersectCheckout,
    p_fixed_width_zoom: input.fixedWidthZoom,
    p_show_seasons: input.showSeasons,
    p_show_channel_abbreviation: input.showChannelAbbreviation,
    p_last_name_first: input.lastNameFirst,
    p_hide_cancellation_area: input.hideCancellationArea,
    p_show_waitlist: input.showWaitlist,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

/* -- Finances -> Invoice Settings (0080) ------------------------------------ */

function revalidateInvoice() {
  revalidateSettings();
  // The printable invoice reads every one of these.
  revalidatePath("/bookings", "layout");
}

export async function saveInvoiceGeneral(input: {
  showRoomNumberForExtras: boolean;
  showNightsBreakdown: boolean;
  vatRegistered: boolean;
  companyName: string;
  country: string;
  region: string;
  city: string;
  address: string;
  postcode: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_invoice_general", {
    p_show_room_number_for_extras: input.showRoomNumberForExtras,
    p_show_nights_breakdown: input.showNightsBreakdown,
    p_vat_registered: input.vatRegistered,
    // Blanks are stored as no override; the invoice falls back to the hotel.
    p_company_name: input.companyName,
    p_country: input.country,
    p_region: input.region,
    p_city: input.city,
    p_address: input.address,
    p_postcode: input.postcode,
  });
  if (error) return { ok: false, error: error.message };
  revalidateInvoice();
  return { ok: true, data: null };
}

export async function saveInvoiceLogoAndNotes(input: {
  useTextInsteadOfLogo: boolean;
  logoText: string;
  notes: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_invoice_logo_and_notes", {
    p_use_text_instead_of_logo: input.useTextInsteadOfLogo,
    p_logo_text: input.logoText,
    p_notes: input.notes,
  });
  if (error) return { ok: false, error: error.message };
  revalidateInvoice();
  return { ok: true, data: null };
}

export async function saveRoundingOptions(input: {
  roundLogic: string;
  roundTo: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_rounding_options", {
    p_round_logic: input.roundLogic,
    p_round_to: input.roundTo,
  });
  if (error) return { ok: false, error: error.message };
  revalidateInvoice();
  return { ok: true, data: null };
}

export async function saveInvoiceNumberSettings(customInvoiceNumbers: boolean): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_invoice_number_settings", {
    p_custom_invoice_numbers: customInvoiceNumbers,
  });
  if (error) return { ok: false, error: error.message };
  revalidateInvoice();
  return { ok: true, data: null };
}

export async function saveStatementSettings(input: {
  reminderText: string;
  termsText: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_statement_settings", {
    p_reminder_text: input.reminderText,
    p_terms_text: input.termsText,
  });
  if (error) return { ok: false, error: error.message };
  revalidateInvoice();
  return { ok: true, data: null };
}

/**
 * Records a logo the browser has already uploaded, or takes it off with null.
 * The replaced file is removed only once Postgres has recorded the new path,
 * as with a room photograph.
 */
export async function setInvoiceLogo(path: string | null): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { data: previous, error } = await supabase.rpc("set_invoice_logo", {
    // Null takes the logo off.
    p_logo_path: nullableArg(path),
  });
  if (error) return { ok: false, error: error.message };
  if (previous && previous !== path) {
    await supabase.storage.from(HOTEL_ASSETS_BUCKET).remove([previous]);
  }
  revalidateInvoice();
  return { ok: true, data: null };
}

/* -- Finances -> Pos Profiles (0084) and Currencies (0083) ----------------- */

export async function savePosProfile(input: {
  id: string | null;
  posType: string;
  isEnabled: boolean;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_pos_profile", {
    // Null adds a new profile.
    p_id: nullableArg(input.id),
    p_pos_type: input.posType,
    p_is_enabled: input.isEnabled,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

export async function deletePosProfile(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_pos_profile", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/* -- Inventory -> Discounts (0090) ---------------------------------------- */

export async function saveDiscount(input: {
  id: string | null;
  title: string;
  kind: "percent" | "fixed";
  percentBps: number | null;
  amountCents: number | null;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_discount", {
    // Null adds a new discount.
    p_id: nullableArg(input.id),
    p_title: input.title,
    p_kind: input.kind,
    // Each kind carries only its own figure; Postgres refuses a missing one.
    p_percent_bps: nullableArg(input.kind === "percent" ? input.percentBps : null),
    p_amount_cents: nullableArg(input.kind === "fixed" ? input.amountCents : null),
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

export async function deleteDiscount(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_discount", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/* -- Inventory -> Settings (0088) ----------------------------------------- */

function revalidateInventorySettings() {
  revalidateSettings();
  // The visibility ticks change the menu, which the layout draws on every page.
  revalidatePath("/", "layout");
}

export async function saveOnlineBookingCutoff(input: {
  enabled: boolean;
  date: string | null;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_online_booking_cutoff", {
    p_enabled: input.enabled,
    // Null with the box unticked; Postgres refuses it with the box ticked.
    p_date: nullableArg(input.enabled && input.date ? input.date : null),
  });
  if (error) return { ok: false, error: error.message };
  revalidateInventorySettings();
  return { ok: true, data: null };
}

export async function saveSameDayBookingCutoff(input: {
  enabled: boolean;
  time: string | null;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_same_day_booking_cutoff", {
    p_enabled: input.enabled,
    // Null with the box unticked; Postgres refuses it with the box ticked.
    p_time: nullableArg(input.enabled && input.time ? input.time : null),
  });
  if (error) return { ok: false, error: error.message };
  revalidateInventorySettings();
  return { ok: true, data: null };
}

export async function saveInventoryVisibility(
  visibility: InventoryVisibility,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_inventory_visibility", {
    p_min_stay_through: visibility.min_stay_through,
    p_min_stay_arrival: visibility.min_stay_arrival,
    p_closed_to_arrival: visibility.closed_to_arrival,
    p_closed_to_departure: visibility.closed_to_departure,
    p_max_stay: visibility.max_stay,
    p_stop_sell: visibility.stop_sell,
  });
  if (error) return { ok: false, error: error.message };
  revalidateInventorySettings();
  return { ok: true, data: null };
}

/* -- Finances -> Payment Gateway (0086) ----------------------------------- */

export async function savePaymentGateway(input: {
  id: string | null;
  provider: string;
  title: string;
  isDefault: boolean;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_payment_gateway", {
    // Null adds a new gateway.
    p_id: nullableArg(input.id),
    p_provider: input.provider,
    p_title: input.title,
    p_is_default: input.isDefault,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

export async function deletePaymentGateway(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_payment_gateway", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/* -- Connectivity -> Channel Manager (0097) ------------------------------- */

/**
 * A configuration file: `undefined` keeps the saved one, `null` removes it,
 * and a name with its text replaces it.
 */
type ConfigFile = { name: string; csv: string } | null | undefined;

function configArgs(file: ConfigFile): { name: string | null; csv: string | null } {
  if (file === undefined) return { name: null, csv: null };
  if (file === null) return { name: "", csv: null };
  return { name: file.name, csv: file.csv };
}

export async function saveChannelManager(input: {
  id: string | null;
  provider: string;
  connectionName: string;
  isActive: boolean;
  username: string;
  /** Blank keeps the saved password. It is written to the vault, never to a row. */
  password: string;
  hotelCode: string;
  requestorId: string;
  region: string | null;
  daysToSync: number;
  syncMultiOccupancy: boolean;
  roomConfig: ConfigFile;
  rateConfig: ConfigFile;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const room = configArgs(input.roomConfig);
  const rate = configArgs(input.rateConfig);
  const { error } = await supabase.rpc("save_channel_manager", {
    // Null adds a new connection.
    p_id: nullableArg(input.id),
    p_provider: input.provider,
    p_connection_name: input.connectionName,
    p_is_active: input.isActive,
    p_username: input.username,
    // Null keeps the saved password.
    p_password: nullableArg(input.password === "" ? null : input.password),
    p_hotel_code: input.hotelCode,
    p_requestor_id: input.requestorId,
    // Null is no region chosen.
    p_region: nullableArg(input.region),
    p_days_to_sync: input.daysToSync,
    p_sync_multi_occupancy: input.syncMultiOccupancy,
    // Null keeps the saved file; '' removes it.
    p_room_config_name: nullableArg(room.name),
    p_room_config_csv: nullableArg(room.csv),
    p_rate_config_name: nullableArg(rate.name),
    p_rate_config_csv: nullableArg(rate.csv),
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

export async function deleteChannelManager(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_channel_manager", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/** A saved configuration file's text, for download. Read under RLS. */
export async function getChannelManagerConfig(
  id: string,
  which: "room" | "rate",
): Promise<ActionResult<{ name: string; csv: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channel_managers")
    .select("room_config_name, room_config_csv, rate_config_name, rate_config_csv")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const name = which === "room" ? data?.room_config_name : data?.rate_config_name;
  const csv = which === "room" ? data?.room_config_csv : data?.rate_config_csv;
  if (!name || csv == null) return { ok: false, error: "That file is no longer saved." };
  return { ok: true, data: { name, csv } };
}

/* -- Connectivity -> Booking Engine Settings (0098) ----------------------- */

export async function saveBookingEngineTexts(input: {
  /** Blank goes back to the default policy. */
  privacyPolicy: string;
  /** Blank is none. */
  terms: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_booking_engine_texts", {
    p_privacy_policy: input.privacyPolicy,
    p_terms: input.terms,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

export async function saveBookingEngineProfile(input: {
  id: string | null;
  title: string;
  slug: string;
  /** Empty is every room type. */
  roomTypeIds: string[];
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_booking_engine_profile", {
    // Null adds a new profile.
    p_id: nullableArg(input.id),
    p_title: input.title,
    p_slug: input.slug,
    p_room_type_ids: input.roomTypeIds,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

export async function deleteBookingEngineProfile(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_booking_engine_profile", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/* -- Finances -> Accounting Systems (0087) -------------------------------- */

export async function saveAccountingSystem(input: {
  id: string | null;
  provider: string;
  isEnabled: boolean;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_accounting_system", {
    // Null adds a new system.
    p_id: nullableArg(input.id),
    p_provider: input.provider,
    p_is_enabled: input.isEnabled,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

export async function deleteAccountingSystem(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_accounting_system", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/* -- Finances -> Accounting Categories (0085) ----------------------------- */

function revalidateAccounting() {
  revalidateSettings();
  // The Accounting report names the default accounts.
  revalidatePath("/reports/accounting");
}

export async function saveAccountingCategory(input: {
  id: string | null;
  name: string;
  internalCode: string;
  externalCode: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_accounting_category", {
    // Null adds a new category.
    p_id: nullableArg(input.id),
    p_name: input.name,
    // Blank codes are stored as none.
    p_internal_code: input.internalCode,
    p_external_code: input.externalCode,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAccounting();
  return { ok: true, data: null };
}

export async function deleteAccountingCategory(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_accounting_category", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateAccounting();
  return { ok: true, data: null };
}

export async function saveAccountingDefaults(input: {
  accommodationId: string;
  extrasId: string;
  taxesId: string;
  paymentsId: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_accounting_defaults", {
    p_accommodation_id: input.accommodationId,
    p_extras_id: input.extrasId,
    p_taxes_id: input.taxesId,
    p_payments_id: input.paymentsId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateAccounting();
  return { ok: true, data: null };
}

export async function saveCurrencyProfile(input: {
  id: string | null;
  currency: string;
  rateKind: "live" | "fixed";
  fixedRateMicros: number | null;
}): Promise<ActionResult<null>> {
  if (input.rateKind === "fixed" && (input.fixedRateMicros === null || input.fixedRateMicros <= 0)) {
    return { ok: false, error: "Write the fixed rate, above zero." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_currency_profile", {
    // Null adds a new currency.
    p_id: nullableArg(input.id),
    p_currency: input.currency,
    p_rate_kind: input.rateKind,
    // Null on a live rate: there is no figure to store.
    p_fixed_rate_micros: nullableArg(input.rateKind === "fixed" ? input.fixedRateMicros : null),
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

export async function deleteCurrencyProfile(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_currency_profile", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/* -- System Settings -> Language Settings (0078) --------------------------- */

function revalidateLanguages() {
  revalidateSettings();
  // The guest booking page is what these settings drive.
  revalidatePath("/book", "layout");
}

export async function saveDefaultLanguage(locale: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_default_language", { p_locale: locale });
  if (error) return { ok: false, error: error.message };
  revalidateLanguages();
  return { ok: true, data: null };
}

export async function saveSupportedLanguages(locales: string[]): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_supported_languages", { p_locales: locales });
  if (error) return { ok: false, error: error.message };
  revalidateLanguages();
  return { ok: true, data: null };
}

/* -- Communications & Notifications -> Email Setup (0075) ----------------- */

function revalidateEmail() {
  revalidateSettings();
  // The booking screen's Email tab offers the templates.
  revalidatePath("/bookings", "layout");
  revalidatePath("/calendar");
}

/** Every Email Setup save ends the same way; the RPC names stay typed. */
function emailDone(error: { message: string } | null): ActionResult<null> {
  if (error) return { ok: false, error: error.message };
  revalidateEmail();
  return { ok: true, data: null };
}

export async function saveEmailGeneral(input: {
  replyToEmails: string[];
  fromText: string;
  notificationEmails: string[];
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_email_general", {
    p_reply_to: input.replyToEmails,
    p_from_text: input.fromText,
    p_notification_emails: input.notificationEmails,
  });
  return emailDone(error);
}

export async function saveEmailFooter(footer: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_email_footer", { p_footer: footer });
  return emailDone(error);
}

export async function saveBookingConfirmationEmail(input: {
  checkinNotes: string;
  directions: string;
  singlePropertyAddress: string;
  multiPropertyAddress: string;
  confirmationMessage: string;
  colors: Record<string, string>;
  showHotelLogo: boolean;
  includeFooter: boolean;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_booking_confirmation_email", {
    p_checkin_notes: input.checkinNotes,
    p_directions: input.directions,
    p_single_property_address: input.singlePropertyAddress,
    p_multi_property_address: input.multiPropertyAddress,
    p_confirmation_message: input.confirmationMessage,
    p_colors: input.colors,
    p_show_hotel_logo: input.showHotelLogo,
    p_include_footer: input.includeFooter,
  });
  return emailDone(error);
}

export async function savePreArrivalEmail(enabled: boolean): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_pre_arrival_email", { p_enabled: enabled });
  return emailDone(error);
}

export async function savePostDepartureEmail(input: {
  enabled: boolean;
  subject: string;
  body: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_post_departure_email", {
    p_enabled: input.enabled,
    p_subject: input.subject,
    p_body: input.body,
  });
  return emailDone(error);
}

export async function savePaymentRequestEmail(input: {
  subject: string;
  body: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_payment_request_email", {
    p_subject: input.subject,
    p_body: input.body,
  });
  return emailDone(error);
}

export async function saveEmailTemplate(input: {
  id: string | null;
  title: string;
  subject: string;
  body: string;
}): Promise<ActionResult<{ id: string }>> {
  if (input.title.trim() === "") return { ok: false, error: "An email template needs a title." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_email_template", {
    // Null is a new template; an id is the one being corrected.
    p_id: nullableArg(input.id),
    p_title: input.title,
    p_subject: input.subject,
    p_body: input.body,
  });
  if (error) return { ok: false, error: error.message };
  revalidateEmail();
  return { ok: true, data: { id: data } };
}

export async function deleteEmailTemplate(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_email_template", { p_id: id });
  return emailDone(error);
}

export async function saveRoomType(input: {
  id: string | null;
  code: string;
  name: string;
  baseOccupancy: number;
  maxOccupancy: number;
}): Promise<ActionResult<{ id: string }>> {
  if (input.code.trim() === "" || input.name.trim() === "") {
    return { ok: false, error: "A room type needs a code and a name." };
  }
  if (input.maxOccupancy < input.baseOccupancy) {
    return { ok: false, error: "The maximum occupancy cannot be below the base." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_room_type", {
    p_id: input.id,
    p_code: input.code,
    p_name: input.name,
    p_base_occupancy: input.baseOccupancy,
    p_max_occupancy: input.maxOccupancy,
    p_sort_order: null,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}

/* -- Inventory -> Room Type (0091) --------------------------------------- */

/** The guest-facing name; blank clears it back to the staff name. */
export async function setRoomTypeDisplayName(input: {
  roomTypeId: string;
  displayName: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_type_display_name", {
    p_room_type_id: input.roomTypeId,
    p_display_name: input.displayName,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

/** The whole list, top first: the calendar and the guest page sort by it. */
export async function setRoomTypeOrder(ids: string[]): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_type_order", { p_ids: ids });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

/** Refused by name while any room, booking, waitlist entry or virtual type uses it. */
export async function deleteRoomType(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_room_type", { p_room_type_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

export async function saveVirtualRoomType(input: {
  id: string | null;
  displayName: string;
  parentRoomTypeId: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_virtual_room_type", {
    // Null adds a new virtual room type.
    p_id: nullableArg(input.id),
    p_display_name: input.displayName,
    p_parent_room_type_id: input.parentRoomTypeId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

export async function deleteVirtualRoomType(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_virtual_room_type", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/* -- Inventory -> Room Setup (0091) -------------------------------------- */

export async function setRoomSetup(input: {
  roomId: string;
  priority: number;
  availableOnline: boolean;
  keyCode: string;
  doorName: string;
  color: string | null;
  hasDivider: boolean;
}): Promise<ActionResult<null>> {
  if (!Number.isSafeInteger(input.priority) || input.priority < 0 || input.priority > 999) {
    return { ok: false, error: "Priority is a whole number from 0 to 999." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_setup", {
    p_room_id: input.roomId,
    p_priority: input.priority,
    p_available_online: input.availableOnline,
    p_key_code: input.keyCode,
    p_door_name: input.doorName,
    // Null clears the colour.
    p_color: nullableArg(input.color),
    p_has_divider: input.hasDivider,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

/** Disabling locks the room out of order; enabling brings it back dirty. */
export async function setRoomEnabled(input: {
  roomId: string;
  enabled: boolean;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_enabled", {
    p_room_id: input.roomId,
    p_enabled: input.enabled,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

/** "Use Booking Room id as Key Code". Stored. */
export async function saveKeyCodeSetting(on: boolean): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_key_code_setting", { p_on: on });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/**
 * Rooms are made in runs. The client operates properties with up to ~1,800
 * rooms, and entering those one at a time is not a thing anyone would do.
 */
export async function createRooms(input: {
  roomTypeId: string;
  first: number;
  last: number;
  floor: number | null;
  prefix: string;
}): Promise<ActionResult<{ created: number }>> {
  if (!Number.isSafeInteger(input.first) || !Number.isSafeInteger(input.last)) {
    return { ok: false, error: "Give a run of whole room numbers." };
  }
  if (input.last < input.first) {
    return { ok: false, error: "Give the run lowest first." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_rooms", {
    p_room_type_id: input.roomTypeId,
    p_first: input.first,
    p_last: input.last,
    p_floor: input.floor,
    p_prefix: input.prefix,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { created: Number(data ?? 0) } };
}

/**
 * Correcting one room.
 *
 * createRooms() makes them in runs and nothing could touch one afterwards, so a
 * number typed wrong, a room on the wrong type or a missing floor meant going
 * back to SQL. Moving a room to another type is safe: booking_rooms carries its
 * own room_type_id, so no booking, rate or night row is rewritten by the move.
 *
 * There is no delete. A room that reservations point at cannot be removed
 * without taking their history with it, and a room out of service is `ooo`,
 * which is what that status is for.
 */
export async function saveRoom(input: {
  id: string | null;
  number: string;
  roomTypeId: string;
  floor: number | null;
}): Promise<ActionResult<{ id: string }>> {
  if (input.number.trim() === "") {
    return { ok: false, error: "A room needs a number." };
  }
  if (input.roomTypeId === "") {
    return { ok: false, error: "Pick the room type this room belongs to." };
  }
  if (input.floor !== null && !Number.isSafeInteger(input.floor)) {
    return { ok: false, error: "A floor is a whole number, or leave it blank." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_room", {
    p_id: input.id,
    p_number: input.number,
    p_room_type_id: input.roomTypeId,
    p_floor: input.floor,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}

/**
 * Deleting a room.
 *
 * The rule used to be that there is no delete for a room at all, on the
 * grounds that `booking_rooms` points at one under `on delete restrict`. That
 * is still true of a room somebody has stayed in, and `delete_room()` refuses
 * those by name. It is not true of a room that has never been booked — a run
 * of 60 entered as 50, a number typed wrong, a cupboard counted as sellable —
 * and those are the rooms a hotel actually wants rid of.
 *
 * The photograph goes with it. Nothing points at the object once the row is
 * gone, so leaving it would be a file in a bucket that no screen can ever
 * show or remove.
 */
export async function deleteRoom(
  roomId: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  /*
   * Read the path BEFORE the row goes, and read it from the database rather
   * than taking it from the browser: a path sent up with the request could
   * name another room's photograph, and the storage policy — which only
   * checks the property — would happily delete it.
   */
  const { data: room } = await supabase
    .from("rooms")
    .select("photo_path")
    .eq("id", roomId)
    .maybeSingle();

  const { error } = await supabase.rpc("delete_room", { p_room_id: roomId });
  if (error) return { ok: false, error: error.message };

  if (room?.photo_path) {
    // Best effort, and deliberately not fatal: the room is already gone, and
    // failing the whole action over a leftover file would report a delete
    // that did happen as one that did not.
    await supabase.storage.from(ROOM_PHOTO_BUCKET).remove([room.photo_path]);
  }

  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: { id: roomId } };
}

/**
 * Recording which uploaded file is a room's photograph, or taking it off.
 *
 * The upload itself happens in the browser, straight to Supabase Storage under
 * the signed-in user's session, so the storage policy decides whether it is
 * allowed. Nothing here holds a service key and nothing bypasses RLS.
 *
 * `set_room_photo()` then checks the path really is under this property and
 * this room before it stores it — the browser chose the name, so the database
 * does not take its word for it.
 */
export async function setRoomPhoto(input: {
  roomId: string;
  /** The new object path, or null to take the photograph off. */
  path: string | null;
  /** The path being replaced, so the old file does not linger in the bucket. */
  previousPath: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_room_photo", {
    p_room_id: input.roomId,
    p_photo_path: input.path,
  });

  if (error) return { ok: false, error: error.message };

  if (input.previousPath && input.previousPath !== input.path) {
    await supabase.storage.from(ROOM_PHOTO_BUCKET).remove([input.previousPath]);
  }

  revalidateSettings();
  return { ok: true, data: { id: input.roomId } };
}

/**
 * Payment types -- the `payment_methods` table (0079: a title, a description,
 * and any number per kind, as the reference's Custom Payment Types).
 *
 * affects_drawer is not passed and is not a choice: a check constraint on the
 * table ties it to the kind — cash touches physical cash, nothing else does —
 * and the whole blind count rests on that being true. The kind itself is frozen
 * by Postgres once payments exist against the method.
 *
 * There is no delete either. A method a payment points at cannot go without
 * taking the payment with it, so retiring one is `isActive: false`, which every
 * other read of the table already filters on.
 */
export async function savePaymentType(input: {
  id: string | null;
  title: string;
  description: string;
  kind: PaymentMethodKind;
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  if (input.title.trim() === "") {
    return { ok: false, error: "A payment type needs a title." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_payment_type", {
    // Null adds a new payment type.
    p_id: nullableArg(input.id),
    p_title: input.title,
    // Blank is stored as no description.
    p_description: input.description,
    p_kind: input.kind,
    p_is_active: input.isActive,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  // What the cashier may take a payment by has changed.
  revalidatePath("/cashier");
  return { ok: true, data: { id: data } };
}

/**
 * Marking a room clean.
 *
 * rooms.status was only ever set by check-in and check-out until now, so a
 * room went dirty on departure and stayed dirty for ever. Housekeeping can
 * call this one — they are the people holding the vacuum.
 */
export async function setRoomStatus(input: {
  roomId: string;
  status: RoomStatus;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_status", {
    p_room_id: input.roomId,
    p_status: input.status,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/reports/housekeeping");
  revalidatePath("/dashboard");
  // The calendar rail draws a dot per room and a summary dot per type, and
  // the status is settable from that rail now, so the board has to move too.
  revalidatePath("/calendar");
  revalidateSettings();
  return { ok: true, data: null };
}

/**
 * The housekeeping menu on the calendar rail (0062).
 *
 * One call for the four points on the clean-to-broken scale, because that is
 * one decision at a front desk. The mapping from a choice to a status plus its
 * inspected flag lives in Postgres, so the menu and the data cannot drift.
 *
 * ONLY "broken" CHANGES WHAT THE HOTEL CAN SELL — it is `ooo`. Clean, dirty
 * and inspected are information for reception and housekeeping, exactly as the
 * client described, and move no availability figure.
 */
export async function setRoomHousekeeping(input: {
  roomId: string;
  choice: HousekeepingChoice;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_housekeeping", {
    p_room_id: input.roomId,
    p_choice: input.choice,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/reports/housekeeping");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidateSettings();
  return { ok: true, data: null };
}

/**
 * The guest's own request, which is not a point on that scale.
 *
 * Its own action because it is a toggle on an OCCUPIED room rather than a
 * state of the room's cleanliness — "set this room to do not disturb" would
 * otherwise have to answer "and is it clean?", which has no sensible answer.
 * Postgres refuses it on a room with nobody in it.
 */
export async function setRoomDoNotDisturb(
  roomId: string,
  on: boolean,
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_room_do_not_disturb", {
    p_room_id: roomId,
    p_on: on,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/reports/housekeeping");
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

export async function saveChannel(input: {
  id: string | null;
  code: string;
  name: string;
  kind: ChannelKind;
  commissionBps: number;
  isActive: boolean;
  /** The Associated Customer (0099), or null for none. */
  customerId: string | null;
}): Promise<ActionResult<{ id: string }>> {
  if (input.commissionBps < 0 || input.commissionBps > 10000) {
    return { ok: false, error: "Commission must be between 0 and 100 percent." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_channel", {
    // Null adds a new sales channel.
    p_id: nullableArg(input.id),
    p_code: input.code,
    p_name: input.name,
    p_kind: input.kind,
    p_commission_bps: input.commissionBps,
    p_is_active: input.isActive,
    // Null is no associated customer.
    p_customer_id: nullableArg(input.customerId),
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}

/** Folds the other channels into the one kept (0099); returns bookings moved. */
export async function mergeChannels(
  keepId: string,
  mergeIds: string[],
): Promise<ActionResult<{ moved: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_channels", {
    p_keep_id: keepId,
    p_merge_ids: mergeIds,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: { moved: data ?? 0 } };
}

/** Customers matching a search, for the Associated Customer picker. */
export async function searchCustomersForPicker(
  q: string,
): Promise<ActionResult<{ id: string; name: string; kind: string }[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("customers_page", {
    p_q: q.trim() || null,
    p_kind: null,
    p_limit: 10,
    p_offset: 0,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.customer_id,
      name: r.name ?? `#${r.customer_number}`,
      kind: r.kind,
    })),
  };
}

export async function saveTaxRate(input: {
  id: string | null;
  name: string;
  rateBps: number;
  inclusion: "inclusive" | "exclusive";
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "A tax rate needs a name." };
  }
  if (!Number.isSafeInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10000) {
    return { ok: false, error: "A tax rate must be between 0 and 100 percent." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_tax_rate", {
    p_id: input.id,
    p_name: input.name,
    p_rate_bps: input.rateBps,
    p_inclusion: input.inclusion,
    p_is_active: input.isActive,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}

/**
 * Taxes And Fees order (0079). The first active rate is the one the booking
 * form seeds, so this is also how a hotel picks its default.
 */
export async function setTaxRateOrder(ids: string[]): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_tax_rate_order", { p_ids: ids });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/** Deletes a tax nothing has used; Postgres refuses one in use by name. */
export async function deleteTaxRate(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_tax_rate", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true, data: null };
}

/**
 * Changing a member of staff who already has a login.
 *
 * Creating one is not here: `staff_users.id` references `auth.users`, so a new
 * member of staff needs an auth account before a row can point at one, and
 * that is an invite flow with its own decisions about who may send one.
 */
/**
 * A season or an event (0095): a name and a colour. Its dates are ranges added
 * with addSeasonRange(). It changes no price -- rates stay in `rate_plan_days`.
 * The kind is fixed once made.
 */
export async function saveSeasonType(input: {
  id: string | null;
  kind: "season" | "event";
  name: string;
  color: string;
}): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_season_type", {
    // Null adds a new season or event.
    p_id: nullableArg(input.id),
    p_kind: input.kind,
    p_name: input.name,
    p_color: input.color,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: { id: data as string } };
}

/** Deletes a season or event with all its ranges. */
export async function deleteSeasonType(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_season_type", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

/** One more date range. Postgres refuses a season range overlapping another season, by name. */
export async function addSeasonRange(input: {
  seasonTypeId: string;
  startsOn: string;
  endsOn: string;
}): Promise<ActionResult<null>> {
  if (!input.startsOn || !input.endsOn) {
    return { ok: false, error: "Choose the start and the end." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_season_range", {
    p_season_type_id: input.seasonTypeId,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
  });
  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

/**
 * One date range of a season or event (0095). Unlike a room, a room type or a
 * tax rate, it really is deleted.
 * Nothing points at one — it is a label over dates — so removing it loses no
 * history and there is nothing to retire it from.
 */
export async function deleteSeason(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_season", { p_id: id });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  revalidatePath("/calendar");
  return { ok: true, data: null };
}

export async function saveStaffUser(input: {
  id: string;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  if (input.fullName.trim() === "") {
    return { ok: false, error: "A member of staff needs a name." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_staff_user", {
    p_id: input.id,
    p_full_name: input.fullName,
    p_role: input.role,
    p_is_active: input.isActive,
  });

  if (error) return { ok: false, error: error.message };

  revalidateSettings();
  return { ok: true, data: { id: data as string } };
}

/**
 * Creating and correcting a rate plan.
 *
 * A hotel sells several: Room Only, Bed and Breakfast, Non-refundable. Until
 * 0054 one could be created — from a corner of the Inventory screen — and never
 * renamed, retired or reordered, which is why the hosted property has exactly
 * one. Rate plans belong in Settings with the room types and the tax rates,
 * because setting them up is part of setting up the property rather than part
 * of pricing a week.
 *
 * There is no delete, for the same reason there is none for a room or a tax
 * rate: `rate_plan_days` and `booking_rooms` point at a plan, so one no longer
 * sold is `is_active = false`. A booking taken on it keeps saying what it was
 * sold on.
 */
export async function saveRatePlan(input: {
  id: string | null;
  code: string;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_rate_plan", {
    p_code: input.code,
    p_name: input.name,
    p_description: input.description.trim() || null,
    p_is_default: input.isDefault,
    p_is_active: input.isActive,
    p_id: input.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  // Every Inventory screen reads the plans, and the Rates grid draws a row per
  // plan per room type, so it moves the moment one is added or retired.
  revalidatePath("/inventory", "layout");
  return { ok: true, data: { id: data as string } };
}

/**
 * A cancellation policy (0093): the reference's form as structured choices,
 * and the sentence they add up to, which is stored as the policy's wording.
 * Postgres derives the kind and the free days the booking screen enforces
 * from the cancellation choice, so the two cannot disagree.
 */
export async function saveCancellationPolicyTerms(input: {
  id: string | null;
  name: string;
  terms: CancellationTerms;
  isDefault: boolean;
  summary: string;
}): Promise<ActionResult<{ id: string }>> {
  const t = input.terms;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_cancellation_policy_terms", {
    // Null adds a new policy; every other null is "not answered".
    p_id: nullableArg(input.id),
    p_name: input.name,
    p_deposit_rule: nullableArg(t.depositRule),
    p_deposit_nights: nullableArg(t.depositNights),
    p_deposit_percent_bps: nullableArg(t.depositPercentBps),
    p_deposit_amount_cents: nullableArg(t.depositAmountCents),
    p_refund_rule: nullableArg(t.refundRule),
    p_refund_days: nullableArg(t.refundDays),
    p_refund_custom: nullableArg(t.refundCustom),
    p_balance_due: nullableArg(t.balanceDue),
    p_preauthorise_card: t.preauthoriseCard,
    p_other_custom: nullableArg(t.otherCustom),
    p_cancel_rule: nullableArg(t.cancelRule),
    p_cancel_value: nullableArg(t.cancelValue),
    p_cancel_unit: nullableArg(t.cancelUnit),
    p_cancel_custom: nullableArg(t.cancelCustom),
    p_no_show_rule: nullableArg(t.noShowRule),
    p_no_show_custom: nullableArg(t.noShowCustom),
    p_breakfast_omit: t.breakfastOmit,
    p_breakfast_custom: nullableArg(t.breakfastCustom),
    p_is_default: input.isDefault,
    p_summary: input.summary,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  // The guest booking page quotes the terms, and a booking screen reads them.
  revalidatePath("/book", "layout");
  revalidatePath("/bookings", "layout");
  return { ok: true, data: { id: data as string } };
}

/** Refused by name when it is the default or any rate plan uses it. */
export async function deleteCancellationPolicy(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_cancellation_policy", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: null };
}

/**
 * One week of a rate plan on one room type, for a season or the Default
 * Season (0096). Stores the template and FILLS nights that have no value yet
 * -- the client's rule; nothing priced by hand is overwritten. Returns how
 * many nights got a price.
 */
export async function saveWeekRates(input: {
  ratePlanId: string;
  roomTypeId: string;
  seasonTypeId: string | null;
  days: {
    weekday: number;
    rateCents: number | null;
    minStayThrough: number | null;
    minStayArrival: number | null;
    maxStay: number | null;
    closedToArrival: boolean;
    closedToDeparture: boolean;
    stopSell: boolean;
  }[];
}): Promise<ActionResult<{ filled: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_week_rates", {
    p_rate_plan_id: input.ratePlanId,
    p_room_type_id: input.roomTypeId,
    // Null is the Default Season.
    p_season_type_id: nullableArg(input.seasonTypeId),
    p_days: input.days.map((d) => ({
      weekday: d.weekday,
      rate_cents: d.rateCents,
      min_stay_through: d.minStayThrough,
      min_stay_arrival: d.minStayArrival,
      max_stay: d.maxStay,
      closed_to_arrival: d.closedToArrival,
      closed_to_departure: d.closedToDeparture,
      stop_sell: d.stopSell,
    })),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/inventory", "layout");
  revalidatePath("/calendar");
  return { ok: true, data: { filled: Number(data ?? 0) } };
}

/** The reference's red bin: refused for the main rate and for a plan anything was sold on. */
export async function deleteRatePlan(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_rate_plan", { p_rate_plan_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/inventory", "layout");
  revalidatePath("/book", "layout");
  return { ok: true, data: null };
}

/**
 * Which policy a rate is sold on.
 *
 * Its own action rather than a field on `saveRatePlan()`, matching the RPC:
 * an optional parameter there would be an overload for PostgREST to choose
 * between, and renaming a plan would otherwise say "and no cancellation
 * policy" unless the form remembered to send it back. Null clears it.
 */
export async function setRatePlanCancellationPolicy(
  ratePlanId: string,
  cancellationPolicyId: string | null,
): Promise<ActionResult<null>> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_rate_plan_cancellation_policy", {
    p_rate_plan_id: ratePlanId,
    p_cancellation_policy_id: cancellationPolicyId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  revalidatePath("/inventory", "layout");
  revalidatePath("/book", "layout");
  revalidatePath("/bookings", "layout");
  return { ok: true, data: null };
}
