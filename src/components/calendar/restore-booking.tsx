"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { restoreBooking } from "@/lib/actions/booking-edit";

/**
 * Putting a cancelled bar back on the house, from the board.
 *
 * The client: "Restore a booking for cancelled ones ... like restore the room
 * krke option ho." The Cancelled band is where somebody is looking when they
 * decide a cancellation was wrong, so the control belongs there as well as on
 * the booking screen.
 *
 * A SIBLING OF THE BAR, NEVER A CHILD OF IT. A `<button>` inside an `<a>` is
 * invalid HTML and browsers rearrange it during parsing, so it vanishes. That
 * is the same trap `AssignRoom` documents, and it has bitten this board
 * before.
 *
 * THE SECOND ASK IS THE POINT. Cancelling frees the rooms, so by the time
 * somebody restores, the nights may have been sold to somebody else.
 * `restore_booking()` refuses with `HP001` rather than overselling quietly,
 * and this shows what it said and offers the override explicitly — the same
 * shape as taking a booking that would oversell. It is never one click.
 */
export function RestoreBooking({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(allowOverbook: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await restoreBooking(bookingId, allowOverbook);
      if (!result.ok) {
        // An oversell refusal is a question, not a dead end. Anything else is
        // an error and is shown as one.
        if (result.error.includes("free for those dates")) setBlocked(result.error);
        else setError(result.error);
        return;
      }
      setBlocked(null);
      router.refresh();
    });
  }

  return (
    <span className="absolute -top-1 right-0.5 z-20">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(false)}
        title="Restore this booking"
        aria-label="Restore this booking"
        className={cn(
          "rounded border border-emerald-300 bg-white px-1 text-[10.5px] font-medium leading-4 text-emerald-700 shadow-card transition",
          "hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
          "disabled:opacity-50",
        )}
      >
        {pending ? "…" : "Restore"}
      </button>

      {(blocked || error) && (
        <span className="absolute right-0 top-5 z-30 w-56 rounded-md border border-line bg-white p-2 text-left shadow-lift">
          <span className="block text-[11.5px] leading-snug text-ink">
            {blocked ?? error}
          </span>
          <span className="mt-1.5 flex gap-1.5">
            {blocked && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(true)}
                className="rounded bg-rose-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                Restore anyway
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setBlocked(null);
                setError(null);
              }}
              className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-shell"
            >
              Close
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
