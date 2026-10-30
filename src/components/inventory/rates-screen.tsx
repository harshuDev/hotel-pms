"use client";

import { useT } from "@/components/i18n";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatEquivalent, formatMoney, formatMoneyInput, parseMoney } from "@/lib/money";
import { convertBetween, type DisplayCurrency } from "@/lib/finance-profiles";
import { applyDefaultRates, applyOccupancyRates, applyRateLines, applyRates, type RateLine } from "@/lib/actions/inventory";
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
 * its main row. The main row is the plan's default occupancy (0156) -- the
 * room type's base occupancy unless a per-person plan names another -- and
 * typing there reprices every party from it, as the plan's form does. An
 * empty occupancy cell shows, faint, what that party pays anyway -- the
 * standard price, or the automatic calculation -- and typing sets that
 * night's own price for them.
 *
 * WHY THIS IS NOT A TENTH COPY OF THE INVENTORY GRID. The rule against that
 * covers the nine screens that are each one field across room types. This is
 * one field across plan and type.
 *
 * "SET A PRICE ON MANY DAYS" PRICES EACH TICKED RATE ON ITS OWN (0161). The
 * client: "when I select multiple room type ... all the selected room types
 * get updated but on their own prices". It took one price and one occupancy
 * for every ticked rate; now the dates and weekdays are shared and each
 * ticked rate is a line with its own occupancy -- the parties the grid draws
 * for it -- and its own price, in its plan's currency. A blank line is
 * skipped; "Clear" on a line clears its nights instead (0162), as clearing
 * the cell would. `set_rate_lines()` writes them all in one transaction through
 * the setter the grid's row would use, so a refusal changes nothing and
 * names its line.
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
/** A typed price as it reads in other currencies, on hover (display only). */
type Equivalents = (cents: number) => string | undefined;

