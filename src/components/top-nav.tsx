"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui";
import { Chevron, Menu, MenuItem } from "@/components/menu";
import { SECTIONS, isHrefActive, isSectionActive } from "@/lib/nav";

const USER_MENU = "__user";

const TRIGGER =
  "relative flex h-14 items-center px-2.5 text-[13.5px] transition-colors";

interface TopNavProps {
  propertyName: string;
  onSearchClick?: () => void;
}

export function TopNav({ propertyName, onSearchClick }: TopNavProps) {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setOpenMenu(null);
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 bg-chrome-900">
      <div className="flex h-14 items-center px-3 lg:px-4">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="mr-1 grid h-8 w-8 place-items-center rounded text-white transition-colors hover:bg-white/[0.16] lg:hidden"
        >
          <svg
            viewBox="0 0 18 18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            className="h-[17px] w-[17px]"
          >
            <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" />
          </svg>
        </button>

        {/*
          Logo. /public/logo-white.png is the Reservation Centric lockup with the
          navy wordmark recoloured white. On the #1D6FE0 chrome the cyan mark
          sits at only 1.6:1 against the bar, so the plate below keeps it
          legible. Aspect is 5.69:1, so h-26px renders ~148px wide.
        */}
        <Link
          href="/dashboard"
          aria-label={`${propertyName} dashboard`}
          className="flex shrink-0 items-center rounded p-1 outline-none focus-visible:ring-1 focus-visible:ring-white/70"
        >
          <img
            src="/logo-white.png"
            alt=""
            aria-hidden="true"
            className="h-[26px] w-auto"
          />
        </Link>

        <nav aria-label="Main" className="ml-2 hidden items-center lg:flex">
          {SECTIONS.map((s) => {
            const active = isSectionActive(s, pathname);

            if (s.items) {
              return (
                <Menu
                  key={s.label}
                  label={s.label}
                  active={active}
                  columns={s.columns ?? 1}
                  open={openMenu === s.label}
                  onOpenChange={(o) => setOpenMenu(o ? s.label : null)}
                  triggerClassName={cn(
                    TRIGGER,
                    "text-white",
                    active ? "font-medium" : "font-normal",
                  )}
                >
                  {s.items.map((i) => (
                    <MenuItem key={i.href} href={i.href}>
                      {i.label}
                    </MenuItem>
                  ))}
                </Menu>
              );
            }

            if (!s.href) return null;

            return (
              <Link
                key={s.label}
                href={s.href}
                className={cn(
                  TRIGGER,
                  "text-white outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/70",
                  active ? "font-medium" : "font-normal",
                )}
              >
                {s.label}
                {active && (
                  <span className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-white" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-0.5 pl-2">
          <button
            type="button"
            onClick={onSearchClick}
            disabled={!onSearchClick}
            aria-label="Search bookings and guests"
            className="grid h-8 w-8 place-items-center rounded text-white outline-none transition-colors hover:bg-white/[0.16] focus-visible:ring-1 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
          >
            <svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              className="h-[17px] w-[17px]"
            >
              <circle cx="9" cy="9" r="5.5" />
              <path d="m13.2 13.2 3.4 3.4" />
            </svg>
          </button>

          <Menu
            label="Shekher"
            align="end"
            open={openMenu === USER_MENU}
            onOpenChange={(o) => setOpenMenu(o ? USER_MENU : null)}
            triggerClassName="relative flex h-14 items-center gap-2 px-1.5 text-[13px] text-white transition-colors"
            triggerContent={
              <>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.22] text-[11px] font-medium text-white">
                  S
                </span>
                <span className="hidden text-[13px] sm:inline">Shekher</span>
                <Chevron open={openMenu === USER_MENU} />
              </>
            }
          >
            <div className="border-b border-line px-2.5 pb-2 pt-1">
              <p className="text-[13px] text-ink">Shekher</p>
              <p className="text-2xs text-ink-faint">Reception · on shift</p>
            </div>
            <div className="pt-1">
              <MenuItem disabled>Profile</MenuItem>
              <MenuItem disabled>Guest booking page</MenuItem>
              <MenuItem disabled>Settings</MenuItem>
              <MenuItem disabled>Clear cache</MenuItem>
              <MenuItem disabled>Language</MenuItem>
              <MenuItem disabled>Log out</MenuItem>
            </div>
            <p className="border-t border-line px-2.5 pb-1 pt-2 text-2xs text-ink-faint">
              These open once accounts are switched on.
            </p>
          </Menu>
        </div>
      </div>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            className="flex h-full w-[268px] flex-col bg-chrome-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-white/20 px-4 py-3.5">
              <img
                src="/logo-white.png"
                alt={propertyName}
                className="h-[24px] w-auto"
              />
            </div>
            <nav
              aria-label="Main"
              className="flex-1 overflow-y-auto px-2.5 pb-4 pt-3"
            >
              {SECTIONS.map((s) => {
                const active = isSectionActive(s, pathname);

                if (s.items) {
                  const isOpen = expanded === s.label || active;
                  return (
                    <div key={s.label} className="mb-0.5">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : s.label)}
                        aria-expanded={isOpen}
                        className={cn(
                          "flex w-full items-center justify-between rounded px-3 py-2 text-[13.5px] text-white transition-colors hover:bg-white/[0.1]",
                          active ? "font-medium" : "font-normal",
                        )}
                      >
                        {s.label}
                        <Chevron open={isOpen} />
                      </button>
                      {isOpen && (
                        <div className="mb-1.5 ml-3 border-l border-white/25 pl-2.5">
                          {s.items.map((i) => (
                            <Link
                              key={i.href}
                              href={i.href}
                              className={cn(
                                "block rounded px-2.5 py-1.5 text-[12.5px] text-white transition-colors hover:bg-white/[0.1]",
                                isHrefActive(i.href, pathname)
                                  ? "font-medium"
                                  : "font-normal",
                              )}
                            >
                              {i.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                if (!s.href) return null;

                return (
                  <Link
                    key={s.label}
                    href={s.href}
                    className={cn(
                      "relative mb-0.5 block rounded px-3 py-2 text-[13.5px] text-white transition-colors hover:bg-white/[0.1]",
                      active ? "bg-white/[0.16] font-medium" : "font-normal",
                    )}
                  >
                    {active && (
                      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-white" />
                    )}
                    {s.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}
    </header>
  );
}
