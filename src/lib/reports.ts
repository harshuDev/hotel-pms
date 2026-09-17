import { format, isValid, parseISO, subDays } from "date-fns";

/** How far back a report looks when nobody has said otherwise. */
export const DEFAULT_REPORT_DAYS = 30;

export interface DateRange {
  from: string;
  to: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readDate(value: string | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  return isValid(parseISO(value)) ? value : null;
}

/**
 * Turns query-string dates into a range a report can be run for.
 *
 * Anything unparseable falls back to the default window rather than reaching
 * Postgres, where a bad date is an error rather than an empty report. The
 * window is measured from the business date, never from server time.
 */
export function reportRange(
  businessDate: string,
  from: string | undefined,
  to: string | undefined,
  days: number = DEFAULT_REPORT_DAYS,
): DateRange {
  const end = readDate(to) ?? businessDate;
  const start =
    readDate(from) ??
    format(subDays(parseISO(end), days - 1), "yyyy-MM-dd");

  // A backwards range returns nothing and looks like a bug. Swap it.
  return start > end ? { from: end, to: start } : { from: start, to: end };
}
