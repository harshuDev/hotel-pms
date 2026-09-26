"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui";
import { formatMoneyIn } from "@/lib/money";
import { CURRENCIES } from "@/lib/currencies";
import { LOCALES, bcp47, type Locale } from "@/lib/i18n/locales";
import { dictionaryFor, type Dict } from "@/lib/i18n/dictionary";
import { FacilityIcon } from "@/components/settings/facility-icon";
import type { HotelPolicies, HotelPolicyKey } from "@/lib/hotel-policies";
import {
  requestPublicBooking,
  searchPublicStay,
  type PublicFacility,
  type PublicProperty,
  type PublicRatePlan,
  type PublicRoomContent,
  type PublicStayRoom,
} from "@/lib/actions/public-booking";

/*
 * THE GUEST BOOKING PAGE, cloned from the client's current booking engine
 * (0072): a numbered stepper across the top and one job per step --
 *
 *   1. Select dates  -- three months of calendar, click arrival then departure
 *   2. Select room   -- a card per room type, photographs, "From <price>"
 *   3. Select rate   -- the room's description and facilities, then each
 *                       published rate plan with its total and its terms
 *   4. Your details  -- the form, with the booking policy, the hotel policy
 *                       and a summary beside it, and an agreement tickbox
 *
 * Their engine has five steps; the one not built is Extras, because a guest
 * cannot buy an extra online here -- create_public_booking() takes a room and
 * nothing else. Nor is the card form: there is no card capture in this
 * system, so the page says the stay is paid at the hotel instead of drawing a
 * card button that does nothing.
 *
 * No date is formatted in the browser. Month and weekday names and today's
 * date arrive from the server, because Node's ICU and the browser's disagree
 * about names like "Sep"/"Sept" and a client component renders in both.
 */

const card = "rounded-lg border border-line bg-white shadow-card";
const field =
  "w-full border-0 border-b border-line bg-transparent px-0 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brass focus:ring-0";
const blue =
  "rounded-md bg-brass px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

