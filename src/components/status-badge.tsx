"use client";

import { useT } from "@/components/i18n";
import { cn } from "@/components/ui";
import { msg } from "@/lib/i18n/translate";
import type { BookingStatus } from "@/lib/types";

const STATUS_STYLE: Record<BookingStatus, string> = {
  // `warn`, not `brass` — pending sat on the accent token and read as pale
  // blue next to `confirmed`. `warn-deep` for text: `warn` DEFAULT on the
  // wash is only ~3:1, too low for the 10.5px badge.
  pending: "bg-warn-wash text-warn-deep ring-warn-light",
  confirmed: "bg-sky-50 text-sky-700 ring-sky-200",
  checked_in: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  checked_out: "bg-slate-100 text-slate-500 ring-slate-200",
  canceled: "bg-rose-50 text-rose-700 ring-rose-200",
  no_show: "bg-violet-50 text-violet-700 ring-violet-200",
};

/*
 * The words the badge has always shown in English, written out rather than
 * made by CSS `capitalize` from the enum (0106): capitalising every word is
 * English's convention, and would mangle a German or Greek label.
 */
export const STATUS_WORD: Record<BookingStatus, string> = {
  pending: msg("Pending"),
  confirmed: msg("Confirmed"),
  checked_in: msg("Checked In"),
  checked_out: msg("Checked Out"),
  canceled: msg("Canceled"),
  no_show: msg("No Show"),
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  const tr = useT();
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xxs font-medium ring-1 ring-inset",
        STATUS_STYLE[status],
      )}
    >
      {tr(STATUS_WORD[status])}
    </span>
  );
}
