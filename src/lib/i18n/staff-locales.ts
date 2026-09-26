import { de, el, enGB, es, fr, id, is, it, pt, ro, sl, th, type Locale as DateLocale } from "date-fns/locale";

/**
 * THE STAFF APPLICATION'S LANGUAGES -- the reference's twelve, in its order,
 * with its codes ("sl-SI" included). Chosen per member of staff in the user
 * menu and stored on `staff_users.locale` (0106), whose check constraint and
 * `save_own_locale()` list the same twelve; the three change together.
 *
 * Separate from `locales.ts`, which is the GUEST booking page's nineteen. The
 * two lists answer different questions -- what a hotel's guests may read, and
 * what its staff read -- and the overlap between them is a coincidence.
 */
export const STAFF_LOCALES = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "el", label: "Ελληνικά" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ro", label: "Română" },
  { code: "sl-SI", label: "Slovenščina" },
  { code: "th", label: "ไทย" },
  { code: "is", label: "Íslenska" },
] as const;

export type StaffLocale = (typeof STAFF_LOCALES)[number]["code"];

export const DEFAULT_STAFF_LOCALE: StaffLocale = "en";

/** Remembers the last choice on this browser, for /login, before anyone is signed in. */
export const STAFF_LOCALE_COOKIE = "staff_locale";

export function isStaffLocale(value: string | null | undefined): value is StaffLocale {
  return STAFF_LOCALES.some((l) => l.code === value);
}

/**
 * date-fns's own locale data, for month and weekday names. It is plain data
 * inside the bundle -- no ICU -- so the server and the browser print a date
 * identically and translating one can never cause a hydration mismatch.
 * English stays en-GB ("26 Sep"), which is what the app always printed.
 */
export const DATE_LOCALES: Record<StaffLocale, DateLocale> = {
  en: enGB,
  de,
  el,
  es,
  fr,
  id,
  it,
  pt,
  ro,
  "sl-SI": sl,
  th,
  is,
};
