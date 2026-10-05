import { headers } from "next/headers";
import { dictionaryFor } from "@/lib/i18n/dictionary";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/locales";

/**
 * Where Stripe sends a guest after they pay a payment request (0130).
 *
 * Public, because the whole of `/book/` is, and a static segment, so it wins
 * over `/book/[propertyId]`. It reads nothing and records nothing: the
 * payment is recorded when staff open the booking's Payment tab, which asks
 * Stripe itself -- a page a guest can reach by typing its address must never
 * be what says money arrived.
 *
 * The guest's own language from their browser, the booking page's dictionary.
 */
async function guestLocale(): Promise<Locale> {
  const accept = (await headers()).get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const code = part.split(";")[0].trim().toLowerCase();
    const base = code.split("-")[0];
    if (isLocale(code)) return code;
    if (base === "nb" || base === "nn") return "no";
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export async function generateMetadata() {
  return { title: dictionaryFor(await guestLocale()).paymentReceived };
}

export default async function PaidPage() {
  const t = dictionaryFor(await guestLocale());
  return (
    <main className="grid min-h-screen place-items-center bg-shell px-4">
      <div className="mx-auto w-full max-w-md rounded-lg border border-line bg-white px-8 py-14 text-center shadow-card">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-700" aria-hidden="true">
          <svg viewBox="0 0 20 20" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4.5 10.5l3.5 3.5 7.5-8" />
          </svg>
        </span>
        <h1 className="mt-5 font-display text-[24px] font-semibold tracking-tightest text-ink">{t.paymentReceived}</h1>
        <p className="mt-2 text-[14px] text-ink-muted">{t.paymentReceivedHint}</p>
      </div>
    </main>
  );
}
