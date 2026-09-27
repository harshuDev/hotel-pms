import { cache } from "react";
import { cookies } from "next/headers";
import { getCurrentStaffUser } from "@/lib/queries";
import { makeTranslator, type Dictionary, type Translator } from "@/lib/i18n/translate";
import {
  DEFAULT_STAFF_LOCALE,
  STAFF_LOCALE_COOKIE,
  isStaffLocale,
  type StaffLocale,
} from "@/lib/i18n/staff-locales";

/*
 * The staff language on the server, per request (0106). The signed-in
 * person's own choice, `staff_users.locale`, wins; before anyone is signed in
 * -- /login -- the cookie the last choice on this browser left behind; else
 * English. `cache()` makes every Server Component in one request share one
 * answer and one dictionary load.
 *
 * Each dictionary is its own chunk, loaded only for the language in use.
 */

const LOADERS: Record<StaffLocale, () => Promise<Dictionary>> = {
  en: async () => ({}),
  de: () => import("@/lib/i18n/staff/de").then((m) => m.default),
  el: () => import("@/lib/i18n/staff/el").then((m) => m.default),
  es: () => import("@/lib/i18n/staff/es").then((m) => m.default),
  fr: () => import("@/lib/i18n/staff/fr").then((m) => m.default),
  id: () => import("@/lib/i18n/staff/id").then((m) => m.default),
  it: () => import("@/lib/i18n/staff/it").then((m) => m.default),
  pt: () => import("@/lib/i18n/staff/pt").then((m) => m.default),
  ro: () => import("@/lib/i18n/staff/ro").then((m) => m.default),
  "sl-SI": () => import("@/lib/i18n/staff/sl-SI").then((m) => m.default),
  th: () => import("@/lib/i18n/staff/th").then((m) => m.default),
  is: () => import("@/lib/i18n/staff/is").then((m) => m.default),
};

export const getCookieLocale = cache(async (): Promise<StaffLocale> => {
  const value = (await cookies()).get(STAFF_LOCALE_COOKIE)?.value;
  return isStaffLocale(value) ? value : DEFAULT_STAFF_LOCALE;
});

export const getStaffLocale = cache(async (): Promise<StaffLocale> => {
  const staff = await getCurrentStaffUser();
  return staff ? staff.locale : getCookieLocale();
});

export const getStaffDictionary = cache(
  async (locale: StaffLocale): Promise<Dictionary> => LOADERS[locale](),
);

/** The translator for this request's staff member. */
export const getT = cache(async (): Promise<Translator> => {
  const locale = await getStaffLocale();
  return makeTranslator(locale, await getStaffDictionary(locale));
});

/** For the 404, which deliberately makes no database query: the cookie only. */
export async function getCookieT(): Promise<Translator> {
  const locale = await getCookieLocale();
  return makeTranslator(locale, await getStaffDictionary(locale));
}

/**
 * A page's tab title in the staff member's language. Pages export
 * `generateMetadata = pageTitle("Dashboard")` in place of a static
 * `metadata`, and the (app) layout still adds the hotel's name.
 */
export function pageTitle(text: string) {
  return async (): Promise<{ title: string }> => ({ title: (await getT())(text) });
}
