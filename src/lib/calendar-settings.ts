/**
 * Settings -> System Settings -> Calendar Settings (0077), in the client's
 * reference's order and wording.
 *
 * The defaults are the reference's own values, and are also the column
 * defaults in Postgres, so a property that never saved reads the same from
 * either side. Reset puts the form back to these.
 *
 * `wired` says whether the setting changes the board today -- see 0077 and
 * CLAUDE.md for what each one drives and why the rest are stored only.
 */

export const CALENDAR_COLORS = [
  { id: "roomBlockerColor", label: "Room Blocker Color", default: "#b4d0f5", wired: false },
  { id: "unpaidBookingColor", label: "Unpaid Booking Color", default: "#ed5b4f", wired: true },
  { id: "paidBookingColor", label: "Paid Booking Color", default: "#74c971", wired: true },
  {
    id: "partiallyPaidBookingColor",
    label: "Partially Paid Booking Color",
    default: "#fdb650",
    wired: true,
  },
  { id: "companyBookingColor", label: "Company Booking Color", default: "#71b4e9", wired: true },
  { id: "groupBookingColor", label: "Group Booking Color", default: "#74c971", wired: true },
  { id: "weekendBorderColor", label: "Weekend Border Color", default: "#dce7f5", wired: true },
] as const;

export const CALENDAR_SWITCHES = [
  { id: "roundedCorners", label: "Use Rounded Corners", default: true, wired: true },
  {
    id: "bookingsIntersectCheckout",
    label: "Bookings to intersect checkout date",
    default: false,
    wired: false,
  },
  {
    id: "bookingMarkerIntersectCheckout",
    label: "Create Booking marker to intersect checkout date",
    default: false,
    wired: false,
  },
  { id: "fixedWidthZoom", label: "Use fixed width for zoom", default: true, wired: false },
  { id: "showSeasons", label: "Show seasons in calendar", default: true, wired: true },
  {
    id: "showChannelAbbreviation",
    label: "Show channel abbreviation for bookings",
    default: true,
    wired: true,
  },
  { id: "lastNameFirst", label: "Show last name first for bookings", default: true, wired: true },
  {
    id: "hideCancellationArea",
    label: "Hide cancellation area from calendar",
    default: false,
    wired: true,
  },
  { id: "showWaitlist", label: "Show waitlist", default: false, wired: false },
] as const;

export type CalendarColorId = (typeof CALENDAR_COLORS)[number]["id"];
export type CalendarSwitchId = (typeof CALENDAR_SWITCHES)[number]["id"];
export type CalendarSettings = Record<CalendarColorId, string> & Record<CalendarSwitchId, boolean>;

export const DEFAULT_CALENDAR_SETTINGS = Object.fromEntries([
  ...CALENDAR_COLORS.map((c) => [c.id, c.default]),
  ...CALENDAR_SWITCHES.map((s) => [s.id, s.default]),
]) as CalendarSettings;

const HEX = /^#[0-9a-f]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim().toLowerCase());
}

/**
 * Dark or white text for a fill, by the fill's luminance.
 *
 * The badge colours are the hotel's to choose, and the reference's own
 * defaults include a light amber that white text is unreadable on at the
 * badge's 10.5px -- so the text colour follows the fill rather than being
 * fixed. WCAG relative luminance; the crossover is where dark and white text
 * have equal contrast.
 */
export function inkOn(hex: string): string {
  if (!isHexColor(hex)) return "#ffffff";
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  // The dark is the `ink` token, so the badge text matches the rest of the board.
  return l > 0.179 ? "#0F1B2A" : "#ffffff";
}
