"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { cn } from "@/components/ui";

/**
 * The date picker in the board's corner.
 *
 * It was a bare `<input type="date">`, on the grounds that it needed no client
 * JavaScript. The client asked for a calendar they can see and click — the
 * native control shows one only after you find the small icon inside a field
 * 18 pixels tall, on a dark rail, which is not a calendar as far as anybody
 * using it is concerned. So this draws the month.
 *
 * Picking a day navigates the board to it. "Today" goes back to the default
 * window -- which STARTS A WEEK BEFORE the business date, not on it, because
 * the board deliberately opens with some history to the left. That is also why
 * the button's own label says "From": the date on it is where the board
 * starts, and it is a week behind the business date the top bar shows.
 *
 * Nothing here decides what the board shows — it only builds the href, so the
 * server still renders the board and the URL is still the whole state.
 */
export function DateJump({
  /** The first date currently on the board — what the picker opens on. */
  from,
  /** The hotel's business date, for the Today control and today's marker. */
  businessDate,
  /**
   * The route the board lives on, and the rail width to carry through.
   *
   * The pieces rather than a `hrefFor` function: this is a client component,
   * and a Server Component cannot hand a closure across that boundary — React
   * refuses to serialise it. Carrying `rail` matters because dropping it would
   * silently reset the room column every time somebody picked a date.
   */
  basePath,
  railW,
  todayFrom,
}: {
  from: string;
  businessDate: string;
  basePath: string;
  railW: number;
  /**
   * The date the board starts on for "today" -- which is a week before the
   * business date, not the business date itself, since the board opens with
   * some history to the left. Passed in rather than worked out here so this
   * and the rail's own Today land in exactly the same place.
   */
  todayFrom: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(from)));
  const wrapRef = useRef<HTMLDivElement>(null);

  // Reopening should show the month the board is on, not the month somebody
  // last browsed to and then dismissed.
  useEffect(() => {
    if (!open) setMonth(startOfMonth(parseISO(from)));
  }, [open, from]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function go(date: Date) {
    setOpen(false);
    router.push(`${basePath}?from=${format(date, "yyyy-MM-dd")}&rail=${railW}`);
  }

  const first = parseISO(from);
  const today = parseISO(businessDate);

  // Six rows of seven, always, so the popover does not change height as you
  // page through months and the buttons stay where the eye left them.
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`The board starts on ${format(first, "d MMM yyyy")}. Go to another date.`}
        aria-label={`The board starts on ${format(first, "d MMM yyyy")}. Go to another date.`}
        className="flex w-full items-center gap-1.5 rounded-sm bg-white/15 px-1.5 py-[3px] text-left text-xxs font-medium text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 shrink-0 fill-current">
          <path d="M5 1v1.5H3.8A1.8 1.8 0 0 0 2 4.3v8A1.8 1.8 0 0 0 3.8 14h8.4a1.8 1.8 0 0 0 1.8-1.7v-8a1.8 1.8 0 0 0-1.8-1.8H11V1H9.5v1.5h-3V1zM3.5 6.2h9v6.1a.3.3 0 0 1-.3.2H3.8a.3.3 0 0 1-.3-.2z" />
        </svg>
        {/*
          "From", because this is WHERE THE BOARD STARTS and not what day it
          is. A bare date here sat directly under the Today control and the
          two read as a label and its value, so the board appeared to claim
          today was this date -- while the top bar, correctly, showed the
          business date a week later. One word, and the field now says which
          of the two it is.
        */}
        <span className="truncate">From {format(first, "d MMM yyyy")}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Go to a date"
          /*
            Left-aligned to the rail and above the board's sticky header, which
            is z-30. A popover under the header is one nobody can click.
          */
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-[248px] rounded-lg border border-line bg-white p-2.5 shadow-lift"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMonth((m) => subMonths(m, 1))}
              aria-label="Previous month"
              className="flex h-6 w-6 items-center justify-center rounded text-ink-muted transition hover:bg-shell hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              ‹
            </button>
            <span className="font-display text-[13px] font-semibold tracking-tightest text-ink">
              {format(month, "MMMM yyyy")}
            </span>
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
              className="flex h-6 w-6 items-center justify-center rounded text-ink-muted transition hover:bg-shell hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              ›
            </button>
          </div>

          <div className="mt-1.5 grid grid-cols-7 gap-px">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span
                key={i}
                className="py-1 text-center text-xxs font-semibold uppercase text-ink-faint"
              >
                {d}
              </span>
            ))}
            {days.map((d) => {
              const outside = !isSameMonth(d, month);
              const isToday = isSameDay(d, today);
              const isFrom = isSameDay(d, first);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => go(d)}
                  className={cn(
                    "tnum h-7 rounded text-[12px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass",
                    isFrom
                      ? "bg-brass font-semibold text-white"
                      : isToday
                        ? // Rose for today, matching the marker on the board
                          // itself rather than introducing a second colour for
                          // the same idea.
                          "bg-rose-50 font-semibold text-rose-600 hover:bg-rose-100"
                        : outside
                          ? "text-ink-faint hover:bg-shell"
                          : "text-ink hover:bg-shell",
                  )}
                >
                  {format(d, "d")}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => go(parseISO(todayFrom))}
            className="mt-2 w-full rounded-md border border-line py-1.5 text-[12px] font-medium text-ink transition hover:bg-shell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            Today
          </button>
        </div>
      )}
    </div>
  );
}
