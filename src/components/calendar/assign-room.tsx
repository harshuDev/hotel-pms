"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { assignRoom, unassignRoom } from "@/lib/actions/rooms";

/**
 * One room type and its rooms, for the picker.
 *
 * The board builds this ONCE and hands the same array to every bar, so the
 * room list crosses the server boundary once rather than once per booking.
 * The rail already draws every room — this is that same list regrouped, not a
 * second one.
 */
export type AssignTypeGroup = {
  roomTypeId: string;
  code: string;
  name: string;
  rooms: { roomId: string; roomNumber: string }[];
};

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
 * UPGRADES ARE THE OTHER TYPES, BEHIND A SECOND ASK (0062). The client:
 * "hotels do offer upgrades. Let's say someone booked a Double Room but when
 * he arrive at the property they changed their mind and decide to upgrade to
 * the Suite. The way the system is build now, the hotel cannot upgrade the
 * guest room in the system."
 *
 * The other types are collapsed rather than mixed in with the sold type's
 * rooms: most of the time somebody is placing a booking in the room it was
 * sold, and a picker that opens on two hundred rooms of four types makes the
 * ordinary job harder to do the common way round.
 *
 * The confirmation is NOT decided here. Clicking an upgrade room attempts the
 * assignment like any other; Postgres refuses it with `HP003` and says which
 * type the booking was sold, and that refusal is what this offers to override.
 * The same shape as overselling on a new booking and on a restore — the server
 * is the authority on what the room actually is, and the browser's copy of the
 * board is a snapshot.
 *
 * Small and unlabelled on the bar itself, because a board draws forty of these
 * and a full-width button on each would bury the guest's name.
 */
export function AssignRoom({
  bookingRoomId,
  soldTypeId,
  roomsByType,
  currentRoomId,
}: {
  bookingRoomId: string;
  /** The type this booking was sold. Its rooms open expanded. */
  soldTypeId: string;
  /** Every type and its rooms — the same array for every bar on the board. */
  roomsByType: AssignTypeGroup[];
  /** Set when the bar already sits on a room, which turns this into a move. */
  currentRoomId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* The room Postgres refused as the wrong type, and what it said about it. */
  const [upgrade, setUpgrade] = useState<{
    roomId: string;
    message: string;
  } | null>(null);
  /* Which other type is expanded. One at a time, so the panel stays short. */
  const [openType, setOpenType] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sold = roomsByType.find((g) => g.roomTypeId === soldTypeId);
  const others = roomsByType.filter(
    (g) => g.roomTypeId !== soldTypeId && g.rooms.length > 0,
  );

  function place(roomId: string, allowTypeChange: boolean) {
    startTransition(async () => {
      const result = await assignRoom(bookingRoomId, roomId, allowTypeChange);
      if (!result.ok) {
        /*
         * A wrong-type refusal is a question, not a dead end: it is exactly
         * the upgrade the client asked for, and the only thing missing is
         * somebody saying they meant it. Anything else — the room is taken,
         * the room is dirty, the booking is cancelled — is an error and is
         * shown as one.
         */
        if (result.error.includes("Confirm the upgrade")) {
          setError(null);
          setUpgrade({ roomId, message: result.error });
        } else {
          setUpgrade(null);
          setError(result.error);
        }
        return;
      }
      setError(null);
      setUpgrade(null);
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await unassignRoom(bookingRoomId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setUpgrade(null);
      setOpen(false);
      router.refresh();
    });
  }

  function roomButton(r: { roomId: string; roomNumber: string }) {
    return (
      <button
        key={r.roomId}
        type="button"
        disabled={pending || r.roomId === currentRoomId}
        onClick={() => place(r.roomId, false)}
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
    );
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
          setUpgrade(null);
          setOpenType(null);
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
            className="absolute left-0 top-6 z-50 block w-[196px] rounded-md border border-line bg-white p-1.5 shadow-lift"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <span className="block px-1.5 pb-1 text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              {currentRoomId ? "Move to" : "Put in room"}
            </span>

            <span className="block max-h-[220px] overflow-y-auto">
              {!sold || sold.rooms.length === 0 ? (
                <span className="block px-1.5 py-2 text-[12px] text-ink-muted">
                  This room type has no rooms set up yet.
                </span>
              ) : (
                sold.rooms.map(roomButton)
              )}

              {/*
                THE UPGRADE PATH. Below a rule and collapsed, because it is the
                exception: the guest normally goes in the room they bought.
                Each type opens on demand, so the panel is a handful of lines
                whatever the size of the property.
              */}
              {others.length > 0 && (
                <span className="mt-1 block border-t border-line pt-1">
                  <span className="block px-1.5 pb-0.5 text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                    Upgrade or move type
                  </span>
                  {others.map((g) => (
                    <span key={g.roomTypeId} className="block">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenType((t) =>
                            t === g.roomTypeId ? null : g.roomTypeId,
                          )
                        }
                        aria-expanded={openType === g.roomTypeId}
                        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[12.5px] text-ink transition hover:bg-shell"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "shrink-0 text-xxs text-ink-faint transition",
                            openType === g.roomTypeId && "rotate-90",
                          )}
                        >
                          ▸
                        </span>
                        <span className="min-w-0 flex-1 truncate">{g.name}</span>
                        <span className="tnum shrink-0 text-xxs text-ink-faint">
                          {g.rooms.length}
                        </span>
                      </button>
                      {openType === g.roomTypeId && (
                        <span className="block pl-3">
                          {g.rooms.map(roomButton)}
                        </span>
                      )}
                    </span>
                  ))}
                </span>
              )}
            </span>

            {currentRoomId && (
              <button
                type="button"
                disabled={pending}
                onClick={remove}
                className="mt-1 block w-full rounded border-t border-line px-1.5 py-1 text-left text-[12px] text-ink-muted transition hover:bg-shell hover:text-ink disabled:opacity-50"
              >
                Cancel the room
              </button>
            )}

            {/*
              The refusal Postgres wrote, and the one control that overrides
              it. The rate is not restated by an upgrade — the guest keeps what
              they were sold — so that is said here rather than left for
              somebody to wonder about after the fact.
            */}
            {upgrade && (
              <span className="mt-1 block rounded bg-warn-wash px-1.5 py-1 text-[11.5px] leading-snug text-warn-deep">
                {upgrade.message}
                <span className="mt-1 flex gap-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => place(upgrade.roomId, true)}
                    className="rounded bg-warn px-1.5 py-0.5 text-[11px] font-medium text-white transition hover:brightness-95 disabled:opacity-50"
                  >
                    Confirm the upgrade
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpgrade(null)}
                    className="rounded border border-line bg-white px-1.5 py-0.5 text-[11px] text-ink-muted transition hover:bg-shell"
                  >
                    Cancel
                  </button>
                </span>
              </span>
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
