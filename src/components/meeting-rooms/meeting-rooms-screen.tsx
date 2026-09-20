"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import {
  bookMeetingRoom,
  cancelMeetingRoomBooking,
  chargeMeetingRoomBooking,
  saveMeetingRoom,
} from "@/lib/actions/meeting-rooms";
import { searchCustomers } from "@/lib/actions/bookings";
import type { MeetingRoomBooking, MeetingRoomCell } from "@/lib/types";

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const fieldClass =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16">
      <div className="w-full max-w-lg rounded-lg border border-line bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-display text-[17px] font-semibold tracking-tightest text-ink">
            {title}
          </h2>
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

export function MeetingRoomsScreen({
  cells,
  from,
  days,
  booking,
  canBook,
  canConfigure,
}: {
  cells: MeetingRoomCell[];
  from: string;
  days: number;
  /** The booking named in the URL, if one is open. */
  booking: MeetingRoomBooking | null;
  canBook: boolean;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const dates = useMemo(
    () => [...new Set(cells.map((c) => c.date))].sort(),
    [cells],
  );
  const rooms = useMemo(
    () => [...new Map(cells.map((c) => [c.meetingRoomId, c])).values()],
    [cells],
  );
  const at = useMemo(
    () => new Map(cells.map((c) => [`${c.meetingRoomId}|${c.date}`, c])),
    [cells],
  );

  const [newBooking, setNewBooking] = useState<{
    roomId: string;
    roomName: string;
    capacity: number | null;
    startsOn: string;
    endsOn: string;
    eventName: string;
    guestCount: string;
    comments: string;
    customerId: string | null;
    customerName: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<
    { id: string; name: string; detail: string }[]
  >([]);

  const [newRoom, setNewRoom] = useState<{ name: string; capacity: string } | null>(
    null,
  );
  const [charge, setCharge] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  function href(nextFrom: string, bookingId?: string | null) {
    const q = new URLSearchParams({ from: nextFrom });
    if (bookingId) q.set("booking", bookingId);
    return `/meeting-rooms?${q.toString()}`;
  }

  function openSlot(cell: MeetingRoomCell, date: string) {
    if (!canBook) return;
    setMessage(null);
    setNewBooking({
      roomId: cell.meetingRoomId,
      roomName: cell.meetingRoomName,
      capacity: cell.capacity,
      startsOn: date,
      endsOn: date,
      eventName: "",
      guestCount: String(cell.capacity ?? 2),
      comments: "",
      customerId: null,
      customerName: "",
    });
    setQuery("");
    setMatches([]);
  }

  function lookUp(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setMatches([]);
      return;
    }
    searchCustomers(value).then((r) => {
      if (r.ok) setMatches(r.data);
    });
  }

  function submitBooking() {
    if (!newBooking) return;
    setMessage(null);

    const guests = Number(newBooking.guestCount);
    if (!Number.isSafeInteger(guests) || guests < 1) {
      setMessage({ ok: false, text: "How many people is it for?" });
      return;
    }

    startTransition(async () => {
      const result = await bookMeetingRoom({
        meetingRoomId: newBooking.roomId,
        eventName: newBooking.eventName,
        guestCount: guests,
        startsOn: newBooking.startsOn,
        endsOn: newBooking.endsOn,
        customerId: newBooking.customerId,
        comments: newBooking.comments,
      });

      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setNewBooking(null);
      setMessage({ ok: true, text: `${result.data.reference} booked.` });
      router.refresh();
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setMessage({ ok: false, text: result.error ?? "That did not work." });
        return;
      }
      setMessage({ ok: true, text: done });
      setCharge("");
      setCancelReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4 shadow-card">
        <div className="flex items-center gap-2">
          {canConfigure && (
            <button
              onClick={() => setNewRoom({ name: "", capacity: "" })}
              className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              Add a room
            </button>
          )}
          <Link
            href={href(format(addDays(parseISO(from), -days), "yyyy-MM-dd"))}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
          >
            Earlier
          </Link>
          <Link
            href={href(format(addDays(parseISO(from), days), "yyyy-MM-dd"))}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
          >
            Later
          </Link>
        </div>
      </div>

      {message && (
        <p
          className={cn(
            "rounded-md px-3 py-2.5 text-[13px] leading-relaxed",
            message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700",
          )}
        >
          {message.text}
        </p>
      )}

      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        {rooms.length === 0 ? (
          <div className="py-10 text-center">
            <p className="font-display text-lg font-semibold tracking-tightest text-ink">
              No meeting rooms yet
            </p>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
              {canConfigure
                ? "Add the rooms this property lets out — Meeting Room A, the boardroom — and they will appear here with their calendars."
                : "A manager or administrator sets these up."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-3 pb-2.5 text-left text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                    Meeting room
                  </th>
                  {dates.map((d) => {
                    const day = parseISO(d);
                    const weekend = [0, 6].includes(day.getDay());
                    return (
                      <th
                        key={d}
                        className={cn(
                          "min-w-[62px] px-1 pb-2.5 text-center text-xxs font-semibold uppercase tracking-[0.06em]",
                          weekend ? "text-ink-muted" : "text-ink-faint",
                        )}
                      >
                        <span className="block">{format(day, "EEE")}</span>
                        <span className="tnum block text-[11px] font-normal">
                          {format(day, "d MMM")}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.meetingRoomId}>
                    <td className="sticky left-0 z-10 whitespace-nowrap border-t border-line bg-white px-3 py-2.5">
                      <span className="font-medium text-ink">
                        {room.meetingRoomName}
                      </span>
                      {room.capacity !== null && (
                        <span className="tnum ml-1.5 text-xxs text-ink-faint">
                          seats {room.capacity}
                        </span>
                      )}
                    </td>
                    {dates.map((d) => {
                      const cell = at.get(`${room.meetingRoomId}|${d}`);
                      const booked = cell?.bookingId != null;

                      if (!booked) {
                        return (
                          <td
                            key={d}
                            className="border-t border-line px-1 py-1.5 text-center"
                          >
                            <button
                              onClick={() => cell && openSlot(cell, d)}
                              disabled={!canBook}
                              title={canBook ? "Book this day" : undefined}
                              className={cn(
                                "h-8 w-full rounded text-xxs",
                                canBook
                                  ? "text-ink-faint hover:bg-brass/10 hover:text-brass"
                                  : "text-ink-faint",
                              )}
                            >
                              {canBook ? "+" : "—"}
                            </button>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={d}
                          className="border-t border-line px-1 py-1.5 text-center"
                          title={`${cell?.eventName} · ${cell?.guestCount} people${
                            cell?.customerName ? ` · ${cell.customerName}` : ""
                          }`}
                        >
                          <Link
                            href={href(from, cell?.bookingId)}
                            className={cn(
                              "flex h-8 items-center justify-center overflow-hidden rounded px-1 text-xxs font-medium",
                              cell?.status === "pending"
                                ? "bg-warn-wash text-warn-deep"
                                : "bg-chrome-800 text-white",
                            )}
                          >
                            {cell?.isFirstDay ? (
                              <span className="truncate">{cell.eventName}</span>
                            ) : (
                              <span className="opacity-60">·</span>
                            )}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Booking a slot ------------------------------------------------ */}
      {newBooking && (
        <Sheet title={`Book ${newBooking.roomName}`} onClose={() => setNewBooking(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mr-from" className={label}>First day</label>
              <input
                id="mr-from"
                type="date"
                value={newBooking.startsOn}
                onChange={(e) =>
                  setNewBooking({
                    ...newBooking,
                    startsOn: e.target.value,
                    endsOn:
                      e.target.value > newBooking.endsOn
                        ? e.target.value
                        : newBooking.endsOn,
                  })
                }
                className={cn(fieldClass, "tnum")}
              />
            </div>
            <div>
              <label htmlFor="mr-to" className={label}>Last day</label>
              <input
                id="mr-to"
                type="date"
                min={newBooking.startsOn}
                value={newBooking.endsOn}
                onChange={(e) => setNewBooking({ ...newBooking, endsOn: e.target.value })}
                className={cn(fieldClass, "tnum")}
              />
              <p className="mt-1 text-xxs text-ink-faint">
                Inclusive — the room is held on this day too.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="mr-event" className={label}>Event name</label>
              <input
                id="mr-event"
                value={newBooking.eventName}
                placeholder="Northern sales conference"
                onChange={(e) => setNewBooking({ ...newBooking, eventName: e.target.value })}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="mr-guests" className={label}>People</label>
              <input
                id="mr-guests"
                inputMode="numeric"
                value={newBooking.guestCount}
                onChange={(e) => setNewBooking({ ...newBooking, guestCount: e.target.value })}
                className={cn(fieldClass, "tnum")}
              />
              {newBooking.capacity !== null && (
                <p className="mt-1 text-xxs text-ink-faint">
                  Seats {newBooking.capacity}.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="mr-customer" className={label}>Customer</label>
              {newBooking.customerId ? (
                <div className="flex items-center justify-between rounded-md border border-line bg-shell px-3 py-2">
                  <span className="text-[13px] text-ink">{newBooking.customerName}</span>
                  <button
                    onClick={() =>
                      setNewBooking({ ...newBooking, customerId: null, customerName: "" })
                    }
                    className="text-xxs text-ink-muted hover:text-ink"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    id="mr-customer"
                    type="search"
                    value={query}
                    placeholder="Optional — search by name"
                    onChange={(e) => lookUp(e.target.value)}
                    className={fieldClass}
                  />
                  {matches.length > 0 && (
                    <ul className="mt-1 divide-y divide-line rounded-md border border-line">
                      {matches.map((m) => (
                        <li key={m.id}>
                          <button
                            onClick={() => {
                              setNewBooking({
                                ...newBooking,
                                customerId: m.id,
                                customerName: m.name,
                              });
                              setMatches([]);
                              setQuery("");
                            }}
                            className="w-full px-3 py-2 text-left text-[13px] hover:bg-shell"
                          >
                            {m.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="mr-comments" className={label}>Comments</label>
              <input
                id="mr-comments"
                value={newBooking.comments}
                placeholder="Optional — layout, equipment, catering"
                onChange={(e) => setNewBooking({ ...newBooking, comments: e.target.value })}
                className={fieldClass}
              />
            </div>
          </div>

          <p className="text-xs leading-relaxed text-ink-faint">
            A customer is needed before any money can be charged.
          </p>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setNewBooking(null)}
              className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={submitBooking}
              disabled={pending}
              className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
            >
              {pending ? "Booking…" : "Book it"}
            </button>
          </div>
        </Sheet>
      )}

      {/* An open booking ----------------------------------------------- */}
      {booking && (
        <Sheet
          title={`${booking.reference} · ${booking.meetingRoomName}`}
          onClose={() => router.push(href(from))}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className={label}>Event</p>
              <p className="text-[13px] text-ink">{booking.eventName}</p>
            </div>
            <div>
              <p className={label}>People</p>
              <p className="tnum text-[13px] text-ink">{booking.guestCount}</p>
            </div>
            <div>
              <p className={label}>When</p>
              <p className="text-[13px] text-ink">
                {format(parseISO(booking.startsOn), "EEE d MMM")} to{" "}
                {format(parseISO(booking.endsOn), "EEE d MMM")}
                <span className="ml-1.5 text-xxs text-ink-faint">
                  {booking.days} day{booking.days === 1 ? "" : "s"}
                </span>
              </p>
            </div>
            <div>
              <p className={label}>Customer</p>
              <p className="text-[13px] text-ink">{booking.customerName ?? "Internal event"}</p>
            </div>
            <div>
              <p className={label}>Status</p>
              <p
                className={cn(
                  "text-[13px]",
                  booking.status === "canceled" ? "text-rose-600" : "text-ink",
                )}
              >
                {booking.status === "canceled" ? "Cancelled" : "Confirmed"}
              </p>
            </div>
            <div>
              <p className={label}>Charged</p>
              <p className="tnum text-[13px] text-ink">
                {booking.folioId === null ? (
                  <span className="text-ink-faint">Nothing yet</span>
                ) : (
                  <>
                    {formatMoney(booking.chargesCents)}
                    <span
                      className={cn(
                        "ml-1.5 text-xxs",
                        booking.balanceCents > 0 ? "text-rose-600" : "text-emerald-700",
                      )}
                    >
                      {booking.balanceCents > 0
                        ? `${formatMoney(booking.balanceCents)} owing`
                        : "settled"}
                    </span>
                  </>
                )}
              </p>
            </div>
            {booking.comments && (
              <div className="sm:col-span-2">
                <p className={label}>Comments</p>
                <p className="whitespace-pre-line text-[13px] text-ink-muted">
                  {booking.comments}
                </p>
              </div>
            )}
          </div>

          {canBook && booking.status !== "canceled" && (
            <>
              <div className="border-t border-line pt-4">
                <label htmlFor="mr-charge" className={label}>Charge for the room</label>
                <div className="flex gap-2">
                  <input
                    id="mr-charge"
                    value={charge}
                    inputMode="decimal"
                    placeholder="450.00"
                    onChange={(e) => setCharge(e.target.value)}
                    className={cn(fieldClass, "tnum")}
                  />
                  <button
                    onClick={() => {
                      let cents: number;
                      try {
                        cents = parseMoney(charge);
                      } catch {
                        setMessage({ ok: false, text: "That is not an amount. Try 450 or 450.50." });
                        return;
                      }
                      run(
                        () =>
                          chargeMeetingRoomBooking({
                            bookingId: booking.bookingId,
                            amountCents: cents,
                            description: "",
                          }),
                        "Charged to the folio.",
                      );
                    }}
                    disabled={pending}
                    className="shrink-0 rounded-md bg-chrome-800 px-4 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
                  >
                    Charge
                  </button>
                </div>
              </div>

              <div className="border-t border-line pt-4">
                <label htmlFor="mr-cancel" className={label}>Cancel this booking</label>
                <div className="flex gap-2">
                  <input
                    id="mr-cancel"
                    value={cancelReason}
                    placeholder="Reason, kept on the booking"
                    onChange={(e) => setCancelReason(e.target.value)}
                    className={fieldClass}
                  />
                  <button
                    onClick={() =>
                      run(
                        () =>
                          cancelMeetingRoomBooking({
                            bookingId: booking.bookingId,
                            reason: cancelReason,
                          }),
                        "Booking cancelled — the room is free again.",
                      )
                    }
                    disabled={pending}
                    className="shrink-0 rounded-md border border-line px-4 py-2 text-[13px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Cancel it
                  </button>
                </div>
                {booking.balanceCents > 0 && (
                  <p className="mt-1.5 text-xs leading-relaxed text-warn-deep">
                    This booking still owes {formatMoney(booking.balanceCents)}.
                    Cancelling frees the room but does not write that off.
                  </p>
                )}
              </div>
            </>
          )}

          <p className="text-xs text-ink-faint">
            Booked by {booking.bookedBy ?? "someone"} on{" "}
            {format(parseISO(booking.createdAt), "d MMM yyyy")}.
          </p>
        </Sheet>
      )}

      {/* Adding a room -------------------------------------------------- */}
      {newRoom && (
        <Sheet title="Add a meeting room" onClose={() => setNewRoom(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="room-name" className={label}>Name</label>
              <input
                id="room-name"
                value={newRoom.name}
                placeholder="Meeting Room A"
                onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="room-cap" className={label}>Seats</label>
              <input
                id="room-cap"
                inputMode="numeric"
                value={newRoom.capacity}
                placeholder="Optional"
                onChange={(e) => setNewRoom({ ...newRoom, capacity: e.target.value })}
                className={cn(fieldClass, "tnum")}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setNewRoom(null)}
              className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const name = newRoom.name;
                run(
                  () =>
                    saveMeetingRoom({
                      id: null,
                      name,
                      capacity:
                        newRoom.capacity.trim() === ""
                          ? null
                          : Number(newRoom.capacity),
                      description: "",
                    }),
                  `${name} added.`,
                );
                setNewRoom(null);
              }}
              disabled={pending}
              className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
            >
              Add it
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
