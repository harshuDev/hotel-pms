"use client";

import { useT } from "@/components/i18n";
import { Fragment, createContext, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatEquivalent, formatMoney, formatMoneyInput, parseMoney } from "@/lib/money";
import type { DisplayCurrency } from "@/lib/finance-profiles";
import { applyOccupancyRates, applyRates } from "@/lib/actions/inventory";
import type { OccupancyGridCell, RatePlan, RatesGridCell, RoomTypeOccupancy } from "@/lib/types";
import { useCurrency } from "@/components/currency";

/**
 * Rates: every rate plan, under every room type, priced PER NIGHT.
 *
 * THE PRICE OF ONE DAY IS TYPED INTO ITS CELL (0110). The client: "Hotels
 * have to be able to change the rates per day", "it is very important to
 * have the rates PER DAY" -- a channel receives a price per night, not a
 * year's template. Until 0110 every cell here was read-only and the only way
 * to change a night was the bulk panel below. Now a cell saves on Enter or
 * when focus leaves it; the bulk panel stays for ranges.
 *
 * A plan that prices by occupancy draws a row per number of adults under
 * its standard row (which is the room type's base occupancy). An empty
 * occupancy cell shows, faint, what that party pays anyway -- the standard
 * price, or the automatic calculation -- and typing sets that night's own
 * price for them.
 *
 * WHY THIS IS NOT A TENTH COPY OF THE INVENTORY GRID. The rule against that
 * covers the nine screens that are each one field across room types. This is
 * one field across plan and type.
 *
 * A BLANK STANDARD CELL IS "NOT LOADED", NOT FREE. `create_booking()`
 * refuses a stay against a night with no rate, so clearing a price is how a
 * plan is taken off sale on a room type for that night.
 */

/** Monday first; the letters come from `tr.weekday(day, "narrow")`. */
const DOW = [1, 2, 3, 4, 5, 6, 0].map((value) => ({ value }));

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const nav =
  "rounded-md border border-line bg-white px-3 py-1.5 text-[12.5px] text-ink hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";

/** A selection is a (room type, rate plan) pair, so it needs a composite key. */
/** Settings -> Currencies: each typed price is also shown in these, on hover. */
const ShowIn = createContext<DisplayCurrency[]>([]);

function equivalents(text: string, list: DisplayCurrency[]): string | undefined {
  if (list.length === 0 || text.trim() === "") return undefined;
  try {
    const cents = parseMoney(text);
    if (cents < 0) return undefined;
    return list.map((d) => formatEquivalent(cents, d.currency, d.rateMicros)).join(" · ");
  } catch {
    return undefined;
  }
}

const pairKey = (roomTypeId: string, ratePlanId: string) =>
  `${roomTypeId}|${ratePlanId}`;

type Save = (text: string) => void;

/**
 * One night's price. Local text while typing; saved when it changes and the
 * cell is left. Keyed by the server's value, so a refresh reseeds it.
 */
function PriceCell({
  initial,
  placeholder,
  ariaLabel,
  onSave,
  faintEmpty,
}: {
  initial: string;
  placeholder: string;
  ariaLabel: string;
  onSave: Save;
  faintEmpty?: boolean;
}) {
  const [text, setText] = useState(initial);
  const showIn = useContext(ShowIn);
  const commit = () => {
    if (text.trim() !== initial.trim()) onSave(text);
  };
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={equivalents(text, showIn)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(initial);
      }}
      className={cn(
        "tnum w-[62px] rounded border px-1 py-1 text-center text-[12.5px] outline-none focus:border-brass focus:ring-1 focus:ring-brass",
        text.trim() === "" && !faintEmpty
          ? "border-rose-200 bg-rose-50/60 text-ink placeholder:text-ink-faint"
          : "border-line bg-white text-ink placeholder:text-ink-faint",
      )}
    />
  );
}

