"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui";
import { formatMoneyIn } from "@/lib/money";
import { LOCALES, bcp47, type Locale } from "@/lib/i18n/locales";
import { dictionaryFor } from "@/lib/i18n/dictionary";
import {
  requestPublicBooking,
  searchPublicRooms,
  type PublicProperty,
  type PublicRatePlan,
  type PublicRoomType,
} from "@/lib/actions/public-booking";

const field =
  "w-full rounded-md border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/20";
const label = "mb-1.5 block text-xs font-medium text-ink";
const card = "rounded-lg border border-line bg-white p-5 shadow-card";
const primary =
  "rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

type Stage =
  | { name: "search" }
  | { name: "details"; room: PublicRoomType }
  | { name: "done"; reference: string };

export function BookingWidget({
  property,
  ratePlans,
  locale,
}: {
  property: PublicProperty;
  ratePlans: PublicRatePlan[];
  locale: Locale;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = dictionaryFor(locale);
  const money = useMemo(() => bcp47(locale), [locale]);

  const [ratePlanId, setRatePlanId] = useState(ratePlans[0].ratePlanId);
  const [from, setFrom] = useState(isoDate(1));
  const [to, setTo] = useState(isoDate(3));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);

  const [rooms, setRooms] = useState<PublicRoomType[] | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "search" });
  const [error, setError] = useState("");
  const [searching, startSearch] = useTransition();
  const [sending, setSending] = useState(false);

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  function changeLanguage(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", next);
    router.replace(`?${params.toString()}`);
  }

  function search() {
    setError("");
    setRooms(null);
    if (to <= from) {
      setError(t.pickLaterDeparture);
      return;
    }
    startSearch(async () => {
      const result = await searchPublicRooms({
        propertyId: property.propertyId,
        ratePlanId,
        from,
        to,
      });
      if (!result.ok) {
        setError(result.error ?? t.somethingWentWrong);
        return;
      }
      setRooms(result.data);
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage.name !== "details") return;
    setError("");
    setSending(true);

    const result = await requestPublicBooking({
      propertyId: property.propertyId,
      ratePlanId,
      roomTypeId: stage.room.roomTypeId,
      from,
      to,
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
    setStage({ name: "done", reference: result.data.reference });
  }

  return (
    <main className="min-h-screen bg-shell">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="font-display text-[20px] font-semibold tracking-tightest text-ink">
              {property.name}
            </h1>
            <p className="text-[13px] text-ink-muted">{t.bookARoom}</p>
          </div>
          <div>
            <label htmlFor="lang" className="sr-only">{t.language}</label>
            <select
              id="lang"
              value={locale}
              onChange={(e) => changeLanguage(e.target.value)}
              className="rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink-muted outline-none focus:border-brass focus:ring-2 focus:ring-brass/20"
            >
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-3 px-5 py-6">
        {stage.name === "done" ? (
          <div className={card}>
            <h2 className="font-display text-[18px] font-semibold tracking-tightest text-ink">
              {t.requestReceived}
            </h2>
            <p className="mt-3 text-[13px] text-ink-muted">{t.yourReference}</p>
            <p className="tnum font-display text-[24px] font-semibold tracking-tightest text-brass">
              {stage.reference}
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
              {t.weWillEmail}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              {t.payAtProperty}
            </p>
            <button
              onClick={() => {
                setStage({ name: "search" });
                setRooms(null);
                setFirst(""); setLast(""); setEmail(""); setPhone(""); setNotes("");
              }}
              className={cn(primary, "mt-5")}
            >
              {t.bookAnother}
            </button>
          </div>
        ) : (
          <>
            <div className={card}>
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <label htmlFor="from" className={label}>{t.arrival}</label>
                  <input id="from" type="date" value={from} min={isoDate(0)}
                    onChange={(e) => setFrom(e.target.value)} className={field} />
                </div>
                <div>
                  <label htmlFor="to" className={label}>{t.departure}</label>
                  <input id="to" type="date" value={to} min={from}
                    onChange={(e) => setTo(e.target.value)} className={field} />
                </div>
                <div>
                  <label htmlFor="adults" className={label}>{t.adults}</label>
                  <input id="adults" type="number" min={1} max={12} value={adults}
                    onChange={(e) => setAdults(Number(e.target.value))}
                    className={cn(field, "tnum")} />
                </div>
                <div>
                  <label htmlFor="children" className={label}>{t.children}</label>
                  <input id="children" type="number" min={0} max={12} value={children}
                    onChange={(e) => setChildren(Number(e.target.value))}
                    className={cn(field, "tnum")} />
                </div>
              </div>

              {ratePlans.length > 1 && (
                <div className="mt-4">
                  <label htmlFor="plan" className={label}>{t.availableRooms}</label>
                  <select id="plan" value={ratePlanId}
                    onChange={(e) => setRatePlanId(e.target.value)} className={field}>
                    {ratePlans.map((p) => (
                      <option key={p.ratePlanId} value={p.ratePlanId}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <button onClick={search} disabled={searching} className={cn(primary, "mt-4")}>
                {searching ? t.searching : t.search}
              </button>
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
                {error}
              </p>
            )}

            {stage.name === "search" && rooms !== null && (
              rooms.length === 0 || rooms.every((r) => r.available < 1 || r.unavailableReason) ? (
                <div className={cn(card, "text-center")}>
                  <p className="text-[15px] text-ink">{t.nothingAvailable}</p>
                  <p className="mt-1 text-[13px] text-ink-muted">{t.nothingAvailableHint}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {rooms.map((room) => {
                    const blocked = room.unavailableReason !== null;
                    const soldOut = room.available < 1;
                    const unpriced = room.totalCents === null;
                    const bookable = !blocked && !soldOut && !unpriced;
                    return (
                      <div key={room.roomTypeId} className={cn(card, !bookable && "opacity-70")}>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <h3 className="font-display text-[16px] font-semibold tracking-tightest text-ink">
                              {room.name}
                            </h3>
                            <p className="mt-0.5 text-[13px] text-ink-muted">
                              {t.sleeps} {room.maxOccupancy}
                            </p>
                            {bookable && room.available <= 3 && (
                              <p className="mt-1 text-xs font-medium text-warn-deep">
                                {room.available} {t.roomsLeft}
                              </p>
                            )}
                            {blocked && (
                              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                                {room.unavailableReason}
                              </p>
                            )}
                            {!blocked && soldOut && (
                              <p className="mt-1 text-xs text-ink-muted">{t.soldOut}</p>
                            )}
                            {!blocked && !soldOut && unpriced && (
                              <p className="mt-1 text-xs text-ink-muted">{t.noPriceLoaded}</p>
                            )}
                          </div>
                          <div className="text-right">
                            {room.totalCents !== null && (
                              <>
                                <p className="tnum font-display text-[20px] font-semibold tracking-tightest text-ink">
                                  {formatMoneyIn(room.totalCents, property.currency, money)}
                                </p>
                                <p className="text-xs text-ink-faint">
                                  {t.totalForStay} · {room.nights}{" "}
                                  {room.nights === 1 ? t.night : t.nights}
                                </p>
                              </>
                            )}
                            {bookable && (
                              <button
                                onClick={() => { setError(""); setStage({ name: "details", room }); }}
                                className={cn(primary, "mt-2")}
                              >
                                {t.choose}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {stage.name === "details" && (
              <form onSubmit={submit} className={card}>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-[16px] font-semibold tracking-tightest text-ink">
                    {t.yourDetails}
                  </h2>
                  <button type="button" onClick={() => setStage({ name: "search" })}
                    className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline">
                    {t.back}
                  </button>
                </div>

                <p className="mb-4 rounded-md bg-shell px-3 py-2.5 text-[13px] text-ink">
                  {stage.room.name} ·{" "}
                  {stage.room.totalCents !== null &&
                    formatMoneyIn(stage.room.totalCents, property.currency, money)}
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="first" className={label}>{t.firstName}</label>
                    <input id="first" required autoComplete="given-name" value={first}
                      onChange={(e) => setFirst(e.target.value)} className={field} />
                  </div>
                  <div>
                    <label htmlFor="last" className={label}>{t.lastName}</label>
                    <input id="last" required autoComplete="family-name" value={last}
                      onChange={(e) => setLast(e.target.value)} className={field} />
                  </div>
                  <div>
                    <label htmlFor="email" className={label}>{t.email}</label>
                    <input id="email" type="email" required autoComplete="email" value={email}
                      onChange={(e) => setEmail(e.target.value)} className={field} />
                  </div>
                  <div>
                    <label htmlFor="phone" className={label}>
                      {t.phone}{" "}
                      <span className="font-normal text-ink-faint">({t.phoneOptional})</span>
                    </label>
                    <input id="phone" type="tel" autoComplete="tel" value={phone}
                      onChange={(e) => setPhone(e.target.value)} className={field} />
                  </div>
                </div>

                <div className="mt-4">
                  <label htmlFor="notes" className={label}>{t.requests}</label>
                  <textarea id="notes" rows={3} value={notes}
                    onChange={(e) => setNotes(e.target.value)} className={field} />
                  <p className="mt-1 text-xs text-ink-faint">{t.requestsHint}</p>
                </div>

                <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
                  {t.payAtProperty}
                </p>

                <button type="submit" disabled={sending} className={cn(primary, "mt-4")}>
                  {sending ? t.sending : t.confirmBooking}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
