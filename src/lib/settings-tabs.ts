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
 * `Hotel Details` and `Hotel Properties` are their two items under Hotel
 * Profile, and `Hotel Policy`, `Extras` and `Room Type Facilities` are their
 * three under Hotel Content. The rest of
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
      { id: "room-types", label: "Room Types" },
      { id: "rooms", label: "Rooms" },
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
    items: [{ id: "staff", label: "Staff" }],
  },
  {
    title: "Finances",
    items: [
      { id: "tax", label: "Tax Rates" },
      { id: "payment-methods", label: "Payment Methods" },
    ],
  },
  {
    title: "Inventory",
    items: [
      { id: "rate-plans", label: "Rate Plans" },
      { id: "cancellation", label: "Cancellation Policies" },
      { id: "seasons", label: "Seasons" },
    ],
  },
  {
    title: "Connectivity Settings",
    items: [{ id: "channels", label: "Booking Sources" }],
  },
];
