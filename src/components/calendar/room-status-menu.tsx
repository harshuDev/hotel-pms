"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import {
  setRoomDoNotDisturb,
  setRoomHousekeeping,
} from "@/lib/actions/settings";
import type { HousekeepingChoice, RoomStatus } from "@/lib/types";

/**
 * Setting a room's housekeeping state from the calendar rail.
 *
 * The client's reference opens this off the coloured dot beside each room, and
 * that is the right place for it — the board is where somebody is already
 * looking at the room when they learn it has been cleaned. Their five are all
 * here now: Inspected, Clean, Dirty, Broken, Do not disturb.
 *
 * THE CLIENT ON WHAT THIS IS FOR: "The housekeeping, does not affect
 * availability. It's there for the hotel reception and housekeeping staff to
 * use ... If the 101 is showing as dirty, the receptionist knows that the room
 * is not ready and will offer a room that's is shown ready in the system."
 *
 * That is true of four of the five. **Broken is the exception**: it maps to
 * `ooo`, which does reduce what the hotel can sell — and should, because a
 * broken room cannot take a guest. The menu says so on the item rather than
 * letting somebody find out from a changed figure.
 *
 * WHY INSPECTED AND DO NOT DISTURB ARE NOT STATUSES. `room_status` is the
 * column that decides sellability, so neither could go in it:
 *
 *   - Inspected is a second fact about a room that is already CLEAN. As a
 *     status, every `= 'vacant_clean'` test would stop matching it — including
 *     the readiness check in `assign_room()` — so signing a room off would
 *     have made it unassignable. It is a flag beside the status instead.
 *   - Do not disturb belongs to an OCCUPIED room. It is the guest's request,
 *     not a state of cleanliness, so it is a separate toggle and Postgres
 *     refuses it on a room with nobody in it.
 *
 * THE MENU IS PORTALLED TO `document.body`, AND IT HAS TO BE. Each room row's
 * rail cell is `sticky left-0 z-10` -- a positioned element with a z-index,
 * which creates a STACKING CONTEXT. So a `z-50` on a menu inside room 103's
 * cell only ranks it against room 103's own contents; rows 104, 105 and the
 * rest are later siblings at the same z-10 and paint straight over it. The
 * client saw a menu with only its first item visible and the rest buried
 * under the room numbers below.
 *
 * This is the same trap the top nav documents -- "a sticky element with a
 * z-index creates a stacking context, so the drawer's 50 only ranks it within
 * the header". Raising the number does not help, because the competition is
 * between the ROWS, not inside them. A portal leaves the stacking contexts
 * behind entirely, which is why the menu is positioned by measurement rather
 * than by `absolute`.
 */
const CHOICES: {
  choice: HousekeepingChoice;
  label: string;
  dot: string;
  note?: string;
}[] = [
  { choice: "inspected", label: "Inspected", dot: "bg-emerald-500" },
  { choice: "clean", label: "Clean", dot: "bg-emerald-400" },
  { choice: "dirty", label: "Dirty", dot: "bg-rose-400" },
  {
    choice: "broken",
    label: "Broken",
    dot: "bg-slate-500",
    // The one clause on a control whose consequence is not obvious, which the
    // copy rules keep: a choice that takes a room off sale has to say so.
    note: "Takes it off sale",
  },
];

