"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { formatStampInProperty } from "@/lib/dates";
import { AttachmentsTab } from "@/components/bookings/attachments-tab";
import { EmailTab } from "@/components/bookings/email-tab";
import { StatusBadge, cn } from "@/components/ui";
import { CheckInAction, CheckOutAction } from "@/components/dashboard/movement-actions";
import { formatMoney, parseMoney } from "@/lib/money";
import {
  cancelBooking,
  cancelBookingRoom,
  restoreBookingRoom,
  restoreBooking,
  confirmBooking,
  setBookingRoomRate,
  updateBooking,
} from "@/lib/actions/booking-edit";
import type {
  Booking,
  BookingActivityItem,
  BookingAttachment,
  BookingEmail,
  BookingCancellationTerms,
  BookingDetail as Detail,
  BookingNight,
  BookingRoomLine,
  Channel,
  FolioItemType,
  FolioLine,
  Settlement,
} from "@/lib/types";
import { COUNTRIES } from "@/lib/countries";

/**
 * The guest record behind the booking, as `customer_for_edit()` returns it.
 *
 * ONE CUSTOMER, NOT A GUEST LIST. `bookings.customer_id` is a single row and
 * `booking_rooms` carries adults and children as COUNTS with no names against
 * them. So the Guests tab shows who the booking belongs to and how many people
 * are in each room -- it cannot name the second and third occupant, because
 * nothing in this schema records them.
 */
export interface BookingGuest {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
  nationality: string;
  country: string;
  passportNumber: string;
  passportExpiry: string;
  dateOfBirth: string;
  nationalIdNumber: string;
}

/**
 * What counts as an extra, taken from the rule the reports already use:
 * `effective_item_type not in ('room_charge', 'tax', 'discount')`.
 *
 * Reused rather than restated. If this screen had its own idea of an extra it
 * would disagree with the Extras report the first time somebody added an item
 * type, and the two would have to be found and reconciled by hand.
 */
const NOT_AN_EXTRA: FolioItemType[] = ["room_charge", "tax", "discount"];

/** The extras a folio holds, in the words a guest would read on the bill. */
const EXTRA_LABEL: Partial<Record<FolioItemType, string>> = {
  food_beverage: "Food & beverage",
  laundry: "Laundry",
  minibar: "Minibar",
  transport: "Transport",
  miscellaneous: "Miscellaneous",
  adjustment: "Adjustment",
  reversal: "Reversal",
};

const TABS = [
  { id: "rooms", label: "Rooms" },
  { id: "extras", label: "Extras" },
  { id: "guests", label: "Guests" },
  { id: "folio", label: "Folio" },
  /*
   * ATTACHMENTS AND EMAIL ARE THE REFERENCE'S LAST TWO (0063). The client:
   * "Copy them too, I just want to clone the application." They sit before
   * History because that is where theirs are, and because History is the
   * trail rather than a thing anybody adds to.
   */
  { id: "attachments", label: "Attachments" },
  { id: "email", label: "Email" },
  { id: "history", label: "History" },
] as const;

