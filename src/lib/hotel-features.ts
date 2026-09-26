/**
 * Settings -> System Settings -> Hotel Features (0076), in the client's
 * reference's order and wording, down to its mixed casing ("Enable room rate
 * combination modification" beside "Enable Group Booking Feature") -- the
 * same rule the Inventory menu keeps.
 *
 * The ids are the keys `save_hotel_features()` accepts. A switch never saved
 * reads as `default`.
 *
 * `wired` says whether turning the switch changes anything in this
 * application today. Four do, each onto something that already exists:
 *
 *   housekeeping                      the Housekeeping Report and the
 *                                     calendar's housekeeping dots
 *   housekeeping_status_modification  whether that dot opens its menu
 *   group_booking                     "Add Group Booking" in the Bookings menu
 *   accounting_report                 the Accounting Report
 *
 * THE REST ARE STORED, NOT YET LIVE -- the same standing as the email
 * settings: each names a feature this system does not have, and the choice is
 * kept for when it does. `payment_edit` will never be wired as its label
 * reads: payments are append-only, and a correction is a reversing row.
 *
 * The defaults are the reference's ticks, except for the two housekeeping
 * switches, which default to what this application already did before the
 * switch existed -- a switch arriving must not quietly take a working screen
 * away.
 */
export const HOTEL_FEATURES = [
  { id: "housekeeping", label: "Enable Housekeeping Feature", default: true, wired: true },
  {
    id: "housekeeping_status_modification",
    label: "Enable Housekeeping Status Modification Feature",
    default: true,
    wired: true,
  },
  {
    id: "room_rate_combination_modification",
    label: "Enable room rate combination modification",
    default: false,
    wired: false,
  },
  { id: "sales_channels", label: "Enable SalesChannels Feature", default: true, wired: false },
  { id: "group_booking", label: "Enable Group Booking Feature", default: true, wired: true },
  {
    id: "checkin_confirmation_mode",
    label: "Use Checkin With Confirmation Mode",
    default: false,
    wired: false,
  },
  {
    id: "payments_export_line_per_payment",
    label: "Show line-per-payment in Payments Report Export",
    default: true,
    wired: false,
  },
  {
    id: "accounting_categories",
    label: "Enable Accounting Categories Feature",
    default: true,
    wired: false,
  },
  { id: "accounting_report", label: "Enable Accounting Report", default: true, wired: true },
  { id: "invoice_date_changes", label: "Allow changes to invoice date", default: true, wired: false },
  {
    id: "invoice_number_changes",
    label: "Allow changes to invoice number",
    default: true,
    wired: false,
  },
  { id: "payment_edit", label: "Allow 'Edit' action for payments", default: true, wired: false },
  {
    id: "foreign_currency_invoices",
    label: "Enable Foreign Currency Invoices",
    default: false,
    wired: false,
  },
  {
    id: "new_extra_in_booking",
    label: "New Extra through booking process allowed",
    default: true,
    wired: false,
  },
  { id: "multi_room_inventory_table", label: "Multi-room inventory table", default: true, wired: false },
  { id: "payment_terminal", label: "Show Payment Terminal", default: false, wired: false },
  {
    id: "three_column_dashboard",
    label: "Enable three-column dashboard view without Statistics",
    default: false,
    wired: false,
  },
  {
    id: "room_rates_with_hotel_data",
    label: "Return room rates with hotel data",
    default: true,
    wired: false,
  },
  { id: "travia_customer_lookup", label: "Enable Travia customer lookup", default: false, wired: false },
  { id: "optimize_customer_search", label: "Optimize Customer Search", default: false, wired: false },
] as const;

export type HotelFeatureId = (typeof HOTEL_FEATURES)[number]["id"];
export type HotelFeatures = Record<HotelFeatureId, boolean>;

/** Stored switches over the defaults; anything unknown or not a boolean is ignored. */
export function resolveHotelFeatures(stored: unknown): HotelFeatures {
  const raw =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    HOTEL_FEATURES.map((f) => [f.id, typeof raw[f.id] === "boolean" ? raw[f.id] : f.default]),
  ) as HotelFeatures;
}

/** What the calendar's housekeeping dot does under the two switches. */
export type HousekeepingMode = "off" | "view" | "edit";

export function housekeepingMode(features: HotelFeatures): HousekeepingMode {
  if (!features.housekeeping) return "off";
  return features.housekeeping_status_modification ? "edit" : "view";
}

/** Menu entries a switched-off feature takes out of the nav. */
export function hiddenNavHrefs(features: HotelFeatures): string[] {
  const hidden: string[] = [];
  if (!features.housekeeping) hidden.push("/reports/housekeeping");
  if (!features.group_booking) hidden.push("/bookings/new?group=1");
  if (!features.accounting_report) hidden.push("/reports/accounting");
  return hidden;
}
