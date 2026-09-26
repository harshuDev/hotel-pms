import { msg } from "@/lib/i18n/translate";

export interface NavItem {
  label: string;
  href: string;
}

export interface NavSection {
  label: string;
  href?: string;
  items?: NavItem[];
  /** Column count for this section's dropdown panel. Defaults to 1. */
  columns?: 1 | 2;
  /** One tall scrolling column, as the client's reference system draws it. */
  scroll?: boolean;
}

export const SECTIONS: NavSection[] = [
  { label: msg("Dashboard"), href: "/dashboard" },
  { label: msg("Calendar"), href: "/calendar" },
  {
    label: msg("Inventory"),
    /*
      Eleven items, matching the client's reference system exactly and in its
      order. "All" is every field on one read-only grid; the other ten each
      bring one field forward to be edited in bulk.

      Rates (All) and Rates (Main) are the same grid over the same field: Main
      pins the default plan, All lets you pick. Changing the main rate is most
      of what anyone does here, and making them choose the plan first every time
      is a click that is always the same click.
    */
    items: [
      { label: msg("All"), href: "/inventory/all" },
      { label: msg("Rates (All)"), href: "/inventory/rates-all" },
      { label: msg("Rates (Main)"), href: "/inventory/rates-main" },
      { label: msg("Availability"), href: "/inventory/availability" },
      { label: msg("Min Stay Through"), href: "/inventory/min-stay-through" },
      { label: msg("Min Stay Arrival"), href: "/inventory/min-stay-arrival" },
      { label: msg("Max Stay"), href: "/inventory/max-stay" },
      { label: msg("Closed to arrival"), href: "/inventory/cta" },
      { label: msg("Closed to departure"), href: "/inventory/ctd" },
      { label: msg("Stop Sell"), href: "/inventory/stop-sell" },
      { label: msg("Close Out"), href: "/inventory/close-out" },
    ],
  },
  {
    label: msg("Bookings"),
    /*
      Three items, matching the client's reference system exactly.
      
      It used to carry five. Arrivals, Departures and In house are still built
      and still reachable — the bookings list links to all three, and In house
      is that list's own `checked_in` filter. They came out of the menu, not out
      of the application.
    */
    items: [
      { label: msg("Add Simple Booking"), href: "/bookings/new" },
      { label: msg("Add Group Booking"), href: "/bookings/new?group=1" },
      { label: msg("Search"), href: "/bookings" },
    ],
  },
  { label: msg("Offers"), href: "/offers" },
  {
    label: msg("Reports"),
    scroll: true,
    /*
      Twenty-two, matching the reference's list and its order. The first
      thirteen were built first and the other nine followed; the order is the
      reference's rather than anything meaningful, and it is kept so somebody
      moving between the two systems finds the same item in the same place.
    */
    items: [
      { label: msg("Payments Report"), href: "/reports/payments" },
      { label: msg("Daily Checkout Report"), href: "/reports/daily-checkout" },
      { label: msg("Booking Report"), href: "/reports/booking" },
      { label: msg("Cancellation Report"), href: "/reports/cancellation" },
      { label: msg("Housekeeping Report"), href: "/reports/housekeeping" },
      { label: msg("Channel Report"), href: "/reports/channel" },
      { label: msg("Extras Report"), href: "/reports/extras" },
      { label: msg("Meal Report"), href: "/reports/meal" },
      { label: msg("Occupancy Report"), href: "/reports/occupancy" },
      { label: msg("Financial Report"), href: "/reports/financial" },
      { label: msg("Debtors Report"), href: "/reports/debtors" },
      { label: msg("In House Report"), href: "/reports/in-house" },
      { label: msg("Reservations Report"), href: "/reports/reservations" },
      { label: msg("Manager Report"), href: "/reports/manager" },
      { label: msg("Folio Report"), href: "/reports/folio" },
      { label: msg("Immigration Report"), href: "/reports/immigration" },
      { label: msg("Country Report"), href: "/reports/country" },
      { label: msg("Deposit Report"), href: "/reports/deposit" },
      { label: msg("Rate Plan Report"), href: "/reports/rate-plan" },
      { label: msg("Accounting Report"), href: "/reports/accounting" },
      { label: msg("End Of Day Report"), href: "/reports/end-of-day" },
      { label: msg("Booking Waitlist Report"), href: "/reports/waitlist" },
    ],
  },
  { label: msg("Customers"), href: "/customers" },
  { label: msg("Cashier"), href: "/cashier" },
  { label: msg("Meeting Rooms"), href: "/meeting-rooms" },
];

export function isHrefActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function isSectionActive(section: NavSection, pathname: string): boolean {
  if (section.href) return isHrefActive(section.href, pathname);
  return (section.items ?? []).some((i) => isHrefActive(i.href, pathname));
}
