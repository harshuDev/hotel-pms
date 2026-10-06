"use client";

import { useT } from "@/components/i18n";
import { msg } from "@/lib/i18n/translate";
import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
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
import { PaymentTypesPanel, TaxesPanel } from "@/components/settings/finance-panels";
import type { HotelFeatures } from "@/lib/hotel-features";
import { CalendarSettingsPanel } from "@/components/settings/calendar-settings-panel";
import type { CalendarSettings } from "@/lib/calendar-settings";
import { LanguageSettingsPanel } from "@/components/settings/language-settings-panel";
import type { LanguageSettings } from "@/lib/language-settings";
import { InvoiceSettingsPanel } from "@/components/settings/invoice-settings-panel";
import type { InvoiceSettings } from "@/lib/invoice-settings";
import { CurrenciesPanel, PosProfilesPanel } from "@/components/settings/finance-profile-panels";
import type {
  AccountingSettings,
  AccountingSystem,
  CurrencyProfile,
  Discount,
  PaymentGateway,
  PosProfile,
} from "@/lib/finance-profiles";
import {
  AccountingSystemsPanel,
  PaymentGatewaysPanel,
} from "@/components/settings/finance-connection-panels";
import { AccountingCategoriesPanel } from "@/components/settings/accounting-categories-panel";
import { InventorySettingsPanel } from "@/components/settings/inventory-settings-panel";
import { RoomSetupPanel, RoomTypesPanel } from "@/components/settings/room-panels";
import { CancellationPolicyPanel } from "@/components/settings/cancellation-policy-panel";
import { RatePlansPanel } from "@/components/settings/rate-plans-panel";
import { ChannelManagerPanel } from "@/components/settings/channel-manager-panel";
import { BookingEnginePanel } from "@/components/settings/booking-engine-panel";
import { SalesChannelsPanel } from "@/components/settings/sales-channels-panel";
import { BookingWidgetPanel } from "@/components/settings/booking-widget-panel";
import { ApiKeyPanel, DeveloperKeysPanel, type DeveloperKey } from "@/components/settings/api-keys-panel";
import { SystemConnectionsPanel } from "@/components/settings/system-connections-panel";
import { ReactionsPanel } from "@/components/settings/reactions-panel";
import { TemplatesPanel } from "@/components/settings/templates-panel";
import { AddStaffMember, PlatformHotels } from "@/components/settings/platform-panels";
import type { Reaction } from "@/lib/reactions";
import type { SystemConnection } from "@/lib/system-connections";
import type { BookingWidget } from "@/lib/booking-widgets";
import type { BookingEngineProfile, BookingEngineTexts } from "@/lib/booking-engine";
import type { ChannelManager } from "@/lib/channel-managers";
import { SeasonsPanel } from "@/components/settings/seasons-panel";
import { RateCombinations } from "@/components/settings/rate-combinations";
import { BookingDialog } from "@/components/calendar/booking-dialog";
import { DiscountsPanel } from "@/components/settings/discounts-panel";
import type { InventorySettings } from "@/lib/inventory-settings";
import type { EmailSetup, EmailTemplate, HotelEmailSettings } from "@/lib/email-preferences";
import { EmailSetupPanel } from "@/components/settings/email-setup-panel";
import type { Facility } from "@/lib/facilities";
import type { ExtrasCatalog } from "@/lib/extras";
import { SETTINGS_NAV, type SettingsTab } from "@/lib/settings-tabs";
import { countriesIn } from "@/lib/countries";
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
  saveHotelDetails,
  saveHotelPolicies,
  saveHotelTimes,
  saveStaffUser,
} from "@/lib/actions/settings";
import type {
  SeasonType,
  WeekRate,
  RatePlanCoverage,
  RatePlan,
  CancellationPolicy,
  ChannelSetting,
  PaymentMethodSetting,
  PropertySettings,
  RoomSettingsPage,
  RoomTypeSetting,
  VirtualRoomType,
  StaffRole,
  StaffSetting,
  TaxRateSetting,
  PlatformProperty,
} from "@/lib/types";

export type { SettingsTab } from "@/lib/settings-tabs";


