"use client";

import Link from "next/link";
import { SearchOverlay } from "@/components/search-overlay";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui";
import { Chevron, Menu, MenuItem } from "@/components/menu";
import { SECTIONS, isHrefActive, isSectionActive } from "@/lib/nav";
import { signOut } from "@/lib/actions/auth";
import { clearCache } from "@/lib/actions/profile";
import { setStaffLanguage } from "@/lib/actions/staff-language";
import {
  STAFF_LOCALES,
  staffHtmlLang,
  staffT,
  type StaffLocale,
} from "@/lib/i18n/staff";

const USER_MENU = "__user";

const TRIGGER =
  "relative flex h-14 items-center px-2.5 text-[13.5px] transition-colors";

interface TopNavProps {
  propertyId: string;
  propertyName: string;
  staffName: string;
  /** The language the frame is drawn in, read from the cookie on the server. */
  lang: StaffLocale;
}

export function TopNav({
  propertyId,
  propertyName,
  staffName,
  lang,
}: TopNavProps) {
  const pathname = usePathname();
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
  const [switching, setSwitching] = useState<StaffLocale | null>(null);

  function chooseLanguage(code: StaffLocale) {
    if (code === lang || switching) return;
    setSwitching(code);
    // The menu stays open, so the change is seen where it was made: its own
    // items re-render in the new language when the layout comes back.
    void setStaffLanguage(code).then(() => {
      router.refresh();
      setSwitching(null);
    });
  }

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
    // `lang` on the frame, not on <html>: this header is in the chosen
    // language while every page body under it is still English, and a screen
    // reader picks its pronunciation from the nearest `lang` it finds.
    <header lang={staffHtmlLang(lang)} className="sticky top-0 z-50 bg-chrome-900">
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
          {SECTIONS.map((s) => {
            const active = isSectionActive(s, pathname);

            if (s.items) {
              return (
                <Menu
                  key={s.label}
                  label={staffT(lang, s.id)}
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
                {staffT(lang, s.id)}
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
            {/*
              THE CLIENT'S REFERENCE MENU, item for item. Their screenshot is
              the specification: Profile, Guest Booking Page, Settings; Clear
              cache; the language codes; the build; Log Out -- each group behind
              a rule, each item behind an icon, and their casing kept even where
              it is inconsistent, as the Inventory menu keeps theirs.

              The name-and-role heading that used to open this menu is gone,
              because theirs has none; the name is on the trigger.
            */}
            <div className="py-1">
              <MenuItem href="/profile">
                <MenuRow icon={<ProfileIcon />}>{staffT(lang, "profile")}</MenuRow>
              </MenuItem>
              <MenuItem href={`/book/${propertyId}`}>
                <MenuRow icon={<CaseIcon />}>{staffT(lang, "guestBookingPage")}</MenuRow>
              </MenuItem>
              <MenuItem href="/settings">
                <MenuRow icon={<GearIcon />}>{staffT(lang, "settings")}</MenuRow>
              </MenuItem>
            </div>

            <div className="border-t border-line py-1">
              {/*
                "Clear cache", their word for it, though what it does is reload
                this screen's figures from the database: reads are Server
                Components, so a number can sit behind a change made on the
                machine next door. The action underneath is unchanged.
              */}
              <MenuItem
                onSelect={() => {
                  if (refreshing) return;
                  setRefreshing(true);
                  void clearCache().then(() => {
                    router.refresh();
                    setRefreshing(false);
                    setOpenMenu(null);
                  });
                }}
              >
                <MenuRow icon={<WarningIcon />}>
                  {staffT(lang, refreshing ? "clearing" : "clearCache")}
                </MenuRow>
              </MenuItem>
            </div>

            {/*
              THE LANGUAGE GRID, and it DOES something. Twice before a language
              item here changed nothing and the client was right to object both
              times. This one switches the frame -- the section names, this
              menu, the business date line -- and the choice sticks to the
              browser. The screens themselves stay English until each is
              translated properly; see `src/lib/i18n/staff.ts` for where that
              line is drawn and why.
            */}
            <div
              role="group"
              aria-label="Language"
              className={cn(
                "grid grid-cols-4 gap-0.5 border-t border-line px-1.5 py-1.5",
                switching && "opacity-60",
              )}
            >
              {STAFF_LOCALES.map((code) => {
                const current = code === lang;
                return (
                  <button
                    key={code}
                    type="button"
                    data-menu-item
                    role="menuitemradio"
                    aria-checked={current}
                    disabled={switching !== null}
                    onClick={() => chooseLanguage(code)}
                    className={cn(
                      "rounded py-1.5 text-center text-[12.5px] outline-none transition-colors",
                      "focus-visible:bg-brass-wash focus-visible:text-brass",
                      current
                        ? "bg-brass-wash font-medium text-brass"
                        : "text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {code}
                  </button>
                );
              })}
            </div>

            <p className="tnum border-t border-line px-3 py-2 text-[11px] text-ink-faint">
              build: {process.env.APP_BUILD}
            </p>

            <div className="border-t border-line py-1">
              <MenuItem onSelect={() => void signOut()}>
                <MenuRow icon={<KeyIcon />}>{staffT(lang, "logOut")}</MenuRow>
              </MenuItem>
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
                        {staffT(lang, s.id)}
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
                    {staffT(lang, s.id)}
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

/** An icon and a label on one line, as every item in the reference's menu. */
function MenuRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-4 w-4 shrink-0 place-items-center text-ink-faint">
        {icon}
      </span>
      {children}
    </span>
  );
}

/*
 * The reference's five marks, drawn rather than imported: there is no icon
 * library here, and five small SVGs are not a reason to add one.
 */
const ICON = "h-4 w-4";

function ProfileIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={ICON} fill="currentColor">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14.5c0-3 2.7-5 6-5s6 2 6 5z" />
    </svg>
  );
}

function CaseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={ICON} fill="currentColor">
      <path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h2a1.5 1.5 0 0 1 1.5 1.5V4H13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 3 4h2.5zM7 3.5V4h2v-.5z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={ICON} fill="currentColor">
      <path d="M9.2 1.5l.3 1.7c.4.1.8.3 1.1.5l1.4-1 1.7 1.7-1 1.4c.2.3.4.7.5 1.1l1.7.3v2.4l-1.7.3c-.1.4-.3.8-.5 1.1l1 1.4-1.7 1.7-1.4-1c-.3.2-.7.4-1.1.5l-.3 1.7H6.8l-.3-1.7c-.4-.1-.8-.3-1.1-.5l-1.4 1-1.7-1.7 1-1.4c-.2-.3-.4-.7-.5-1.1l-1.7-.3V6.8l1.7-.3c.1-.4.3-.8.5-1.1l-1-1.4 1.7-1.7 1.4 1c.3-.2.7-.4 1.1-.5l.3-1.7zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={ICON} fill="currentColor">
      <path d="M8 1.5c.4 0 .7.2.9.5l6 10.5c.4.7-.1 1.5-.9 1.5H2c-.8 0-1.3-.8-.9-1.5l6-10.5c.2-.3.5-.5.9-.5zm-.8 4.5.2 4h1.2l.2-4zM8 11a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={ICON} fill="currentColor">
      <path d="M10.5 1.5a4 4 0 1 1-1.3 7.8L8 10.5H6.5V12H5v1.5H2.5v-2.2l4.2-4.2a4 4 0 0 1 3.8-5.6zm1 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
    </svg>
  );
}
