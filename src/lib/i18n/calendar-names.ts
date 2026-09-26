import { bcp47, type Locale } from "@/lib/i18n/locales";

/*
 * The calendar's words and today's date, worked out HERE rather than in the
 * browser. Node's ICU and the browser's name months and weekdays differently
 * often enough ("Sep"/"Sept", "mié"/"mié.") that formatting them in a client
 * component is a hydration mismatch waiting for the right locale. Computed
 * once on the server and handed down, both renders print the same string.
 */
function capitalise(s: string) {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

export function monthNames(locale: Locale): string[] {
  const f = new Intl.DateTimeFormat(bcp47(locale), { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, m) => capitalise(f.format(new Date(Date.UTC(2024, m, 1)))));
}

/** Sunday first, as the client's current booking engine draws its weeks. */
export function weekdayNames(locale: Locale): string[] {
  const f = new Intl.DateTimeFormat(bcp47(locale), { weekday: "short", timeZone: "UTC" });
  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, d) => capitalise(f.format(new Date(Date.UTC(2024, 0, 7 + d)))));
}

/**
 * Today on the hotel's own clock, never the server's: a guest in Mexico at
 * 23:00 is still on today, while a UTC server is already on tomorrow.
 */
export function hotelToday(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
