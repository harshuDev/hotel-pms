import type { StaffKey } from "@/lib/i18n/staff";

export interface NavItem {
  label: string;
  href: string;
}

export interface NavSection {
  /**
   * The key into the staff dictionary (`src/lib/i18n/staff.ts`). The English
   * `label` stays the internal identifier -- React keys and which menu is open
   * both hang off it -- so switching language never reshuffles state.
   */
  id: StaffKey;
  label: string;
  href?: string;
  items?: NavItem[];
  /** Column count for this section's dropdown panel. Defaults to 1. */
  columns?: 1 | 2;
  /** One tall scrolling column, as the client's reference system draws it. */
  scroll?: boolean;
}

export const SECTIONS: NavSection[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard" },
  { id: "calendar", label: "Calendar", href: "/calendar" },
  {
    id: "inventory",
    label: "Inventory",
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
      { label: "All", href: "/inventory/all" },
      { label: "Rates (All)", href: "/inventory/rates-all" },
      { label: "Rates (Main)", href: "/inventory/rates-main" },
      { label: "Availability", href: "/inventory/availability" },
      { label: "Min Stay Through", href: "/inventory/min-stay-through" },
      { label: "Min Stay Arrival", href: "/inventory/min-stay-arrival" },
      { label: "Max Stay", href: "/inventory/max-stay" },
      { label: "Closed to arrival", href: "/inventory/cta" },
      { label: "Closed to departure", href: "/inventory/ctd" },
      { label: "Stop Sell", href: "/inventory/stop-sell" },
      { label: "Close Out", href: "/inventory/close-out" },
    ],
  },
  {
    id: "bookings",
    label: "Bookings",
    /*
      Three items, matching the client's reference system exactly.
      
      It used to carry five. Arrivals, Departures and In house are still built
      and still reachable — the bookings list links to all three, and In house
      is that list's own `checked_in` filter. They came out of the menu, not out
      of the application.
    */
    items: [
      { label: "Add Simple Booking", href: "/bookings/new" },
      { label: "Add Group Booking", href: "/bookings/new?group=1" },
      { label: "Search", href: "/bookings" },
    ],
  },
  { id: "offers", label: "Offers", href: "/offers" },
  {
    id: "reports",
    label: "Reports",
    scroll: true,
    /*
      Twenty-two, matching the reference's list and its order. The first
      thirteen were built first and the other nine followed; the order is the
      reference's rather than anything meaningful, and it is kept so somebody
      moving between the two systems finds the same item in the same place.
    */
    items: [
      { label: "Payments Report", href: "/reports/payments" },
      { label: "Daily Checkout Report", href: "/reports/daily-checkout" },
      { label: "Booking Report", href: "/reports/booking" },
      { label: "Cancellation Report", href: "/reports/cancellation" },
      { label: "Housekeeping Report", href: "/reports/housekeeping" },
      { label: "Channel Report", href: "/reports/channel" },
      { label: "Extras Report", href: "/reports/extras" },
      { label: "Meal Report", href: "/reports/meal" },
      { label: "Occupancy Report", href: "/reports/occupancy" },
      { label: "Financial Report", href: "/reports/financial" },
      { label: "Debtors Report", href: "/reports/debtors" },
      { label: "In House Report", href: "/reports/in-house" },
      { label: "Reservations Report", href: "/reports/reservations" },
      { label: "Manager Report", href: "/reports/manager" },
      { label: "Folio Report", href: "/reports/folio" },
      { label: "Immigration Report", href: "/reports/immigration" },
      { label: "Country Report", href: "/reports/country" },
      { label: "Deposit Report", href: "/reports/deposit" },
      { label: "Rate Plan Report", href: "/reports/rate-plan" },
      { label: "Accounting Report", href: "/reports/accounting" },
      { label: "End Of Day Report", href: "/reports/end-of-day" },
      { label: "Booking Waitlist Report", href: "/reports/waitlist" },
    ],
  },
  { id: "customers", label: "Customers", href: "/customers" },
  { id: "cashier", label: "Cashier", href: "/cashier" },
  { id: "meetingRooms", label: "Meeting Rooms", href: "/meeting-rooms" },
];

export function isHrefActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function isSectionActive(section: NavSection, pathname: string): boolean {
  if (section.href) return isHrefActive(section.href, pathname);
  return (section.items ?? []).some((i) => isHrefActive(i.href, pathname));
}
