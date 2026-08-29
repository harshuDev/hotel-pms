"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui";

interface Section {
  label: string;
  href?: string;
  items?: { label: string; href: string }[];
}

const SECTIONS: Section[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Calendar", href: "/calendar" },
  {
    label: "Inventory",
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

export function SideNav() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  const active = (s: Section) =>
    s.href
      ? pathname === s.href || pathname.startsWith(s.href + "/")
      : (s.items ?? []).some((i) => pathname.startsWith(i.href));

  const body = (
    <>
      <nav className="flex-1 overflow-y-auto px-2.5 pb-4 pt-5">
        {SECTIONS.map((s) => {
          const isActive = active(s);
          const isOpen = expanded === s.label || (isActive && !!s.items);

          if (s.href) {
            return (
              <Link
                key={s.label}
                href={s.href}
                className={cn(
                  "relative mb-0.5 block rounded px-3 py-2 text-[13.5px] transition-colors",
                  isActive
                    ? "bg-white/[0.07] font-500 text-white"
                    : "text-white/55 hover:bg-white/[0.04] hover:text-white/90",
                )}
              >
                {isActive && (
                  <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brass" />
                )}
                {s.label}
              </Link>
            );
          }

          return (
            <div key={s.label} className="mb-0.5">
              <button
                onClick={() => setExpanded(isOpen ? null : s.label)}
                aria-expanded={isOpen}
                className={cn(
                  "relative flex w-full items-center justify-between rounded px-3 py-2 text-[13.5px] transition-colors",
                  isActive
                    ? "font-500 text-white"
                    : "text-white/55 hover:bg-white/[0.04] hover:text-white/90",
                )}
              >
                {isActive && (
                  <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brass" />
                )}
                {s.label}
                <span
                  className={cn(
                    "text-[8px] opacity-50 transition-transform",
                    isOpen && "rotate-90",
                  )}
                >
                  ▶
                </span>
              </button>
              {isOpen && (
                <div className="mb-1.5 ml-3 border-l border-white/10 pl-2.5">
                  {s.items!.map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      className={cn(
                        "block rounded px-2.5 py-1.5 text-[12.5px] transition-colors",
                        pathname === i.href
                          ? "text-brass-light"
                          : "text-white/40 hover:text-white/80",
                      )}
                    >
                      {i.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/[0.07] px-5 py-3.5">
        <p className="text-[13px] text-white">Shekher</p>
        <p className="text-2xs text-white/35">Reception · on shift</p>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="sticky top-0 z-40 flex h-13 items-center gap-3 bg-chrome-900 px-4 py-3 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="text-sm text-white/80"
          aria-label="Open navigation"
        >
          ☰
        </button>
        <p className="font-display text-sm text-white">Grand Ferndale</p>
      </div>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="flex h-full w-[268px] flex-col bg-chrome-900"
            onClick={(e) => e.stopPropagation()}
          >
            {body}
          </aside>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[212px] flex-col bg-chrome-900 lg:flex">
        {body}
      </aside>
    </>
  );
}
