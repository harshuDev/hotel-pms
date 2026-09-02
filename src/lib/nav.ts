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
}

export const SECTIONS: NavSection[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Calendar", href: "/calendar" },
  {
    label: "Inventory",
    columns: 2,
    items: [
      { label: "Rates", href: "/inventory/rates-all" },
      { label: "Availability", href: "/inventory/availability" },
      { label: "Min stay through", href: "/inventory/min-stay-through" },
      { label: "Min stay arrival", href: "/inventory/min-stay-arrival" },
      { label: "Max stay", href: "/inventory/max-stay" },
      { label: "Closed to arrival", href: "/inventory/cta" },
      { label: "Closed to departure", href: "/inventory/ctd" },
      { label: "Stop sell", href: "/inventory/stop-sell" },
      { label: "Close out", href: "/inventory/close-out" },
    ],
  },
  {
    label: "Bookings",
    items: [
      { label: "All bookings", href: "/bookings" },
      { label: "New booking", href: "/bookings/new" },
      { label: "Arrivals", href: "/bookings/arrivals" },
      { label: "Departures", href: "/bookings/departures" },
      { label: "In house", href: "/bookings/in-house" },
    ],
  },
  { label: "Promotions", href: "/offers" },
  {
    label: "Reports",
    columns: 2,
    items: [
      { label: "Payments", href: "/reports/payments" },
      { label: "Daily checkout", href: "/reports/daily-checkout" },
      { label: "Booking", href: "/reports/booking" },
      { label: "Cancellation", href: "/reports/cancellation" },
      { label: "Housekeeping", href: "/reports/housekeeping" },
      { label: "Channel", href: "/reports/channel" },
      { label: "Extras", href: "/reports/extras" },
      { label: "Meal", href: "/reports/meal" },
      { label: "Occupancy", href: "/reports/occupancy" },
      { label: "Financial", href: "/reports/financial" },
      { label: "Debtors", href: "/reports/debtors" },
      { label: "In house", href: "/reports/in-house" },
      { label: "Reservations", href: "/reports/reservations" },
    ],
  },
  { label: "Customers", href: "/customers" },
  { label: "Cashier", href: "/cashier" },
  { label: "Meeting Rooms", href: "/meeting-rooms" },
];

export function isHrefActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function isSectionActive(section: NavSection, pathname: string): boolean {
  if (section.href) return isHrefActive(section.href, pathname);
  return (section.items ?? []).some((i) => isHrefActive(i.href, pathname));
}
