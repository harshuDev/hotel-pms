"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { setRoomStatus } from "@/lib/actions/settings";
import type { RoomStatus } from "@/lib/types";

/**
 * Setting a room's housekeeping status from the calendar rail.
 *
 * The client's reference opens a little menu off the coloured dot beside each
 * room — Inspected, Clean, Dirty, Broken, Do not disturb — and that is the
 * right place for it: the board is where somebody is already looking at the
 * room when they learn it has been cleaned.
 *
 * THREE OF THEIR FIVE ARE HERE, AND THE OTHER TWO ARE NOT INVENTED.
 * `room_status` is `vacant_clean | vacant_dirty | occupied | ooo`, so Clean,
 * Dirty and Broken map onto it exactly and go through `set_room_status()`,
 * which housekeeping has been able to call since 0030.
 *
 * "Inspected" and "Do not disturb" have no column to live in, and they are not
 * simply two more enum values:
 *
 *   - Inspected is "clean, and a supervisor has checked it". It is a second
 *     fact ABOUT a clean room rather than a different vacancy, so as an enum
 *     value it would make every `= 'vacant_clean'` test in the database wrong
 *     the day somebody used it.
 *   - Do not disturb is a guest's request on an OCCUPIED room. `room_status`
 *     says whether a room can be sold; a do-not-disturb room is sold already.
 *     Putting it here would break that meaning for the house board, the
 *     housekeeping report and every availability read.
 *
 * Both want a decision about the schema rather than a guess, so they are
 * raised rather than half-built. See the note in CLAUDE.md.
 *
 * OCCUPIED IS NOT OFFERED, in either direction. A room is occupied because a
 * guest is in it: check-in and check-out are what move it, and offering it
 * here would be a way to tell the board a lie about a real bed.
 */
const CHOICES: { status: RoomStatus; label: string; dot: string }[] = [
  { status: "vacant_clean", label: "Clean", dot: "bg-emerald-400" },
  { status: "vacant_dirty", label: "Dirty", dot: "bg-rose-400" },
  { status: "ooo", label: "Broken", dot: "bg-slate-500" },
];

export function RoomStatusMenu({
  roomId,
  roomNumber,
  status,
  dotClass,
  label,
}: {
  roomId: string;
  roomNumber: string;
  status: RoomStatus;
  /** The dot's colour, decided by the board so the two cannot drift. */
  dotClass: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: RoomStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setRoomStatus({ roomId, status: next });
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${label} — change`}
        aria-label={`Housekeeping status for room ${roomNumber}: ${label}. Change it.`}
        aria-expanded={open}
        className={cn(
          "block h-2.5 w-2.5 rounded-full ring-offset-1 ring-offset-chrome-800 transition",
          "hover:ring-2 hover:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
          dotClass,
        )}
      />

      {open && (
        <>
          {/*
            Click-away. A sibling rather than a document listener: the board is
            one big scroller and a listener on it fights every other control.
          */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute left-4 top-0 z-50 w-40 rounded-md border border-line bg-white py-1 shadow-lift">
            {CHOICES.map((c) => (
              <button
                key={c.status}
                type="button"
                disabled={pending || c.status === status}
                onClick={() => choose(c.status)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition",
                  c.status === status
                    ? "cursor-default text-ink-faint"
                    : "text-ink hover:bg-shell",
                  pending && "opacity-50",
                )}
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", c.dot)} />
                {c.label}
                {c.status === status && (
                  <span className="ml-auto text-xxs text-ink-faint">now</span>
                )}
              </button>
            ))}

            {/*
              Occupied is shown so the menu is not silently missing the state
              the room is actually in, and is not selectable, because a guest
              being in the room is what puts it there.
            */}
            {status === "occupied" && (
              <span className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[12.5px] text-ink-faint">
                <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                Occupied — check the guest out first
              </span>
            )}

            {error && (
              <span className="block border-t border-line px-3 py-1.5 text-[12px] leading-snug text-rose-700">
                {error}
              </span>
            )}
          </div>
        </>
      )}
    </span>
  );
}
