import Link from "next/link";
import { format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import type {
  BookingCancellationTerms,
  BookingDetail,
  BookingRoomLine,
} from "@/lib/types";

/**
 * A booking's details over the board, as the reference's popup does.
 *
 * The client asked for this directly: "jab koi bhi kisi booking ko open krta
 * hai to vo popup hota hai uski puri details ke sath". Clicking a bar used to
 * navigate away to `/bookings/[id]`, which meant losing the dates and the rail
 * width you were looking at just to read a reference and a balance.
 *
 * IT READS AND DOES NOT EDIT, AND THAT IS THE WHOLE DESIGN. `/bookings/[id]`
 * is the reservation workflow — editing dates, taking payments, cancelling,
 * the five tabs — and a second, smaller copy of it inside a dialog is the
 * thing this codebase has refused to build three times, because two editors
 * for one booking drift apart the first time either changes. So the popup
 * answers "who is this and what do they owe", which is what somebody scanning
 * a board actually wants, and hands over to the real screen for anything that
 * writes.
 *
 * Every figure here comes from `booking_detail()` and `booking_room_lines()`,
 * the same two reads the full screen uses. Nothing is recomputed, so the two
 * cannot disagree.
 */

const STATUS_TONE: Record<string, string> = {
  pending: "bg-warn-wash text-warn-deep",
  confirmed: "bg-blue-50 text-blue-700",
  checked_in: "bg-emerald-50 text-emerald-700",
  checked_out: "bg-slate-100 text-slate-600",
  canceled: "bg-rose-50 text-rose-700",
  no_show: "bg-rose-50 text-rose-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  checked_in: "In house",
  checked_out: "Departed",
  canceled: "Cancelled",
  no_show: "No show",
};

function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xxs uppercase tracking-[0.08em] text-ink-faint">
        {name}
      </span>
      <span className="text-right text-[13px] text-ink">{children}</span>
    </div>
  );
}

export function BookingPeek({
  detail,
  rooms,
  cancellationTerms,
  fullHref,
}: {
  detail: BookingDetail;
  rooms: BookingRoomLine[];
  cancellationTerms: BookingCancellationTerms | null;
  /** The real screen, carrying `?back=` so it returns to this board. */
  fullHref: string;
}) {
  const settled = detail.balanceCents === 0;

  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="tnum font-display text-[17px] font-semibold tracking-tightest text-ink">
          {detail.reference}
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-xxs font-semibold",
            STATUS_TONE[detail.status] ?? "bg-slate-100 text-slate-600",
          )}
        >
          {STATUS_LABEL[detail.status] ?? detail.status}
        </span>
      </div>

      <div className="divide-y divide-line">
        <Row name="Guest">
          <span className="font-medium">{detail.customerName}</span>
          {detail.customerEmail && (
            <span className="block text-xxs text-ink-faint">
              {detail.customerEmail}
            </span>
          )}
          {detail.customerPhone && (
            <span className="block text-xxs text-ink-faint">
              {detail.customerPhone}
            </span>
          )}
        </Row>

        <Row name="Stay">
          {format(parseISO(detail.checkIn), "EEE d MMM yyyy")} —{" "}
          {format(parseISO(detail.checkOut), "EEE d MMM yyyy")}
          <span className="block text-xxs text-ink-faint">
            {detail.nights} night{detail.nights === 1 ? "" : "s"}
          </span>
        </Row>

        <Row name="Guests">
          {detail.adults} adult{detail.adults === 1 ? "" : "s"}
          {detail.children > 0 &&
            `, ${detail.children} child${detail.children === 1 ? "" : "ren"}`}
        </Row>

        <Row name="Rooms">
          {/*
            The room lines themselves, because "who is in 101" is the question
            this board exists to answer and a count alone does not.
          */}
          {rooms.length === 0 ? (
            <span className="text-ink-muted">None</span>
          ) : (
            rooms.map((r) => (
              <span key={r.bookingRoomId} className="block">
                {r.roomNumber ? (
                  <span className="tnum font-medium">{r.roomNumber}</span>
                ) : (
                  <span className="text-ink-muted">Not assigned</span>
                )}
                <span className="text-ink-faint"> · {r.roomTypeName}</span>
              </span>
            ))
          )}
        </Row>

        <Row name="Source">
          {detail.channelName ?? "—"}
          {detail.externalReference && (
            <span className="block text-xxs text-ink-faint">
              {detail.externalReference}
            </span>
          )}
        </Row>

        <Row name="Cancellation">
          {cancellationTerms === null || cancellationTerms.hasNoPolicy ? (
            <span className="text-ink-muted">Not set</span>
          ) : cancellationTerms.kind === "non_refundable" ? (
            <span className="font-medium text-rose-600">Non-refundable</span>
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
              {cancellationTerms.freeUntil && (
                <span className="block text-xxs text-ink-faint">
                  until {format(parseISO(cancellationTerms.freeUntil), "d MMM yyyy")}
                </span>
              )}
            </>
          )}
        </Row>

        <Row name="Value">
          <span className="tnum">{formatMoney(detail.reservationValueCents)}</span>
        </Row>

        <Row name="Balance">
          <span
            className={cn(
              "tnum font-medium",
              detail.balanceCents > 0 ? "text-rose-600" : "text-ink",
            )}
          >
            {settled ? "Settled" : formatMoney(detail.balanceCents)}
          </span>
        </Row>

        {detail.guestNotes && (
          <Row name="Guest note">
            <span className="whitespace-pre-line text-[12.5px] leading-relaxed">
              {detail.guestNotes}
            </span>
          </Row>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <Link
          href={fullHref}
          className="rounded-md bg-chrome-800 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-chrome-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          Open full booking
        </Link>
      </div>
    </div>
  );
}
