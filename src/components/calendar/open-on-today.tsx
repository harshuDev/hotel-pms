"use client";

import { useEffect } from "react";

/**
 * Scrolls the board so the business date is the first column you see.
 *
 * THE LOOKBACK IS A DATA RANGE, NOT A STARTING POSITION, and conflating the
 * two is the bug this fixes. `CALENDAR_LOOKBACK` exists because the client
 * asked to be able to see past dates -- "in the calendar I want the hotels to
 * be able to see past dates too" -- so the window is fetched starting a week
 * before the business date. But the board then also OPENED on that first
 * column, which is a different decision and one nobody asked for.
 *
 * On a desk monitor that was survivable: eight or nine columns fit, so today
 * was still on screen, just not at the left edge. On a phone ONE column fits.
 * The client opened the calendar, saw 12 September against a top bar reading
 * "Business date Sat 19 Sep 2026", and had no way of knowing today was seven
 * columns off the right-hand edge. They flagged it twice.
 *
 * So the week of history stays loaded and is one swipe to the LEFT, which is
 * where a tape chart puts the past, and the board opens on the day the hotel
 * is actually operating.
 *
 * `useEffect`, not `useLayoutEffect`. A client component still renders on the
 * server in the App Router, and React warns that `useLayoutEffect` does
 * nothing there -- a warning on every calendar render is not worth the one
 * frame it would save. The rAF fallback below covers a phone whose layout has
 * not settled on the first pass.
 */
export function OpenOnToday({
  /** The element to scroll. */
  scrollerId,
  /** How far in, in pixels. Zero means the board is already where it should be. */
  offset,
}: {
  scrollerId: string;
  offset: number;
}) {
  useEffect(() => {
    if (offset <= 0) return;
    const el = document.getElementById(scrollerId);
    if (!el) return;

    /*
     * ONLY ON ARRIVAL, never after somebody has scrolled.
     *
     * This component remounts on every navigation the board makes -- paging,
     * picking a date, opening a dialog through the URL -- and forcing the
     * scroll back each time would drag the board out from under anybody who
     * had moved it. A board already scrolled is a board somebody is reading.
     */
    if (el.scrollLeft > 0) return;

    el.scrollLeft = offset;

    /*
     * The grid's width comes from inline styles, so it is known at this point
     * -- but a phone that is still settling its layout can report a smaller
     * scrollWidth and clamp the assignment. One frame later it is right, and
     * re-checking `scrollLeft` keeps this from fighting a real scroll.
     */
    const frame = requestAnimationFrame(() => {
      if (el.scrollLeft < offset) el.scrollLeft = offset;
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollerId, offset]);

  return null;
}
