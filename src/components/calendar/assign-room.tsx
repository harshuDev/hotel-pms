"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { assignRoom, unassignRoom } from "@/lib/actions/rooms";

/**
 * Putting a bar into a room, from the board.
 *
 * The rooms offered are every room of the type the booking was sold — not a
 * filtered "free" list. Filtering here would be a promise the browser cannot
 * keep: the list is a snapshot, and the room can be taken between loading the
 * page and clicking. `assign_room()` does the real check inside the
 * transaction and refuses by name — "Room 101 is already taken for part of 4
 * to 7 March" — which is a better answer than a room quietly missing from a
 * list with no explanation.
 *
 * Small and unlabelled on the bar itself, because a board draws forty of these
 * and a full-width button on each would bury the guest's name.
 */
export function AssignRoom({
  bookingRoomId,
  rooms,
  currentRoomId,
}: {
  bookingRoomId: string;
  /** Every room of the type this booking was sold. */
  rooms: { roomId: string; roomNumber: string }[];
  /** Set when the bar already sits on a room, which turns this into a move. */
  currentRoomId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <span className="relative">
      <button
        type="button"
        onClick={(e) => {
          // The bar itself is a link to the booking. This sits on top of it.
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
          setError(null);
        }}
        aria-label={currentRoomId ? "Move to another room" : "Put in a room"}
        title={currentRoomId ? "Move to another room" : "Put in a room"}
        className="grid h-5 w-5 place-items-center rounded border border-line bg-white text-[11px] text-ink-muted transition hover:bg-shell hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        {currentRoomId ? "⇄" : "+"}
      </button>

      {open && (
        <>
          {/* Click-away. Fixed, so it catches a click anywhere on the board. */}
          <span
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <span
            className="absolute left-0 top-6 z-50 block w-[184px] rounded-md border border-line bg-white p-1.5 shadow-lift"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <span className="block px-1.5 pb-1 text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              {currentRoomId ? "Move to" : "Put in room"}
            </span>

            <span className="block max-h-[190px] overflow-y-auto">
              {rooms.length === 0 ? (
                <span className="block px-1.5 py-2 text-[12px] text-ink-muted">
                  This room type has no rooms set up yet.
                </span>
              ) : (
                rooms.map((r) => (
                  <button
                    key={r.roomId}
                    type="button"
                    disabled={pending || r.roomId === currentRoomId}
                    onClick={() => run(() => assignRoom(bookingRoomId, r.roomId))}
                    className={cn(
                      "tnum block w-full rounded px-1.5 py-1 text-left text-[12.5px] transition",
                      r.roomId === currentRoomId
                        ? "cursor-default text-ink-faint"
                        : "text-ink hover:bg-shell",
                      pending && "opacity-50",
                    )}
                  >
                    {r.roomNumber}
                    {r.roomId === currentRoomId && (
                      <span className="ml-1 text-xxs text-ink-faint">current</span>
                    )}
                  </button>
                ))
              )}
            </span>

            {currentRoomId && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => unassignRoom(bookingRoomId))}
                className="mt-1 block w-full rounded border-t border-line px-1.5 py-1 text-left text-[12px] text-ink-muted transition hover:bg-shell hover:text-ink disabled:opacity-50"
              >
                Take out of the room
              </button>
            )}

            {error && (
              <span className="mt-1 block rounded bg-rose-50 px-1.5 py-1 text-[11.5px] leading-snug text-rose-700">
                {error}
              </span>
            )}
          </span>
        </>
      )}
    </span>
  );
}
