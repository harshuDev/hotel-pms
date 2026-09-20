import { LOCALE } from "./money";

/**
 * Rendering a `timestamptz` on the property's own clock.
 *
 * `format()` from date-fns renders in whatever timezone the RUNTIME happens to
 * be in, which for a client component is two different answers for one row: it
 * is rendered once on the server (UTC on Vercel) and again in the browser (the
 * viewer's zone), the two disagree, and React reports a hydration mismatch and
 * repaints. Neither answer is necessarily the hotel's own clock either, and
 * `properties.timezone` is what every other date in this app is measured
 * against.
 *
 * Naming the zone makes the two renders identical and makes the time the one
 * the front desk would read off the wall.
 *
 * The month name comes from the array below rather than from `Intl`, and the
 * hour cycle is pinned to `h23`. Both are on purpose: ICU versions disagree
 * about whether September abbreviates to "Sep" or "Sept", and about whether
 * midnight under `hour12: false` is "00" or "24" — and Node's ICU is not the
 * browser's, so leaving either to the platform would reintroduce exactly the
 * mismatch this function exists to remove. Only the numeric parts, which every
 * ICU agrees on, are taken from `Intl`.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function partsInProperty(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** "20 Sep, 14:32" — when something was posted, on the property's clock. */
export function formatStampInProperty(iso: string, timezone: string): string {
  const p = partsInProperty(iso, timezone);
  const month = MONTHS[Number(p.month) - 1] ?? p.month;

  return `${Number(p.day)} ${month}, ${p.hour}:${p.minute}`;
}
