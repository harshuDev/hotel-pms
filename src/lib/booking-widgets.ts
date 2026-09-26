/**
 * Settings -> Connectivity Settings -> Booking Widget (0100). A widget is a
 * small search box a hotel embeds on its own website, as an iframe of
 * `/book/widget/<hash>`; it sends the guest to the booking page with the
 * dates, the party and the language already chosen.
 */

export interface BookingWidget {
  id: string;
  hash: string;
  titleText: string | null;
  buttonText: string | null;
  checkInText: string | null;
  checkOutText: string | null;
  nightsText: string | null;
  showOccupancy: boolean;
  useCheckoutDate: boolean;
  /** Twelve names, comma separated, or null for the language's own. */
  monthNames: string | null;
  /** Seven names from Sunday, comma separated, or null for the language's own. */
  weekdayNames: string | null;
  primaryColor: string;
  textColor: string;
  backgroundColor: string;
  labelColor: string;
  borderColor: string;
  /** Null is the hotel's default language. */
  language: string | null;
}

/** What a blank text reads as on the widget. */
export const WIDGET_TEXT_DEFAULTS = {
  title: "Book Now",
  button: "Search",
  checkIn: "Check-In Date",
  checkOut: "Check-Out Date",
  nights: "Nights",
} as const;

/** The reference's starting values for a new widget. */
export const NEW_WIDGET: Omit<BookingWidget, "id" | "hash"> = {
  titleText: "Book Now",
  buttonText: "Search",
  checkInText: "Check-In Date",
  checkOutText: null,
  nightsText: "Nights",
  showOccupancy: false,
  useCheckoutDate: false,
  monthNames: null,
  weekdayNames: null,
  primaryColor: "#0098d1",
  textColor: "#363b3d",
  backgroundColor: "#ffffff",
  labelColor: "#a0acb2",
  borderColor: "#e2e2e2",
  language: null,
};

/** A custom list of names if it has exactly `count`, else the fallback. */
export function customNames(value: string | null, count: number, fallback: string[]): string[] {
  if (!value) return fallback;
  const names = value.split(",").map((n) => n.trim());
  return names.length === count && names.every(Boolean) ? names : fallback;
}

/** The iframe a hotel pastes into its own website. */
export function widgetEmbedCode(origin: string, w: Pick<BookingWidget, "hash" | "titleText" | "showOccupancy">): string {
  const height = w.showOccupancy ? 560 : 480;
  const title = (w.titleText ?? WIDGET_TEXT_DEFAULTS.title).replace(/"/g, "&quot;");
  return `<iframe src="${origin}/book/widget/${w.hash}" title="${title}" style="border:0;width:100%;max-width:380px;height:${height}px;background:transparent" loading="lazy"></iframe>`;
}
