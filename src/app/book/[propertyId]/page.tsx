import { notFound } from "next/navigation";
import Link from "next/link";
import { BookingWidget } from "@/components/book/booking-widget";
import {
  getPublicHotelPolicies,
  getPublicLanguageSettings,
  getPublicProperty,
  getPublicRatePlans,
  getPublicRoomTypeContent,
  getPublicRoomTypeFacilities,
} from "@/lib/actions/public-booking";
import { getCurrentStaffUser } from "@/lib/queries";
import { LOCALES, bcp47, isLocale, type Locale } from "@/lib/i18n/locales";
import { dictionaryFor } from "@/lib/i18n/dictionary";

export const metadata = { title: "Book a room" };

/**
 * The public booking page. No session, no staff account, no nav.
 *
 * The property is in the URL because a guest has nothing else to identify it
 * by: current_property_id() reads staff_users, and a stranger has no row
 * there.
 *
 * Two failures that are not the same thing, and used to be:
 *
 *   - No such property, or an inactive one. That is a 404, and it stays a
 *     bare one: a stranger guessing property ids learns nothing from it.
 *   - A real property with nothing published yet. This used to 404 too, which
 *     meant the hotel's own staff clicked "Guest booking page" in their menu
 *     and got a black error page with no clue what was wrong. It is a page
 *     now, and it says what to do — which is what an empty state is for.
 */
export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { propertyId } = await params;
  const { lang } = await searchParams;

  const property = await getPublicProperty(propertyId);
  if (!property) notFound();

  /*
   * Language Settings (0078). A `?lang=` the hotel does not offer falls back
   * to its default rather than being honoured -- otherwise a shared link would
   * put a guest in a language the hotel chose not to support.
   */
  const languages = await getPublicLanguageSettings(propertyId);
  const locale: Locale =
    isLocale(lang) && languages.supportedLocales.includes(lang)
      ? lang
      : languages.defaultLocale;

  const ratePlans = await getPublicRatePlans(propertyId);

  if (ratePlans.length === 0) {
    const t = dictionaryFor(locale);

    // Only a signed-in member of staff is told where to fix it. A guest has no
    // use for the word "Inventory" and it is not theirs to read.
    const staff = await getCurrentStaffUser();

    return (
      <main className="flex min-h-screen items-center justify-center bg-shell px-5">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h1 className="font-display text-[20px] font-semibold tracking-tightest text-ink">
              {property.name}
            </h1>
            {languages.supportedLocales.length > 1 && (
              <form>
                <label htmlFor="lang" className="sr-only">{t.language}</label>
                <select
                  id="lang"
                  name="lang"
                  defaultValue={locale}
                  className="rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink-muted outline-none focus:border-brass focus:ring-2 focus:ring-brass/20"
                >
                  {LOCALES.filter((l) => languages.supportedLocales.includes(l.code)).map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <noscript>
                  <button type="submit" className="ml-2 text-[13px] underline">
                    OK
                  </button>
                </noscript>
              </form>
            )}
          </div>

          <div className="rounded-lg border border-line bg-white p-6 shadow-card">
            <h2 className="font-display text-[17px] font-semibold tracking-tightest text-ink">
              {t.notBookable}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              {t.notBookableHint}
            </p>

            {staff && (
              <div className="mt-5 rounded-md bg-shell px-3 py-3">
                <p className="text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  Staff only
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink">
                  Guests see the message above because no rate plan is
                  published. Open a plan in Inventory, tick{" "}
                  <span className="font-medium">
                    Sell this rate on the guest booking page
                  </span>
                  , and load rates for the dates you want to sell.
                </p>
                <Link
                  href="/inventory/rates-all"
                  className="mt-3 inline-block rounded-md bg-chrome-800 px-4 py-2 text-[13px] font-medium text-white hover:bg-chrome-900"
                >
                  Go to Inventory
                </Link>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // What the guest is told about the hotel and its rooms (0071, 0072). The
  // hotel set these, so it knows them; the guest is who needs telling.
  const [policies, facilities, content] = await Promise.all([
    getPublicHotelPolicies(propertyId),
    getPublicRoomTypeFacilities(propertyId),
    getPublicRoomTypeContent(propertyId),
  ]);

  return (
    <BookingWidget
      property={property}
      ratePlans={ratePlans}
      locale={locale}
      languages={languages.supportedLocales}
      policies={policies}
      facilities={facilities}
      content={content}
      today={hotelToday(property.timezone)}
      monthNames={monthNames(locale)}
      weekdayNames={weekdayNames(locale)}
    />
  );
}

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

function monthNames(locale: Locale): string[] {
  const f = new Intl.DateTimeFormat(bcp47(locale), { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, m) => capitalise(f.format(new Date(Date.UTC(2024, m, 1)))));
}

/** Sunday first, as the client's current booking engine draws its weeks. */
function weekdayNames(locale: Locale): string[] {
  const f = new Intl.DateTimeFormat(bcp47(locale), { weekday: "short", timeZone: "UTC" });
  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, d) => capitalise(f.format(new Date(Date.UTC(2024, 0, 7 + d)))));
}

/**
 * Today on the hotel's own clock, never the server's: a guest in Mexico at
 * 23:00 is still on today, while a UTC server is already on tomorrow.
 */
function hotelToday(timezone: string): string {
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
