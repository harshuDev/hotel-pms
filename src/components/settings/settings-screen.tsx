"use client";

import { useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { RoomPhoto } from "@/components/settings/room-photo";
import { ExtrasPanel } from "@/components/settings/extras-panel";
import { FacilitiesPanel } from "@/components/settings/facilities-panel";
import {
  GuestDetailsPanel,
  IdentificationTypesPanel,
  RegistrationFormPanel,
} from "@/components/settings/guest-config-panels";
import type { GuestField, IdentificationType, RegistrationForm } from "@/lib/guest-config";
import { EmailPreferencesPanel } from "@/components/settings/email-preferences-panel";
import { HotelFeaturesPanel } from "@/components/settings/hotel-features-panel";
import type { HotelFeatures } from "@/lib/hotel-features";
import { CalendarSettingsPanel } from "@/components/settings/calendar-settings-panel";
import type { CalendarSettings } from "@/lib/calendar-settings";
import { LanguageSettingsPanel } from "@/components/settings/language-settings-panel";
import type { LanguageSettings } from "@/lib/language-settings";
import type { EmailSetup, EmailTemplate, HotelEmailSettings } from "@/lib/email-preferences";
import { EmailSetupPanel } from "@/components/settings/email-setup-panel";
import { FacilityIcon } from "@/components/settings/facility-icon";
import type { Facility } from "@/lib/facilities";
import type { ExtrasCatalog } from "@/lib/extras";
import { SETTINGS_NAV, type SettingsTab } from "@/lib/settings-tabs";
import { COUNTRIES } from "@/lib/countries";
import { CURRENCIES, currencyOptionLabel } from "@/lib/currencies";
import {
  CUSTOM_POLICY,
  HOTEL_POLICY_SECTIONS,
  OMIT_POLICY,
  hotelPolicySummary,
  type HotelPolicies,
  type HotelPolicyKey,
} from "@/lib/hotel-policies";

/*
 * Browser-only: Leaflet reaches for `window` the moment it is imported, so the
 * server renders the empty frame and the map arrives with the page's
 * JavaScript. The frame is the map's own height, so nothing jumps.
 */
const LocationMap = dynamic(() => import("@/components/settings/location-map"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] rounded-md border border-line bg-board" aria-hidden="true" />
  ),
});
import {
  createRooms,
  saveChannel,
  savePaymentMethod,
  saveHotelDetails,
  saveHotelPolicies,
  saveHotelTimes,
  saveRoom,
  saveRoomType,
  setRoomTypeDescription,
  setRoomTypeFacilities,
  saveSeason,
  deleteSeason,
  saveStaffUser,
  saveTaxRate,
  saveRatePlan,
  saveCancellationPolicy,
  setRatePlanCancellationPolicy,
  deleteRoom,
} from "@/lib/actions/settings";
import type {
  CalendarSeason,
  MealType,
  RatePlan,
  CancellationPolicy,
  CancellationPolicyKind,
  ChannelKind,
  ChannelSetting,
  PaymentMethodKind,
  PaymentMethodSetting,
  PropertySettings,
  RoomSettingsPage,
  RoomTypeSetting,
  StaffRole,
  StaffSetting,
  TaxRateSetting,
} from "@/lib/types";

export type { SettingsTab } from "@/lib/settings-tabs";

/** What a plan includes, in a guest's words. The set of meals IS the board type. */
const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

const CHANNEL_KINDS: { value: ChannelKind; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "ota", label: "OTA" },
  { value: "wholesaler", label: "Wholesaler" },
  { value: "gds", label: "GDS" },
  { value: "offline", label: "Offline" },
];

const ROLES: { value: StaffRole; label: string; note: string }[] = [
  { value: "admin", label: "Administrator", note: "Everything, including staff" },
  { value: "manager", label: "Manager", note: "Rates, settings, the night audit, the drawer total" },
  { value: "front_desk", label: "Front desk", note: "Bookings, check-in and out, payments" },
  { value: "cashier", label: "Cashier", note: "Payments and the drawer" },
  { value: "housekeeping", label: "Housekeeping", note: "Room status, and no money at all" },
];

/**
 * payment_methods carries `unique (property_id, kind)`, so this list is the
 * whole space of methods a property can have — never a free-form list. A kind
 * already taken is offered only on the method that holds it.
 */
const PAYMENT_KINDS: { value: PaymentMethodKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "ota_prepaid", label: "Prepaid to the channel" },
  { value: "virtual_card", label: "Virtual card" },
  { value: "complimentary", label: "Complimentary" },
  { value: "other", label: "Other" },
];

const ROOM_STATUS_LABEL: Record<string, string> = {
  vacant_clean: "Vacant, clean",
  vacant_dirty: "Vacant, dirty",
  occupied: "Occupied",
  ooo: "Out of order",
};

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const card = "rounded-lg border border-line bg-white p-5 shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink";
/* Property ID and slug: shown, greyed, never typed in -- as the reference's. */
const readOnlyField =
  "w-full cursor-default rounded-md border border-line bg-shell px-3 py-2 text-[13px] text-ink-faint focus:outline-none";

/**
 * One row of Hotel Details: the label on the left with its colon, the input
 * on the right, as the client's reference lays the form out. Stacks on a
 * phone, where two columns of that width do not fit.
 */
function DetailRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[13.5rem_1fr] sm:items-start sm:gap-4">
      <label htmlFor={htmlFor} className="text-[13.5px] text-ink sm:pt-2">
        {label}:
      </label>
      <div>{children}</div>
    </div>
  );
}

/** A coordinate field's text as a number, or null while it is blank or half-typed. */
function parseCoordinate(text: string): number | null {
  const t = text.trim();
  if (t === "" || t === "-" || t.endsWith(".")) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The timezone options: the server's list, plus the saved value and the
 * browser's own zone if either is missing from it. Browsers still report
 * old names like "Asia/Calcutta" that newer lists spell "Asia/Kolkata";
 * Postgres accepts both, and a select cannot show a value it has no option
 * for.
 */
function zoneOptions(list: string[], saved: string, browser: string | null): string[] {
  const extra = [saved, browser].filter(
    (z): z is string => z !== null && z !== "" && !list.includes(z),
  );
  return extra.length ? [...new Set([...extra, ...list])].sort() : list;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-xs leading-relaxed text-ink-faint">{children}</p>
  );
}

