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
  "room-types",
  "rooms",
  "staff",
  "tax",
  "payment-methods",
  "rate-plans",
  "cancellation",
  "seasons",
  "channels",
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
 * keeps them. Their items not listed -- Invoice Settings, Pos Profiles,
 * Currencies, Accounting Categories, Payment Gateway, Accounting Systems,
 * Inventory's own Settings and Discounts -- go in as each is built, for the
 * same reason Other is left out: an item that opens onto nothing is a dead
 * control. The tab ids did not change, so every existing link still lands.
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
    title: "Hotel Profile",
    items: [
      { id: "property", label: "Hotel Details" },
      { id: "hotel-properties", label: "Hotel Properties" },
    ],
  },
  {
    title: "Hotel Content",
    items: [
      { id: "hotel-policy", label: "Hotel Policy" },
      { id: "extras", label: "Extras" },
      { id: "facilities", label: "Room Type Facilities" },
    ],
  },
  {
    title: "Guest Configuration",
    items: [
      { id: "guest-registration", label: "Guest Registration Form" },
      { id: "identification-types", label: "Identification Types" },
      { id: "guest-details", label: "Guest Details Settings" },
    ],
  },
  {
    title: "Communications & Notifications",
    items: [
      { id: "email-preferences", label: "Hotel Emails Preferences" },
      { id: "email-setup", label: "Email Setup" },
    ],
  },
  {
    title: "System Settings",
    items: [
      { id: "hotel-features", label: "Hotel Features" },
      { id: "calendar-settings", label: "Calendar Settings" },
      { id: "language-settings", label: "Language Settings" },
      { id: "staff", label: "Staff" },
    ],
  },
  {
    title: "Finances",
    items: [
      { id: "payment-methods", label: "Custom Payment Types" },
      { id: "tax", label: "Tax Information" },
    ],
  },
  {
    title: "Inventory",
    items: [
      { id: "room-types", label: "Room Type" },
      { id: "rooms", label: "Room Setup" },
      { id: "cancellation", label: "Cancellation Policy" },
      { id: "rate-plans", label: "Rate Plans" },
      { id: "seasons", label: "Seasons and Events" },
    ],
  },
  {
    title: "Connectivity Settings",
    items: [{ id: "channels", label: "Booking Sources" }],
  },
];
