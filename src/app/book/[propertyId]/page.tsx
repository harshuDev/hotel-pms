import { notFound } from "next/navigation";
import Link from "next/link";
import { BookingWidget } from "@/components/book/booking-widget";
import {
  getPublicProperty,
  getPublicRatePlans,
} from "@/lib/actions/public-booking";
import { getCurrentStaffUser } from "@/lib/queries";
import { LOCALES, DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
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
  const locale = isLocale(lang) ? lang : DEFAULT_LOCALE;

  const property = await getPublicProperty(propertyId);
  if (!property) notFound();

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
            <form>
              <label htmlFor="lang" className="sr-only">{t.language}</label>
              <select
                id="lang"
                name="lang"
                defaultValue={locale}
                className="rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink-muted outline-none focus:border-brass focus:ring-2 focus:ring-brass/20"
              >
                {LOCALES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <noscript>
                <button type="submit" className="ml-2 text-[13px] underline">
                  OK
                </button>
              </noscript>
            </form>
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

  return (
    <BookingWidget
      property={property}
      ratePlans={ratePlans}
      locale={locale}
    />
  );
}
