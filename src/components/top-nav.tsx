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
          className="mr-1 grid h-8 w-8 place-items-center rounded text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white lg:hidden"
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
          navy wordmark recoloured white so it reads on bg-chrome-900. The mark
          stays brand cyan. Aspect is 5.69:1, so h-26px renders ~148px wide.
          Swap the src to /logo-mark.png for the compact mark-only version.
        */}
        <Link
          href="/dashboard"
          aria-label={`${propertyName} dashboard`}
          className="flex shrink-0 items-center rounded p-1 outline-none focus-visible:ring-1 focus-visible:ring-white/40"
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
                    active
                      ? "font-medium text-white"
                      : "text-white/60 hover:text-white",
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
                  "outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40",
                  active
                    ? "font-medium text-white"
                    : "text-white/60 hover:text-white",
                )}
              >
                {s.label}
                {active && (
                  <span className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-brass" />
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
            className="grid h-8 w-8 place-items-center rounded text-white/60 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-1 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
            triggerClassName="relative flex h-14 items-center gap-2 px-1.5 text-[13px] text-white/70 transition-colors hover:text-white"
            triggerContent={
              <>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.14] text-[11px] font-medium text-white">
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
            <div className="border-b border-white/[0.07] px-4 py-3.5">
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
                          "flex w-full items-center justify-between rounded px-3 py-2 text-[13.5px] transition-colors",
                          active
                            ? "font-medium text-white"
                            : "text-white/55 hover:bg-white/[0.04] hover:text-white/90",
                        )}
                      >
                        {s.label}
                        <Chevron open={isOpen} />
                      </button>
                      {isOpen && (
                        <div className="mb-1.5 ml-3 border-l border-white/10 pl-2.5">
                          {s.items.map((i) => (
                            <Link
                              key={i.href}
                              href={i.href}
                              className={cn(
                                "block rounded px-2.5 py-1.5 text-[12.5px] transition-colors",
                                isHrefActive(i.href, pathname)
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
                }

                if (!s.href) return null;

                return (
                  <Link
                    key={s.label}
                    href={s.href}
                    className={cn(
                      "relative mb-0.5 block rounded px-3 py-2 text-[13.5px] transition-colors",
                      active
                        ? "bg-white/[0.07] font-medium text-white"
                        : "text-white/55 hover:bg-white/[0.04] hover:text-white/90",
                    )}
                  >
                    {active && (
                      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brass" />
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

