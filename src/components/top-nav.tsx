"use client";

import Link from "next/link";
import { SearchOverlay } from "@/components/search-overlay";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/components/ui";
import { Chevron, Menu, MenuItem } from "@/components/menu";
import { SECTIONS, isHrefActive, isSectionActive } from "@/lib/nav";
import { signOut } from "@/lib/actions/auth";
import { clearCache } from "@/lib/actions/profile";
import type { StaffRole } from "@/lib/types";

const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  front_desk: "Front desk",
  cashier: "Cashier",
  housekeeping: "Housekeeping",
};

const USER_MENU = "__user";

const TRIGGER =
  "relative flex h-14 items-center px-2.5 text-[13.5px] transition-colors";

interface TopNavProps {
  propertyId: string;
  propertyName: string;
  staffName: string;
  staffRole: StaffRole;
  /**
   * Menu entries a switched-off Hotel Feature takes away (0076). Required, so
   * a caller that forgets the switches is a compile error rather than a nav
   * quietly offering a screen the hotel turned off.
   */
  hiddenHrefs: string[];
}

export function TopNav({
  propertyId,
  propertyName,
  staffName,
  staffRole,
  hiddenHrefs,
}: TopNavProps) {
  const pathname = usePathname();
  // One filtered list for the bar and the drawer alike, so the two cannot
  // disagree about what the hotel has switched off.
  const sections = useMemo(
    () =>
      SECTIONS.map((s) =>
        s.items ? { ...s, items: s.items.filter((i) => !hiddenHrefs.includes(i.href)) } : s,
      ),
    [hiddenHrefs],
  );
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /*
    The search owns its own open state.

    It used to take an `onSearchClick` prop, which the layout could never pass:
    the layout is a Server Component and React will not serialise a function
    across that boundary. So the button was `disabled={!onSearchClick}` for
    ever — structurally un-wireable rather than merely unwired.
  */
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl/Cmd K is what people try first, and a front desk works by keyboard.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setOpenMenu(null);
    setDrawerOpen(false);
  }, [pathname]);

  return (
    /*
      z-50, NOT z-40.

      The mobile drawer below is `fixed inset-0 z-50`, but it is a child of this
      header -- and a `sticky` element with a z-index creates a stacking
      context, so that 50 only ranks the drawer *inside* the header. At page
      level the whole header competes with its own z-index, so at z-40 it tied
      with the calendar's paging chevrons and lost to them on DOM order: the
      two arrows floated on top of the open drawer on a phone.

      Raising it means the nav chrome sits above ordinary page content, which is
      what it is for. Dialogs still cover it: they are `fixed inset-0 z-50` in
      `main`, which comes after this header, so an equal z-index resolves their
      way. Do not lower this back to z-40 to "match" the top bar -- that strip
      is z-30 and sits under this by design.
    */
    <header className="sticky top-0 z-50 bg-chrome-900 print:hidden">
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
          Logo. Client asked for the mark only, no wordmark — it was taking up
          too much bar width. /public/logo-mark.png is the brand-blue droplet
          with the RC lettering reversed to white, same as the mark supplied
          in _RC_LOGO.pdf. Aspect is ~1.18:1, so h-32px renders ~38px wide.
        */}
        <Link
          href="/dashboard"
          aria-label={`${propertyName} dashboard`}
          className="flex shrink-0 items-center rounded p-1 outline-none focus-visible:ring-1 focus-visible:ring-white/40"
        >
          <img
            src="/logo-mark.png"
            alt=""
            aria-hidden="true"
            className="h-8 w-auto"
          />
        </Link>

        <nav aria-label="Main" className="ml-2 hidden items-center lg:flex">
          {sections.map((s) => {
            const active = isSectionActive(s, pathname);

            if (s.items) {
              return (
                <Menu
                  key={s.label}
                  label={s.label}
                  active={active}
                  columns={s.columns ?? 1}
                  scroll={s.scroll ?? false}
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
            onClick={() => setSearchOpen(true)}
            aria-label="Search bookings, guests and rooms"
            title="Search bookings, guests and rooms (Ctrl K)"
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
            label={staffName}
            align="end"
            open={openMenu === USER_MENU}
            onOpenChange={(o) => setOpenMenu(o ? USER_MENU : null)}
            triggerClassName="relative flex h-14 items-center gap-2 px-1.5 text-[13px] text-white/70 transition-colors hover:text-white"
            triggerContent={
              <>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.14] text-[11px] font-medium text-white">
                  {staffName.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-[13px] sm:inline">{staffName}</span>
                <Chevron open={openMenu === USER_MENU} />
              </>
            }
          >
            <div className="border-b border-line px-2.5 pb-2 pt-1">
              <p className="text-[13px] text-ink">{staffName}</p>
              <p className="text-2xs text-ink-faint">{ROLE_LABEL[staffRole]}</p>
            </div>
            <div className="pt-1">
              <MenuItem href="/profile">Profile</MenuItem>
              <MenuItem href={`/book/${propertyId}`}>Guest booking page</MenuItem>
              <MenuItem href="/settings">Settings</MenuItem>
              <MenuItem
                onSelect={() => {
                  if (refreshing) return;
                  setRefreshing(true);
                  // The menu stays open while this runs, which is the only
                  // place there is to say it is happening — every screen this
                  // sits over is a table that will look identical until the
                  // new data lands. It closes once the refresh is through.
                  void clearCache().then(() => {
                    router.refresh();
                    setRefreshing(false);
                    setOpenMenu(null);
                  });
                }}
              >
                {refreshing ? "Reloading\u2026" : "Reload data"}
              </MenuItem>
              {/*
                There is no Language item. These screens are English, so a
                control that cannot change anything was worse than nothing —
                first it read as broken, then as pointless, and both were fair.
                The nineteen languages live on the guest booking page, where
                the person reading might not speak English. If the staff app is
                ever translated this is where the switcher goes back.
              */}
              <MenuItem onSelect={() => void signOut()}>Log out</MenuItem>
            </div>
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
                src="/logo-mark.png"
                alt={propertyName}
                className="h-7 w-auto"
              />
            </div>
            <nav
              aria-label="Main"
              className="flex-1 overflow-y-auto px-2.5 pb-4 pt-3"
            >
              {sections.map((s) => {
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

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </header>
  );
}