export function RoomStatusMenu({
  roomId,
  roomNumber,
  status,
  isInspected,
  doNotDisturb,
  dotClass,
  label,
}: {
  roomId: string;
  roomNumber: string;
  status: RoomStatus;
  isInspected: boolean;
  doNotDisturb: boolean;
  /** The dot's colour, decided by the board so the two cannot drift. */
  dotClass: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dotRef = useRef<HTMLButtonElement>(null);
  /* Where to draw the portalled menu, in viewport coordinates. */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const MENU_W = 192; // w-48
  const MENU_MAX_H = 260; // the five rows plus a note, near enough

  /*
   * Measured from the dot, because a portalled menu has no parent to be
   * positioned against. Clamped to the viewport in both directions: the rail
   * is on the left of a phone screen, so the menu goes to the RIGHT of the
   * dot and only flips when there is no room, and a dot near the bottom of a
   * long list would otherwise open a menu hanging off the screen.
   */
  function place() {
    const el = dotRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 10;
    let left = r.right + gap;
    if (left + MENU_W + 8 > window.innerWidth) {
      left = Math.max(8, r.left - gap - MENU_W);
    }
    const top = Math.max(
      8,
      Math.min(r.top - 6, window.innerHeight - MENU_MAX_H - 8),
    );
    setPos({ left, top });
  }

  /*
   * The board is a scroller and the menu is fixed to the viewport, so the two
   * come apart the moment anything scrolls. Closing is the honest response:
   * re-measuring on every scroll frame would have the menu chasing the dot
   * across the screen, which is worse than it simply going away.
   */
  useEffect(() => {
    if (!open) return;
    function shut() {
      setOpen(false);
    }
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    return () => {
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("resize", shut);
    };
  }, [open]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  /* The current point on the scale, so the menu can mark it. */
  const current: HousekeepingChoice | null =
    status === "vacant_clean"
      ? isInspected
        ? "inspected"
        : "clean"
      : status === "vacant_dirty"
        ? "dirty"
        : status === "ooo"
          ? "broken"
          : null;

  return (
    <span className="relative shrink-0">
      <button
        ref={dotRef}
        type="button"
        onClick={() => {
          if (!open) place();
          setOpen((o) => !o);
        }}
        title={`${label} — change`}
        aria-label={`Housekeeping for room ${roomNumber}: ${label}. Change it.`}
        aria-expanded={open}
        className={cn(
          "block h-2.5 w-2.5 rounded-full ring-offset-1 ring-offset-chrome-800 transition",
          "hover:ring-2 hover:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
          dotClass,
        )}
      />

      {open &&
        pos &&
        createPortal(
          <>
            {/*
              Click-away as a sibling rather than a document listener: the
              board is one big scroller and a listener on it fights every
              other control.
            */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[60] cursor-default"
            />
            <div
              className="fixed z-[61] w-48 rounded-md border border-line bg-white py-1 shadow-lift"
              style={{ left: pos.left, top: pos.top }}
            >
              {CHOICES.map((c) => (
                <button
                  key={c.choice}
                  type="button"
                  disabled={pending || status === "occupied"}
                  onClick={() =>
                    run(() => setRoomHousekeeping({ roomId, choice: c.choice }))
                  }
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition",
                    c.choice === current
                      ? "cursor-default text-ink-faint"
                      : "text-ink hover:bg-shell",
                    (pending || status === "occupied") && "opacity-50",
                  )}
                >
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", c.dot)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {c.label}
                    {c.note && (
                      <span className="block text-xxs text-ink-faint">
                        {c.note}
                      </span>
                    )}
                  </span>
                  {c.choice === current && (
                    <span className="shrink-0 text-xxs text-ink-faint">
                      now
                    </span>
                  )}
                </button>
              ))}

              {/*
              Do not disturb sits below a rule, because it is the guest's
              request rather than a point on the scale above. It is only
              offered while somebody is in the room — Postgres refuses it
              otherwise, and a menu that offers a refusal is worse than one
              that does not offer it.
            */}
              {status === "occupied" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() => setRoomDoNotDisturb(roomId, !doNotDisturb))
                  }
                  className={cn(
                    "mt-1 flex w-full items-center gap-2 border-t border-line px-3 py-1.5 text-left text-[13px] transition",
                    "text-ink hover:bg-shell",
                    pending && "opacity-50",
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-warn" />
                  <span className="min-w-0 flex-1 truncate">
                    Do not disturb
                    <span className="block text-xxs text-ink-faint">
                      Guest is in the room
                    </span>
                  </span>
                  {doNotDisturb && (
                    <span className="shrink-0 text-xxs text-warn-deep">on</span>
                  )}
                </button>
              ) : (
                <span className="mt-1 block border-t border-line px-3 py-1.5 text-[12.5px] leading-snug text-ink-faint">
                  Do not disturb needs a guest in the room.
                </span>
              )}

              {/*
              Occupied is shown rather than silently missing, and is not
              selectable: a guest being in the room is what puts it there, and
              check-in and check-out are what move it.
            */}
              {status === "occupied" && (
                <span className="block border-t border-line px-3 py-1.5 text-[12px] leading-snug text-ink-faint">
                  Occupied — check the guest out before changing its state.
                </span>
              )}

              {error && (
                <span className="block border-t border-line px-3 py-1.5 text-[12px] leading-snug text-rose-700">
                  {error}
                </span>
              )}
            </div>
          </>,
          document.body,
        )}
    </span>
  );
}