export function SettingsScreen({
  tab,
  property,
  roomTypes,
  rooms,
  roomQuery,
  channels,
  taxRates,
  seasons,
  ratePlans,
  cancellationPolicies,
  paymentMethods,
  staff,
  editRoomTypeId,
  meId,
  canEdit,
  isAdmin,
  timezones,
  hotelPolicies,
  extrasCatalog,
  facilities,
  identificationTypes,
  guestFields,
  registrationForm,
  emailSettings,
  emailSetup,
  emailTemplates,
  hotelFeatures,
  calendarSettings,
  languageSettings,
}: {
  tab: SettingsTab;
  property: PropertySettings;
  /** IANA zones, listed on the server so both renders offer the same ones. */
  timezones: string[];
  /** Hotel Content -> Hotel Policy (0068). */
  hotelPolicies: HotelPolicies;
  /** Hotel Content -> Extras (0069). */
  extrasCatalog: ExtrasCatalog;
  /** Hotel Content -> Room Type Facilities (0070). */
  facilities: Facility[];
  /** Settings -> Guest Configuration (0073). */
  identificationTypes: IdentificationType[];
  guestFields: GuestField[];
  registrationForm: RegistrationForm;
  /** Communications & Notifications -> Hotel Emails Preferences (0074). */
  emailSettings: HotelEmailSettings;
  /** Communications & Notifications -> Email Setup (0075). */
  emailSetup: EmailSetup;
  emailTemplates: EmailTemplate[];
  /** System Settings -> Hotel Features (0076). */
  hotelFeatures: HotelFeatures;
  /** System Settings -> Calendar Settings (0077). */
  calendarSettings: CalendarSettings;
  /** System Settings -> Language Settings (0078). */
  languageSettings: LanguageSettings;
  roomTypes: RoomTypeSetting[];
  rooms: RoomSettingsPage;
  roomQuery: string;
  channels: ChannelSetting[];
  taxRates: TaxRateSetting[];
  seasons: CalendarSeason[];
  ratePlans: RatePlan[];
  cancellationPolicies: CancellationPolicy[];
  paymentMethods: PaymentMethodSetting[];
  /** A room type to open for editing on arrival, from the calendar's rail. */
  editRoomTypeId: string | null;
  staff: StaffSetting[];
  meId: string | null;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setMessage({ ok: false, text: result.error ?? "That did not work." });
        return;
      }
      setMessage({ ok: true, text: done });
      router.refresh();
    });
  }

  /* -- Property ------------------------------------------------------- */
  /* -- Hotel Details (0067) ------------------------------------------ */
  // Every value a string, as the inputs hold them: a coordinate half-typed as
  // "51." is not a number yet, and a number state would snap it under the
  // cursor. The action turns them back into numbers and refuses what is not.
  const [details, setDetails] = useState({
    name: property.name,
    timezone: property.timezone,
    currency: property.currency,
    propertyType: property.propertyType,
    companyName: property.companyName ?? "",
    companyRegistrationId: property.companyRegistrationId ?? "",
    country: property.country ?? "",
    addressLine1: property.addressLine1 ?? "",
    addressLine2: property.addressLine2 ?? "",
    city: property.city ?? "",
    region: property.region ?? "",
    postcode: property.postcode ?? "",
    latitude: property.latitude === null ? "" : String(property.latitude),
    longitude: property.longitude === null ? "" : String(property.longitude),
    phone: property.phone ?? "",
    fax: property.fax ?? "",
    email: property.email ?? "",
    website: property.website ?? "",
  });

  /*
   * The browser's own timezone, for "Your current timezone is: ... Set as
   * hotel timezone", as the reference offers. Read after mount and never
   * during render: the server has no idea which zone the reader is in, so
   * rendering it would put one value on the server and another in the
   * browser -- the hydration mismatch this project has already met on dates.
   */
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  useEffect(() => {
    try {
      setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setBrowserZone(null);
    }
  }, []);

  /* -- Hotel Properties: the three times ------------------------------- */
  /* -- Hotel Policy (0068) ------------------------------------------- */
  const [policies, setPolicies] = useState<HotelPolicies>(hotelPolicies);
  const customField = (key: HotelPolicyKey) => `${key}Custom` as const;
  const policySummary = hotelPolicySummary({
    choice: (key) => policies[key],
    custom: (key) => policies[customField(key)],
    other: policies.otherPolicies,
  });

  const [editingTimes, setEditingTimes] = useState(false);
  const [times, setTimes] = useState({
    checkInTime: property.checkInTime?.slice(0, 5) ?? "15:00",
    checkOutTime: property.checkOutTime?.slice(0, 5) ?? "11:00",
    auditCloseTime: property.auditCloseTime.slice(0, 5),
  });

  /* -- Room types ----------------------------------------------------- */
  const [rt, setRt] = useState<{
    id: string | null;
    code: string;
    name: string;
    baseOccupancy: string;
    maxOccupancy: string;
    /** Ticked facilities (0070), saved with the room type as one set. */
    facilityIds: string[];
    /** Shown to guests on the booking page (0072). */
    description: string;
  } | null>(() => {
    // The calendar's rail links here to rename a type, so arriving with that
    // id opens its form rather than a list somebody then has to search. An id
    // that no longer exists opens nothing, which is the right nothing.
    const t = roomTypes.find((x) => x.id === editRoomTypeId);
    if (!t) return null;
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      baseOccupancy: String(t.baseOccupancy),
      maxOccupancy: String(t.maxOccupancy),
      facilityIds: t.facilityIds,
      description: t.description ?? "",
    };
  });

  /* -- Rooms ---------------------------------------------------------- */
  const [run_, setRun] = useState({
    roomTypeId: roomTypes[0]?.id ?? "",
    first: "",
    last: "",
    floor: "",
    prefix: "",
  });

  /* -- One room ------------------------------------------------------- */
  const [room, setRoom] = useState<{
    id: string;
    number: string;
    roomTypeId: string;
    floor: string;
  } | null>(null);
  const [roomSearch, setRoomSearch] = useState(roomQuery);

  function goToRooms(q: string, page: number) {
    const params = new URLSearchParams({ tab: "rooms" });
    if (q.trim() !== "") params.set("q", q.trim());
    if (page > 1) params.set("page", String(page));
    router.push(`/settings?${params.toString()}`);
  }

  /* -- Payment methods ------------------------------------------------- */
  const [pm, setPm] = useState<{
    id: string | null;
    name: string;
    kind: PaymentMethodKind;
    isActive: boolean;
    frozen: boolean;
  } | null>(null);

  /* -- Channels ------------------------------------------------------- */
  const [ch, setCh] = useState<{
    id: string | null;
    code: string;
    name: string;
    kind: ChannelKind;
    commission: string;
    isActive: boolean;
  } | null>(null);

  /* -- Tax ------------------------------------------------------------ */
  const [tx, setTx] = useState<{
    id: string | null;
    name: string;
    percent: string;
    inclusion: "inclusive" | "exclusive";
    isActive: boolean;
  } | null>(null);

  const [sn, setSn] = useState<{
    id: string | null;
    name: string;
    startsOn: string;
    endsOn: string;
  } | null>(null);

  const [rp, setRp] = useState<{
    id: string | null;
    code: string;
    name: string;
    description: string;
    isDefault: boolean;
    isActive: boolean;
  } | null>(null);

  const [cp, setCp] = useState<{
    id: string | null;
    name: string;
    kind: CancellationPolicyKind;
    /* A string, not a number: an emptied field is "" while somebody retypes,
       and a number state would turn that into 0 under their cursor. */
    freeCancellationDays: string;
    description: string;
    isActive: boolean;
    sortOrder: number;
  } | null>(null);

  return (
    /*
      THE REFERENCE'S LAYOUT: a dark sidebar down the left, the panel on the
      right. Pulled out to the edges of `main` with negative margins so the
      sidebar runs flush and full height, the way theirs does. 5.75rem is the
      nav bar (h-14) plus the top bar (h-9) above it.

      This is a sidebar INSIDE Settings, not an application sidebar. The app's
      own navigation stays horizontal across the top, as CLAUDE.md requires --
      the reference is built the same way.
    */
    <div className="-m-3 flex min-h-[calc(100vh-5.75rem)] flex-col sm:-m-5 lg:flex-row">
      <SettingsSidebar tab={tab} />
      <div className="min-w-0 flex-1 space-y-3 p-3 sm:p-5">
      {message && (
        <p
          className={cn(
            "rounded-md px-3 py-2.5 text-[13px] leading-relaxed",
            message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700",
          )}
        >
          {message.text}
        </p>
      )}

      {!canEdit && (
        <p className={cn(card, "text-[13px] leading-relaxed text-ink-muted")}>
          You can read the settings but not change them. Rooms, rates and
          booking sources are set by managers and administrators.
        </p>
      )}

      {/* Hotel Details --------------------------------------------------- */}
      {tab === "property" && (
        /*
          Settings > Hotel Profile > Hotel Details, cloned from the client's
          reference field for field and label for label, colons included:
          a label column on the left, the input on the right, one card.
        */
        <div className={cn(card, "max-w-3xl p-6 sm:p-7")}>
          <h2 className="mb-6 font-display text-[26px] font-semibold tracking-tightest text-ink">
            Hotel Details
          </h2>

          <div className="space-y-4">
            <DetailRow label="Property ID" htmlFor="d-id">
              <input id="d-id" value={property.id} readOnly className={readOnlyField} />
            </DetailRow>
            <DetailRow label="Property slug" htmlFor="d-slug">
              <input id="d-slug" value={property.slug ?? ""} readOnly className={readOnlyField} />
            </DetailRow>
            <DetailRow label="Company Name" htmlFor="d-company">
              <input
                id="d-company"
                value={details.companyName}
                placeholder="Company Name"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, companyName: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Company registration id" htmlFor="d-reg">
              <input
                id="d-reg"
                value={details.companyRegistrationId}
                placeholder="Company registration id"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, companyRegistrationId: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Property type" htmlFor="d-type">
              <input
                id="d-type"
                value={details.propertyType}
                placeholder="Property type"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, propertyType: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Country" htmlFor="d-country">
              <select
                id="d-country"
                value={details.country}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, country: e.target.value })}
                className={field}
              >
                <option value="">Country</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </DetailRow>
            <DetailRow label="Name of your hotel" htmlFor="d-name">
              <input
                id="d-name"
                value={details.name}
                placeholder="Name of your hotel"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, name: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Address" htmlFor="d-addr1">
              <input
                id="d-addr1"
                value={details.addressLine1}
                placeholder="Address"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, addressLine1: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Address line 2" htmlFor="d-addr2">
              <input
                id="d-addr2"
                value={details.addressLine2}
                placeholder="Address line 2"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, addressLine2: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="City / Town / Village" htmlFor="d-city">
              <input
                id="d-city"
                value={details.city}
                placeholder="City / Town / Village"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, city: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="County / State / Province" htmlFor="d-region">
              <input
                id="d-region"
                value={details.region}
                placeholder="County / State / Province"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, region: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Postcode" htmlFor="d-post">
              <input
                id="d-post"
                value={details.postcode}
                placeholder="Postcode"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, postcode: e.target.value })}
                className={field}
              />
            </DetailRow>

            <h3 className="pt-3 text-[18px] text-ink">Location</h3>
            <DetailRow label="Latitude" htmlFor="d-lat">
              <input
                id="d-lat"
                inputMode="decimal"
                value={details.latitude}
                placeholder="Latitude"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, latitude: e.target.value })}
                className={cn(field, "tnum")}
              />
            </DetailRow>
            <DetailRow label="Longitude" htmlFor="d-lng">
              <input
                id="d-lng"
                inputMode="decimal"
                value={details.longitude}
                placeholder="Longitude"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, longitude: e.target.value })}
                className={cn(field, "tnum")}
              />
            </DetailRow>
            {/*
              The map reads the two fields above and writes back to them: drag
              the pin or click the map and they change; type in them and the pin
              moves. A half-typed value that is not yet a number simply leaves
              the pin where it was.
            */}
            <LocationMap
              latitude={parseCoordinate(details.latitude)}
              longitude={parseCoordinate(details.longitude)}
              disabled={!canEdit}
              onChange={(lat, lng) =>
                setDetails((d) => ({ ...d, latitude: String(lat), longitude: String(lng) }))
              }
            />

            <DetailRow label="Telephone Number" htmlFor="d-phone">
              <input
                id="d-phone"
                type="tel"
                value={details.phone}
                placeholder="Telephone Number"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, phone: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Fax Number" htmlFor="d-fax">
              <input
                id="d-fax"
                type="tel"
                value={details.fax}
                placeholder="Fax Number"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, fax: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Email address" htmlFor="d-email">
              <input
                id="d-email"
                type="email"
                value={details.email}
                placeholder="Email address"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, email: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Website" htmlFor="d-web">
              <input
                id="d-web"
                type="url"
                value={details.website}
                placeholder="Website"
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, website: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label="Currency" htmlFor="d-cur">
              <select
                id="d-cur"
                value={details.currency}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, currency: e.target.value })}
                className={field}
              >
                {/* The saved value stays offered even if it is not in the list. */}
                {!CURRENCIES.some((c) => c.code === details.currency) && (
                  <option value={details.currency}>{details.currency}</option>
                )}
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {currencyOptionLabel(c.code)}
                  </option>
                ))}
              </select>
            </DetailRow>
            <DetailRow label="What is your timezone" htmlFor="d-tz">
              <select
                id="d-tz"
                value={details.timezone}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, timezone: e.target.value })}
                className={field}
              >
                {zoneOptions(timezones, details.timezone, browserZone).map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
              {browserZone && (
                <p className="mt-1.5 text-[13px] text-ink-muted">
                  Your current timezone is: {browserZone}.{" "}
                  {canEdit && browserZone !== details.timezone && (
                    <button
                      type="button"
                      onClick={() => setDetails({ ...details, timezone: browserZone })}
                      className="text-brass hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      Set as hotel timezone
                    </button>
                  )}
                </p>
              )}
            </DetailRow>
          </div>

          {canEdit && (
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => run(() => saveHotelDetails(details), "Hotel details saved.")}
                disabled={pending}
                className={primary}
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hotel Properties ------------------------------------------------ */}
      {tab === "hotel-properties" && (
        /*
          The reference's Properties list. One row, because a staff login
          belongs to one property: staff_users.property_id is a single column
          and every RLS policy keys off it. So there is no Add New Property and
          no delete — a second property would be one nobody here could open,
          and every table points at this one under on delete restrict. The
          pencil opens the three times that used to sit on the Property form.
        */
        <div className="max-w-5xl space-y-5">
          <h2 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
            Hotel Properties
          </h2>

          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
            <h3 className="border-b border-line px-6 py-4 text-[16px] text-ink">
              Properties list
            </h3>
            <div className="overflow-x-auto px-6 py-6">
              <table className="w-full min-w-[34rem] text-[13.5px]">
                <thead>
                  <tr className="bg-shell text-left text-ink">
                    <th className="w-[38%] px-4 py-4 font-normal">
                      <span className="block border-r border-line">Property name</span>
                    </th>
                    <th className="px-4 py-4 font-normal">
                      <span className="block border-r border-line">Address</span>
                    </th>
                    <th className="w-20 px-4 py-4" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line">
                    <td className="px-4 py-5 text-ink">{property.name}</td>
                    <td className="px-4 py-5 text-ink">
                      {[
                        property.postcode,
                        property.city,
                        property.region,
                        property.addressLine1,
                        property.addressLine2,
                      ]
                        .filter((part) => part && part.trim() !== "")
                        .join(", ") || "—"}
                    </td>
                    <td className="px-4 py-5 text-right">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setEditingTimes(true)}
                          aria-label={`Edit ${property.name}`}
                          title="Edit"
                          className="rounded p-1 text-ink hover:bg-shell"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-[18px] w-[18px]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M4 20h16" />
                            <path d="M14.5 5.5l3 3L8 18H5v-3z" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {editingTimes && canEdit && (
            <div className={cn(card, "p-6 sm:p-7")}>
              <h3 className="mb-6 font-display text-[18px] font-semibold tracking-tightest text-ink">
                {property.name}
              </h3>
              <div className="space-y-4">
                <DetailRow label="Check-in from" htmlFor="h-in">
                  <input
                    id="h-in"
                    type="time"
                    value={times.checkInTime}
                    onChange={(e) => setTimes({ ...times, checkInTime: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </DetailRow>
                <DetailRow label="Check-out by" htmlFor="h-out">
                  <input
                    id="h-out"
                    type="time"
                    value={times.checkOutTime}
                    onChange={(e) => setTimes({ ...times, checkOutTime: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </DetailRow>
                <DetailRow label="Night audit at" htmlFor="h-audit">
                  <input
                    id="h-audit"
                    type="time"
                    value={times.auditCloseTime}
                    onChange={(e) => setTimes({ ...times, auditCloseTime: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </DetailRow>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingTimes(false)}
                  className={secondary}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      const result = await saveHotelTimes(times);
                      if (result.ok) setEditingTimes(false);
                      return result;
                    }, "Hotel properties saved.")
                  }
                  disabled={pending}
                  className={primary}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "hotel-policy" && (
        /*
          The reference's Hotel Policy, section for section. Each is a choice
          from its own short list, "Custom policy" with the hotel's words, or
          "Omit this policy"; the line above Save is those choices as a guest
          would read them, following the form as it is edited.
        */
        <div className="max-w-5xl space-y-5">
          <h2 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
            Hotel Policy
          </h2>

          <div className={cn(card, "px-6 py-7 sm:px-10")}>
            <div className="space-y-8">
              {HOTEL_POLICY_SECTIONS.map((section) => {
                const choice = policies[section.key];
                const custom = customField(section.key);
                const name = `policy-${section.key}`;
                return (
                  <fieldset key={section.key}>
                    <legend className="w-full border-b border-line pb-2 text-[20px] text-ink">
                      {section.title}
                    </legend>
                    {section.prompt && (
                      <p className="mt-4 text-[14px] text-ink-muted">{section.prompt}</p>
                    )}
                    <div className={cn("space-y-2", section.prompt ? "mt-2" : "mt-4")}>
                      {[
                        ...section.options,
                        { id: CUSTOM_POLICY, label: "Custom policy" },
                        { id: OMIT_POLICY, label: "Omit this policy" },
                      ].map((option) => (
                        <label
                          key={option.id}
                          className="flex w-fit items-center gap-2 text-[14px] text-ink-muted"
                        >
                          <input
                            type="radio"
                            name={name}
                            value={option.id}
                            checked={choice === option.id}
                            disabled={!canEdit}
                            onChange={() =>
                              setPolicies({ ...policies, [section.key]: option.id })
                            }
                            className="h-3.5 w-3.5 accent-brass"
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                    {choice === CUSTOM_POLICY && (
                      <textarea
                        aria-label={`${section.title} policy`}
                        value={policies[custom] ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setPolicies({ ...policies, [custom]: e.target.value })
                        }
                        rows={2}
                        className={cn(field, "mt-3")}
                      />
                    )}
                  </fieldset>
                );
              })}

              <div>
                <h3 className="w-full border-b border-line pb-2 text-[20px] text-ink">
                  <label htmlFor="policy-other">Other Policies</label>
                </h3>
                <textarea
                  id="policy-other"
                  value={policies.otherPolicies ?? ""}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setPolicies({ ...policies, otherPolicies: e.target.value })
                  }
                  rows={3}
                  className={cn(field, "mt-5")}
                />
              </div>
            </div>

            {policySummary && (
              <p className="mt-6 text-[14px] leading-relaxed text-ink">{policySummary}</p>
            )}

            {canEdit && (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => run(() => saveHotelPolicies(policies), "Hotel policy saved.")}
                  disabled={pending}
                  className={primary}
                >
                  Save
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "extras" && (
        <ExtrasPanel
          catalog={extrasCatalog}
          taxRates={taxRates}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "facilities" && (
        <FacilitiesPanel
          facilities={facilities}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "guest-registration" && (
        <RegistrationFormPanel form={registrationForm} canEdit={canEdit} pending={pending} run={run} />
      )}
      {tab === "identification-types" && (
        <IdentificationTypesPanel types={identificationTypes} canEdit={canEdit} pending={pending} run={run} />
      )}
      {tab === "guest-details" && (
        <GuestDetailsPanel
          // Remounts on the saved list, so rows added before a save pick up
          // their new ids -- otherwise saving twice would add them twice.
          key={guestFields.map((f) => `${f.id}:${f.label}:${f.kind}`).join("|")}
          fields={guestFields}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "email-preferences" && (
        <EmailPreferencesPanel settings={emailSettings} canEdit={canEdit} pending={pending} run={run} />
      )}

      {tab === "email-setup" && (
        <EmailSetupPanel
          setup={emailSetup}
          templates={emailTemplates}
          propertyName={property.name}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "hotel-features" && (
        <HotelFeaturesPanel
          // Re-seeded from what was saved, so a save that the server changed
          // (or another tab's) is what the ticks show.
          key={JSON.stringify(hotelFeatures)}
          features={hotelFeatures}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "calendar-settings" && (
        <CalendarSettingsPanel
          key={JSON.stringify(calendarSettings)}
          settings={calendarSettings}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "language-settings" && (
        <LanguageSettingsPanel
          // Re-seeded after each save, so the default's list is the saved
          // supported set.
          key={JSON.stringify(languageSettings)}
          settings={languageSettings}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {/* Room types ---------------------------------------------------- */}
      {tab === "room-types" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Room types
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setRt({
                      id: null,
                      code: "",
                      name: "",
                      baseOccupancy: "2",
                      maxOccupancy: "2",
                      facilityIds: [],
                      description: "",
                    })
                  }
                  className={secondary}
                >
                  New room type
                </button>
              )}
            </div>

            {roomTypes.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-muted">
                None yet. Add a room type before anything else.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Code", "Name", "Sleeps", "Rooms", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {roomTypes.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2.5 font-medium text-ink">{t.code}</td>
                      <td className="px-3 py-2.5 text-ink">{t.name}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">
                        {t.baseOccupancy}
                        {t.maxOccupancy > t.baseOccupancy && `–${t.maxOccupancy}`}
                      </td>
                      <td
                        className={cn(
                          "tnum px-3 py-2.5",
                          t.roomCount === 0 ? "text-warn-deep" : "text-ink-muted",
                        )}
                      >
                        {t.roomCount === 0 ? "none yet" : t.roomCount}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <button
                            onClick={() =>
                              setRt({
                                id: t.id,
                                code: t.code,
                                name: t.name,
                                baseOccupancy: String(t.baseOccupancy),
                                maxOccupancy: String(t.maxOccupancy),
                                facilityIds: t.facilityIds,
                                description: t.description ?? "",
                              })
                            }
                            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {rt && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {rt.id ? "Edit room type" : "New room type"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <label htmlFor="rt-code" className={label}>Code</label>
                  <input
                    id="rt-code"
                    value={rt.code}
                    placeholder="DBL"
                    onChange={(e) => setRt({ ...rt, code: e.target.value.toUpperCase() })}
                    className={cn(field, "uppercase")}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="rt-name" className={label}>Name</label>
                  <input
                    id="rt-name"
                    value={rt.name}
                    placeholder="Double"
                    onChange={(e) => setRt({ ...rt, name: e.target.value })}
                    className={field}
                  />
                </div>
                <div className="flex gap-2">
                  <div>
                    <label htmlFor="rt-base" className={label}>Sleeps</label>
                    <input
                      id="rt-base"
                      inputMode="numeric"
                      value={rt.baseOccupancy}
                      onChange={(e) => setRt({ ...rt, baseOccupancy: e.target.value })}
                      className={cn(field, "tnum")}
                    />
                  </div>
                  <div>
                    <label htmlFor="rt-max" className={label}>Max</label>
                    <input
                      id="rt-max"
                      inputMode="numeric"
                      value={rt.maxOccupancy}
                      onChange={(e) => setRt({ ...rt, maxOccupancy: e.target.value })}
                      className={cn(field, "tnum")}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <label htmlFor="rt-description" className={label}>Description</label>
                <textarea
                  id="rt-description"
                  rows={3}
                  value={rt.description}
                  onChange={(e) => setRt({ ...rt, description: e.target.value })}
                  className={field}
                />
              </div>
              {facilities.length > 0 && (
                <fieldset className="mt-5">
                  <legend className={label}>Facilities</legend>
                  <div className="mt-1 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                    {facilities.map((f) => (
                      <label
                        key={f.id}
                        className="flex items-center gap-2 text-[13px] text-ink"
                      >
                        <input
                          type="checkbox"
                          checked={rt.facilityIds.includes(f.id)}
                          onChange={(e) =>
                            setRt({
                              ...rt,
                              facilityIds: e.target.checked
                                ? [...rt.facilityIds, f.id]
                                : rt.facilityIds.filter((id) => id !== f.id),
                            })
                          }
                          className="h-3.5 w-3.5 accent-brass"
                        />
                        <FacilityIcon name={f.icon} className="h-[15px] w-[15px] text-ink-muted" />
                        {f.title}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setRt(null)} className={secondary}>Cancel</button>
                <button
                  onClick={() =>
                    run(async () => {
                      const saved = await saveRoomType({
                        id: rt.id,
                        code: rt.code,
                        name: rt.name,
                        baseOccupancy: Number(rt.baseOccupancy) || 1,
                        maxOccupancy: Number(rt.maxOccupancy) || 1,
                      });
                      if (!saved.ok) return saved;
                      // The room type first, so a new one has an id to hang
                      // its description and facilities on.
                      const described = await setRoomTypeDescription({
                        roomTypeId: saved.data.id,
                        description: rt.description,
                      });
                      if (!described.ok || facilities.length === 0) return described;
                      return setRoomTypeFacilities({
                        roomTypeId: saved.data.id,
                        facilityIds: rt.facilityIds,
                      });
                    }, `${rt.name || "Room type"} saved.`)
                  }
                  disabled={pending}
                  className={primary}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Rooms --------------------------------------------------------- */}
      {tab === "rooms" && (
        <>
        <div className={card}>
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            Add rooms
          </h2>

          {roomTypes.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              Add a room type first — every room belongs to one.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-5">
                <div className="sm:col-span-2">
                  <label htmlFor="r-type" className={label}>Room type</label>
                  <select
                    id="r-type"
                    value={run_.roomTypeId}
                    disabled={!canEdit}
                    onChange={(e) => setRun({ ...run_, roomTypeId: e.target.value })}
                    className={field}
                  >
                    {roomTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="r-first" className={label}>From</label>
                  <input
                    id="r-first"
                    inputMode="numeric"
                    placeholder="101"
                    value={run_.first}
                    disabled={!canEdit}
                    onChange={(e) => setRun({ ...run_, first: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
                <div>
                  <label htmlFor="r-last" className={label}>To</label>
                  <input
                    id="r-last"
                    inputMode="numeric"
                    placeholder="120"
                    value={run_.last}
                    disabled={!canEdit}
                    onChange={(e) => setRun({ ...run_, last: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
                <div>
                  <label htmlFor="r-floor" className={label}>Floor</label>
                  <input
                    id="r-floor"
                    inputMode="numeric"
                    placeholder="1"
                    value={run_.floor}
                    disabled={!canEdit}
                    onChange={(e) => setRun({ ...run_, floor: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
              </div>
              {canEdit && (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-ink-faint">
                    Correct a room afterwards from the list below.
                  </p>
                  <button
                    onClick={() =>
                      run(
                        () =>
                          createRooms({
                            roomTypeId: run_.roomTypeId,
                            first: Number(run_.first),
                            last: Number(run_.last),
                            floor: run_.floor.trim() === "" ? null : Number(run_.floor),
                            prefix: run_.prefix,
                          }),
                        "Rooms added.",
                      )
                    }
                    disabled={pending || run_.first === "" || run_.last === ""}
                    className={primary}
                  >
                    {pending ? "Adding…" : "Add the run"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* The rooms themselves ---------------------------------------- */}
        <div className={card}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
              Rooms
              {rooms.total > 0 && (
                <span className="tnum ml-2 text-[13px] font-normal text-ink-faint">
                  {rooms.total}
                </span>
              )}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                goToRooms(roomSearch, 1);
              }}
              className="flex items-center gap-2"
            >
              <label htmlFor="room-q" className="sr-only">
                Search rooms
              </label>
              <input
                id="room-q"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                placeholder="Room number or type"
                className={cn(field, "w-56")}
              />
              <button type="submit" className={secondary}>
                Search
              </button>
              {roomQuery !== "" && (
                <button
                  type="button"
                  onClick={() => {
                    setRoomSearch("");
                    goToRooms("", 1);
                  }}
                  className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Clear
                </button>
              )}
            </form>
          </div>

          {rooms.rows.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              {roomQuery !== ""
                ? `No room matches \u201C${roomQuery}\u201D. Try the number on its own, or the room type.`
                : "No rooms yet \u2014 add a run above."}
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  {["", "Room", "Floor", "Type", "Status", ""].map((c, i) => (
                    <th
                      key={c || i}
                      className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rooms.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pl-3 pr-0">
                      <span className="block h-9 w-12 overflow-hidden rounded border border-line bg-shell">
                        {r.photoUrl && (
                          /* eslint-disable-next-line @next/next/no-img-element --
                             the bucket is a runtime host; next/image would want
                             it in remotePatterns and a rebuild per property. */
                          <img
                            src={r.photoUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                      </span>
                    </td>
                    <td className="tnum px-3 py-2.5 font-medium text-ink">
                      {r.number}
                    </td>
                    <td className="tnum px-3 py-2.5 text-ink-muted">
                      {r.floor ?? "\u2014"}
                    </td>
                    <td className="px-3 py-2.5 text-ink">{r.roomTypeName}</td>
                    <td className="px-3 py-2.5 text-ink-muted">
                      {ROOM_STATUS_LABEL[r.status] ?? r.status}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canEdit && (
                        <button
                          onClick={() =>
                            setRoom({
                              id: r.id,
                              number: r.number,
                              roomTypeId: r.roomTypeId,
                              floor: r.floor === null ? "" : String(r.floor),
                            })
                          }
                          className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                        >
                          Edit
                        </button>
                      )}
                      {canEdit && !r.hasBookings && (
                        <button
                          onClick={() => {
                            if (
                              !confirm(
                                `Delete room ${r.number}? This cannot be undone.`,
                              )
                            ) {
                              return;
                            }
                            run(
                              () => deleteRoom(r.id),
                              `Room ${r.number} deleted.`,
                            );
                          }}
                          disabled={pending}
                          className="ml-3 text-rose-600 underline-offset-2 hover:underline disabled:opacity-40"
                        >
                          Delete
                        </button>
                      )}
                      {canEdit && r.hasBookings && (
                        <span
                          title="This room has bookings against it. Put it out of order instead."
                          className="ml-3 text-ink-faint"
                        >
                          Booked
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {rooms.total > rooms.perPage && (
            <div className="mt-4 flex items-center justify-between gap-3 text-[13px]">
              <button
                onClick={() => goToRooms(roomQuery, rooms.page - 1)}
                disabled={rooms.page <= 1}
                className={cn(secondary, "disabled:opacity-40")}
              >
                Previous
              </button>
              <span className="tnum text-ink-faint">
                {(rooms.page - 1) * rooms.perPage + 1}
                {"\u2013"}
                {Math.min(rooms.page * rooms.perPage, rooms.total)} of {rooms.total}
              </span>
              <button
                onClick={() => goToRooms(roomQuery, rooms.page + 1)}
                disabled={rooms.page * rooms.perPage >= rooms.total}
                className={cn(secondary, "disabled:opacity-40")}
              >
                Next
              </button>
            </div>
          )}

        </div>

        {room && (
          <div className={card}>
            <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
              Room {room.number}
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="room-number" className={label}>Number</label>
                <input
                  id="room-number"
                  value={room.number}
                  onChange={(e) => setRoom({ ...room, number: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </div>
              <div>
                <label htmlFor="room-type" className={label}>Room type</label>
                <select
                  id="room-type"
                  value={room.roomTypeId}
                  onChange={(e) => setRoom({ ...room, roomTypeId: e.target.value })}
                  className={field}
                >
                  {roomTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="room-floor" className={label}>Floor</label>
                <input
                  id="room-floor"
                  inputMode="numeric"
                  placeholder="Leave blank if none"
                  value={room.floor}
                  onChange={(e) => setRoom({ ...room, floor: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </div>
            </div>
            {room.id && (
              <div className="mt-5 border-t border-line pt-4">
                <span className={label}>Picture</span>
                {/*
                  Read off the list rather than held in the edit form's state:
                  the upload refreshes the page, so the row is the fresher of
                  the two and a copy in state would go stale the moment a
                  picture changed.
                */}
                <RoomPhoto
                  propertyId={property.id}
                  roomId={room.id}
                  roomNumber={room.number}
                  photoUrl={
                    rooms.rows.find((r) => r.id === room.id)?.photoUrl ?? null
                  }
                  photoPath={
                    rooms.rows.find((r) => r.id === room.id)?.photoPath ?? null
                  }
                />
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() =>
                  run(
                    () =>
                      saveRoom({
                        id: room.id,
                        number: room.number,
                        roomTypeId: room.roomTypeId,
                        floor:
                          room.floor.trim() === "" ? null : Number(room.floor),
                      }).then((r) => {
                        if (r.ok) setRoom(null);
                        return r;
                      }),
                    "Room saved.",
                  )
                }
                disabled={pending}
                className={primary}
              >
                {pending ? "Saving\u2026" : "Save the room"}
              </button>
              <button onClick={() => setRoom(null)} className={secondary}>
                Cancel
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {/* Channels ------------------------------------------------------ */}
      {tab === "channels" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Booking sources
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setCh({
                      id: null,
                      code: "",
                      name: "",
                      kind: "direct",
                      commission: "0",
                      isActive: true,
                    })
                  }
                  className={secondary}
                >
                  New source
                </button>
              )}
            </div>

            {channels.length === 0 ? (
              <p className="rounded-md bg-warn-wash px-3 py-3 text-center text-[13px] leading-relaxed text-warn-deep">
                None yet. Add at least &ldquo;Direct&rdquo; — a booking cannot
                be taken without a source.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Code", "Name", "Kind", "Commission", "", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {channels.map((c) => (
                    <tr key={c.id} className={cn(!c.isActive && "opacity-55")}>
                      <td className="px-3 py-2.5 font-medium text-ink">{c.code}</td>
                      <td className="px-3 py-2.5 text-ink">{c.name}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{c.kind}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">
                        {c.commissionBps === 0 ? "—" : `${(c.commissionBps / 100).toFixed(2)}%`}
                      </td>
                      <td className="px-3 py-2.5 text-xxs text-ink-faint">
                        {c.isActive ? "" : "retired"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <button
                            onClick={() =>
                              setCh({
                                id: c.id,
                                code: c.code,
                                name: c.name,
                                kind: c.kind,
                                commission: String(c.commissionBps / 100),
                                isActive: c.isActive,
                              })
                            }
                            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {ch && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {ch.id ? "Edit booking source" : "New booking source"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <label htmlFor="c-code" className={label}>Code</label>
                  <input
                    id="c-code"
                    value={ch.code}
                    placeholder="DIR"
                    onChange={(e) => setCh({ ...ch, code: e.target.value.toUpperCase() })}
                    className={cn(field, "uppercase")}
                  />
                </div>
                <div>
                  <label htmlFor="c-name" className={label}>Name</label>
                  <input
                    id="c-name"
                    value={ch.name}
                    placeholder="Direct"
                    onChange={(e) => setCh({ ...ch, name: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="c-kind" className={label}>Kind</label>
                  <select
                    id="c-kind"
                    value={ch.kind}
                    onChange={(e) => setCh({ ...ch, kind: e.target.value as ChannelKind })}
                    className={field}
                  >
                    {CHANNEL_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="c-comm" className={label}>Commission %</label>
                  <input
                    id="c-comm"
                    inputMode="decimal"
                    value={ch.commission}
                    onChange={(e) => setCh({ ...ch, commission: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
              </div>
              {ch.id && (
                <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-muted">
                  <input
                    type="checkbox"
                    checked={ch.isActive}
                    onChange={(e) => setCh({ ...ch, isActive: e.target.checked })}
                  />
                  Still selling
                </label>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setCh(null)} className={secondary}>Cancel</button>
                <button
                  onClick={() =>
                    run(
                      () =>
                        saveChannel({
                          id: ch.id,
                          code: ch.code,
                          name: ch.name,
                          kind: ch.kind,
                          // Basis points, like every other rate here.
                          commissionBps: Math.round((Number(ch.commission) || 0) * 100),
                          isActive: ch.isActive,
                        }),
                      `${ch.name || "Source"} saved.`,
                    )
                  }
                  disabled={pending}
                  className={primary}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tax ----------------------------------------------------------- */}
      {tab === "tax" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Tax rates
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setTx({
                      id: null,
                      name: "VAT",
                      percent: "20",
                      // Inclusive, which is what a hotel selling to the public
                      // does -- consumer prices have to be shown with tax in,
                      // and it is the property's settled choice. It seeded
                      // "exclusive", pointing a new rate the wrong way.
                      inclusion: "inclusive",
                      isActive: true,
                    })
                  }
                  className={secondary}
                >
                  New tax rate
                </button>
              )}
            </div>

            {taxRates.length === 0 ? (
              <p className="py-6 text-center text-[13px] leading-relaxed text-ink-muted">
                None yet. Without one, charges post with no tax.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Name", "Rate", "Quoted", "Charges posted", "", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {taxRates.map((t) => (
                    <tr key={t.id} className={cn(!t.isActive && "opacity-55")}>
                      <td className="px-3 py-2.5 font-medium text-ink">{t.name}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">
                        {(t.rateBps / 100).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {t.inclusion === "inclusive" ? "tax included" : "tax on top"}
                      </td>
                      {/*
                        Above zero, `save_tax_rate()` refuses to move the rate
                        or its inclusion: a folio item records which rate it
                        used. The figure is here so that is visible before
                        somebody types a new one, rather than only in the
                        refusal afterwards -- the same reason the cancellation
                        policies list carries its rate-plan count.
                      */}
                      <td className="tnum px-3 py-2.5 text-ink-muted">
                        {t.chargeCount > 0 ? t.chargeCount : "\u2014"}
                      </td>
                      <td className="px-3 py-2.5 text-xxs text-ink-faint">
                        {t.isActive ? "" : "retired"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <button
                            onClick={() =>
                              setTx({
                                id: t.id,
                                name: t.name,
                                percent: String(t.rateBps / 100),
                                inclusion: t.inclusion,
                                isActive: t.isActive,
                              })
                            }
                            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {tx && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {tx.id ? "Edit tax rate" : "New tax rate"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="t-name" className={label}>Name</label>
                  <input
                    id="t-name"
                    value={tx.name}
                    onChange={(e) => setTx({ ...tx, name: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="t-pct" className={label}>Rate %</label>
                  <input
                    id="t-pct"
                    inputMode="decimal"
                    value={tx.percent}
                    onChange={(e) => setTx({ ...tx, percent: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
                <div>
                  <label htmlFor="t-inc" className={label}>How it is quoted</label>
                  <select
                    id="t-inc"
                    value={tx.inclusion}
                    onChange={(e) =>
                      setTx({ ...tx, inclusion: e.target.value as "inclusive" | "exclusive" })
                    }
                    className={field}
                  >
                    <option value="exclusive">Tax on top of the rate</option>
                    <option value="inclusive">Rate already includes tax</option>
                  </select>
                </div>
              </div>
              {tx.id && (
                <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-muted">
                  <input
                    type="checkbox"
                    checked={tx.isActive}
                    onChange={(e) => setTx({ ...tx, isActive: e.target.checked })}
                  />
                  In use.
                </label>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setTx(null)} className={secondary}>Cancel</button>
                <button
                  onClick={() =>
                    run(
                      () =>
                        saveTaxRate({
                          id: tx.id,
                          name: tx.name,
                          rateBps: Math.round((Number(tx.percent) || 0) * 100),
                          inclusion: tx.inclusion,
                          isActive: tx.isActive,
                        }),
                      `${tx.name || "Tax rate"} saved.`,
                    )
                  }
                  disabled={pending}
                  className={primary}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Payment methods ----------------------------------------------- */}
      {tab === "seasons" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Seasons
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setSn({ id: null, name: "", startsOn: "", endsOn: "" })
                  }
                  className={secondary}
                >
                  New season
                </button>
              )}
            </div>

            {seasons.length === 0 ? (
              <p className="py-6 text-center text-[13px] leading-relaxed text-ink-muted">
                None yet.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Season", "First day", "Last day", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {seasons.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2.5 font-medium text-ink">{s.name}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">{s.startsOn}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">{s.endsOn}</td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <span className="flex justify-end gap-3">
                            <button
                              onClick={() =>
                                setSn({
                                  id: s.id,
                                  name: s.name,
                                  startsOn: s.startsOn,
                                  endsOn: s.endsOn,
                                })
                              }
                              className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await deleteSeason(s.id);
                                  if (!result.ok) {
                                    setMessage({ ok: false, text: result.error });
                                    return;
                                  }
                                  setMessage({ ok: true, text: `${s.name} removed.` });
                                  router.refresh();
                                })
                              }
                              className="text-rose-600 underline-offset-2 hover:underline"
                            >
                              Remove
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {sn && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {sn.id ? "Edit season" : "New season"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={label} htmlFor="season-name">Name</label>
                  <input
                    id="season-name"
                    value={sn.name}
                    onChange={(e) => setSn({ ...sn, name: e.target.value })}
                    placeholder="Low season"
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="season-from">First day</label>
                  <input
                    id="season-from"
                    type="date"
                    value={sn.startsOn}
                    onChange={(e) => setSn({ ...sn, startsOn: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="season-to">Last day</label>
                  <input
                    id="season-to"
                    type="date"
                    value={sn.endsOn}
                    onChange={(e) => setSn({ ...sn, endsOn: e.target.value })}
                    className={field}
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await saveSeason(sn);
                      if (!result.ok) {
                        setMessage({ ok: false, text: result.error });
                        return;
                      }
                      setMessage({ ok: true, text: `${sn.name} saved.` });
                      setSn(null);
                      router.refresh();
                    })
                  }
                  className={primary}
                >
                  {pending ? "Saving…" : "Save season"}
                </button>
                <button onClick={() => setSn(null)} className={secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Rate plans ------------------------------------------------------ */}
      {tab === "rate-plans" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Rate plans
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setRp({
                      id: null,
                      code: "",
                      name: "",
                      description: "",
                      isDefault: false,
                      isActive: true,
                    })
                  }
                  className={secondary}
                >
                  New rate plan
                </button>
              )}
            </div>

            {ratePlans.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                No rate plans yet. Add one.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-faint">
                      {["Code", "Name", "Includes", "Cancellation", "Guest page", "Status", ""].map(
                        (c, i) => (
                          <th
                            key={c || `c${i}`}
                            className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                          >
                            {c}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {ratePlans.map((p) => (
                      <tr key={p.id}>
                        <td className="tnum px-3 py-2.5 font-medium text-ink">
                          {p.code}
                        </td>
                        <td className="px-3 py-2.5 text-ink">
                          {p.name}
                          {p.isDefault && (
                            <span className="ml-2 text-xxs text-ink-faint">main</span>
                          )}
                          {p.description && (
                            <span className="block text-xxs text-ink-faint">
                              {p.description}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-ink-muted">
                          {/* The board type IS the set of meals. "Half board" is
                              two rows here and "B&B" is one, which is why there
                              is no board-type enum to keep in step. */}
                          {p.meals.length === 0
                            ? "Room only"
                            : p.meals
                                .map((m) => MEAL_LABEL[m])
                                .join(", ")}
                        </td>
                        <td className="px-3 py-2.5">
                          {/*
                            Set here rather than in the form below, because it
                            goes through its own RPC: an optional parameter on
                            save_rate_plan() would be an overload for PostgREST
                            to choose between, and a rename would then have to
                            resend the policy or silently clear it.
                          */}
                          {canEdit ? (
                            <select
                              aria-label={`Cancellation policy for ${p.name}`}
                              value={p.cancellationPolicyId ?? ""}
                              disabled={pending}
                              onChange={(e) =>
                                run(
                                  () =>
                                    setRatePlanCancellationPolicy(
                                      p.id,
                                      e.target.value || null,
                                    ),
                                  "Cancellation terms saved.",
                                )
                              }
                              className="w-full min-w-[150px] rounded border border-line bg-white px-2 py-1 text-[12.5px] text-ink"
                            >
                              <option value="">Not set</option>
                              {cancellationPolicies
                                .filter(
                                  (c) =>
                                    c.isActive || c.id === p.cancellationPolicyId,
                                )
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.isActive ? "" : " (retired)"}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <span className="text-ink-muted">
                              {cancellationPolicies.find(
                                (c) => c.id === p.cancellationPolicyId,
                              )?.name ?? "Not set"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={
                              p.isPublic ? "text-emerald-600" : "text-ink-faint"
                            }
                          >
                            {p.isPublic ? "Published" : "Not published"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={p.isActive ? "text-ink" : "text-ink-faint"}
                          >
                            {p.isActive ? "Selling" : "Retired"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {canEdit && (
                            <button
                              onClick={() =>
                                setRp({
                                  id: p.id,
                                  code: p.code,
                                  name: p.name,
                                  description: p.description ?? "",
                                  isDefault: p.isDefault,
                                  isActive: p.isActive,
                                })
                              }
                              className="rounded border border-line px-2 py-1 text-xxs text-ink-muted hover:bg-shell"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {rp && canEdit && (
            <div className={card}>
              <h2 className="mb-3 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {rp.id ? "Edit rate plan" : "New rate plan"}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="rp-code">Code</label>
                  <input
                    id="rp-code"
                    value={rp.code}
                    onChange={(e) => setRp({ ...rp, code: e.target.value })}
                    placeholder="BB"
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="rp-name">Name</label>
                  <input
                    id="rp-name"
                    value={rp.name}
                    onChange={(e) => setRp({ ...rp, name: e.target.value })}
                    placeholder="Bed and Breakfast"
                    className={field}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="rp-desc">Description</label>
                  <input
                    id="rp-desc"
                    value={rp.description}
                    onChange={(e) => setRp({ ...rp, description: e.target.value })}
                    placeholder="What a guest gets on this rate"
                    className={field}
                  />
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={rp.isDefault}
                  onChange={(e) => setRp({ ...rp, isDefault: e.target.checked })}
                  className="h-3.5 w-3.5 accent-brass"
                />
                The main rate — used when a booking names no plan
              </label>
              <label className="mt-2 flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={rp.isActive}
                  onChange={(e) => setRp({ ...rp, isActive: e.target.checked })}
                  className="h-3.5 w-3.5 accent-brass"
                />
                Still selling
              </label>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() =>
                    run(() => saveRatePlan(rp), rp.id ? "Rate plan saved." : "Rate plan created.")
                  }
                  disabled={pending}
                  className={primary}
                >
                  {pending ? "Saving\u2026" : "Save"}
                </button>
                <button onClick={() => setRp(null)} className={secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}


      {tab === "cancellation" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Cancellation policies
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setCp({
                      id: null,
                      name: "",
                      kind: "flexible",
                      freeCancellationDays: "1",
                      description: "",
                      isActive: true,
                      sortOrder: cancellationPolicies.length,
                    })
                  }
                  className={secondary}
                >
                  New policy
                </button>
              )}
            </div>

            {cancellationPolicies.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                None yet. Add a flexible policy, a non-refundable one, or both.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-faint">
                      {["Name", "Type", "Free until", "Rate plans", "Status", ""].map(
                        (c, i) => (
                          <th
                            key={c || `c${i}`}
                            className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                          >
                            {c}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {cancellationPolicies.map((c) => (
                      <tr key={c.id}>
                        <td className="px-3 py-2.5 font-medium text-ink">
                          {c.name}
                          {c.description && (
                            <span className="block text-xxs text-ink-faint">
                              {c.description}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={
                              c.kind === "non_refundable"
                                ? "rounded bg-rose-50 px-1.5 py-0.5 text-xxs font-semibold text-rose-700"
                                : "rounded bg-emerald-50 px-1.5 py-0.5 text-xxs font-semibold text-emerald-700"
                            }
                          >
                            {c.kind === "non_refundable"
                              ? "Non-refundable"
                              : "Flexible"}
                          </span>
                        </td>
                        <td className="tnum px-3 py-2.5 text-ink-muted">
                          {c.kind === "non_refundable"
                            ? "\u2014"
                            : c.freeCancellationDays === 0
                              ? "The arrival day"
                              : `${c.freeCancellationDays} day${c.freeCancellationDays === 1 ? "" : "s"} before arrival`}
                        </td>
                        <td className="tnum px-3 py-2.5 text-ink-muted">
                          {c.ratePlanCount}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={c.isActive ? "text-ink" : "text-ink-faint"}>
                            {c.isActive ? "Offered" : "Retired"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {canEdit && (
                            <button
                              onClick={() =>
                                setCp({
                                  id: c.id,
                                  name: c.name,
                                  kind: c.kind,
                                  freeCancellationDays: String(
                                    c.freeCancellationDays ?? 1,
                                  ),
                                  description: c.description ?? "",
                                  isActive: c.isActive,
                                  sortOrder: c.sortOrder,
                                })
                              }
                              className="rounded border border-line px-2 py-1 text-xxs text-ink-muted hover:bg-shell"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {cp && canEdit && (
            <div className={card}>
              <h2 className="mb-3 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {cp.id ? "Edit cancellation policy" : "New cancellation policy"}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="cp-name">Name</label>
                  <input
                    id="cp-name"
                    value={cp.name}
                    onChange={(e) => setCp({ ...cp, name: e.target.value })}
                    placeholder="Free cancellation until 3 days before"
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="cp-kind">Type</label>
                  <select
                    id="cp-kind"
                    value={cp.kind}
                    onChange={(e) =>
                      setCp({
                        ...cp,
                        kind: e.target.value as CancellationPolicyKind,
                      })
                    }
                    className={field}
                  >
                    <option value="flexible">Flexible</option>
                    <option value="non_refundable">Non-refundable</option>
                  </select>
                </div>

                {/* Only flexible has a window. Non-refundable has no "how many
                    days", so the field goes rather than sitting there disabled. */}
                {cp.kind === "flexible" && (
                  <div>
                    <label className={label} htmlFor="cp-days">
                      Free cancellation up to
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="cp-days"
                        type="number"
                        min={0}
                        max={365}
                        value={cp.freeCancellationDays}
                        onChange={(e) =>
                          setCp({ ...cp, freeCancellationDays: e.target.value })
                        }
                        className={cn(field, "w-24")}
                      />
                      <span className="text-[13px] text-ink-muted">
                        days before arrival
                      </span>
                    </div>
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label className={label} htmlFor="cp-desc">
                    What the guest is told
                  </label>
                  <input
                    id="cp-desc"
                    value={cp.description}
                    onChange={(e) => setCp({ ...cp, description: e.target.value })}
                    placeholder="Cancel free up to three days before you arrive."
                    className={field}
                  />
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={cp.isActive}
                  onChange={(e) => setCp({ ...cp, isActive: e.target.checked })}
                  className="h-3.5 w-3.5 accent-brass"
                />
                Still offered
              </label>

              {cp.kind === "non_refundable" && (
                <p className="mt-3 rounded-md bg-shell px-3 py-2 text-[12.5px] leading-snug text-ink-muted">
                  A non-refundable booking can still be cancelled by staff — the
                  charge stands and stays on the folio. Charging a card
                  automatically is not built; there is no card capture in this
                  system yet.
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() =>
                    run(
                      () =>
                        saveCancellationPolicy({
                          id: cp.id,
                          name: cp.name,
                          kind: cp.kind,
                          freeCancellationDays:
                            cp.kind === "flexible"
                              ? Number(cp.freeCancellationDays || 0)
                              : null,
                          description: cp.description,
                          isActive: cp.isActive,
                          sortOrder: cp.sortOrder,
                        }),
                      cp.id ? "Policy saved." : "Policy created.",
                    )
                  }
                  disabled={pending}
                  className={primary}
                >
                  {pending ? "Saving\u2026" : "Save"}
                </button>
                <button onClick={() => setCp(null)} className={secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "payment-methods" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Payment methods
              </h2>
              {canEdit && paymentMethods.length < PAYMENT_KINDS.length && (
                <button
                  onClick={() =>
                    setPm({
                      id: null,
                      name: "",
                      kind:
                        PAYMENT_KINDS.find(
                          (k) => !paymentMethods.some((m) => m.kind === k.value),
                        )?.value ?? "other",
                      isActive: true,
                      frozen: false,
                    })
                  }
                  className={secondary}
                >
                  New method
                </button>
              )}
            </div>

            {paymentMethods.length === 0 ? (
              <p className="rounded-md bg-warn-wash px-3 py-3 text-center text-[13px] leading-relaxed text-warn-deep">
                None yet. Add at least cash and card.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Name", "Kind", "Drawer", "Taken", "", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {paymentMethods.map((m) => (
                    <tr key={m.id} className={cn(!m.isActive && "opacity-55")}>
                      <td className="px-3 py-2.5 font-medium text-ink">{m.name}</td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {PAYMENT_KINDS.find((k) => k.value === m.kind)?.label ??
                          m.kind}
                      </td>
                      <td className="px-3 py-2.5">
                        {m.affectsDrawer ? (
                          <span className="rounded bg-warn-wash px-1.5 py-0.5 text-xxs font-semibold uppercase tracking-[0.08em] text-warn-deep">
                            Physical cash
                          </span>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">
                        {m.paymentCount === 0 ? "\u2014" : m.paymentCount}
                      </td>
                      <td className="px-3 py-2.5 text-xxs text-ink-faint">
                        {m.isActive ? "" : "retired"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <button
                            onClick={() =>
                              setPm({
                                id: m.id,
                                name: m.name,
                                kind: m.kind,
                                isActive: m.isActive,
                                frozen: m.paymentCount > 0,
                              })
                            }
                            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {pm && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {pm.id ? "Edit payment method" : "New payment method"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="pm-name" className={label}>Name</label>
                  <input
                    id="pm-name"
                    value={pm.name}
                    placeholder="Card (Worldpay)"
                    onChange={(e) => setPm({ ...pm, name: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="pm-kind" className={label}>Kind</label>
                  <select
                    id="pm-kind"
                    value={pm.kind}
                    disabled={pm.frozen}
                    onChange={(e) =>
                      setPm({ ...pm, kind: e.target.value as PaymentMethodKind })
                    }
                    className={cn(field, pm.frozen && "bg-shell text-ink-muted")}
                  >
                    {PAYMENT_KINDS.filter(
                      (k) =>
                        k.value === pm.kind ||
                        !paymentMethods.some((m) => m.kind === k.value),
                    ).map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-ink-faint">
                    {pm.frozen
                      ? "Fixed \u2014 payments have already been taken by this method."
                      : pm.kind === "cash"
                        ? "Takes physical cash, so it counts towards the drawer."
                        : "Does not touch the drawer."}
                  </p>
                </div>
                <div>
                  <label htmlFor="pm-active" className={label}>Offered</label>
                  <select
                    id="pm-active"
                    value={pm.isActive ? "yes" : "no"}
                    onChange={(e) =>
                      setPm({ ...pm, isActive: e.target.value === "yes" })
                    }
                    className={field}
                  >
                    <option value="yes">On the cashier&rsquo;s list</option>
                    <option value="no">Retired</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() =>
                    run(
                      () =>
                        savePaymentMethod({
                          id: pm.id,
                          name: pm.name,
                          kind: pm.kind,
                          isActive: pm.isActive,
                        }).then((r) => {
                          if (r.ok) setPm(null);
                          return r;
                        }),
                      pm.id ? "Payment method saved." : "Payment method added.",
                    )
                  }
                  disabled={pending || pm.name.trim() === ""}
                  className={primary}
                >
                  {pending ? "Saving\u2026" : "Save the method"}
                </button>
                <button onClick={() => setPm(null)} className={secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Staff --------------------------------------------------------- */}
      {tab === "staff" && (
        <div className={card}>
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            Staff
          </h2>

          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-faint">
                {["Name", "Role", "", ""].map((c, i) => (
                  <th
                    key={c || i}
                    className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {staff.map((s) => (
                <StaffRow
                  key={s.id}
                  staff={s}
                  isMe={s.id === meId}
                  canEdit={isAdmin}
                  pending={pending}
                  onSave={(next) =>
                    run(() => saveStaffUser(next), `${next.fullName} saved.`)
                  }
                />
              ))}
            </tbody>
          </table>

          <Note>
            <strong className="font-medium text-ink">Adding a new login is not here.</strong>{" "}
            A new member of staff is invited in Supabase Auth, and then
            appears in this list.
          </Note>
        </div>
      )}
      </div>
    </div>
  );
}

function StaffRow({
  staff,
  isMe,
  canEdit,
  pending,
  onSave,
}: {
  staff: StaffSetting;
  isMe: boolean;
  canEdit: boolean;
  pending: boolean;
  onSave: (next: {
    id: string;
    fullName: string;
    role: StaffRole;
    isActive: boolean;
  }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(staff.fullName);
  const [role, setRole] = useState<StaffRole>(staff.role);
  const [active, setActive] = useState(staff.isActive);

  if (!editing) {
    return (
      <tr className={cn(!staff.isActive && "opacity-55")}>
        <td className="px-3 py-2.5 font-medium text-ink">
          {staff.fullName}
          {isMe && <span className="ml-1.5 text-xxs font-normal text-ink-faint">you</span>}
        </td>
        <td className="px-3 py-2.5 text-ink-muted">
          {ROLES.find((r) => r.value === staff.role)?.label ?? staff.role}
        </td>
        <td className="px-3 py-2.5 text-xxs text-ink-faint">
          {staff.isActive ? "" : "no access"}
        </td>
        <td className="px-3 py-2.5 text-right">
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Edit
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="px-3 py-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
          aria-label="Name"
        />
      </td>
      <td className="px-3 py-2.5">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
          className={field}
          aria-label="Role"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <span className="mt-1 block text-xxs text-ink-faint">
          {ROLES.find((r) => r.value === role)?.note}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <label className="flex items-center gap-2 text-xxs text-ink-muted">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Has access
        </label>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <button
          onClick={() => setEditing(false)}
          className="mr-2 text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            onSave({ id: staff.id, fullName: name, role, isActive: active });
            setEditing(false);
          }}
          disabled={pending}
          className="font-medium text-brass underline-offset-2 hover:underline disabled:opacity-50"
        >
          Save
        </button>
      </td>
    </tr>
  );
}

/**
 * The Settings sidebar, cloned from the client's reference: section headings
 * with a disclosure arrow, their items indented beneath, the current one lit.
 *
 * The section holding the open panel starts expanded and the rest collapsed,
 * as theirs does. Each heading toggles on its own, so somebody can open two to
 * compare without losing their place.
 *
 * Links, not buttons: the panel is URL state (`?tab=`), so the back button,
 * a reload and a bookmark all land where somebody was.
 */
function SettingsSidebar({ tab }: { tab: SettingsTab }) {
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        SETTINGS_NAV.filter((s) => s.items.some((i) => i.id === tab)).map(
          (s) => s.title,
        ),
      ),
  );

  function toggle(title: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  return (
    <aside className="shrink-0 bg-chrome-900 py-2 lg:w-60">
      <nav aria-label="Settings">
        {SETTINGS_NAV.map((section) => {
          const expanded = open.has(section.title);
          return (
            <div key={section.title}>
              <button
                type="button"
                onClick={() => toggle(section.title)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-[13.5px] text-white/85 outline-none transition-colors hover:text-white focus-visible:bg-white/[0.06]"
              >
                <svg
                  viewBox="0 0 8 8"
                  aria-hidden="true"
                  className={cn(
                    "h-2 w-2 shrink-0 fill-current transition-transform",
                    expanded && "rotate-90",
                  )}
                >
                  <path d="M2 1l4 3-4 3z" />
                </svg>
                {section.title}
              </button>
              {expanded && (
                <ul>
                  {section.items.map((item) => {
                    const current = item.id === tab;
                    return (
                      <li key={item.id}>
                        <Link
                          href={`/settings?tab=${item.id}`}
                          aria-current={current ? "page" : undefined}
                          className={cn(
                            "block py-2.5 pl-8 pr-3 text-[13.5px] outline-none transition-colors",
                            "focus-visible:bg-white/[0.08]",
                            current
                              ? "bg-white/[0.1] font-medium text-white"
                              : "text-white/70 hover:bg-white/[0.05] hover:text-white",
                          )}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
