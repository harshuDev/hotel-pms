"use client";

import { useT } from "@/components/i18n";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import {
  assignRoom,
  checkIn,
  checkOut,
  loadAvailableRooms,
  loadCheckoutCharges,
  type CheckoutCharges,
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
  const tr = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-medium">{title}</h2>
          <button
            onClick={onClose}
            className="text-ink-faint hover:text-ink"
            aria-label={tr("Close")}
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
  const tr = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<BookingRoomSlot[] | null>(null);
  const [options, setOptions] = useState<Record<string, AvailableRoom[]>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [late, setLate] = useState(false);

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

  const submit = (moveArrival = false) => {
    setError("");
    startTransition(async () => {
      for (const slot of unassigned) {
        const assigned = await assignRoom(
          slot.bookingRoomId,
          chosen[slot.bookingRoomId],
        );
        if (!assigned.ok) return setError(assigned.error);
      }

      const result = await checkIn(booking.id, moveArrival);
      if (!result.ok) {
        setLate(result.block === "late");
        return setError(result.error);
      }

      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setError("");
          setLate(false);
        }}
        className={rowButton}
      >
        {tr("Check in")}
      </button>

      {open && (
        <Sheet title={tr("Check in")} onClose={() => setOpen(false)}>
          <div>
            <p className="text-[13px] font-medium text-ink">
              {booking.customerName}
            </p>
            <p className="text-xxs text-ink-faint">
              {booking.reference} · {tr("{n}n", { n: booking.nights })} ·{" "}
              {tr.plural(booking.roomCount, "{n} room", "{n} rooms")}
            </p>
          </div>

          {slots === null ? (
            <p className="text-[13px] text-ink-faint">{tr("Loading rooms…")}</p>
          ) : unassigned.length === 0 ? (
            <p className="text-[13px] text-ink-muted">{tr("Every room is assigned.")}</p>
          ) : (
            unassigned.map((slot) => {
              const rooms = options[slot.bookingRoomId];
              return (
                <div key={slot.bookingRoomId}>
                  <label className="mb-1 block text-xs font-medium text-ink-muted">
                    {tr("Room for {type}", { type: slot.roomTypeName })}
                  </label>
                  {rooms === undefined ? (
                    <p className="text-[13px] text-ink-faint">
                      {tr("Finding free rooms…")}
                    </p>
                  ) : rooms.length === 0 ? (
                    <p className="rounded-md border border-warn-light bg-warn-wash px-3 py-2 text-xs text-warn-deep">
                      {tr("No clean {type} is free for these dates. Housekeeping needs to release one first.", { type: slot.roomTypeName })}
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
                      <option value="">{tr("Choose a room")}</option>
                      {rooms.map((r) => (
                        <option key={r.roomId} value={r.roomId}>
                          {tr("Room {n}", { n: r.number })}
                          {r.floor === null ? "" : ` · ${tr("floor {n}", { n: r.floor })}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
            >
              {tr("Cancel")}
            </button>
            {late ? (
              <button
                onClick={() => submit(true)}
                disabled={pending}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {pending ? tr("Checking in…") : tr("Move the arrival to today and check in")}
              </button>
            ) : (
              <button
                onClick={() => submit()}
                disabled={pending || !ready}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {pending ? tr("Checking in…") : tr("Check in")}
              </button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Move the guest out and release the room to housekeeping. */
export function CheckOutAction({ booking }: { booking: Booking }) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [charges, setCharges] = useState<CheckoutCharges | null>(null);

  // Room charges post at check-out (0125), so what is owed is the folio plus
  // the nights about to be charged. Read when the sheet opens.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setCharges(null);
    loadCheckoutCharges(booking.id).then((r) => {
      if (!live) return;
      if (r.ok) setCharges(r.data);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open, booking.id]);

  const owedAfter = charges ? charges.balanceCents + charges.roomChargesCents : booking.balanceCents;
  const owes = owedAfter > 0;

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
        {tr("Check out")}
      </button>

      {open && (
        <Sheet title={tr("Check out")} onClose={() => setOpen(false)}>
          <div>
            <p className="text-[13px] font-medium text-ink">
              {booking.customerName}
            </p>
            <p className="text-xxs text-ink-faint">
              {booking.reference}
              {booking.roomNumber ? ` · ${tr("room {n}", { n: booking.roomNumber })}` : ""}
            </p>
          </div>

          {charges && charges.nights > 0 && (
            <dl className="space-y-1 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-ink-muted">
                  {tr.plural(charges.nights, "Room charge, {n} night", "Room charges, {n} nights")}
                </dt>
                <dd className="tnum">{formatMoney(charges.roomChargesCents, currency)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1">
                <dt className="font-medium">{tr("Balance after check-out")}</dt>
                <dd className="tnum font-bold">{formatMoney(owedAfter, currency)}</dd>
              </div>
            </dl>
          )}

          {owes ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2.5 text-xs",
                "border-warn-light bg-warn-wash text-warn-deep",
              )}
            >
              {tr("This folio still owes {amount}. Checking out does not settle it — take the payment first unless the balance is going to an account.", { amount: formatMoney(owedAfter, currency) })}
            </div>
          ) : (
            <p className="text-[13px] text-ink-muted">{tr("The folio is settled.")}</p>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded border border-line px-4 py-2 text-sm hover:bg-shell"
            >
              {tr("Cancel")}
            </button>
            <button
              onClick={submit}
              disabled={pending}
              className="rounded bg-chrome-800 px-4 py-2 text-sm font-medium text-white hover:bg-chrome-900 disabled:opacity-60"
            >
              {pending ? tr("Checking out…") : tr("Check out")}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
