"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { StatusBadge, cn } from "@/components/ui";
import { CheckInAction, CheckOutAction } from "@/components/dashboard/movement-actions";
import { formatMoney, parseMoney } from "@/lib/money";
import {
  cancelBooking,
  confirmBooking,
  setBookingRoomRate,
  updateBooking,
} from "@/lib/actions/booking-edit";
import type {
  Booking,
  BookingActivityItem,
  BookingDetail as Detail,
  BookingNight,
  BookingRoomLine,
  Channel,
  FolioLine,
  Settlement,
} from "@/lib/types";

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

function Fact({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={label}>{name}</p>
      <p className="text-[13px] text-ink">{children}</p>
    </div>
  );
}

export function BookingDetailView({
  detail,
  rooms,
  nights,
  folio,
  activity,
  channels,
  canEdit,
}: {
  detail: Detail;
  rooms: BookingRoomLine[];
  nights: BookingNight[];
  folio: FolioLine[];
  activity: BookingActivityItem[];
  channels: Channel[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [block, setBlock] = useState<"overbook" | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    checkIn: detail.checkIn,
    checkOut: detail.checkOut,
    adults: detail.adults,
    children: detail.children,
    channelId: detail.channelId,
    settlement: detail.settlement,
    guestNotes: detail.guestNotes ?? "",
    internalNotes: "",
    externalReference: detail.externalReference ?? "",
  });
  const [allowOverbook, setAllowOverbook] = useState(false);

  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [noShow, setNoShow] = useState(false);

  const [pricing, setPricing] = useState<string | null>(null);
  const [newRate, setNewRate] = useState("");

  const settled = detail.balanceCents === 0;
  const unpriced = nights.filter((n) => n.roomRateCents === 0);
  const editable = !["canceled", "no_show", "checked_out"].includes(detail.status);

  // The existing check-in and check-out flows take a Booking, so the detail is
  // shaped into one rather than those being rewritten for a second caller.
  const asBooking: Booking = {
    id: detail.bookingId,
    reference: detail.reference,
    customerId: detail.customerId,
    customerName: detail.customerName,
    channelName: detail.channelName ?? "",
    settlement: detail.settlement,
    status: detail.status,
    arrivalDate: detail.checkIn,
    departureDate: detail.checkOut,
    bookedAt: detail.bookedOn,
    nights: detail.nights,
    roomCount: detail.roomCount,
    roomTypeName: rooms[0]?.roomTypeName ?? "",
    roomNumber: rooms[0]?.roomNumber ?? null,
    adults: detail.adults,
    children: detail.children,
    totalCents: detail.reservationValueCents,
    balanceCents: detail.balanceCents,
  };

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setMessage(null);
    setBlock(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setMessage({ ok: false, text: result.error ?? "That did not work." });
        if ("block" in result && result.block === "overbook") setBlock("overbook");
        return;
      }
      setMessage({ ok: true, text: done });
      setEditing(false);
      setCancelling(false);
      setPricing(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {/* Header ------------------------------------------------------- */}
      <div className="rounded-lg border border-line bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-semibold tracking-tightest text-ink">
                {detail.reference}
              </h1>
              <StatusBadge status={detail.status} />
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">
              {detail.customerName}
              {detail.customerEmail && ` · ${detail.customerEmail}`}
              {detail.customerPhone && ` · ${detail.customerPhone}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && detail.status === "pending" && (
              <button
                onClick={() => run(() => confirmBooking(detail.bookingId), "Booking confirmed.")}
                disabled={pending}
                className="rounded-md bg-chrome-800 px-4 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
              >
                Confirm
              </button>
            )}
            {canEdit && ["pending", "confirmed"].includes(detail.status) && (
              <CheckInAction booking={asBooking} />
            )}
            {canEdit && detail.status === "checked_in" && (
              <CheckOutAction booking={asBooking} />
            )}
            {canEdit && editable && (
              <button
                onClick={() => setEditing((e) => !e)}
                className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
              >
                {editing ? "Stop editing" : "Edit"}
              </button>
            )}
            {canEdit && ["pending", "confirmed"].includes(detail.status) && (
              <button
                onClick={() => setCancelling((c) => !c)}
                className="rounded-md border border-line px-4 py-2 text-[13px] text-rose-700 hover:bg-rose-50"
              >
                Cancel booking
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-4 lg:grid-cols-6">
          <Fact name="Arrival">{format(parseISO(detail.checkIn), "EEE d MMM yyyy")}</Fact>
          <Fact name="Departure">{format(parseISO(detail.checkOut), "EEE d MMM yyyy")}</Fact>
          <Fact name="Nights">
            <span className="tnum">{detail.nights}</span>
          </Fact>
          <Fact name="Guests">
            <span className="tnum">
              {detail.adults} adult{detail.adults === 1 ? "" : "s"}
              {detail.children > 0 && `, ${detail.children} child${detail.children === 1 ? "" : "ren"}`}
            </span>
          </Fact>
          <Fact name="Rooms">
            <span className="tnum">
              {detail.roomCount}
            </span>
            {detail.roomsAssigned < detail.roomCount && (
              <span className="ml-1.5 text-xxs text-warn-deep">
                {detail.roomCount - detail.roomsAssigned} unassigned
              </span>
            )}
          </Fact>
          <Fact name="Source">{detail.channelName ?? "—"}</Fact>
          <Fact name="Settlement">
            {detail.settlement === "at_property"
              ? "Pays at the property"
              : detail.settlement === "prepaid_to_channel"
                ? "Prepaid to the channel"
                : "Virtual card"}
          </Fact>
          <Fact name="Booked">
            {format(parseISO(detail.bookedOn), "d MMM yyyy")}
            {detail.bookedBy && (
              <span className="block text-xxs text-ink-faint">{detail.bookedBy}</span>
            )}
          </Fact>
          {detail.externalReference && (
            <Fact name="Channel reference">{detail.externalReference}</Fact>
          )}
          <Fact name="Reservation value">
            <span className="tnum">{formatMoney(detail.reservationValueCents)}</span>
            <span className="block text-xxs text-ink-faint">Rate less discount, before tax</span>
          </Fact>
          <Fact name="Balance">
            <span
              className={cn(
                "tnum font-medium",
                detail.balanceCents > 0 ? "text-rose-600" : "text-ink",
              )}
            >
              {settled ? "Settled" : formatMoney(detail.balanceCents)}
            </span>
            <span className="block text-xxs text-ink-faint">
              {formatMoney(detail.chargesCents)} charged, {formatMoney(detail.paymentsCents)} paid
            </span>
          </Fact>
        </div>

        {(detail.guestNotes || detail.internalNotes) && (
          <div className="mt-4 space-y-2 border-t border-line pt-4">
            {detail.guestNotes && (
              <p className="text-[13px] text-ink-muted">
                <span className="font-medium text-ink">Guest notes </span>
                {detail.guestNotes}
              </p>
            )}
            {detail.internalNotes && (
              <p className="whitespace-pre-line text-[13px] text-ink-muted">
                <span className="font-medium text-ink">Staff notes </span>
                {detail.internalNotes}
              </p>
            )}
          </div>
        )}

        {message && (
          <p
            className={cn(
              "mt-4 rounded-md px-3 py-2.5 text-[13px] leading-relaxed",
              message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700",
            )}
          >
            {message.text}
          </p>
        )}
      </div>

      {/* Edit --------------------------------------------------------- */}
      {editing && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-card">
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            Change the booking
          </h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label htmlFor="e-in" className={label}>Arrival</label>
              <input
                id="e-in"
                type="date"
                value={form.checkIn}
                disabled={detail.status === "checked_in"}
                onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
                className={cn(field, "tnum disabled:bg-shell disabled:text-ink-faint")}
              />
            </div>
            <div>
              <label htmlFor="e-out" className={label}>Departure</label>
              <input
                id="e-out"
                type="date"
                value={form.checkOut}
                onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
                className={cn(field, "tnum")}
              />
            </div>
            <div>
              <label htmlFor="e-adults" className={label}>Adults</label>
              <input
                id="e-adults"
                type="number"
                min={1}
                value={form.adults}
                onChange={(e) => setForm({ ...form, adults: Math.max(Number(e.target.value) || 1, 1) })}
                className={cn(field, "tnum")}
              />
            </div>
            <div>
              <label htmlFor="e-children" className={label}>Children</label>
              <input
                id="e-children"
                type="number"
                min={0}
                value={form.children}
                onChange={(e) => setForm({ ...form, children: Math.max(Number(e.target.value) || 0, 0) })}
                className={cn(field, "tnum")}
              />
            </div>
            <div>
              <label htmlFor="e-channel" className={label}>Came from</label>
              <select
                id="e-channel"
                value={form.channelId}
                onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                className={field}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="e-settlement" className={label}>Settlement</label>
              <select
                id="e-settlement"
                value={form.settlement}
                onChange={(e) => setForm({ ...form, settlement: e.target.value as Settlement })}
                className={field}
              >
                <option value="at_property">Pays at the property</option>
                <option value="prepaid_to_channel">Prepaid to the channel</option>
                <option value="virtual_card">Virtual card</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="e-guest" className={label}>Notes for the guest</label>
              <input
                id="e-guest"
                value={form.guestNotes}
                onChange={(e) => setForm({ ...form, guestNotes: e.target.value })}
                className={field}
              />
            </div>
            <div className="sm:col-span-4">
              <label htmlFor="e-internal" className={label}>Add a staff note</label>
              <input
                id="e-internal"
                value={form.internalNotes}
                placeholder="Appended to the existing notes; the guest never sees these"
                onChange={(e) => setForm({ ...form, internalNotes: e.target.value })}
                className={field}
              />
            </div>
          </div>

          {block === "overbook" && (
            <label className="mt-4 flex items-start gap-2.5 rounded-md border border-warn/40 bg-warn-wash px-3 py-2.5">
              <input
                type="checkbox"
                checked={allowOverbook}
                onChange={(e) => setAllowOverbook(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-[13px] leading-relaxed text-warn-deep">
                Extend anyway, overbooking the house.
              </span>
            </label>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              onClick={() =>
                run(
                  () =>
                    updateBooking({
                      bookingId: detail.bookingId,
                      checkIn: form.checkIn,
                      checkOut: form.checkOut,
                      adults: form.adults,
                      children: form.children,
                      channelId: form.channelId,
                      settlement: form.settlement,
                      guestNotes: form.guestNotes,
                      internalNotes: form.internalNotes,
                      externalReference: form.externalReference,
                      allowOverbook,
                    }),
                  "Booking changed.",
                )
              }
              disabled={pending}
              className="shrink-0 rounded-md bg-chrome-800 px-6 py-2.5 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}

      {/* Cancel ------------------------------------------------------- */}
      {cancelling && (
        <div className="rounded-lg border border-rose-200 bg-white p-5 shadow-card">
          <h2 className="mb-2 font-display text-[15px] font-semibold tracking-tightest text-ink">
            Cancel {detail.reference}
          </h2>
          <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            The rooms come off the house immediately, which frees the inventory.
            {detail.balanceCents > 0 && (
              <>
                {" "}This booking still owes{" "}
                <span className="tnum font-medium text-rose-600">
                  {formatMoney(detail.balanceCents)}
                </span>
                . Cancelling does not write that off — a cancellation fee is a
                real charge and somebody still has to chase it.
              </>
            )}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[280px] flex-1">
              <label htmlFor="c-reason" className={label}>Reason</label>
              <input
                id="c-reason"
                value={cancelReason}
                placeholder="Recorded on the booking's staff notes"
                onChange={(e) => setCancelReason(e.target.value)}
                className={field}
              />
            </div>
            <label className="flex items-center gap-2 pb-2.5 text-[13px] text-ink-muted">
              <input
                type="checkbox"
                checked={noShow}
                onChange={(e) => setNoShow(e.target.checked)}
              />
              They did not turn up (no show)
            </label>
            <button
              onClick={() =>
                run(
                  () =>
                    cancelBooking({
                      bookingId: detail.bookingId,
                      noShow,
                      reason: cancelReason,
                    }),
                  noShow ? "Marked as a no show." : "Booking cancelled.",
                )
              }
              disabled={pending}
              className="rounded-md bg-rose-600 px-5 py-2.5 text-[13px] font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {noShow ? "Mark no show" : "Cancel it"}
            </button>
          </div>
        </div>
      )}

      {/* Rooms and nights --------------------------------------------- */}
      <div className="rounded-lg border border-line bg-white p-5 shadow-card">
        <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
          Rooms
        </h2>
        <div className="space-y-4">
          {rooms.map((room) => {
            const roomNights = nights.filter((n) => n.bookingRoomId === room.bookingRoomId);
            return (
              <div key={room.bookingRoomId} className="rounded-md border border-line">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <div>
                    <span className="font-medium text-ink">
                      {room.roomNumber ? `Room ${room.roomNumber}` : "No room assigned"}
                    </span>
                    <span className="ml-2 text-[13px] text-ink-muted">{room.roomTypeName}</span>
                    <span className="ml-2 text-xxs text-ink-faint">
                      {room.adults} adult{room.adults === 1 ? "" : "s"}
                      {room.children > 0 && ` + ${room.children}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tnum text-[13px] text-ink">
                      {formatMoney(room.valueCents)}
                    </span>
                    {room.discountCents > 0 && (
                      <span className="tnum rounded bg-emerald-50 px-2 py-0.5 text-xxs font-medium text-emerald-800">
                        {formatMoney(room.discountCents)} off
                      </span>
                    )}
                    {canEdit && editable && (
                      <button
                        onClick={() =>
                          setPricing(pricing === room.bookingRoomId ? null : room.bookingRoomId)
                        }
                        className="rounded border border-line px-2.5 py-1 text-xxs text-ink-muted hover:bg-shell hover:text-ink"
                      >
                        Set rate
                      </button>
                    )}
                  </div>
                </div>

                {pricing === room.bookingRoomId && (
                  <div className="flex flex-wrap items-end gap-3 border-b border-line bg-shell px-4 py-3">
                    <div>
                      <label className={label}>Rate a night</label>
                      <input
                        value={newRate}
                        inputMode="decimal"
                        placeholder="120.00"
                        onChange={(e) => setNewRate(e.target.value)}
                        className={cn(field, "tnum w-32")}
                      />
                    </div>
                    <button
                      onClick={() => {
                        let cents: number;
                        try {
                          cents = parseMoney(newRate);
                        } catch {
                          setMessage({ ok: false, text: "That is not an amount. Try 120 or 120.50." });
                          return;
                        }
                        run(
                          () =>
                            setBookingRoomRate({
                              bookingId: detail.bookingId,
                              bookingRoomId: room.bookingRoomId,
                              rateCents: cents,
                            }),
                          "Rate set on the nights that have not been charged.",
                        );
                      }}
                      disabled={pending}
                      className="rounded-md bg-chrome-800 px-4 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </div>
                )}

                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-ink-faint">
                      {["Night", "Rate", "Discount", "Tax", "Payable", ""].map((c, i) => (
                        <th
                          key={c || i}
                          className={cn(
                            "whitespace-nowrap px-4 pb-2 pt-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                            i >= 1 && i <= 4 && "text-right",
                          )}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {roomNights.map((n) => (
                      <tr key={n.stayDate}>
                        <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                          {format(parseISO(n.stayDate), "EEE d MMM")}
                        </td>
                        <td
                          className={cn(
                            "tnum px-4 py-2 text-right",
                            n.roomRateCents === 0 ? "text-warn-deep" : "text-ink-muted",
                          )}
                        >
                          {n.roomRateCents === 0 ? "Not priced" : formatMoney(n.roomRateCents)}
                        </td>
                        <td className="tnum px-4 py-2 text-right text-emerald-700">
                          {n.discountCents > 0 ? formatMoney(n.discountCents) : "—"}
                        </td>
                        <td className="tnum px-4 py-2 text-right text-ink-faint">
                          {n.taxCents > 0 ? formatMoney(n.taxCents) : "—"}
                        </td>
                        <td className="tnum px-4 py-2 text-right font-medium text-ink">
                          {formatMoney(n.roomRateCents - n.discountCents + n.taxCents)}
                        </td>
                        <td className="px-4 py-2 text-xxs text-ink-faint">
                          {n.charged ? "Charged" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        {unpriced.length > 0 && (
          <p className="mt-3 rounded-md bg-warn-wash px-3 py-2.5 text-[13px] leading-relaxed text-warn-deep">
            {unpriced.length} night{unpriced.length === 1 ? " has" : "s have"} no
            rate. Nights added by an extension come in at zero because no rate
            plan was named — set a rate before the night audit runs, or the stay
            will be charged as free.
          </p>
        )}
      </div>

      {/* Folio -------------------------------------------------------- */}
      <div className="rounded-lg border border-line bg-white p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
            Folio
          </h2>
          <Link
            href="/cashier"
            className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Take a payment
          </Link>
        </div>
        {folio.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-muted">
            Nothing posted yet.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-faint">
                {["Business date", "Folio", "What", "Amount"].map((c, i) => (
                  <th
                    key={c}
                    className={cn(
                      "whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                      i === 3 && "text-right",
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {folio.map((l) => (
                <tr key={l.lineId}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">
                    {format(parseISO(l.businessDate), "d MMM")}
                  </td>
                  <td className="tnum px-3 py-2.5 text-ink-faint">{l.folioNumber}</td>
                  <td className="px-3 py-2.5 text-ink">
                    {l.description}
                    <span className="ml-2 text-xxs text-ink-faint">
                      {l.kind === "payment" ? "payment" : "charge"}
                      {l.isReversal && " · reversed"}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "tnum whitespace-nowrap px-3 py-2.5 text-right font-medium",
                      l.kind === "payment" ? "text-emerald-700" : "text-ink",
                      l.isReversal && "text-warn-deep",
                    )}
                  >
                    {formatMoney(l.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Activity ----------------------------------------------------- */}
      <div className="rounded-lg border border-line bg-white p-5 shadow-card">
        <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
          History
        </h2>
        {activity.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {activity.map((a) => (
              <li key={a.activityId} className="flex items-baseline justify-between gap-4">
                <span className="text-[13px] text-ink">{a.summary}</span>
                <span className="shrink-0 text-xxs text-ink-faint">
                  {format(parseISO(a.createdAt), "d MMM, HH:mm")}
                  {a.actor && ` · ${a.actor}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
