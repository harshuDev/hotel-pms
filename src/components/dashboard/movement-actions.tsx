"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import {
  assignRoom,
  checkIn,
  checkOut,
  loadAvailableRooms,
  loadBookingRooms,
  type AvailableRoom,
  type BookingRoomSlot,
} from "@/lib/actions/front-desk";
import type { Booking } from "@/lib/types";
import { useCurrency } from "@/components/currency";

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-medium">{title}</h2>
          <button
            onClick={onClose}
            className="text-ink-faint hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="space-y-4 p-5">{children}</div>
      </div>
    </div>
  );
}

const rowButton =
  "shrink-0 rounded border border-line px-2.5 py-1 text-xxs font-medium text-ink-muted transition-colors hover:bg-white hover:text-ink";

/** Assign whatever rooms are still missing, then move the guest in. */
export function CheckInAction({ booking }: { booking: Booking }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<BookingRoomSlot[] | null>(null);
  const [options, setOptions] = useState<Record<string, AvailableRoom[]>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;

    void (async () => {
      const result = await loadBookingRooms(booking.id);
      if (!live) return;
      if (!result.ok) return setError(result.error);
      setSlots(result.data);

      for (const slot of result.data) {
        if (slot.roomId) continue;
        const rooms = await loadAvailableRooms(slot.bookingRoomId);
        if (!live) return;
        if (rooms.ok) {
          setOptions((o) => ({ ...o, [slot.bookingRoomId]: rooms.data }));
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [open, booking.id]);

  const unassigned = (slots ?? []).filter((s) => !s.roomId);
  const ready =
    slots !== null && unassigned.every((s) => chosen[s.bookingRoomId]);

  const submit = () => {
    setError("");
    startTransition(async () => {
      for (const slot of unassigned) {
        const assigned = await assignRoom(
          slot.bookingRoomId,
          chosen[slot.bookingRoomId],
        );
        if (!assigned.ok) return setError(assigned.error);
      }

      const result = await checkIn(booking.id);
      if (!result.ok) return setError(result.error);

      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className={rowButton}>
        Check in
      </button>

      {open && (
        <Sheet title="Check in" onClose={() => setOpen(false)}>
          <div>
            <p className="text-[13px] font-medium text-ink">
              {booking.customerName}
            </p>
            <p className="text-xxs text-ink-faint">
              {booking.reference} · {booking.nights}n · {booking.roomCount} room
              {booking.roomCount === 1 ? "" : "s"}
            </p>
          </div>

          {slots === null ? (
            <p className="text-[13px] text-ink-faint">Loading rooms…</p>
          ) : unassigned.length === 0 ? (
            <p className="text-[13px] text-ink-muted">Every room is assigned.</p>
          ) : (
            unassigned.map((slot) => {
              const rooms = options[slot.bookingRoomId];
              return (
                <div key={slot.bookingRoomId}>
                  <label className="mb-1 block text-xs font-medium text-ink-muted">
                    Room for {slot.roomTypeName}
                  </label>
                  {rooms === undefined ? (
                    <p className="text-[13px] text-ink-faint">
                      Finding free rooms…
                    </p>
                  ) : rooms.length === 0 ? (
                    <p className="rounded-md border border-warn-light bg-warn-wash px-3 py-2 text-xs text-warn-deep">
                      No clean {slot.roomTypeName} is free for these dates.
                      Housekeeping needs to release one first.
                    </p>
                  ) : (
                    <select
                      value={chosen[slot.bookingRoomId] ?? ""}
                      onChange={(e) =>
                        setChosen((c) => ({
                          ...c,
                          [slot.bookingRoomId]: e.target.value,
                        }))
                      }
                      className="w-full rounded border border-line px-3 py-2 text-sm"
                    >
                      <option value="">Choose a room</option>
                      {rooms.map((r) => (
                        <option key={r.roomId} value={r.roomId}>
                          Room {r.number}
                          {r.floor === null ? "" : ` · floor ${r.floor}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={pending || !ready}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Checking in…" : "Check in"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Move the guest out and release the room to housekeeping. */
export function CheckOutAction({ booking }: { booking: Booking }) {
  const currency = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const owes = booking.balanceCents > 0;

  const submit = () => {
    setError("");
    startTransition(async () => {
      const result = await checkOut(booking.id);
      if (!result.ok) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className={rowButton}>
        Check out
      </button>

      {open && (
        <Sheet title="Check out" onClose={() => setOpen(false)}>
          <div>
            <p className="text-[13px] font-medium text-ink">
              {booking.customerName}
            </p>
            <p className="text-xxs text-ink-faint">
              {booking.reference}
              {booking.roomNumber ? ` · room ${booking.roomNumber}` : ""}
            </p>
          </div>

          {owes ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2.5 text-xs",
                "border-warn-light bg-warn-wash text-warn-deep",
              )}
            >
              This folio still owes {formatMoney(booking.balanceCents, currency)}. Checking
              out does not settle it — take the payment first unless the balance
              is going to an account.
            </div>
          ) : (
            <p className="text-[13px] text-ink-muted">The folio is settled.</p>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={pending}
              className="rounded bg-chrome-800 px-4 py-2 text-sm font-medium text-white hover:bg-chrome-900 disabled:opacity-60"
            >
              {pending ? "Checking out…" : "Check out"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