type Tab = (typeof TABS)[number]["id"];

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
  attachments,
  emails,
  channels,
  canEdit,
  guest,
  cancellationTerms,
  timezone,
  inDialog = false,
  backHref,
  backLabel,
}: {
  detail: Detail;
  rooms: BookingRoomLine[];
  nights: BookingNight[];
  folio: FolioLine[];
  activity: BookingActivityItem[];
  /** Files on the booking (0063). */
  attachments: BookingAttachment[];
  /** Correspondence recorded against the booking (0063). */
  emails: BookingEmail[];
  channels: Channel[];
  canEdit: boolean;
  /** Null when the guest record could not be read; the tab then says so. */
  guest: BookingGuest | null;
  /**
   * What this booking may be cancelled under (0060). Null when it has no
   * rooms left to cancel. It REPORTS and does not block: staff can always
   * cancel, because a hotel that cannot cancel its own booking is broken.
   */
  cancellationTerms: BookingCancellationTerms | null;
  /** The property's own timezone. A posting time on the History tab is the
      hotel's clock, and renders the same on the server as in the browser. */
  timezone: string;
  /** Where "back" goes — the calendar the booking was opened from, or the list. */
  backHref: string;
  backLabel: string;
  /**
   * Rendered inside the calendar's dialog rather than as its own page.
   *
   * The dialog carries its own title bar and close button, so the back link
   * and the big reference heading would each be saying a second time what the
   * frame already says. Nothing else changes: it is the SAME component, which
   * is the whole point — a reduced copy of this screen is what this codebase
   * has refused to build three times.
   */
  inDialog?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [block, setBlock] = useState<"overbook" | null>(null);
  /* The restore refusal, when the rooms have been sold since the cancellation. */
  const [restoreBlocked, setRestoreBlocked] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("rooms");

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

  /*
   * Cancelling ONE room out of a group booking (0065). Which line is asking,
   * and the refusal when putting one back finds the room has been sold since
   * -- kept per line, because a group can be twenty-seven rooms and a message
   * with no room against it says nothing.
   */
  /*
   * WHICH ROOMS HAVE THEIR NIGHTS OPEN.
   *
   * Every room used to draw its whole nights table at once, which is fine on
   * the one-room booking this screen was built for and unusable on a group:
   * the hosted property's 27-room booking over six nights is 162 night rows
   * plus 27 table headers, all on screen together. The client: "it's very,
   * very big ... it takes the whole area."
   *
   * Seeded once per mount rather than derived, so a room somebody opened
   * stays open across `router.refresh()`. A single-room booking opens itself,
   * because there is nothing to shorten and hiding one short table behind a
   * click would only add a click.
   */
  const [openRooms, setOpenRooms] = useState<Set<string>>(
    () => new Set(rooms.length === 1 ? rooms.map((r) => r.bookingRoomId) : []),
  );

  const [roomCancelling, setRoomCancelling] = useState<string | null>(null);
  const [roomCancelReason, setRoomCancelReason] = useState("");
  const [roomRestoreBlocked, setRoomRestoreBlocked] = useState<
    { bookingRoomId: string; message: string } | null
  >(null);

  /*
   * The extras, derived from the folio rather than read separately.
   *
   * These are the same rows the Folio tab draws, filtered by the rule the
   * Extras report already uses. Deriving rather than fetching is what keeps
   * requirement 7 true: there is one set of money on this screen, looked at
   * two ways, so the two can never disagree.
   */
  const extras = folio.filter(
    (l) =>
      l.kind === "charge" &&
      l.itemType !== null &&
      !NOT_AN_EXTRA.includes(l.itemType),
  );
  const extrasCents = extras.reduce((sum, l) => sum + l.amountCents, 0);

  /*
   * How many rooms this booking still holds. Cancelling ONE room is offered
   * only above one, because the last one is the booking itself -- Postgres
   * refuses it by name and says to cancel the booking instead, and a control
   * that is always refused is a control that should not be drawn.
   */
  const liveRooms = rooms.filter(
    (r) => !["canceled", "no_show"].includes(r.status),
  ).length;

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

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
    /** For a caller that needs the refusal text as well as the banner. */
    onError?: (message: string) => void,
  ) {
    setMessage(null);
    setBlock(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        const text = result.error ?? "That did not work.";
        setMessage({ ok: false, text });
        if ("block" in result && result.block === "overbook") setBlock("overbook");
        onError?.(text);
        return;
      }
      setMessage({ ok: true, text: done });
      setRestoreBlocked(null);
      setEditing(false);
      setCancelling(false);
      setPricing(null);
      setRoomCancelling(null);
      setRoomRestoreBlocked(null);
      router.refresh();
    });
  }

  function toggleRoom(bookingRoomId: string) {
    setOpenRooms((open) => {
      const next = new Set(open);
      if (next.has(bookingRoomId)) next.delete(bookingRoomId);
      else next.add(bookingRoomId);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {/*
        Back to wherever this was opened from. A booking reached from the
        board returns to the board on the same dates and rail width, so the
        calendar is where it was left rather than reset to today.
      */}
      {!inDialog && (
        <Link
          href={backHref}
          className="inline-block text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          ← {backLabel}
        </Link>
      )}

      {/* Header ------------------------------------------------------- */}
      <div className="rounded-lg border border-line bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              {!inDialog && (
                <h1 className="font-display text-2xl font-semibold tracking-tightest text-ink">
                  {detail.reference}
                </h1>
              )}
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
            {/*
              RESTORE, for a booking somebody cancelled and wants back (0061).
              Cancelling used to be a one-way door: a guest ringing back meant
              taking the booking again by hand, losing the reference, the folio
              and the trail. It only shows on a booking that is actually
              cancelled, so it is never a second way to do nothing.
            */}
            {canEdit && ["canceled", "no_show"].includes(detail.status) && (
              <button
                onClick={() => {
                  setRestoreBlocked(null);
                  run(
                    () => restoreBooking(detail.bookingId),
                    "Booking restored.",
                    (message) => setRestoreBlocked(message),
                  );
                }}
                disabled={pending}
                className="rounded-md border border-emerald-300 px-4 py-2 text-[13px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                {pending ? "Restoring\u2026" : "Restore booking"}
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
          <Fact name="Cancellation">
            {cancellationTerms === null || cancellationTerms.hasNoPolicy ? (
              /* "Not set" is not "free". Saying "free cancellation" here
                 because no policy is attached would be inventing a promise
                 the hotel never made. */
              <span className="text-ink-muted">Not set</span>
            ) : cancellationTerms.kind === "non_refundable" ? (
              <>
                <span className="font-medium text-rose-600">Non-refundable</span>
                <span className="block text-xxs text-ink-faint">
                  {cancellationTerms.policyName}
                </span>
              </>
            ) : (
              <>
                <span
                  className={cn(
                    "font-medium",
                    cancellationTerms.isFreeNow ? "text-emerald-600" : "text-warn-deep",
                  )}
                >
                  {cancellationTerms.isFreeNow ? "Free to cancel" : "Past the free window"}
                </span>
                <span className="block text-xxs text-ink-faint">
                  {cancellationTerms.freeUntil
                    ? `Free until ${format(parseISO(cancellationTerms.freeUntil), "d MMM yyyy")}`
                    : cancellationTerms.policyName}
                </span>
              </>
            )}
            {cancellationTerms?.isMixed && (
              <span className="block text-xxs text-warn-deep">
                Rooms differ — strictest shown
              </span>
            )}
          </Fact>
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
            {/*
              The terms, at the moment somebody is about to cancel — which is
              the one moment they matter. It does not block the button: a
              hotel has to be able to cancel its own booking, and what the
              policy decides is whether money is owed, not whether staff may
              act. Cancelling never writes off the balance either way.
            */}
            {cancellationTerms && !cancellationTerms.hasNoPolicy && (
              <p
                className={cn(
                  "mb-3 rounded-md px-3 py-2 text-[12.5px] leading-snug",
                  cancellationTerms.kind === "non_refundable" ||
                    cancellationTerms.isFreeNow === false
                    ? "bg-rose-50 text-rose-700"
                    : "bg-emerald-50 text-emerald-700",
                )}
              >
                {cancellationTerms.kind === "non_refundable"
                  ? `Sold as non-refundable (${cancellationTerms.policyName}). The charge stands and stays on the folio.`
                  : cancellationTerms.isFreeNow
                    ? `Free to cancel until ${cancellationTerms.freeUntil ? format(parseISO(cancellationTerms.freeUntil), "d MMM yyyy") : "the deadline"}.`
                    : `The free window closed on ${cancellationTerms.freeUntil ? format(parseISO(cancellationTerms.freeUntil), "d MMM yyyy") : "the deadline"}. A cancellation fee applies.`}
              </p>
            )}
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

      {/*
        The areas the reference PMS puts a reservation into. Rooms, Extras and
        Guests are what the client named; Folio and History were already here
        as their own cards and join the same strip rather than sitting below it,
        so the screen is one thing to scroll instead of five.
      */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1.5 shadow-card">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass",
              tab === t.id
                ? "bg-chrome-800 text-white"
                : "text-ink-muted hover:bg-shell hover:text-ink",
            )}
          >
            {t.label}
            {t.id === "extras" && extras.length > 0 && (
              <span className="tnum ml-1.5 text-xxs opacity-70">{extras.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Rooms and nights --------------------------------------------- */}
      {tab === "rooms" && (
      <div className="rounded-lg border border-line bg-white p-5 shadow-card">
        <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
          Rooms
        </h2>
        <div className="space-y-4">
          {rooms.map((room) => {
            const roomNights = nights.filter((n) => n.bookingRoomId === room.bookingRoomId);
            const roomCanceled = ["canceled", "no_show"].includes(room.status);
            const roomOpen = openRooms.has(room.bookingRoomId);
            return (
              <div
                key={room.bookingRoomId}
                className={cn(
                  "rounded-md border border-line",
                  roomCanceled && "bg-shell/60",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                  {/*
                    THE SUMMARY IS THE TOGGLE, and it is its own button rather
                    than a wrapper round the row: the controls on the right are
                    buttons too, and a button inside a button is invalid HTML
                    that browsers rearrange during parsing -- the same trap the
                    calendar's assign control hit as a child of its bar.
                  */}
                  <button
                    type="button"
                    onClick={() => toggleRoom(room.bookingRoomId)}
                    aria-expanded={roomOpen}
                    className="-my-1 flex min-w-0 flex-1 items-center gap-2 rounded py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform",
                        roomOpen && "rotate-90",
                      )}
                    >
                      <path
                        d="M6 4l4 4-4 4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="min-w-0">
                      <span className="font-medium text-ink">
                        {room.roomNumber ? `Room ${room.roomNumber}` : "No room assigned"}
                      </span>
                      <span className="ml-2 text-[13px] text-ink-muted">{room.roomTypeName}</span>
                      <span className="ml-2 text-xxs text-ink-faint">
                        {room.adults} adult{room.adults === 1 ? "" : "s"}
                        {room.children > 0 && ` + ${room.children}`}
                        {" · "}
                        {room.nights} night{room.nights === 1 ? "" : "s"}
                      </span>
                      {/*
                        Only when this room does not agree with the booking --
                        which since 0065 is possible, and is the whole point. A
                        badge repeating the header's status on every line would
                        be noise on the twenty-seven-room group.
                      */}
                      {room.status !== detail.status && (
                        <span className="ml-2 align-middle">
                          <StatusBadge status={room.status} />
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="tnum text-[13px] text-ink">
                      {formatMoney(room.valueCents)}
                    </span>
                    {room.discountCents > 0 && (
                      <span className="tnum rounded bg-emerald-50 px-2 py-0.5 text-xxs font-medium text-emerald-800">
                        {formatMoney(room.discountCents)} off
                      </span>
                    )}
                    {canEdit && editable && !roomCanceled && (
                      <button
                        onClick={() =>
                          setPricing(pricing === room.bookingRoomId ? null : room.bookingRoomId)
                        }
                        className="rounded border border-line px-2.5 py-1 text-xxs text-ink-muted hover:bg-shell hover:text-ink"
                      >
                        Set rate
                      </button>
                    )}
                    {/*
                      CANCEL ONE ROOM OUT OF A GROUP (0065). The client:
                      "Group bookings allow the receptionist to be able to
                      cancel a reservation." Only above one live room -- the
                      last one is the booking, and cancelling the booking is
                      the header's own button.
                    */}
                    {canEdit && editable && liveRooms > 1 && !roomCanceled && (
                      <button
                        onClick={() => {
                          setRoomCancelReason("");
                          setRoomCancelling(
                            roomCancelling === room.bookingRoomId ? null : room.bookingRoomId,
                          );
                        }}
                        className="rounded border border-rose-300 px-2.5 py-1 text-xxs text-rose-700 hover:bg-rose-50"
                      >
                        Cancel this room
                      </button>
                    )}
                    {canEdit && editable && room.canceledSeparately && (
                      <button
                        onClick={() => {
                          setRoomRestoreBlocked(null);
                          run(
                            () =>
                              restoreBookingRoom({
                                bookingId: detail.bookingId,
                                bookingRoomId: room.bookingRoomId,
                              }),
                            "Room restored.",
                            (m) =>
                              setRoomRestoreBlocked({
                                bookingRoomId: room.bookingRoomId,
                                message: m,
                              }),
                          );
                        }}
                        disabled={pending}
                        className="rounded border border-emerald-300 px-2.5 py-1 text-xxs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        Restore this room
                      </button>
                    )}
                  </div>
                </div>

                {roomCancelling === room.bookingRoomId && (
                  <div className="flex flex-wrap items-end gap-3 border-b border-line bg-rose-50/50 px-4 py-3">
                    <div className="min-w-[240px] flex-1">
                      <label htmlFor={`rc-${room.bookingRoomId}`} className={label}>
                        Reason
                      </label>
                      <input
                        id={`rc-${room.bookingRoomId}`}
                        value={roomCancelReason}
                        placeholder="Recorded on the booking's staff notes"
                        onChange={(e) => setRoomCancelReason(e.target.value)}
                        className={field}
                      />
                    </div>
                    <button
                      onClick={() =>
                        run(
                          () =>
                            cancelBookingRoom({
                              bookingId: detail.bookingId,
                              bookingRoomId: room.bookingRoomId,
                              reason: roomCancelReason,
                            }),
                          "Room cancelled. The rest of the booking is unchanged.",
                        )
                      }
                      disabled={pending}
                      className="rounded-md bg-rose-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      Cancel this room
                    </button>
                    <button
                      onClick={() => setRoomCancelling(null)}
                      className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
                    >
                      Keep it
                    </button>
                  </div>
                )}

                {/*
                  The refusal when the room has been sold since it was
                  cancelled, with the override carrying Postgres's own words --
                  the same second ask taking an overbooked booking makes.
                */}
                {roomRestoreBlocked?.bookingRoomId === room.bookingRoomId && (
                  <div className="flex flex-wrap items-center gap-3 border-b border-line bg-rose-50 px-4 py-3">
                    <p className="flex-1 text-[13px] text-rose-700">
                      {roomRestoreBlocked.message}
                    </p>
                    <button
                      onClick={() =>
                        run(
                          () =>
                            restoreBookingRoom({
                              bookingId: detail.bookingId,
                              bookingRoomId: room.bookingRoomId,
                              allowOverbook: true,
                            }),
                          "Room restored, and the house is oversold for those nights.",
                        )
                      }
                      disabled={pending}
                      className="rounded-md bg-rose-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      Restore it anyway
                    </button>
                  </div>
                )}

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

                {roomOpen && (
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
                )}
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

      )}

      {/* Extras ------------------------------------------------------- */}
      {tab === "extras" && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-card">
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            Extras
          </h2>
          {extras.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              Nothing charged beyond the room. Post an extra from the cashier.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  {["Business date", "Type", "What", "Amount"].map((c, i) => (
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
                {extras.map((l) => (
                  <tr key={l.lineId}>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">
                      {format(parseISO(l.businessDate), "d MMM")}
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">
                      {(l.itemType && EXTRA_LABEL[l.itemType]) ?? l.itemType}
                    </td>
                    <td className="px-3 py-2.5 text-ink">
                      {l.description}
                      {l.isReversal && (
                        <span className="ml-2 text-xxs text-warn-deep">reversed</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "tnum whitespace-nowrap px-3 py-2.5 text-right font-medium",
                        l.isReversal ? "text-warn-deep" : "text-ink",
                      )}
                    >
                      {formatMoney(l.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/*
                The same folio lines, added up. Not a second set of books: it
                is a column total over rows the Folio tab also shows, so it
                cannot disagree with the balance in the header.
              */}
              <tfoot>
                <tr className="border-t border-line-strong">
                  <td className="px-3 pt-3 font-semibold text-ink" colSpan={3}>
                    Extras charged
                  </td>
                  <td className="tnum whitespace-nowrap px-3 pt-3 text-right font-semibold text-ink">
                    {formatMoney(extrasCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Guests ------------------------------------------------------- */}
      {tab === "guests" && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
              Guests
            </h2>
            <Link
              href={`/customers?q=${encodeURIComponent(detail.customerName)}`}
              className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Open in Customers
            </Link>
          </div>

          {guest === null ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              The guest record could not be read.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <Fact name="Name">{detail.customerName}</Fact>
              {guest.companyName && <Fact name="Company">{guest.companyName}</Fact>}
              <Fact name="Email">{guest.email || "—"}</Fact>
              <Fact name="Phone">{guest.phone || "—"}</Fact>
              <Fact name="Nationality">
                {COUNTRIES.find((c) => c.code === guest.nationality)?.name ??
                  guest.nationality ??
                  "—"}
              </Fact>
              <Fact name="Country">
                {COUNTRIES.find((c) => c.code === guest.country)?.name ??
                  guest.country ??
                  "—"}
              </Fact>
              <Fact name="Passport">{guest.passportNumber || "—"}</Fact>
              <Fact name="Passport expiry">
                {guest.passportExpiry
                  ? format(parseISO(guest.passportExpiry), "d MMM yyyy")
                  : "—"}
              </Fact>
              <Fact name="Date of birth">
                {guest.dateOfBirth
                  ? format(parseISO(guest.dateOfBirth), "d MMM yyyy")
                  : "—"}
              </Fact>
              {guest.nationalIdNumber && (
                <Fact name="National ID">{guest.nationalIdNumber}</Fact>
              )}
            </div>
          )}

          {/*
            Occupancy per room. This is as close to a guest list as the schema
            gets: `booking_rooms` counts adults and children and records no
            names, so the second occupant of 101 is a number here and nowhere
            a name.
          */}
          <div className="mt-5 border-t border-line pt-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  {["Room", "Room type", "Adults", "Children"].map((c, i) => (
                    <th
                      key={c}
                      className={cn(
                        "whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                        i > 1 && "text-right",
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rooms.map((r) => (
                  <tr key={r.bookingRoomId}>
                    <td className="tnum px-3 py-2.5 font-medium text-ink">
                      {r.roomNumber ?? "Not assigned"}
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{r.roomTypeName}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink">{r.adults}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink">{r.children}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Folio -------------------------------------------------------- */}
      {tab === "folio" && (
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

      )}

      {/* Activity ----------------------------------------------------- */}
      {tab === "attachments" && (
        <AttachmentsTab
          bookingId={detail.bookingId}
          attachments={attachments}
          timezone={timezone}
          canEdit={canEdit}
        />
      )}

      {tab === "email" && (
        <EmailTab
          bookingId={detail.bookingId}
          emails={emails}
          defaultTo={guest?.email ?? null}
          timezone={timezone}
          canEdit={canEdit}
        />
      )}

      {tab === "history" && (
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
                  {formatStampInProperty(a.createdAt, timezone)}
                  {a.actor && ` · ${a.actor}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}
