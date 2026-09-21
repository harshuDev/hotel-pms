"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * The panel that opens over the board when a date is clicked.
 *
 * The reference system opens a "Create Booking" dialog in place rather than
 * taking you to another screen, and the client asked for the board exactly.
 *
 * **This is a frame and not a form.** What it wraps is the same
 * `NewBookingForm` the `/bookings/new` page renders, passed in as children from
 * the server. Taking a booking goes through `create_booking()` and nothing
 * else, and a second form would be a second thing to keep in step with it —
 * its per-night rate lookup, the two override flags, promotion resolution. So
 * the dialog moves where the form is shown and changes nothing about what it
 * does.
 *
 * Open state is the URL (`?book=<date>&type=<id>`), not React state, so the
 * server can render the form already filled in for the night that was clicked.
 * That is also what makes the back button close it.
 */
export function BookingDialog({
  title,
  subtitle,
  closeHref,
  closeLabel = "Close without taking a booking",
  side = false,
  meta,
  children,
}: {
  title: string;
  subtitle: string;
  /** Where closing goes: the same board, without the booking params. */
  closeHref: string;
  /** What the close button announces. The frame wraps more than one thing. */
  closeLabel?: string;
  /**
   * A RIGHT-HAND PANEL rather than a centred dialog, for the booking details.
   *
   * The client sent their reference's popup and asked for it by shape: it
   * slides in from the right, runs the full height of the window, and the
   * board stays visible down the left. A centred box is what we had, and it
   * covers the dates you were reading -- which was the whole reason they
   * wanted a popup instead of a page in the first place.
   *
   * The booking FORM keeps the centred frame. It is a short form and a panel
   * the height of the screen for six fields is the wrong shape; only the
   * reservation, which carries a room table and a folio, earns the panel.
   */
  side?: boolean;
  /**
   * The figures the reference puts along the top of its panel -- Grand Total,
   * Due, Paid. Passed in rather than worked out here, because this frame is
   * generic and the money belongs to the booking the server already loaded.
   * Omitted on the form, which has no totals until it is submitted.
   */
  meta?: { label: string; value: string; tone?: "paid" | "due" }[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, which is what every dialog on every system does, and a front
  // desk reaches for it without thinking.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") router.push(closeHref);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, closeHref]);

  // The page behind must not scroll while this is over it: scrolling the board
  // under an open dialog looks like the dialog has come loose from the date it
  // belongs to.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Focus lands inside the panel rather than staying on the cell that was
  // clicked, so tab goes through the form and not the board behind it.
  //
  // The first FIELD, not the first focusable thing. `querySelector` returns
  // document order and the close button comes first in the markup, so a single
  // selector put the cursor on "close" — which is where somebody pressing
  // space or enter out of habit would land, on a control that throws the form
  // away. The button is only the fallback for a panel with no fields in it,
  // which is what the role refusal is.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const field = panel.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea',
    );
    (field ?? panel.querySelector<HTMLElement>("button"))?.focus();
  }, []);

  return (
    <div
      className={
        side
          ? "fixed inset-0 z-50 flex justify-end bg-chrome-900/50"
          : "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-chrome-900/50 p-4 sm:p-6"
      }
      // Only a click that starts AND ends on the backdrop closes. A drag that
      // begins inside the form and finishes outside it is somebody selecting
      // text, and closing on that throws away everything they have typed.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) router.push(closeHref);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-dialog-title"
        className={
          side
            ? /*
                Full height and flush to the right edge, like the reference's.
                A flex COLUMN, so the header keeps its place and only the body
                scrolls -- `max-h` on the body would work until the header
                wrapped on a narrow screen and pushed the total off the end.
              */
              "flex h-full w-full flex-col overflow-hidden border-l border-line bg-shell shadow-lift sm:max-w-3xl lg:max-w-5xl"
            : "my-4 w-full max-w-4xl overflow-hidden rounded-lg border border-line bg-shell shadow-lift"
        }
      >
        <div className="flex items-start gap-4 bg-chrome-800 px-4 py-3 sm:px-5">
          {/*
            THE CLOSE GOES FIRST ON A PANEL, which is where the reference puts
            it and where a slide-over conventionally carries it: the panel
            arrives from the right, so the eye lands on its left edge. On the
            centred dialog it stays on the right, as it was.
          */}
          {side && (
            <button
              type="button"
              onClick={() => router.push(closeHref)}
              aria-label={closeLabel}
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15 text-white transition hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
                <path d="M4.3 3 3 4.3 6.7 8 3 11.7 4.3 13 8 9.3l3.7 3.7 1.3-1.3L9.3 8 13 4.3 11.7 3 8 6.7z" />
              </svg>
            </button>
          )}

          <div className="min-w-0 flex-1">
            <h2
              id="booking-dialog-title"
              className="truncate font-display text-[15px] font-semibold tracking-tightest text-white"
            >
              {title}
            </h2>
            <p className="mt-0.5 truncate text-xxs text-white/70">{subtitle}</p>
          </div>

          {/*
            The money, along the top, as the reference's panel carries it.
            Hidden on a narrow screen rather than wrapped: the reservation
            repeats every one of these figures a few centimetres below, so a
            phone loses nothing by dropping them out of the bar.
          */}
          {meta && meta.length > 0 && (
            <div className="hidden shrink-0 items-start gap-5 sm:flex">
              {meta.map((m) => (
                <div key={m.label} className="text-right">
                  <div className="text-xxs uppercase tracking-[0.1em] text-white/55">
                    {m.label}
                  </div>
                  <div
                    className={`tnum font-display text-[14px] font-semibold tracking-tightest ${
                      m.tone === "paid"
                        ? "text-emerald-300"
                        : m.tone === "due"
                          ? "text-rose-300"
                          : "text-white"
                    }`}
                  >
                    {m.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/*
            A button rather than a link, so it cannot be opened in a new tab —
            "close this" is not a destination. It pushes the same href the
            backdrop and Escape do.
          */}
          {!side && (
            <button
              type="button"
              onClick={() => router.push(closeHref)}
              aria-label={closeLabel}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15 text-white transition hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
                <path d="M4.3 3 3 4.3 6.7 8 3 11.7 4.3 13 8 9.3l3.7 3.7 1.3-1.3L9.3 8 13 4.3 11.7 3 8 6.7z" />
              </svg>
            </button>
          )}
        </div>

        <div
          className={
            side
              ? "min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"
              : "max-h-[75vh] overflow-y-auto p-4 sm:p-5"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