export function RatesScreen({
  cells,
  occupancy,
  plans,
  roomTypes,
  dates,
  from,
  businessDate,
  basePath,
  plan = null,
  derivedFrom,
  showIn = [],
  canEdit,
}: {
  cells: RatesGridCell[];
  /** Per-occupancy prices set on nights in this window (0110). */
  occupancy: OccupancyGridCell[];
  plans: RatePlan[];
  roomTypes: RoomTypeOccupancy[];
  dates: string[];
  from: string;
  businessDate: string;
  /** Where the date controls link: Rates (All) or Rates (Main). */
  basePath: string;
  /** The one plan Rates (All) is narrowed to by ?plan=, kept on every link. */
  plan?: string | null;
  /**
   * A derived plan's id to its parent's name (0109). Its price follows the
   * parent and set_rates() refuses it, so it is shown and never edited.
   */
  derivedFrom: Record<string, string>;
  /** Other currencies a price is also shown in (display only). */
  showIn?: DisplayCurrency[];
  canEdit: boolean;
}) {
  const tr = useT();
  const currency = useCurrency();
  const router = useRouter();
  const planQuery = plan ? `&plan=${plan}` : "";
  const [selected, setSelected] = useState<string[]>([]);
  const [editFrom, setEditFrom] = useState(from);
  const [editTo, setEditTo] = useState(dates[dates.length - 1] ?? from);
  const [dow, setDow] = useState<number[]>([]);
  const [value, setValue] = useState("");
  const [adults, setAdults] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const typeById = useMemo(() => new Map(roomTypes.map((t) => [t.id, t])), [roomTypes]);

  // Room types in the order Postgres returned them, each carrying its plans.
  const groups = useMemo(() => {
    const types = new Map<
      string,
      {
        roomTypeId: string;
        roomTypeCode: string;
        roomTypeName: string;
        plans: Map<
          string,
          { ratePlanId: string; ratePlanCode: string; ratePlanName: string; isDefault: boolean }
        >;
      }
    >();
    for (const c of cells) {
      let t = types.get(c.roomTypeId);
      if (!t) {
        t = {
          roomTypeId: c.roomTypeId,
          roomTypeCode: c.roomTypeCode,
          roomTypeName: c.roomTypeName,
          plans: new Map(),
        };
        types.set(c.roomTypeId, t);
      }
      if (!t.plans.has(c.ratePlanId)) {
        t.plans.set(c.ratePlanId, {
          ratePlanId: c.ratePlanId,
          ratePlanCode: c.ratePlanCode,
          ratePlanName: c.ratePlanName,
          isDefault: c.ratePlanIsDefault,
        });
      }
    }
    return [...types.values()];
  }, [cells]);

  const at = useMemo(
    () => new Map(cells.map((c) => [`${c.roomTypeId}|${c.ratePlanId}|${c.date}`, c])),
    [cells],
  );
  const occAt = useMemo(
    () => new Map(occupancy.map((o) => [`${o.roomTypeId}|${o.ratePlanId}|${o.date}|${o.adults}`, o.rateCents])),
    [occupancy],
  );

  const maxAdults = Math.max(1, ...roomTypes.map((t) => t.maxOccupancy));

  function parse(text: string): number | null | "bad" {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    try {
      const c = parseMoney(trimmed);
      return c < 0 ? "bad" : c;
    } catch {
      return "bad";
    }
  }

  /** What a party pays on a night with no price of its own (display only). */
  function fallback(planId: string, typeId: string, base: number | null, a: number): number | null {
    if (base === null) return null;
    const plan = planById.get(planId);
    const type = typeById.get(typeId);
    if (!plan || !type || plan.occupancyPricing !== "per_person") return base;
    // A party removed in Room Rate Combinations (0124) pays the standard price.
    if ((plan.standardOccupancies?.[typeId] ?? []).includes(a)) return base;
    const b = type.baseOccupancy;
    const inc = plan.adultAdjustCents ?? 0;
    const dec = plan.adultDecreaseCents ?? inc;
    return Math.max(0, a >= b ? base + (a - b) * inc : base - (b - a) * dec);
  }

  function saveDay(
    what: { roomTypeId: string; ratePlanId: string; date: string; adults: number | null },
    text: string,
  ) {
    const cents = parse(text);
    if (cents === "bad") {
      setMessage({ ok: false, text: tr("That is not an amount. Try 120 or 120.50.") });
      return;
    }
    startTransition(async () => {
      const pairs = [{ roomTypeId: what.roomTypeId, ratePlanId: what.ratePlanId }];
      const result =
        what.adults === null
          ? await applyRates({ pairs, from: what.date, to: what.date, daysOfWeek: [], value: cents })
          : await applyOccupancyRates({
              pairs, from: what.date, to: what.date, daysOfWeek: [], adults: what.adults, value: cents,
            });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        router.refresh();
        return;
      }
      setMessage({
        ok: true,
        text:
          cents === null
            ? tr("{date} cleared.", { date: tr.date(what.date, "EEE d MMM") })
            : tr("{date} set to {amount}.", {
                date: tr.date(what.date, "EEE d MMM"),
                amount: formatMoney(cents, currency),
              }),
      });
      router.refresh();
    });
  }

  function toggle(key: string) {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }

  function toggleType(roomTypeId: string, planIds: string[]) {
    const keys = planIds.map((p) => pairKey(roomTypeId, p));
    const allOn = keys.every((k) => selected.includes(k));
    setSelected((s) =>
      allOn ? s.filter((k) => !keys.includes(k)) : [...new Set([...s, ...keys])],
    );
  }

  function apply() {
    const pairs = selected.map((k) => {
      const [roomTypeId, ratePlanId] = k.split("|");
      return { roomTypeId, ratePlanId };
    });
    const cents = parse(value);
    if (cents === "bad") {
      setMessage({ ok: false, text: tr("That is not an amount. Try 120 or 120.50.") });
      return;
    }
    startTransition(async () => {
      const result =
        adults === null
          ? await applyRates({ pairs, from: editFrom, to: editTo, daysOfWeek: dow, value: cents })
          : await applyOccupancyRates({ pairs, from: editFrom, to: editTo, daysOfWeek: dow, adults, value: cents });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({
        ok: true,
        text:
          cents === null
            ? tr.plural(result.data.nightsWritten, "Cleared {n} night.", "Cleared {n} nights.")
            : tr.plural(result.data.nightsWritten, "Set {amount} on {n} night.", "Set {amount} on {n} nights.", {
                amount: formatMoney(cents, currency),
              }),
      });
      router.refresh();
    });
  }

  const shift = (days: number) => format(addDays(parseISO(from), days), "yyyy-MM-dd");

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-white p-4 text-[13px] text-ink-muted shadow-card">
        {tr("There are no rate plans yet, so there is nothing to price.")}{" "}
        <Link href="/settings?tab=rate-plans" className="underline underline-offset-2">
          {tr("Create one under Settings → Rate plans.")}
        </Link>
      </div>
    );
  }

  return (
    <ShowIn.Provider value={showIn}>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`${basePath}?from=${shift(-dates.length)}${planQuery}`} className={nav} aria-label={tr("Previous {n} days", { n: dates.length })}>
          ‹ {tr("Previous")}
        </Link>
        <Link href={plan ? `${basePath}?plan=${plan}` : basePath} className={nav}>{tr("Today")}</Link>
        <Link href={`${basePath}?from=${shift(dates.length)}${planQuery}`} className={nav} aria-label={tr("Next {n} days", { n: dates.length })}>
          {tr("Next")} ›
        </Link>
        <form action={basePath} className="flex items-center gap-2">
          {plan && <input type="hidden" name="plan" value={plan} />}
          <label className="sr-only" htmlFor="rates-from">{tr("From")}</label>
          <input id="rates-from" type="date" name="from" defaultValue={from}
            className="rounded-md border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink" />
          <button type="submit" className={nav}>{tr("Go")}</button>
        </form>
        {plan && (
          <Link href={`${basePath}?from=${from}`} className={nav}>{tr("All rate plans")}</Link>
        )}
        {pending && <span className="text-[12px] text-ink-faint">{tr("Saving…")}</span>}
      </div>

      {message && (
        <div
          role={message.ok ? "status" : "alert"}
          className={cn(
            "rounded-lg border px-4 py-3 text-[13px]",
            message.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-3 pb-2.5 text-left text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  {tr("Room type / rate")}
                </th>
                {dates.map((d) => {
                  const day = parseISO(d);
                  const weekend = [5, 6].includes(day.getDay());
                  return (
                    <th
                      key={d}
                      className={cn(
                        "min-w-[70px] px-1 pb-2.5 text-center text-xxs font-semibold uppercase tracking-[0.06em]",
                        d === businessDate ? "text-brass" : weekend ? "text-ink-muted" : "text-ink-faint",
                      )}
                    >
                      <span className="block">{tr.date(day, "EEE")}</span>
                      <span className="tnum block text-[11px] font-normal">{tr.date(day, "d MMM")}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((t) => {
                const groupPlans = [...t.plans.values()];
                const editable = groupPlans.filter((p) => !derivedFrom[p.ratePlanId]);
                const keys = editable.map((p) => pairKey(t.roomTypeId, p.ratePlanId));
                const allOn = keys.length > 0 && keys.every((k) => selected.includes(k));
                const type = typeById.get(t.roomTypeId);
                const base = type?.baseOccupancy ?? 1;
                return (
                  <Fragment key={t.roomTypeId}>
                    <tr>
                      <td
                        colSpan={dates.length + 1}
                        className="sticky left-0 z-10 whitespace-nowrap border-t border-line bg-shell px-3 py-2"
                      >
                        <label className="flex cursor-pointer items-center gap-2">
                          {canEdit && (
                            <input
                              type="checkbox"
                              checked={allOn}
                              onChange={() => toggleType(t.roomTypeId, editable.map((p) => p.ratePlanId))}
                              className="h-3.5 w-3.5 accent-brass"
                            />
                          )}
                          <span className="font-medium text-ink">{t.roomTypeName}</span>
                          <span className="text-xxs text-ink-faint">
                            {t.roomTypeCode}
                            {type ? ` · ${tr("Max Occ. {n}", { n: type.maxOccupancy })}` : ""}
                          </span>
                        </label>
                      </td>
                    </tr>

                    {groupPlans.map((p) => {
                      const key = pairKey(t.roomTypeId, p.ratePlanId);
                      const derived = !!derivedFrom[p.ratePlanId];
                      const plan = planById.get(p.ratePlanId);
                      const byOccupancy = !derived && plan && plan.occupancyPricing !== "single" && type;
                      const others = byOccupancy
                        ? Array.from({ length: type.maxOccupancy }, (_, i) => i + 1).filter((a) => a !== base)
                        : [];
                      return (
                        <Fragment key={key}>
                          <tr>
                            <td className="sticky left-0 z-10 whitespace-nowrap border-t border-line bg-white px-3 py-1.5">
                              <label className="flex cursor-pointer items-center gap-2 pl-4">
                                {canEdit && !derived ? (
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(key)}
                                    onChange={() => toggle(key)}
                                    className="h-3.5 w-3.5 accent-brass"
                                  />
                                ) : (
                                  <span className="inline-block h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                <span className="text-ink">{p.ratePlanName}</span>
                                {byOccupancy && (
                                  <span className="text-xxs text-ink-faint">
                                    {tr.plural(base, "{n} adult", "{n} adults")}
                                  </span>
                                )}
                                {derived && (
                                  <span className="text-xxs text-ink-faint">
                                    {tr("Derived from {name}", { name: derivedFrom[p.ratePlanId] })}
                                  </span>
                                )}
                                {p.isDefault && <span className="text-xxs text-ink-faint">{tr("main")}</span>}
                              </label>
                            </td>
                            {dates.map((d) => {
                              const rate = at.get(`${t.roomTypeId}|${p.ratePlanId}|${d}`)?.rateCents ?? null;
                              const text = rate === null ? "" : formatMoneyInput(rate, currency);
                              const past = d < businessDate;
                              return (
                                <td key={d} className="tnum border-t border-line px-1 py-1 text-center">
                                  {canEdit && !derived && !past ? (
                                    <PriceCell
                                      key={text}
                                      initial={text}
                                      placeholder="—"
                                      ariaLabel={tr("{plan}, {type}, {date}", {
                                        plan: p.ratePlanName, type: t.roomTypeName, date: tr.date(d, "d MMM"),
                                      })}
                                      onSave={(v) => saveDay({ roomTypeId: t.roomTypeId, ratePlanId: p.ratePlanId, date: d, adults: null }, v)}
                                    />
                                  ) : (
                                    <span className={rate === null ? "text-ink-faint" : "text-ink-muted"}>
                                      {rate === null ? "—" : formatMoney(rate, currency)}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                          {others.map((a) => (
                            <tr key={`${key}|${a}`}>
                              <td className="sticky left-0 z-10 whitespace-nowrap border-t border-line/60 bg-white px-3 py-1 pl-[3.25rem] text-[12px] text-ink-muted">
                                {tr.plural(a, "{n} adult", "{n} adults")}
                              </td>
                              {dates.map((d) => {
                                const own = occAt.get(`${t.roomTypeId}|${p.ratePlanId}|${d}|${a}`);
                                const std = at.get(`${t.roomTypeId}|${p.ratePlanId}|${d}`)?.rateCents ?? null;
                                const fb = fallback(p.ratePlanId, t.roomTypeId, std, a);
                                const text = own === undefined ? "" : formatMoneyInput(own, currency);
                                const past = d < businessDate;
                                return (
                                  <td key={d} className="tnum border-t border-line/60 px-1 py-1 text-center">
                                    {canEdit && !past ? (
                                      <PriceCell
                                        key={text}
                                        initial={text}
                                        faintEmpty
                                        placeholder={fb === null ? "—" : formatMoneyInput(fb, currency)}
                                        ariaLabel={tr("{plan}, {type}, {n} adults, {date}", {
                                          plan: p.ratePlanName, type: t.roomTypeName, n: a, date: tr.date(d, "d MMM"),
                                        })}
                                        onSave={(v) => saveDay({ roomTypeId: t.roomTypeId, ratePlanId: p.ratePlanId, date: d, adults: a }, v)}
                                      />
                                    ) : (
                                      <span className={own === undefined ? "text-ink-faint" : "text-ink-muted"}>
                                        {own !== undefined ? formatMoney(own, currency) : fb === null ? "—" : formatMoney(fb, currency)}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {canEdit && (
        <div className="rounded-lg border border-line bg-white p-4 shadow-card">
          <h2 className="mb-3 font-display text-[15px] tracking-tightest text-ink">
            {tr("Set a price on many days")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className={label} htmlFor="r-from">{tr("From")}</label>
              <input id="r-from" type="date" value={editFrom} onChange={(e) => setEditFrom(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="r-to">{tr("To")}</label>
              <input id="r-to" type="date" value={editTo} onChange={(e) => setEditTo(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="r-adults">{tr("Occupancy")}</label>
              <select id="r-adults" value={adults ?? ""} className={field}
                onChange={(e) => setAdults(e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">{tr("Standard price")}</option>
                {Array.from({ length: maxAdults }, (_, i) => i + 1).map((a) => (
                  <option key={a} value={a}>{tr.plural(a, "{n} adult", "{n} adults")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="r-value">{tr("Rate a night")}</label>
              <input id="r-value" type="text" inputMode="decimal" value={value}
                placeholder={tr("120.00, or blank to clear")}
                onChange={(e) => setValue(e.target.value)} className={cn(field, "tnum")} />
            </div>
            <div>
              <span className={label}>{tr("Only these days")}</span>
              <div className="flex gap-1">
                {DOW.map((d, i) => (
                  <button
                    key={`${d.value}-${i}`}
                    type="button"
                    aria-pressed={dow.includes(d.value)}
                    aria-label={tr.weekday(d.value)}
                    onClick={() =>
                      setDow((s) => (s.includes(d.value) ? s.filter((x) => x !== d.value) : [...s, d.value]))
                    }
                    className={cn(
                      "h-8 w-8 rounded border text-[12px]",
                      dow.includes(d.value)
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell",
                    )}
                  >
                    {tr.weekday(d.value, "narrow")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={apply}
              disabled={pending || selected.length === 0}
              className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
            >
              {pending ? tr("Applying…") : tr("Apply")}
            </button>
            <p className="text-xs text-ink-faint">
              {selected.length === 0
                ? tr("Tick the rates on the left to apply this to.")
                : tr.plural(selected.length, "{n} rate selected.", "{n} rates selected.")}
            </p>
          </div>
        </div>
      )}
    </div>
    </ShowIn.Provider>
  );
}