function equivalents(text: string, of: Equivalents | undefined): string | undefined {
  if (!of || text.trim() === "") return undefined;
  try {
    const cents = parseMoney(text);
    return cents < 0 ? undefined : of(cents);
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
  equivalent,
}: {
  initial: string;
  placeholder: string;
  ariaLabel: string;
  onSave: Save;
  faintEmpty?: boolean;
  equivalent?: Equivalents;
}) {
  const [text, setText] = useState(initial);
  const commit = () => {
    if (text.trim() !== initial.trim()) onSave(text);
  };
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={equivalents(text, equivalent)}
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
  /**
   * The hotel's other currencies with the rate in use (display only, and the
   * "≈" on a plan priced in another currency, 0138).
   */
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
  /** Each ticked rate's own party and price in the bulk panel (0161), by pair key. */
  const [lineDraft, setLineDraft] = useState<Record<string, { adults: number; value: string; clear: boolean }>>({});
  /** The line Postgres or the parser refused, drawn in rose. */
  const [badLine, setBadLine] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  /** The currency a plan's prices are typed and stored in (0138). */
  const curOf = (planId: string) => planById.get(planId)?.currency ?? currency;
  /** On hover: a plan in the hotel's currency shows the others; a plan in another shows the hotel's. */
  const equivalentFor = (planId: string): Equivalents | undefined => {
    const pc = curOf(planId);
    if (pc === currency) {
      return showIn.length === 0
        ? undefined
        : (c) => showIn.map((d) => formatEquivalent(c, d.currency, d.rateMicros)).join(" · ");
    }
    return (c) => {
      const v = convertBetween(c, pc, currency, currency, showIn);
      return v === null ? undefined : `≈ ${formatMoney(v, currency)}`;
    };
  };
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

  /** A party removed in Room Rate Combinations (0124) on a per-person plan. */
  function isRemoved(planId: string, typeId: string, a: number): boolean {
    const plan = planById.get(planId);
    return plan?.occupancyPricing === "per_person" && (plan.standardOccupancies?.[typeId] ?? []).includes(a);
  }

  /**
   * The party a plan's main row prices (0156): a per-person plan's default
   * occupancy (0136) unless it is removed, else Sleeps -- what
   * `set_default_rates()` reads, so the row and the save agree.
   */
  function defaultAdults(planId: string, typeId: string): number {
    const plan = planById.get(planId);
    const type = typeById.get(typeId);
    const b = type?.baseOccupancy ?? 1;
    const stored = plan?.defaultOccupancies?.[typeId];
    if (!plan || !type || plan.occupancyPricing !== "per_person" || plan.parentRatePlanId || stored == null) return b;
    const d = Math.min(Math.max(stored, 1), Math.max(type.maxOccupancy, 1));
    return isRemoved(planId, typeId, d) ? b : d;
  }

  /** What a party pays on a night with no price of its own (display only). */
  function fallback(planId: string, typeId: string, base: number | null, a: number): number | null {
    if (base === null) return null;
    const plan = planById.get(planId);
    const type = typeById.get(typeId);
    if (!plan || !type || plan.occupancyPricing !== "per_person") return base;
    const b = type.baseOccupancy;
    const inc = plan.adultAdjustCents ?? 0;
    const dec = plan.adultDecreaseCents ?? inc;
    return Math.max(0, a >= b ? base + (a - b) * inc : base - (b - a) * dec);
  }

  function saveDay(
    /** Adults null is the main row (the default party); `sleeps` the Sleeps row under it. */
    what: { roomTypeId: string; ratePlanId: string; date: string; adults: number | null; sleeps?: boolean },
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
          ? await applyDefaultRates({ pairs, from: what.date, to: what.date, daysOfWeek: [], value: cents })
          : what.sleeps
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
                amount: formatMoney(cents, curOf(what.ratePlanId)),
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

  /**
   * The parties a ticked rate can be priced for in the bulk panel -- exactly
   * the rows the grid draws for it: the main row (its default party), then
   * every other number of adults up to what the room type sleeps, leaving out
   * a party removed in Room Rate Combinations. A plan with one price for all
   * occupancies, or a room type not on the screen, has the main row only.
   */
  function partiesFor(ratePlanId: string, roomTypeId: string): { adults: number; kind: RateLine["kind"] }[] {
    const plan = planById.get(ratePlanId);
    const type = typeById.get(roomTypeId);
    const def = defaultAdults(ratePlanId, roomTypeId);
    const main = { adults: def, kind: "default" as const };
    if (!plan || !type || plan.occupancyPricing === "single") return [main];
    const rest = Array.from({ length: type.maxOccupancy }, (_, i) => i + 1)
      .filter((a) => a !== def && !isRemoved(ratePlanId, roomTypeId, a))
      .map((a) => ({
        adults: a,
        // Under a default that is not Sleeps, the Sleeps row is the standard
        // price itself, as on the grid.
        kind: a === type.baseOccupancy ? ("standard" as const) : ("occupancy" as const),
      }));
    return [main, ...rest];
  }

  // The ticked rates in the grid's own order, each with its own party and price.
  const bulkLines = groups.flatMap((t) =>
    [...t.plans.values()]
      .filter((p) => selected.includes(pairKey(t.roomTypeId, p.ratePlanId)))
      .map((p) => {
        const key = pairKey(t.roomTypeId, p.ratePlanId);
        const parties = partiesFor(p.ratePlanId, t.roomTypeId);
        const draft = lineDraft[key];
        const chosen = parties.find((x) => x.adults === draft?.adults) ?? parties[0];
        return {
          key,
          roomTypeId: t.roomTypeId,
          ratePlanId: p.ratePlanId,
          roomTypeName: t.roomTypeName,
          ratePlanName: p.ratePlanName,
          parties,
          chosen,
          value: draft?.value ?? "",
          clear: draft?.clear ?? false,
        };
      }),
  );

  function setLine(
    key: string,
    patch: Partial<{ adults: number; value: string; clear: boolean }>,
    fallbackAdults: number,
  ) {
    setBadLine(null);
    setLineDraft((d) => ({
      ...d,
      [key]: {
        adults: d[key]?.adults ?? fallbackAdults,
        value: d[key]?.value ?? "",
        clear: d[key]?.clear ?? false,
        ...patch,
      },
    }));
  }

  function apply() {
    setBadLine(null);
    // A line left blank is skipped; a line set to Clear clears its nights
    // (0162); every other line must be an amount.
    const lines: (RateLine & { key: string })[] = [];
    for (const l of bulkLines) {
      if (l.clear) {
        lines.push({
          key: l.key,
          roomTypeId: l.roomTypeId,
          ratePlanId: l.ratePlanId,
          kind: l.chosen.kind,
          adults: l.chosen.kind === "occupancy" ? l.chosen.adults : null,
          value: null,
        });
        continue;
      }
      if (l.value.trim() === "") continue;
      const cents = parse(l.value);
      if (cents === "bad" || cents === null) {
        setBadLine(l.key);
        setMessage({ ok: false, text: tr("That is not an amount. Try 120 or 120.50.") });
        return;
      }
      lines.push({
        key: l.key,
        roomTypeId: l.roomTypeId,
        ratePlanId: l.ratePlanId,
        kind: l.chosen.kind,
        adults: l.chosen.kind === "occupancy" ? l.chosen.adults : null,
        value: cents,
      });
    }
    if (lines.length === 0) {
      setMessage({ ok: false, text: tr("Type a price for at least one ticked rate.") });
      return;
    }
    startTransition(async () => {
      const result = await applyRateLines({
        from: editFrom,
        to: editTo,
        daysOfWeek: dow,
        lines: lines.map(({ key: _key, ...line }) => line),
      });
      if (!result.ok) {
        if (result.line !== undefined) setBadLine(lines[result.line]?.key ?? null);
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({
        ok: true,
        text: lines.every((x) => x.value === null)
          ? tr.plural(result.data.nightsWritten, "Cleared {n} night.", "Cleared {n} nights.")
          : tr.plural(result.data.nightsWritten, "Prices set on {n} night.", "Prices set on {n} nights."),
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
    <>
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
                      // The main row is the plan's default party (0156); Sleeps is
                      // then one of the rows under it.
                      const def = defaultAdults(p.ratePlanId, t.roomTypeId);
                      const others = byOccupancy
                        ? Array.from({ length: type.maxOccupancy }, (_, i) => i + 1).filter(
                            // A party removed in Room Rate Combinations has no row of its own.
                            (a) => a !== def && !isRemoved(p.ratePlanId, t.roomTypeId, a),
                          )
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
                                    {tr.plural(def, "{n} adult", "{n} adults")}
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
                              const std = at.get(`${t.roomTypeId}|${p.ratePlanId}|${d}`)?.rateCents ?? null;
                              const rate =
                                def === base || std === null
                                  ? std
                                  : (occAt.get(`${t.roomTypeId}|${p.ratePlanId}|${d}|${def}`) ??
                                    fallback(p.ratePlanId, t.roomTypeId, std, def));
                              const text = rate === null ? "" : formatMoneyInput(rate, curOf(p.ratePlanId));
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
                                      equivalent={equivalentFor(p.ratePlanId)}
                                    />
                                  ) : (
                                    <span className={rate === null ? "text-ink-faint" : "text-ink-muted"}>
                                      {rate === null ? "—" : formatMoney(rate, curOf(p.ratePlanId))}
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
                                const std = at.get(`${t.roomTypeId}|${p.ratePlanId}|${d}`)?.rateCents ?? null;
                                // Under a default that is not Sleeps, the Sleeps row is the
                                // standard price itself.
                                const sleeps = a === base;
                                const own = sleeps
                                  ? (std ?? undefined)
                                  : occAt.get(`${t.roomTypeId}|${p.ratePlanId}|${d}|${a}`);
                                const fb = sleeps ? null : fallback(p.ratePlanId, t.roomTypeId, std, a);
                                const text = own === undefined ? "" : formatMoneyInput(own, curOf(p.ratePlanId));
                                const past = d < businessDate;
                                return (
                                  <td key={d} className="tnum border-t border-line/60 px-1 py-1 text-center">
                                    {canEdit && !past ? (
                                      <PriceCell
                                        key={text}
                                        initial={text}
                                        faintEmpty
                                        placeholder={fb === null ? "—" : formatMoneyInput(fb, curOf(p.ratePlanId))}
                                        ariaLabel={tr("{plan}, {type}, {n} adults, {date}", {
                                          plan: p.ratePlanName, type: t.roomTypeName, n: a, date: tr.date(d, "d MMM"),
                                        })}
                                        onSave={(v) => saveDay({ roomTypeId: t.roomTypeId, ratePlanId: p.ratePlanId, date: d, adults: a, sleeps }, v)}
                                        equivalent={equivalentFor(p.ratePlanId)}
                                      />
                                    ) : (
                                      <span className={own === undefined ? "text-ink-faint" : "text-ink-muted"}>
                                        {own !== undefined ? formatMoney(own, curOf(p.ratePlanId)) : fb === null ? "—" : formatMoney(fb, curOf(p.ratePlanId))}
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={label} htmlFor="r-from">{tr("From")}</label>
              <input id="r-from" type="date" value={editFrom} onChange={(e) => setEditFrom(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="r-to">{tr("To")}</label>
              <input id="r-to" type="date" value={editTo} onChange={(e) => setEditTo(e.target.value)} className={field} />
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

          {bulkLines.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className={cn(label, "py-1.5 pr-3 font-semibold")}>{tr("Rate")}</th>
                    <th className={cn(label, "w-44 py-1.5 pr-3 font-semibold")}>{tr("Occupancy")}</th>
                    <th className={cn(label, "w-64 py-1.5 font-semibold")}>{tr("Rate a night")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {bulkLines.map((l) => {
                    const cur = curOf(l.ratePlanId);
                    const bad = badLine === l.key;
                    return (
                      <tr key={l.key} className={cn(bad && "bg-rose-50")}>
                        <td className="py-1.5 pr-3">
                          <span className="font-medium text-ink">{l.roomTypeName}</span>
                          <span className="text-ink-muted"> · {l.ratePlanName}</span>
                        </td>
                        <td className="py-1.5 pr-3">
                          {l.parties.length > 1 ? (
                            <select
                              value={l.chosen.adults}
                              aria-label={tr("Occupancy for {plan}, {type}", { plan: l.ratePlanName, type: l.roomTypeName })}
                              onChange={(e) => setLine(l.key, { adults: Number(e.target.value) }, l.chosen.adults)}
                              className={field}
                            >
                              {l.parties.map((x) => (
                                <option key={x.adults} value={x.adults}>
                                  {tr.plural(x.adults, "{n} adult", "{n} adults")}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-ink-muted">{tr("Standard price")}</span>
                          )}
                        </td>
                        <td className="py-1.5">
                          <div className="flex items-center gap-2">
                            {l.clear ? (
                              // Clearing the standard price takes the plan off sale on
                              // those nights; clearing a party's own price puts it back
                              // on the standard price -- what clearing the cell does.
                              <span className="min-w-0 flex-1 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12.5px] text-rose-700">
                                {l.chosen.kind === "occupancy"
                                  ? tr("Back to the standard price")
                                  : tr("Not sold on these nights")}
                              </span>
                            ) : (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={l.value}
                                placeholder="120.00"
                                aria-label={tr("Rate a night for {plan}, {type}", { plan: l.ratePlanName, type: l.roomTypeName })}
                                aria-invalid={bad || undefined}
                                onChange={(e) => setLine(l.key, { value: e.target.value }, l.chosen.adults)}
                                className={cn(field, "tnum", bad && "border-rose-400")}
                              />
                            )}
                            {!l.clear && cur !== currency && <span className="text-xxs text-ink-faint">{cur}</span>}
                            <button
                              type="button"
                              aria-pressed={l.clear}
                              onClick={() => setLine(l.key, { clear: !l.clear }, l.chosen.adults)}
                              className={cn(
                                "shrink-0 rounded-md border px-2.5 py-1.5 text-[12px]",
                                l.clear
                                  ? "border-line text-ink-muted hover:bg-shell hover:text-ink"
                                  : "border-line text-rose-600 hover:bg-rose-50",
                              )}
                            >
                              {l.clear ? tr("Set a price") : tr("Clear")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
    </>
  );
}
