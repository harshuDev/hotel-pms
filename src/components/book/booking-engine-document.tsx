import { notFound } from "next/navigation";
import Link from "next/link";
import { PlainDocument } from "@/components/book/plain-document";
import { getPublicBookingEngine, getPublicLanguageSettings, getPublicProperty } from "@/lib/actions/public-booking";
import { DEFAULT_PRIVACY_POLICY, fillPlaceholders } from "@/lib/booking-engine";
import { countryName } from "@/lib/countries";
import { isLocale, type Locale } from "@/lib/i18n/locales";
import { dictionaryFor } from "@/lib/i18n/dictionary";

/**
 * The guest-facing privacy policy or terms of a property (0098), linked from
 * the booking page's agreement. The hotel's words are shown as written, like
 * its cancellation wording; only the heading around them is translated.
 */
export async function BookingEngineDocument({
  propertyId,
  lang,
  which,
}: {
  propertyId: string;
  lang: string | undefined;
  which: "privacy" | "terms";
}) {
  const property = await getPublicProperty(propertyId);
  if (!property) notFound();
  const [engine, languages] = await Promise.all([
    getPublicBookingEngine(propertyId, null),
    getPublicLanguageSettings(propertyId),
  ]);
  const locale: Locale =
    isLocale(lang) && languages.supportedLocales.includes(lang) ? lang : languages.defaultLocale;
  const t = dictionaryFor(locale);

  const raw = which === "privacy" ? (engine.privacyPolicy ?? DEFAULT_PRIVACY_POLICY) : engine.terms;
  if (raw === null) notFound();
  const text = fillPlaceholders(raw, {
    hotel_name: property.name,
    hotel_address: engine.address ?? "",
    hotel_city: engine.city ?? "",
    hotel_state: engine.region ?? "",
    hotel_postal_code: engine.postcode ?? "",
    hotel_country: engine.country ? countryName(engine.country) : "",
    hotel_email: engine.email ?? "",
    hotel_phone: engine.phone ?? "",
  });

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <Link
            href={`/book/${propertyId}?lang=${locale}`}
            className="flex min-h-[3.25rem] items-center bg-chrome-900 px-4 font-display text-[15px] font-semibold uppercase tracking-[0.12em] text-white"
          >
            {property.name}
          </Link>
          <h1 className="text-[18px] text-ink">
            {which === "privacy" ? t.privacyPolicy : t.termsAndConditions}
          </h1>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <PlainDocument text={text} />
      </div>
    </main>
  );
}