/* -- Dates, as plain ISO strings: no Date objects cross a render. ---------- */

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function iso(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function parts(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m: m - 1, d };
}
function daysIn(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}
function weekdayOf(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d)).getUTCDay(); // 0 = Sunday
}
function nightsBetween(a: string, b: string) {
  const x = parts(a);
  const y = parts(b);
  return Math.round((Date.UTC(y.y, y.m, y.d) - Date.UTC(x.y, x.m, x.d)) / 86_400_000);
}
function addMonths(y: number, m: number, n: number) {
  const t = y * 12 + m + n;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

/* -- Policies ------------------------------------------------------------ */

const POLICY_OPTION: Record<string, keyof Dict> = {
  all_ages: "pAllAges",
  no_children_or_infants: "pNoChildren",
  no_infants: "pNoInfants",
  no_pets: "pNoPets",
  pets_surcharge: "pPetsSurcharge",
  no_smoking: "pNoSmoking",
  permitted_areas: "pSmokingAreas",
  free_wifi_all: "pWifiAll",
  free_wifi_most: "pWifiMost",
  free_on_site: "pParkingFree",
  limited_on_site: "pParkingLimited",
};

/**
 * The hotel's policies as sentences, in the guest's language where they are
 * ours and as written where they are the hotel's. Omitted sections are left
 * out; an option this page has no words for is left out, never guessed at.
 */
function policySentences(p: HotelPolicies | null, t: Dict): string[] {
  if (!p) return [];
  const keys: HotelPolicyKey[] = ["children", "pets", "smoking", "internet", "parking"];
  const out: string[] = [];
  for (const key of keys) {
    const choice = p[key];
    if (choice === "omit") continue;
    const option = POLICY_OPTION[choice];
    const text = choice === "custom" ? p[`${key}Custom`]?.trim() : option ? t[option] : null;
    if (text) out.push(text);
  }
  const other = p.otherPolicies?.trim();
  if (other) out.push(other);
  return out.map((x) => (/[.!?]$/.test(x) ? x : `${x}.`));
}

type Step = 1 | 2 | 3 | 4 | "done";

export function BookingWidget({
  property,
  ratePlans,
  locale,
  policies,
  facilities,
  content,
  today,
  monthNames,
  weekdayNames,
}: {
  property: PublicProperty;
  ratePlans: PublicRatePlan[];
  locale: Locale;
  /** Null when the hotel has never saved its policies (0071). */
  policies: HotelPolicies | null;
  /** Each room type's facilities, keyed by room type (0071). */
  facilities: Record<string, PublicFacility[]>;
  /** Each room type's description and photographs (0072). */
  content: Record<string, PublicRoomContent>;
  /** The hotel's today, YYYY-MM-DD, worked out on the server in its zone. */
  today: string;
  /** Twelve month names and seven weekday names (Sunday first), from the server. */
  monthNames: string[];
  weekdayNames: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = dictionaryFor(locale);
  const moneyLocale = useMemo(() => bcp47(locale), [locale]);
  const money = (cents: number) => formatMoneyIn(cents, property.currency, moneyLocale);
  // The reference's "$ (MXN)". From a static list rather than Intl, which
  // writes symbols differently in Node and the browser.
  const symbol = CURRENCIES.find((c) => c.code === property.currency)?.symbol ?? property.currency;

  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState("");

  // Step 1
  const start = parts(today);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;

  // Steps 2 and 3
  const [rooms, setRooms] = useState<PublicStayRoom[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [ratePlanId, setRatePlanId] = useState<string | null>(null);
  const room = rooms?.find((r) => r.roomTypeId === roomId) ?? null;
  const plan = ratePlans.find((p) => p.ratePlanId === ratePlanId) ?? null;
  const offer = room?.offers.find((o) => o.ratePlanId === ratePlanId) ?? null;

  // Step 4
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState("");

  const dateLabel = (s: string) => {
    const x = parts(s);
    return `${x.d} ${monthNames[x.m]} ${x.y}`;
  };
  const stayLabel =
    checkIn && checkOut
      ? `${dateLabel(checkIn)} — ${dateLabel(checkOut)} (${nights} ${nights === 1 ? t.night : t.nights})`
      : "";

  function changeLanguage(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", next);
    router.replace(`?${params.toString()}`);
  }

  function pickDay(day: string) {
    setError("");
    if (!checkIn || checkOut) {
      setCheckIn(day);
      setCheckOut(null);
    } else if (day > checkIn) {
      setCheckOut(day);
    } else {
      setCheckIn(day);
    }
  }

  function showRooms() {
    setError("");
    if (!checkIn || !checkOut) {
      setError(t.pickLaterDeparture);
      return;
    }
    const from = checkIn;
    const to = checkOut;
    startSearch(async () => {
      const result = await searchPublicStay({ propertyId: property.propertyId, from, to });
      if (!result.ok) {
        setError(result.error ?? t.somethingWentWrong);
        return;
      }
      setRooms(result.data);
      setRoomId(null);
      setRatePlanId(null);
      setStep(2);
    });
  }

  /** The cheapest plan this room can actually be sold on, for "From". */
  function lowest(r: PublicStayRoom): number | null {
    if (r.available < 1) return null;
    const prices = r.offers
      .filter((o) => o.totalCents !== null && o.unavailableReason === null)
      .map((o) => o.totalCents as number);
    return prices.length ? Math.min(...prices) : null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!room || !plan || !checkIn || !checkOut) return;
    if (!agreed) {
      setError(t.mustAgree);
      return;
    }
    setError("");
    setSending(true);
    const result = await requestPublicBooking({
      propertyId: property.propertyId,
      ratePlanId: plan.ratePlanId,
      roomTypeId: room.roomTypeId,
      from: checkIn,
      to: checkOut,
      firstName: first,
      lastName: last,
      email,
      phone,
      adults,
      children,
      notes,
    });
    setSending(false);
    if (!result.ok) {
      setError(result.error ?? t.somethingWentWrong);
      return;
    }
    setReference(result.data.reference);
    setStep("done");
  }

  function reset() {
    setStep(1);
    setCheckIn(null);
    setCheckOut(null);
    setRooms(null);
    setRoomId(null);
    setRatePlanId(null);
    setAgreed(false);
    setError("");
  }

  const STEPS: { n: 1 | 2 | 3 | 4; label: string }[] = [
    { n: 1, label: t.stepDates },
    { n: 2, label: t.stepRoom },
    { n: 3, label: t.stepRate },
    { n: 4, label: t.yourDetails },
  ];
  const current = step === "done" ? 5 : step;
  const sentences = policySentences(policies, t);

  return (
    <main className="min-h-screen bg-white">
      {/* Header: name, stepper, currency, language ------------------------ */}
      <header className="sticky top-0 z-20 border-b border-line bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <div className="flex min-h-[3.25rem] min-w-[10rem] items-center bg-chrome-900 px-4 font-display text-[15px] font-semibold uppercase tracking-[0.12em] text-white">
            {property.name}
          </div>
          {/* A row of its own on a phone, beside the name from a tablet up. */}
          <ol className="order-last flex basis-full items-center gap-2 sm:order-none sm:flex-1 sm:basis-auto">
            {STEPS.map((s, i) => {
              const done = current > s.n;
              const active = current === s.n;
              return (
                <li key={s.n} className="flex items-center gap-2">
                  {i > 0 && <span className="h-px w-5 bg-line" aria-hidden="true" />}
                  {done && step !== "done" ? (
                    <button
                      type="button"
                      onClick={() => setStep(s.n)}
                      aria-label={s.label}
                      className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-[11px] font-semibold text-white hover:bg-emerald-600"
                    >
                      {s.n}
                    </button>
                  ) : (
                    <span
                      aria-current={active ? "step" : undefined}
                      className="flex items-center gap-2"
                    >
                      <span
                        className={cn(
                          "grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold text-white",
                          done ? "bg-emerald-500" : active ? "bg-brass" : "bg-slate-300",
                        )}
                      >
                        {active ? (
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor"
                            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 20h4L19 9l-4-4L4 16z" />
                          </svg>
                        ) : (
                          s.n
                        )}
                      </span>
                      {active && (
                        // The page heading names the step too, so a phone keeps
                        // the circles and loses the words rather than clipping them.
                        <span className="hidden whitespace-nowrap text-[15px] text-ink sm:inline">{s.label}</span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex items-center gap-5 text-[13px] text-ink-muted">
            <span>
              {symbol} ({property.currency})
            </span>
            <label htmlFor="lang" className="sr-only">{t.language}</label>
            <select
              id="lang"
              value={locale}
              onChange={(e) => changeLanguage(e.target.value)}
              className="border-0 bg-transparent py-1 text-[13px] text-ink-muted outline-none focus:ring-2 focus:ring-brass/30"
            >
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pb-16">
        <p className="mt-5 text-center text-[17px] uppercase tracking-wide text-ink-muted">
          {property.name}
        </p>

        {step === "done" ? (
          <div className={cn(card, "mx-auto mt-8 max-w-lg p-8 text-center")}>
            <h1 className="font-display text-[22px] font-semibold tracking-tightest text-ink">
              {t.requestReceived}
            </h1>
            <p className="mt-3 text-[13px] text-ink-muted">{t.yourReference}</p>
            <p className="tnum mt-1 font-display text-[26px] font-semibold tracking-tightest text-ink">
              {reference}
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">{t.weWillEmail}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{t.payAtProperty}</p>
            <button type="button" onClick={reset} className={cn(blue, "mt-6")}>
              {t.bookAnother}
            </button>
          </div>
        ) : (
          <>
            <h1 className="mt-3 text-[30px] font-light text-ink sm:text-[32px]">
              {current}. {STEPS[(current as number) - 1].label}
            </h1>
            {step !== 1 && stayLabel && (
              <p className="mt-1 text-[14px] text-ink-faint">{stayLabel}</p>
            )}

            {error && (
              <p role="alert" className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
                {error}
              </p>
            )}

            {/* 1. Dates ------------------------------------------------ */}
            {step === 1 && (
              <>
                <div className="mt-5 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {[0, 1, 2].map((offset) => {
                    const { y, m } = addMonths(view.y, view.m, offset);
                    const lead = weekdayOf(y, m, 1);
                    const count = daysIn(y, m);
                    const canGoBack = view.y * 12 + view.m > start.y * 12 + start.m;
                    return (
                      <div
                        key={`${y}-${m}`}
                        className={cn(
                          card,
                          "p-4",
                          offset === 1 && "hidden md:block",
                          offset === 2 && "hidden lg:block",
                        )}
                      >
                        <div className="relative mb-4 mt-2 flex items-center justify-center">
                          {offset === 0 && canGoBack && (
                            <button
                              type="button"
                              aria-label={t.prevMonth}
                              onClick={() => setView(addMonths(view.y, view.m, -1))}
                              className="absolute left-1 rounded p-1 text-brass hover:bg-shell"
                            >
                              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor"
                                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M19 12H5M11 6l-6 6 6 6" />
                              </svg>
                            </button>
                          )}
                          <h2 className="text-[18px] text-ink">
                            {monthNames[m]} {y}
                          </h2>
                          <button
                            type="button"
                            aria-label={t.nextMonth}
                            onClick={() => setView(addMonths(view.y, view.m, 1))}
                            className={cn(
                              "absolute right-1 rounded p-1 text-brass hover:bg-shell",
                              offset === 0 && "md:hidden",
                              offset === 1 && "hidden md:block lg:hidden",
                              offset === 2 && "hidden lg:block",
                            )}
                          >
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor"
                              strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M5 12h14M13 6l6 6-6 6" />
                            </svg>
                          </button>
                        </div>
                        <div className="grid grid-cols-7 border-b border-line pb-2 text-center text-[12px] text-ink-muted">
                          {weekdayNames.map((w) => (
                            <span key={w}>{w}</span>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-7">
                          {Array.from({ length: lead }, (_, i) => (
                            <span key={`lead-${i}`} />
                          ))}
                          {Array.from({ length: count }, (_, i) => {
                            const day = iso(y, m, i + 1);
                            const past = day < today;
                            const isEdge = day === checkIn || day === checkOut;
                            const inside =
                              checkIn !== null && checkOut !== null && day > checkIn && day < checkOut;
                            return (
                              <button
                                key={day}
                                type="button"
                                disabled={past}
                                onClick={() => pickDay(day)}
                                aria-pressed={isEdge || inside}
                                aria-label={dateLabel(day)}
                                className={cn(
                                  "tnum -ml-px -mt-px h-11 border border-line text-[14px] transition focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass",
                                  past && "cursor-not-allowed bg-shell text-ink-faint",
                                  !past && !isEdge && !inside && "bg-white text-emerald-600 hover:bg-emerald-50",
                                  inside && "bg-brass/15 text-brass",
                                  isEdge && "bg-brass font-semibold text-white",
                                )}
                              >
                                {i + 1}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-8 grid items-center gap-4 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => {
                      setCheckIn(null);
                      setCheckOut(null);
                      setError("");
                    }}
                    className="rounded-md border border-line px-5 py-3 text-sm text-ink-muted hover:bg-shell"
                  >
                    {t.resetCalendar}
                  </button>
                  <p className="text-center text-[13px] text-ink">
                    {nights > 0 ? `${nights} ${nights === 1 ? t.night : t.nights}` : ""}
                  </p>
                  <button type="button" onClick={showRooms} disabled={searching} className={blue}>
                    {searching ? t.searching : t.search}
                  </button>
                </div>
              </>
            )}

            {/* 2. Room ------------------------------------------------- */}
            {step === 2 && rooms && (
              rooms.length === 0 || rooms.every((r) => lowest(r) === null) ? (
                <div className={cn(card, "mt-6 p-8 text-center")}>
                  <p className="text-[15px] text-ink">{t.nothingAvailable}</p>
                  <p className="mt-1 text-[13px] text-ink-muted">{t.nothingAvailableHint}</p>
                  <button type="button" onClick={() => setStep(1)} className={cn(blue, "mt-5")}>
                    {t.back}
                  </button>
                </div>
              ) : (
                <div className="mt-5 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {rooms.map((r) => {
                    const from = lowest(r);
                    const bookable = from !== null;
                    return (
                      <div key={r.roomTypeId} className={cn(card, "overflow-hidden", !bookable && "opacity-60")}>
                        <PhotoCarousel
                          photos={content[r.roomTypeId]?.photos ?? []}
                          alt={r.name}
                          badge={
                            from !== null
                              ? `${t.priceFrom} ${money(from)}`
                              : r.available < 1
                                ? t.soldOut
                                : t.noPriceLoaded
                          }
                        />
                        {bookable ? (
                          <button
                            type="button"
                            onClick={() => {
                              setRoomId(r.roomTypeId);
                              setRatePlanId(null);
                              setAdults(Math.min(2, r.maxOccupancy));
                              setChildren(0);
                              setStep(3);
                            }}
                            className="block w-full px-4 py-4 text-left hover:bg-shell/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                          >
                            <RoomCardText r={r} t={t} />
                          </button>
                        ) : (
                          <div className="px-4 py-4">
                            <RoomCardText r={r} t={t} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* 3. Rate ------------------------------------------------- */}
            {step === 3 && room && (
              <>
                <div
                  className="relative mt-5 overflow-hidden rounded-lg bg-chrome-900 bg-cover bg-center px-4 py-10 sm:py-16"
                  style={
                    content[room.roomTypeId]?.photos[0]
                      ? { backgroundImage: `url(${JSON.stringify(content[room.roomTypeId].photos[0])})` }
                      : undefined
                  }
                >
                  <div className="mx-auto max-w-2xl overflow-hidden rounded bg-white shadow-card">
                    <div className="px-6 pb-6 pt-8 text-center sm:px-10">
                      <h2 className="text-[30px] font-light text-ink">{room.name}</h2>
                      <p className="mt-2 text-[14px] text-ink-faint">{stayLabel}</p>
                      {content[room.roomTypeId]?.description && (
                        <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-ink">
                          {content[room.roomTypeId].description}
                        </p>
                      )}
                      {(facilities[room.roomTypeId]?.length ?? 0) > 0 && (
                        <ul className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-3">
                          {facilities[room.roomTypeId].map((f) => (
                            <li
                              key={f.title}
                              className="flex flex-col items-center gap-1 text-[12.5px] text-brass"
                            >
                              <FacilityIcon name={f.icon} className="h-5 w-5" />
                              {f.title}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {(content[room.roomTypeId]?.photos.length ?? 0) > 1 && (
                      <div className="grid grid-cols-3">
                        {content[room.roomTypeId].photos.slice(0, 3).map((src) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={src} src={src} alt={room.name} className="h-28 w-full object-cover sm:h-32" />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mx-auto mt-6 max-w-3xl space-y-3">
                  {room.offers.map((o) => {
                    const p = ratePlans.find((x) => x.ratePlanId === o.ratePlanId);
                    if (!p) return null;
                    const sellable = o.totalCents !== null && o.unavailableReason === null && room.available > 0;
                    return (
                      <div
                        key={o.ratePlanId}
                        className={cn(card, "flex flex-wrap items-center justify-between gap-4 p-5", !sellable && "opacity-60")}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[17px] text-ink">{p.name}</p>
                          {p.description && (
                            <p className="mt-1 text-[13px] text-ink-muted">{p.description}</p>
                          )}
                          {p.cancellationKind && (
                            <p
                              className={cn(
                                "mt-2 text-[12.5px]",
                                p.cancellationKind === "non_refundable" ? "text-warn-deep" : "text-emerald-700",
                              )}
                            >
                              {p.cancellationKind === "non_refundable" ? t.nonRefundable : t.cancellation}
                              {p.cancellationName ? ` · ${p.cancellationName}` : ""}
                            </p>
                          )}
                          {!sellable && (
                            <p className="mt-1 text-[12.5px] text-ink-muted">
                              {o.unavailableReason ?? (o.totalCents === null ? t.noPriceLoaded : t.soldOut)}
                            </p>
                          )}
                        </div>
                        {sellable && (
                          <div className="text-right">
                            <p className="tnum text-[20px] font-medium text-ink">{money(o.totalCents as number)}</p>
                            <p className="text-[12px] text-ink-faint">
                              {t.totalForStay} · {room.nights} {room.nights === 1 ? t.night : t.nights}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setRatePlanId(o.ratePlanId);
                                setAgreed(false);
                                setError("");
                                setStep(4);
                              }}
                              className={cn(blue, "mt-2 py-2")}
                            >
                              {t.choose}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* 4. Details ---------------------------------------------- */}
            {step === 4 && room && plan && offer && offer.totalCents !== null && (
              <div className="mx-auto mt-6 grid max-w-5xl gap-6 lg:grid-cols-[1fr_20rem]">
                <form onSubmit={submit} className="space-y-4">
                  <div className={cn(card, "p-6")}>
                    <h2 className="text-[15px] font-medium text-ink">{t.yourDetails}</h2>
                    <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                      <input aria-label={t.firstName} placeholder={t.firstName} required value={first}
                        onChange={(e) => setFirst(e.target.value)} className={field} />
                      <input aria-label={t.lastName} placeholder={t.lastName} required value={last}
                        onChange={(e) => setLast(e.target.value)} className={field} />
                      <input aria-label={t.email} placeholder={t.email} type="email" required value={email}
                        onChange={(e) => setEmail(e.target.value)} className={field} />
                      <input aria-label={t.phone} placeholder={`${t.phone} (${t.phoneOptional})`} type="tel" value={phone}
                        onChange={(e) => setPhone(e.target.value)} className={field} />
                      <label className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm text-ink-muted">
                        {t.adults}
                        <input type="number" min={1} max={room.maxOccupancy} value={adults}
                          onChange={(e) => {
                            const next = Math.max(1, Math.min(room.maxOccupancy, Number(e.target.value) || 1));
                            setAdults(next);
                            setChildren(Math.min(children, room.maxOccupancy - next));
                          }}
                          className="tnum w-16 border-0 bg-transparent text-right text-ink outline-none" />
                      </label>
                      <label className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm text-ink-muted">
                        {t.children}
                        <input type="number" min={0} max={Math.max(0, room.maxOccupancy - adults)} value={children}
                          onChange={(e) => setChildren(Math.max(0, Math.min(room.maxOccupancy - adults, Number(e.target.value) || 0)))}
                          className="tnum w-16 border-0 bg-transparent text-right text-ink outline-none" />
                      </label>
                    </div>
                    <textarea aria-label={t.requests} placeholder={t.requests} rows={2} value={notes}
                      onChange={(e) => setNotes(e.target.value)} className={cn(field, "mt-2")} />
                    <p className="mt-4 text-[13px] text-ink-muted">{t.payAtProperty}</p>
                  </div>

                  <label className="flex items-start gap-2 text-[13px] text-ink">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-brass" />
                    {t.agreePolicies}
                  </label>
                  <button type="submit" disabled={sending}
                    className="w-full rounded-md bg-emerald-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50">
                    {sending ? t.sending : t.agreeAndBook}
                  </button>
                </form>

                <aside className="space-y-4 text-[13px]">
                  {plan.cancellationKind && (
                    <section>
                      <h3 className="text-[14px] text-ink-muted">{t.bookingPolicy}</h3>
                      <p className="mt-1 font-medium text-ink">
                        {plan.cancellationKind === "non_refundable" ? t.nonRefundable : t.cancellation}
                        {plan.cancellationName ? ` (${plan.cancellationName})` : ""}
                      </p>
                      {plan.cancellationDescription && (
                        <p className="mt-1 leading-relaxed text-ink-muted">{plan.cancellationDescription}</p>
                      )}
                    </section>
                  )}
                  {sentences.length > 0 && (
                    <section>
                      <h3 className="text-[14px] text-ink-muted">{t.policies}</h3>
                      <p className="mt-1 leading-relaxed text-ink-muted">{sentences.join(" ")}</p>
                    </section>
                  )}
                  <section className={cn(card, "overflow-hidden")}>
                    <div className="p-4">
                      <h3 className="text-[14px] text-ink">{t.bookingSummary}</h3>
                      <div className="mt-3 flex justify-between gap-3">
                        <span className="font-medium text-ink">{room.name}</span>
                        <span className="tnum font-medium text-ink">{money(offer.totalCents)}</span>
                      </div>
                      <p className="mt-1 text-ink-muted">
                        {nights} {nights === 1 ? t.night : t.nights} · {t.adults}: {adults}
                        {children > 0 ? ` · ${t.children}: ${children}` : ""}
                      </p>
                      {checkIn && checkOut && (
                        <p className="text-ink-faint">
                          {dateLabel(checkIn)} — {dateLabel(checkOut)}
                        </p>
                      )}
                      <p className="mt-1 text-warn-deep">{plan.name}</p>
                    </div>
                    <div className="flex items-baseline justify-between bg-shell px-4 py-3">
                      <span className="text-[15px] text-ink">{t.total}:</span>
                      <span className="tnum text-[18px] font-semibold text-ink">{money(offer.totalCents)}</span>
                    </div>
                  </section>
                </aside>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function RoomCardText({ r, t }: { r: PublicStayRoom; t: Dict }) {
  return (
    <>
      <span className="block text-[18px] text-ink">{r.name}</span>
      <span className="mt-1 flex justify-between gap-3 text-[13px] text-ink-muted">
        <span>
          {t.maxOccupancy}: {r.maxOccupancy}
        </span>
        <span>
          {t.availableLabel}: {r.available}
        </span>
      </span>
    </>
  );
}

/*
 * The room card's photographs, with the reference's round arrows. With none,
 * a plain tint in the app's own dark blue rather than a broken image.
 */
function PhotoCarousel({
  photos,
  alt,
  badge,
}: {
  photos: string[];
  alt: string;
  badge: string;
}) {
  const [i, setI] = useState(0);
  const src = photos.length ? photos[i % photos.length] : null;
  return (
    <div className="relative h-56 bg-chrome-800">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      )}
      {photos.length > 1 && (
        <>
          <button
            type="button"
            // Language-neutral: "Suite 2/5" reads the same in all nineteen.
            aria-label={`${alt} ${((i - 1 + photos.length) % photos.length) + 1}/${photos.length}`}
            onClick={() => setI((i - 1 + photos.length) % photos.length)}
            className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/30 text-2xl leading-none text-white hover:bg-black/50"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={`${alt} ${((i + 1) % photos.length) + 1}/${photos.length}`}
            onClick={() => setI((i + 1) % photos.length)}
            className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/30 text-2xl leading-none text-white hover:bg-black/50"
          >
            ›
          </button>
        </>
      )}
      <span className="absolute bottom-4 right-0 bg-brass px-4 py-2 text-[14px] text-white">
        {badge}
      </span>
    </div>
  );
}
