import { msg } from "@/lib/i18n/translate";
/**
 * THE ONE LIST OF SETTINGS PANELS, read by the page and by the screen alike.
 *
 * There used to be two: the screen drew ten panels and the page accepted
 * eight, and the two it left out were `rate-plans` and `cancellation`. So
 * `/settings?tab=rate-plans` fell through to the Property form -- from the
 * Settings tab strip, and from both of the Inventory Rates screen's links.
 * Rate plans and cancellation policies could not be opened in Settings at
 * all. The two lists drifted because there were two; now there is one, in a
 * plain module rather than the "use client" screen, so a Server Component can
 * import the values themselves and not a client reference to them.
 *
 * The ids are URL state (`?tab=`) and are linked to from elsewhere -- the
 * calendar rail's pencil opens `?tab=room-types&edit=<id>` -- so they do not
 * change when the labels do.
 */

export const SETTINGS_TABS = [
  "property",
  "hotel-properties",
  "hotel-policy",
  "extras",
  "facilities",
  "guest-registration",
  "identification-types",
  "guest-details",
  "email-preferences",
  "email-setup",
  "hotel-features",
  "calendar-settings",
  "language-settings",
  "inventory-settings",
  "room-types",
  "rooms",
  "staff",
  "tax",
  "invoice-settings",
  "pos-profiles",
  "currencies",
  "accounting-categories",
  "payment-gateways",
  "accounting-systems",
  "payment-methods",
  "rate-plans",
  "cancellation",
  "seasons",
  "discounts",
  "channel-manager",
  "booking-engine",
  "booking-widget",
  "api-key",
  "developer-keys",
  "key-lock-systems",
  "housekeeping-systems",
  "channels",
  "reactions",
  "templates",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "property";

export function isSettingsTab(value: string | undefined): value is SettingsTab {
  return SETTINGS_TABS.some((t) => t === value);
}

/**
 * THE SIDEBAR, in the client's reference system's order and wording.
 *
 * Theirs has nine sections. Eight are here, each holding panels this system
 * already has. **Other is left out on purpose**: nothing here belongs in it
 * yet, and a
 * section that opens onto nothing is the control that does nothing, which
 * this application does not ship. They go in when there is something behind
 * them -- and the reference's own contents for them have not been seen.
 *
 * FINANCES AND INVENTORY carry the reference's labels in its order (0079),
 * and Room Type and Room Setup moved under Inventory, where the reference
 * keeps them. Both sections now carry every item the reference lists. The tab
 * ids did not change, so every existing link still lands.
 *
 * `Hotel Details` and `Hotel Properties` are their two items under Hotel
 * Profile, `Hotel Policy`, `Extras` and `Room Type Facilities` are their
 * three under Hotel Content, and `Hotel Features`, `Calendar Settings` and
 * `Language Settings` are their three under System Settings. The rest of
 * the item names are ours, in their Title Case.
 */
export const SETTINGS_NAV: {
  title: string;
  items: { id: SettingsTab; label: string }[];
}[] = [
  {
    title: msg("Hotel Profile"),
    items: [
      { id: "property", label: msg("Hotel Details") },
      { id: "hotel-properties", label: msg("Hotel Properties") },
    ],
  },
  {
    title: msg("Hotel Content"),
    items: [
      { id: "hotel-policy", label: msg("Hotel Policy") },
      { id: "extras", label: msg("Extras") },
      { id: "facilities", label: msg("Room Type Facilities") },
    ],
  },
  {
    title: msg("Guest Configuration"),
    items: [
      { id: "guest-registration", label: msg("Guest Registration Form") },
      { id: "identification-types", label: msg("Identification Types") },
      { id: "guest-details", label: msg("Guest Details Settings") },
    ],
  },
  {
    title: msg("Communications & Notifications"),
    items: [
      { id: "email-preferences", label: msg("Hotel Emails Preferences") },
      { id: "email-setup", label: msg("Email Setup") },
    ],
  },
  {
    title: msg("System Settings"),
    items: [
      { id: "hotel-features", label: msg("Hotel Features") },
      { id: "calendar-settings", label: msg("Calendar Settings") },
      { id: "language-settings", label: msg("Language Settings") },
      { id: "staff", label: msg("Staff") },
    ],
  },
  {
    title: msg("Finances"),
    items: [
      { id: "payment-methods", label: msg("Custom Payment Types") },
      { id: "tax", label: msg("Tax Information") },
      { id: "invoice-settings", label: msg("Invoice Settings") },
      { id: "pos-profiles", label: msg("Pos Profiles") },
      { id: "currencies", label: msg("Currencies") },
      { id: "accounting-categories", label: msg("Accounting Categories") },
      { id: "payment-gateways", label: msg("Payment Gateway") },
      { id: "accounting-systems", label: msg("Accounting Systems") },
    ],
  },
  {
    title: msg("Inventory"),
    items: [
      { id: "inventory-settings", label: msg("Settings") },
      { id: "room-types", label: msg("Room Type") },
      { id: "rooms", label: msg("Room Setup") },
      { id: "cancellation", label: msg("Cancellation Policy") },
      { id: "rate-plans", label: msg("Rate Plans") },
      { id: "seasons", label: msg("Seasons and Events") },
      { id: "discounts", label: msg("Discounts") },
    ],
  },
  {
    title: msg("Connectivity Settings"),
    items: [
      { id: "channel-manager", label: msg("Channel Manager") },
      { id: "booking-engine", label: msg("Booking Engine Settings") },
      { id: "channels", label: msg("Sales Channels") },
      { id: "booking-widget", label: msg("Booking Widget") },
      { id: "api-key", label: msg("API Key") },
      { id: "developer-keys", label: msg("Developers Keys") },
      { id: "key-lock-systems", label: msg("Key Lock Systems") },
      { id: "housekeeping-systems", label: msg("Housekeeping Systems") },
    ],
  },
  {
    // The reference also lists Country-Specific Settings here. Theirs is an
    // empty page ("settings that are specific for your country, if
    // present"), and a sidebar item with nothing behind it is a dead
    // control, so it goes in when a country needs something.
    title: msg("Other"),
    items: [
      { id: "reactions", label: msg("Reactions") },
      { id: "templates", label: msg("Templates") },
    ],
  },
];