const ROLES: { value: StaffRole; label: string; note: string }[] = [
  { value: "admin", label: msg("Administrator"), note: msg("Everything, including staff") },
  { value: "manager", label: msg("Manager"), note: msg("Rates, settings, the night audit, the drawer total") },
  { value: "front_desk", label: msg("Front desk"), note: msg("Bookings, check-in and out, payments") },
  { value: "cashier", label: msg("Cashier"), note: msg("Payments and the drawer") },
  { value: "housekeeping", label: msg("Housekeeping"), note: msg("Room status, and no money at all") },
];

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
  openSeasonId,
  ratesSeason,
  meId,
  canEdit,
  isAdmin,
  platformProperties,
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
  invoiceSettings,
  posProfiles,
  currencyProfiles,
  accountingSettings,
  paymentGateways,
  accountingSystems,
  inventorySettings,
  businessDate,
  discounts,
  virtualRoomTypes,
  weekRates,
  rateCoverage,
  channelManagers,
  bookingEngine,
  bookingWidgets,
  apiKeys,
  systemConnections,
  reactions,
  folioTemplate,
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
  /** Finances -> Invoice Settings (0080). */
  invoiceSettings: InvoiceSettings;
  /** Finances -> Pos Profiles (0084) and Currencies (0083). */
  posProfiles: PosProfile[];
  currencyProfiles: CurrencyProfile[];
  /** Finances -> Accounting Categories (0085). */
  accountingSettings: AccountingSettings;
  /** Finances -> Payment Gateway (0086) and Accounting Systems (0087). */
  paymentGateways: PaymentGateway[];
  accountingSystems: AccountingSystem[];
  /** Inventory -> Settings (0088), and the earliest cut-off date it accepts. */
  inventorySettings: InventorySettings;
  businessDate: string;
  /** Inventory -> Discounts (0090). */
  discounts: Discount[];
  /** Inventory -> Room Type -> Virtual Room Types (0091). Stored. */
  virtualRoomTypes: VirtualRoomType[];
  /** The weekly rate templates (0096); loaded only on the Rate Plans tab. */
  weekRates: WeekRate[];
  rateCoverage: RatePlanCoverage[];
  /** Channel manager connections (0097); loaded only on their tab. */
  channelManagers: ChannelManager[];
  /** Booking Engine Settings (0098); loaded only on their tab. */
  bookingEngine: { texts: BookingEngineTexts; profiles: BookingEngineProfile[] } | null;
  /** Booking widgets (0100); loaded only on their tab. */
  bookingWidgets: BookingWidget[];
  /** API Key and Developer Keys (0101), hints only; loaded only on their tabs. */
  apiKeys: { main: { hint: string; createdAt: string } | null; developer: DeveloperKey[] } | null;
  /** Key lock or housekeeping systems (0102-0103), for whichever tab is open. */
  systemConnections: SystemConnection[];
  /** Reactions (0104); loaded only on their tab. */
  reactions: Reaction[];
  /** The folio/invoice template (0105); loaded only on its tab. */
  folioTemplate: { liquid: string; css: string; isActive: boolean } | null;
  roomTypes: RoomTypeSetting[];
  rooms: RoomSettingsPage;
  roomQuery: string;
  channels: ChannelSetting[];
  taxRates: TaxRateSetting[];
  seasons: SeasonType[];
  ratePlans: RatePlan[];
  cancellationPolicies: CancellationPolicy[];
  paymentMethods: PaymentMethodSetting[];
  /** A room type to open for editing on arrival, from the calendar's rail. */
  editRoomTypeId: string | null;
  /** The season a rate plan's prices open on, from the Seasons screen (0110). */
  openSeasonId: string | null;
  /** Room Rate Combinations open over Seasons: a season id, null for the Default Season, undefined closed. */
  ratesSeason?: string | null;
  staff: StaffSetting[];
  meId: string | null;
  canEdit: boolean;
  isAdmin: boolean;
  /** Every hotel, for the platform team only (0135); empty for hotel staff. */
  platformProperties: PlatformProperty[];
}) {
  const tr = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  /*
   * A confirmation belongs to the screen it was given on. Changing tab only
   * changes `?tab=`, so this component stays mounted and its state with it --
   * "Df deleted." from Developer Keys was still showing on Templates. Reset
   * while rendering rather than in an effect, so the old message never paints
   * on the new tab even for one frame.
   */
  const [messageTab, setMessageTab] = useState(tab);
  if (messageTab !== tab) {
    setMessageTab(tab);
    setMessage(null);
  }

  // The tab on screen now, for a save that finishes after the reader moved
  // on: its "saved" is not said on a screen it does not belong to. A failure
  // still is -- something not saved must never pass silently.
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setMessage(null);
    const startedOn = tab;
    startTransition(async () => {
      const result = await fn();
      if (result.ok && tabRef.current !== startedOn) {
        router.refresh();
        return;
      }
      if (!result.ok) {
        setMessage({ ok: false, text: result.error ?? tr("That did not work.") });
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
  const policySummary = hotelPolicySummary(tr, {
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
          {tr("You can read the settings but not change them. Rooms, rates and sales channels are set by managers and administrators.")}
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
            {tr("Hotel Details")}
          </h2>

          <div className="space-y-4">
            <DetailRow label={tr("Property ID")} htmlFor="d-id">
              <input id="d-id" value={property.id} readOnly className={readOnlyField} />
            </DetailRow>
            <DetailRow label={tr("Property slug")} htmlFor="d-slug">
              <input id="d-slug" value={property.slug ?? ""} readOnly className={readOnlyField} />
            </DetailRow>
            <DetailRow label={tr("Company Name")} htmlFor="d-company">
              <input
                id="d-company"
                value={details.companyName}
                placeholder={tr("Company Name")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, companyName: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Company registration id")} htmlFor="d-reg">
              <input
                id="d-reg"
                value={details.companyRegistrationId}
                placeholder={tr("Company registration id")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, companyRegistrationId: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Property type")} htmlFor="d-type">
              <input
                id="d-type"
                value={details.propertyType}
                placeholder={tr("Property type")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, propertyType: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Country")} htmlFor="d-country">
              <select
                id="d-country"
                value={details.country}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, country: e.target.value })}
                className={field}
              >
                <option value="">{tr("Country")}</option>
                {countriesIn(tr).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </DetailRow>
            <DetailRow label={tr("Name of your hotel")} htmlFor="d-name">
              <input
                id="d-name"
                value={details.name}
                placeholder={tr("Name of your hotel")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, name: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Address")} htmlFor="d-addr1">
              <input
                id="d-addr1"
                value={details.addressLine1}
                placeholder={tr("Address")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, addressLine1: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Address line 2")} htmlFor="d-addr2">
              <input
                id="d-addr2"
                value={details.addressLine2}
                placeholder={tr("Address line 2")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, addressLine2: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("City / Town / Village")} htmlFor="d-city">
              <input
                id="d-city"
                value={details.city}
                placeholder={tr("City / Town / Village")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, city: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("County / State / Province")} htmlFor="d-region">
              <input
                id="d-region"
                value={details.region}
                placeholder={tr("County / State / Province")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, region: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Postcode")} htmlFor="d-post">
              <input
                id="d-post"
                value={details.postcode}
                placeholder={tr("Postcode")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, postcode: e.target.value })}
                className={field}
              />
            </DetailRow>

            <h3 className="pt-3 text-[18px] text-ink">{tr("Location")}</h3>
            <DetailRow label={tr("Latitude")} htmlFor="d-lat">
              <input
                id="d-lat"
                inputMode="decimal"
                value={details.latitude}
                placeholder={tr("Latitude")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, latitude: e.target.value })}
                className={cn(field, "tnum")}
              />
            </DetailRow>
            <DetailRow label={tr("Longitude")} htmlFor="d-lng">
              <input
                id="d-lng"
                inputMode="decimal"
                value={details.longitude}
                placeholder={tr("Longitude")}
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

            <DetailRow label={tr("Telephone Number")} htmlFor="d-phone">
              <input
                id="d-phone"
                type="tel"
                value={details.phone}
                placeholder={tr("Telephone Number")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, phone: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Fax Number")} htmlFor="d-fax">
              <input
                id="d-fax"
                type="tel"
                value={details.fax}
                placeholder={tr("Fax Number")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, fax: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Email address")} htmlFor="d-email">
              <input
                id="d-email"
                type="email"
                value={details.email}
                placeholder={tr("Email address")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, email: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Website")} htmlFor="d-web">
              <input
                id="d-web"
                type="url"
                value={details.website}
                placeholder={tr("Website")}
                disabled={!canEdit}
                onChange={(e) => setDetails({ ...details, website: e.target.value })}
                className={field}
              />
            </DetailRow>
            <DetailRow label={tr("Currency")} htmlFor="d-cur">
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
            <DetailRow label={tr("What is your timezone")} htmlFor="d-tz">
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
                  {tr("Your current timezone is: {zone}.", { zone: browserZone })}{" "}
                  {canEdit && browserZone !== details.timezone && (
                    <button
                      type="button"
                      onClick={() => setDetails({ ...details, timezone: browserZone })}
                      className="text-brass hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {tr("Set as hotel timezone")}
                    </button>
                  )}
                </p>
              )}
            </DetailRow>
          </div>

          {canEdit && (
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => run(() => saveHotelDetails(details), tr("Hotel details saved."))}
                disabled={pending}
                className={primary}
              >
                {tr("Save")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hotel Properties ------------------------------------------------ */}
      {tab === "hotel-properties" && (
        /*
          The reference's Properties list. A hotel's own staff see one row:
          their login belongs to one hotel. The platform team (0135) sees every
          hotel, opens any of them and adds new ones -- PlatformHotels. There
          is still no delete: every table points at a property under on delete
          restrict. The pencil opens the three times that used to sit on the
          Property form.
        */
        <div className="max-w-5xl space-y-5">
          <h2 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
            {tr("Hotel Properties")}
          </h2>

          {platformProperties.length > 0 ? (
            <PlatformHotels
              properties={platformProperties}
              timezones={timezones}
              defaultTimezone={property.timezone}
              onEditCurrent={canEdit ? () => setEditingTimes(true) : null}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
              <h3 className="border-b border-line px-6 py-4 text-[16px] text-ink">
                {tr("Properties list")}
              </h3>
              <div className="overflow-x-auto px-6 py-6">
                <table className="w-full min-w-[34rem] text-[13.5px]">
                  <thead>
                    <tr className="bg-shell text-left text-ink">
                      <th className="w-[38%] px-4 py-4 font-normal">
                        <span className="block border-r border-line">{tr("Property name")}</span>
                      </th>
                      <th className="px-4 py-4 font-normal">
                        <span className="block border-r border-line">{tr("Address")}</span>
                      </th>
                      <th className="w-20 px-4 py-4" aria-label={tr("Actions")} />
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
                            aria-label={tr("Edit {name}", { name: property.name })}
                            title={tr("Edit")}
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
          )}

          {editingTimes && canEdit && (
            <div className={cn(card, "p-6 sm:p-7")}>
              <h3 className="mb-6 font-display text-[18px] font-semibold tracking-tightest text-ink">
                {property.name}
              </h3>
              <div className="space-y-4">
                <DetailRow label={tr("Check-in from")} htmlFor="h-in">
                  <input
                    id="h-in"
                    type="time"
                    value={times.checkInTime}
                    onChange={(e) => setTimes({ ...times, checkInTime: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </DetailRow>
                <DetailRow label={tr("Check-out by")} htmlFor="h-out">
                  <input
                    id="h-out"
                    type="time"
                    value={times.checkOutTime}
                    onChange={(e) => setTimes({ ...times, checkOutTime: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </DetailRow>
                <DetailRow label={tr("Night audit at")} htmlFor="h-audit">
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
                  {tr("Cancel")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      const result = await saveHotelTimes(times);
                      if (result.ok) setEditingTimes(false);
                      return result;
                    }, tr("Hotel properties saved."))
                  }
                  disabled={pending}
                  className={primary}
                >
                  {tr("Save")}
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
            {tr("Hotel Policy")}
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
                        { id: CUSTOM_POLICY, label: tr("Custom policy") },
                        { id: OMIT_POLICY, label: tr("Omit this policy") },
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
                        aria-label={tr("{name} policy", { name: section.title })}
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
                  <label htmlFor="policy-other">{tr("Other Policies")}</label>
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
                  onClick={() => run(() => saveHotelPolicies(policies), tr("Hotel policy saved."))}
                  disabled={pending}
                  className={primary}
                >
                  {tr("Save")}
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

      {tab === "invoice-settings" && (
        <InvoiceSettingsPanel
          // Not keyed: each card keeps what was typed in it, so saving one
          // never throws away unsaved edits in the other. The logo is read
          // from the settings directly and needs no re-seeding.
          settings={invoiceSettings}
          propertyId={property.id}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "pos-profiles" && (
        <PosProfilesPanel profiles={posProfiles} canEdit={canEdit} pending={pending} run={run} />
      )}

      {tab === "currencies" && (
        <CurrenciesPanel
          defaultCurrency={property.currency.trim()}
          profiles={currencyProfiles}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "accounting-categories" && (
        <AccountingCategoriesPanel
          settings={accountingSettings}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "inventory-settings" && (
        <InventorySettingsPanel
          settings={inventorySettings}
          businessDate={businessDate}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "discounts" && (
        <DiscountsPanel discounts={discounts} canEdit={canEdit} pending={pending} run={run} />
      )}

      {tab === "payment-gateways" && (
        <PaymentGatewaysPanel gateways={paymentGateways} canEdit={canEdit} pending={pending} run={run} />
      )}

      {tab === "accounting-systems" && (
        <AccountingSystemsPanel
          systems={accountingSystems}
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

      {/* Room Type and Room Setup (0091) --------------------------------- */}
      {tab === "room-types" && (
        <RoomTypesPanel
          // Keyed on the saved order and set, so the drag order re-seeds
          // after a type is added, deleted or reordered elsewhere.
          key={roomTypes.map((t) => `${t.id}:${t.sortOrder}`).join("|")}
          propertyId={property.id}
          roomTypes={roomTypes}
          virtualRoomTypes={virtualRoomTypes}
          facilities={facilities}
          accountingCategories={accountingSettings.categories}
          accommodationDefaultId={accountingSettings.defaults?.accommodationId ?? null}
          editRoomTypeId={editRoomTypeId}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "rooms" && (
        <RoomSetupPanel
          propertyId={property.id}
          propertyName={property.name}
          roomTypes={roomTypes}
          rooms={rooms}
          roomQuery={roomQuery}
          keyCodeFromBookingRoom={inventorySettings.keyCodeFromBookingRoom}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {/* Channels ------------------------------------------------------ */}
      {tab === "channel-manager" && (
        <ChannelManagerPanel
          channelManagers={channelManagers}
          timezone={property.timezone}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "booking-engine" && bookingEngine && (
        <BookingEnginePanel
          propertyId={property.id}
          profiles={bookingEngine.profiles}
          texts={bookingEngine.texts}
          roomTypes={roomTypes}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "booking-widget" && (
        <BookingWidgetPanel
          widgets={bookingWidgets}
          supportedLocales={languageSettings.supportedLocales}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "api-key" && (
        <ApiKeyPanel hint={apiKeys?.main?.hint ?? null} canEdit={canEdit} pending={pending} run={run} />
      )}

      {tab === "developer-keys" && (
        <DeveloperKeysPanel
          propertyId={property.id}
          keys={apiKeys?.developer ?? []}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "templates" && (
        <TemplatesPanel template={folioTemplate} canEdit={canEdit} pending={pending} run={run} />
      )}
      {tab === "reactions" && (
        <ReactionsPanel
          reactions={reactions}
          channels={channels.map((c) => ({ id: c.id, label: c.name }))}
          roomTypes={roomTypes.map((t) => ({ id: t.id, label: t.name }))}
          ratePlans={ratePlans.map((p) => ({ id: p.id, label: p.name }))}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}
      {(tab === "key-lock-systems" || tab === "housekeeping-systems") && (
        <SystemConnectionsPanel
          // Remounted per tab, so a form open on one never carries to the other.
          key={tab}
          category={tab === "key-lock-systems" ? "key_lock" : "housekeeping"}
          systems={systemConnections}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "channels" && (
        <SalesChannelsPanel channels={channels} canEdit={canEdit} pending={pending} run={run} />
      )}

      {/* Tax ----------------------------------------------------------- */}
      {tab === "tax" && (
        <TaxesPanel
          // Re-seeded after every save, add, delete or reorder, so the order
          // held in the panel is always the saved one.
          key={taxRates.map((t) => `${t.id}:${t.sortOrder}:${t.isActive}:${t.inUse}`).join("|")}
          taxRates={taxRates}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {/* Payment methods ----------------------------------------------- */}
      {tab === "seasons" && (
        <div className="space-y-6">
          <SeasonsPanel
            types={seasons}
            businessDate={businessDate}
            // The price button opens Room Rate Combinations for the season
            // OVER this screen, as the reference does, rather than moving to
            // Rate Plans -- the client asked for the popup by name.
            onRates={(id) => router.push(`/settings?tab=seasons&rates=${id ?? "default"}`)}
            canEdit={canEdit}
            pending={pending}
            run={run}
          />
          {ratesSeason !== undefined && (() => {
            const s = ratesSeason === null ? null : seasons.find((x) => x.id === ratesSeason);
            if (ratesSeason !== null && !s) return null;
            const name = s ? s.name : tr("Default Season");
            return (
              <BookingDialog
                side
                wide
                title={tr("Room Rate Combinations for {name}", { name })}
                subtitle={s
                  ? s.ranges.map((r) => `${tr.date(r.startsOn, "dd MMM yyyy")} - ${tr.date(r.endsOn, "dd MMM yyyy")}`).join(" · ")
                  : tr("Every night no season covers")}
                closeHref="/settings?tab=seasons"
                closeLabel={tr("Close")}
              >
                <div className="rounded border border-line bg-white p-4 sm:p-6">
                <RateCombinations
                  // A different season is a different set of drafts.
                  key={ratesSeason ?? "default"}
                  ratePlans={ratePlans}
                  roomTypes={roomTypes}
                  seasons={seasons}
                  cancellationPolicies={cancellationPolicies}
                  weekRates={weekRates}
                  coverage={rateCoverage}
                  initialSeasonId={ratesSeason}
                  lockSeason
                  onEditPlan={(id) => router.push(`/settings?tab=rate-plans&edit=${id}&season=${ratesSeason ?? "default"}`)}
                  canEdit={canEdit}
                  pending={pending}
                  run={run}
                />
                </div>
              </BookingDialog>
            );
          })()}
        </div>
      )}

      {tab === "rate-plans" && (
        <div className="space-y-6">
          <RatePlansPanel
            // Keyed on the plan asked for, so arriving from Seasons opens it.
            key={`${editRoomTypeId ?? ""}|${openSeasonId ?? ""}`}
            ratePlans={ratePlans}
            cancellationPolicies={cancellationPolicies}
            roomTypes={roomTypes}
            taxRates={taxRates}
            accountingCategories={accountingSettings.categories}
            channels={channels}
            extrasCatalog={extrasCatalog}
            coverage={rateCoverage}
            seasons={seasons}
            weekRates={weekRates}
            openPlanId={editRoomTypeId}
            openSeasonId={openSeasonId}
            canEdit={canEdit}
            pending={pending}
            run={run}
          />
        </div>
      )}

      {tab === "cancellation" && (
        <CancellationPolicyPanel
          policies={cancellationPolicies}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      )}

      {tab === "payment-methods" && (
        <PaymentTypesPanel methods={paymentMethods} canEdit={canEdit} pending={pending} run={run} />
      )}

      {/* Staff --------------------------------------------------------- */}
      {tab === "staff" && (
        <div className={card}>
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            {tr("Staff")}
          </h2>

          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-faint">
                {[msg("Name"), msg("Role"), "", ""].map((c, i) => (
                  <th
                    key={c || i}
                    className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                  >
                    {c && tr(c)}
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
                    run(() => saveStaffUser(next), tr("{name} saved.", { name: next.fullName }))
                  }
                />
              ))}
            </tbody>
          </table>

          {isAdmin && <AddStaffMember roles={ROLES} />}
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
  const tr = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(staff.fullName);
  const [role, setRole] = useState<StaffRole>(staff.role);
  const [active, setActive] = useState(staff.isActive);

  if (!editing) {
    return (
      <tr className={cn(!staff.isActive && "opacity-55")}>
        <td className="px-3 py-2.5 font-medium text-ink">
          {staff.fullName}
          {isMe && <span className="ml-1.5 text-xxs font-normal text-ink-faint">{tr("you")}</span>}
        </td>
        <td className="px-3 py-2.5 text-ink-muted">
          {(() => {
            const label = ROLES.find((r) => r.value === staff.role)?.label;
            return label ? tr(label) : staff.role;
          })()}
        </td>
        <td className="px-3 py-2.5 text-xxs text-ink-faint">
          {staff.isActive ? "" : tr("no access")}
        </td>
        <td className="px-3 py-2.5 text-right">
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {tr("Edit")}
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
          aria-label={tr("Name")}
        />
      </td>
      <td className="px-3 py-2.5">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
          className={field}
          aria-label={tr("Role")}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{tr(r.label)}</option>
          ))}
        </select>
        <span className="mt-1 block text-xxs text-ink-faint">
          {(() => {
            const note = ROLES.find((r) => r.value === role)?.note;
            return note ? tr(note) : null;
          })()}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <label className="flex items-center gap-2 text-xxs text-ink-muted">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {tr("Has access")}
        </label>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <button
          onClick={() => setEditing(false)}
          className="mr-2 text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {tr("Cancel")}
        </button>
        <button
          onClick={() => {
            onSave({ id: staff.id, fullName: name, role, isActive: active });
            setEditing(false);
          }}
          disabled={pending}
          className="font-medium text-brass underline-offset-2 hover:underline disabled:opacity-50"
        >
          {tr("Save")}
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
  const tr = useT();
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
      <nav aria-label={tr("Settings")}>
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
