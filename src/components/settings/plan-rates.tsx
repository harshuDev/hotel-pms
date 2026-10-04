"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useT } from "@/components/i18n";
import { cn } from "@/components/ui";
import { formatMoneyInput, parseMoney } from "@/lib/money";
import type { OccupancyPricing, RatePlan, RatePlanCoverage, RoomTypeSetting, SeasonType, WeekRate } from "@/lib/types";
import { FilterSelect, type FilterOption } from "./filter-select";

/*
 * A rate plan's prices, INSIDE the plan's form (0110) -- the client's
 * reference puts them there, and sent a Loom asking for exactly that:
 * choose the season, then per room type one row per number of adults up to
 * its maximum occupancy, Monday to Sunday, a ">>" that copies Monday to the
 * whole week, and the plan's restrictions as rows of their own underneath
 * ("Rate Category Restrictions") rather than tiny boxes under every price.
 *
 * THIS IS A WEEKLY TEMPLATE THAT WRITES NIGHTS. Saving puts the week onto
 * every matching night -- a season's own dates, or the Default Season's next
 * year -- in `rate_plan_days` (and `rate_plan_occupancy_days`), which is what
 * every booking and the channels read. The price of ONE night is changed in
 * Inventory -> Rates, which edits the nights directly.
 *
 * The three occupancy modes are the plan's (see the form above):
 *  - single: one row, the price whatever the party;
 *  - per_occupancy: a row per number of adults, each typed;
 *  - per_person ("Automatic Calculation"): the radio picks the row you type
 *    in, and the others are worked out from the plan's increase and decrease
 *    per adult, shown grey, as the reference does.
 * The room type's base occupancy is always the standard price
 * (`rate_cents`); every other row goes to `occupancy_rates`.
 */

const WEEKDAY_OF = [1, 2, 3, 4, 5, 6, 0];

type Restrictions = {
  mst: string[];
  msa: string[];
  mxs: string[];
  cta: boolean[];
  ctd: boolean[];
  ss: boolean[];
};

type TypeDraft = {
  /** Row per number of adults, 1..max, each seven weekday strings. */
  rows: Record<number, string[]>;
  radio: number;
  dirty: boolean;
};

export type PlanRatesPayload = {
  seasonTypeId: string | null;
  replaceRates: boolean;
  rows: {
    roomTypeId: string;
    roomTypeName: string;
    days: {
      weekday: number;
      rateCents: number | null;
      minStayThrough: number | null;
      minStayArrival: number | null;
      maxStay: number | null;
      closedToArrival: boolean;
      closedToDeparture: boolean;
      stopSell: boolean;
      occupancyRates: Record<string, number> | null;
    }[];
  }[];
};

export type PlanRatesHandle = {
  /** What to save, null when nothing was touched, or the first problem found. */
  collect: () => PlanRatesPayload | null | string;
};

const EMPTY7 = () => ["", "", "", "", "", "", ""];

function money(s: string): number | null | "bad" {
  if (s.trim() === "") return null;
  try {
    const c = parseMoney(s);
    return c < 0 ? "bad" : c;
  } catch {
    return "bad";
  }
}

function nights(s: string): number | null | "bad" {
  if (s.trim() === "") return null;
  return /^\s*\d{1,3}\s*$/.test(s) && Number(s) >= 1 && Number(s) <= 365 ? Number(s) : "bad";
}

/** The parent's price, adjusted as Postgres adjusts it. Display only. */
function derive(parentCents: number, plan: RatePlan): number {
  if (plan.derivedKind === "amount" && plan.derivedAmountCents !== null) {
    return Math.max(0, parentCents + plan.derivedAmountCents);
  }
  if (plan.derivedKind === "percent" && plan.derivedPercentBps !== null) {
    const scaled = parentCents * plan.derivedPercentBps;
    const adj = Math.sign(scaled) * Math.floor((Math.abs(scaled) + 5000) / 10000);
    return Math.max(0, parentCents + adj);
  }
  return parentCents;
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="5" r="2.6" />
      <path d="M3 14c.5-3 2.5-4.5 5-4.5s4.5 1.5 5 4.5" strokeLinecap="round" />
    </svg>
  );
}

function ChildIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="6" r="2.2" />
      <path d="M4.5 14c.4-2.3 1.8-3.5 3.5-3.5s3.1 1.2 3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

function FillIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3.5L7.5 8 3 12.5M8.5 3.5L13 8l-4.5 4.5" />
    </svg>
  );
}

const cell =
  "tnum w-full min-w-[4.2rem] rounded border border-line bg-white px-1 py-1 text-center text-[12.5px] text-ink outline-none focus:border-brass focus:ring-1 focus:ring-brass";
const fillBtn =
  "grid h-7 w-7 place-items-center rounded text-ink-muted hover:bg-shell hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";

export const PlanRates = forwardRef<
  PlanRatesHandle,
  {
    plan: RatePlan;
    /** The mode and amounts as the form currently has them, so the grey rows follow what is typed. */
    mode: OccupancyPricing;
    increaseAdultCents: number;
    decreaseAdultCents: number;
    parent: RatePlan | null;
    roomTypes: RoomTypeSetting[];
    seasons: SeasonType[];
    weekRates: WeekRate[];
    coverage: RatePlanCoverage[];
    initialSeasonId: string | null;
    canEdit: boolean;
  }
>(function PlanRates(
  { plan, mode, increaseAdultCents, decreaseAdultCents, parent, roomTypes, seasons, weekRates, coverage, initialSeasonId, canEdit },
  ref,
) {
  const tr = useT();
  const [season, setSeason] = useState<string | null>(initialSeasonId);
  const [replaceRates, setReplaceRates] = useState(false);
  // Affected room types: those already priced on this plan, else all.
  const [typeIds, setTypeIds] = useState<string[]>(() => {
    const priced = roomTypes.filter((t) => coverage.some((c) => c.ratePlanId === plan.id && c.roomTypeId === t.id));
    return (priced.length > 0 ? priced : roomTypes).map((t) => t.id);
  });
  const [types, setTypes] = useState<Record<string, TypeDraft>>({});
  const [restr, setRestr] = useState<Record<string, Restrictions & { dirty: boolean }>>({});
  // Per-occupancy rows added before they hold a price, and rows removed and
  // not yet saved: "<season>|<type>|<adults>". An empty row is "this party
  // pays the standard price", so removing a row is clearing it (video 2: "we
  // want the possibility to delete the one we don't want").
  const [addedOcc, setAddedOcc] = useState<string[]>([]);
  const [removedOcc, setRemovedOcc] = useState<string[]>([]);

  const derived = !!plan.parentRatePlanId;
  const seasonKey = season ?? "default";
  const k = (typeId: string) => `${seasonKey}|${typeId}`;
  const baseOf = (t: RoomTypeSetting) => Math.min(Math.max(t.baseOccupancy, 1), t.maxOccupancy);

  const template = (planId: string, typeId: string, weekday: number) =>
    weekRates.find(
      (w) => w.ratePlanId === planId && w.roomTypeId === typeId && w.seasonTypeId === season && w.weekday === weekday,
    );

  function loadType(t: RoomTypeSetting): TypeDraft {
    const b = baseOf(t);
    const rows: Record<number, string[]> = {};
    for (let a = 1; a <= t.maxOccupancy; a++) rows[a] = EMPTY7();
    for (let i = 0; i < 7; i++) {
      const w = template(plan.id, t.id, i + 1);
      if (!w) continue;
      if (w.rateCents !== null) rows[b][i] = formatMoneyInput(w.rateCents);
      for (const [a, cents] of Object.entries(w.occupancyRates ?? {})) {
        const n = Number(a);
        if (rows[n] && n !== b) rows[n][i] = formatMoneyInput(cents);
      }
    }
    return { rows, radio: b, dirty: false };
  }

  function loadRestrictions(): Restrictions & { dirty: boolean } {
    const r: Restrictions & { dirty: boolean } = {
      mst: EMPTY7(), msa: EMPTY7(), mxs: EMPTY7(),
      cta: Array(7).fill(false), ctd: Array(7).fill(false), ss: Array(7).fill(false), dirty: false,
    };
    // The plan's restrictions are one set; read them off the first room type
    // that has a week saved for this season.
    const source = roomTypes.find((t) => weekRates.some(
      (w) => w.ratePlanId === plan.id && w.roomTypeId === t.id && w.seasonTypeId === season,
    ));
    if (!source) return r;
    for (let i = 0; i < 7; i++) {
      const w = template(plan.id, source.id, i + 1);
      if (!w) continue;
      r.mst[i] = w.minStayThrough === null ? "" : String(w.minStayThrough);
      r.msa[i] = w.minStayArrival === null ? "" : String(w.minStayArrival);
      r.mxs[i] = w.maxStay === null ? "" : String(w.maxStay);
      r.cta[i] = w.closedToArrival;
      r.ctd[i] = w.closedToDeparture;
      r.ss[i] = w.stopSell;
    }
    return r;
  }

  const typeDraft = (t: RoomTypeSetting) => types[k(t.id)] ?? loadType(t);

  /** The rows a room type draws: every occupancy, or on a per-occupancy plan the standard row and those with a price. */
  function adultsFor(t: RoomTypeSetting, d: TypeDraft): number[] {
    const b = baseOf(t);
    if (mode === "single" || derived) return [b];
    const all = Array.from({ length: t.maxOccupancy }, (_, x) => x + 1);
    // Rows removed in Room Rate Combinations (0124) pay the standard price.
    if (mode === "per_person") return all.filter((a) => a === b || !(plan.standardOccupancies?.[t.id] ?? []).includes(a));
    return all.filter(
      (a) => a === b || (d.rows[a] ?? []).some((v) => v.trim() !== "") || addedOcc.includes(`${k(t.id)}|${a}`),
    );
  }

  function removeOcc(t: RoomTypeSetting, a: number) {
    const d = typeDraft(t);
    setTypes({ ...types, [k(t.id)]: { ...d, rows: { ...d.rows, [a]: EMPTY7() }, dirty: true } });
    setAddedOcc(addedOcc.filter((x) => x !== `${k(t.id)}|${a}`));
    setRemovedOcc([...removedOcc, `${k(t.id)}|${a}`]);
  }
  const restrictions = restr[seasonKey] ?? loadRestrictions();

  /** What a row shows: typed, or worked out from the radio row in automatic mode. */
  function shown(t: RoomTypeSetting, d: TypeDraft, adults: number, i: number): { text: string; computed: boolean } {
    if (mode !== "per_person" || adults === d.radio) return { text: d.rows[adults]?.[i] ?? "", computed: false };
    const v = money(d.rows[d.radio]?.[i] ?? "");
    if (typeof v !== "number") return { text: "", computed: true };
    const cents = adults > d.radio
      ? v + (adults - d.radio) * increaseAdultCents
      : v - (d.radio - adults) * decreaseAdultCents;
    return { text: formatMoneyInput(Math.max(0, cents)), computed: true };
  }

  function setRow(t: RoomTypeSetting, adults: number, i: number | "all", value: string) {
    const d = typeDraft(t);
    const row = [...(d.rows[adults] ?? EMPTY7())];
    if (i === "all") for (let x = 0; x < 7; x++) row[x] = value;
    else row[i] = value;
    setTypes({ ...types, [k(t.id)]: { ...d, rows: { ...d.rows, [adults]: row }, dirty: true } });
  }

  function setRadio(t: RoomTypeSetting, adults: number) {
    const d = typeDraft(t);
    // The row being typed in starts from what it showed, so nothing jumps.
    const rows = { ...d.rows };
    rows[adults] = WEEKDAY_OF.map((_, i) => shown(t, d, adults, i).text);
    setTypes({ ...types, [k(t.id)]: { ...d, rows, radio: adults, dirty: true } });
  }

  function setRestriction<K extends keyof Restrictions>(key: K, i: number | "all", value: Restrictions[K][number]) {
    const r = restrictions;
    const list = [...r[key]] as Restrictions[K][number][];
    if (i === "all") for (let x = 0; x < 7; x++) list[x] = value;
    else list[i] = value;
    setRestr({ ...restr, [seasonKey]: { ...r, [key]: list, dirty: true } });
  }

  useImperativeHandle(ref, () => ({
    collect() {
      const shownTypes = roomTypes.filter((t) => typeIds.includes(t.id));
      const r = restrictions;
      const anyDirty = r.dirty || shownTypes.some((t) => types[k(t.id)]?.dirty);
      if (!anyDirty || !canEdit) return null;
      const day = (i: number) => tr.weekday(WEEKDAY_OF[i]);
      const rules: { mst: number | null; msa: number | null; mxs: number | null }[] = [];
      for (let i = 0; i < 7; i++) {
        const mst = nights(r.mst[i]);
        const msa = nights(r.msa[i]);
        const mxs = nights(r.mxs[i]);
        if (mst === "bad" || msa === "bad" || mxs === "bad") {
          return tr("{day}: a stay rule is a number of nights, 1 to 365.", { day: day(i) });
        }
        rules.push({ mst, msa, mxs });
      }
      const rows: PlanRatesPayload["rows"] = [];
      for (const t of shownTypes) {
        const d = typeDraft(t);
        if (!d.dirty && !r.dirty) continue;
        const b = baseOf(t);
        const name = t.displayName ?? t.name;
        const days: PlanRatesPayload["rows"][number]["days"] = [];
        for (let i = 0; i < 7; i++) {
          let rateCents: number | null = null;
          let occupancyRates: Record<string, number> | null = null;
          if (!derived) {
            const values: Record<number, number | null> = {};
            const adultsList = mode === "single" ? [b] : Array.from({ length: t.maxOccupancy }, (_, x) => x + 1);
            for (const a of adultsList) {
              const v = money(shown(t, d, a, i).text);
              if (v === "bad") {
                return tr("{name}, {day}: write the price as a number, such as 120 or 99.50.", { name, day: day(i) });
              }
              values[a] = v;
            }
            rateCents = values[b] ?? null;
            if (mode !== "single") {
              const others = Object.entries(values).filter(([a, v]) => Number(a) !== b && v !== null);
              if (rateCents === null && others.length > 0) {
                return tr("{name}, {day}: fill the price for {n} adults first. It is the room's standard price.", {
                  name, day: day(i), n: b,
                });
              }
              // Automatic from the base row: nothing to store, Postgres works
              // the others out. From another row: store what is shown.
              occupancyRates = mode === "per_person" && d.radio === b
                ? {}
                : Object.fromEntries(others.map(([a, v]) => [a, v as number]));
            }
          }
          days.push({
            weekday: i + 1,
            rateCents,
            minStayThrough: rules[i].mst,
            minStayArrival: rules[i].msa,
            maxStay: rules[i].mxs,
            closedToArrival: r.cta[i],
            closedToDeparture: r.ctd[i],
            stopSell: r.ss[i],
            occupancyRates,
          });
        }
        rows.push({ roomTypeId: t.id, roomTypeName: name, days });
      }
      // The Default Season clears a removed party's nightly prices only when it
      // replaces (save_week_rates()); without it the row would vanish here and
      // its old price go on being charged.
      if (rows.length > 0 && season === null && !replaceRates && removedOcc.some((x) => x.startsWith(`${seasonKey}|`))) {
        return tr("Tick Replace prices already on these nights to take a removed occupancy price off the nights already priced.");
      }
      return rows.length === 0 ? null : { seasonTypeId: season, replaceRates, rows };
    },
  }));

  // Seasons, then events (priced on their own nights as of 0114), then the
  // Default Season, as the Room Rate Combinations filter lists them.
  const seasonOptions: FilterOption[] = [
    ...seasons.filter((s) => s.kind === "season").map((s) => ({ id: s.id, name: s.name, color: s.color })),
    ...seasons.filter((s) => s.kind === "event").map((s) => ({ id: s.id, name: s.name, color: s.color, tag: tr("Event") })),
    { id: "default", name: tr("Default Season") },
  ];
  const shownTypes = roomTypes.filter((t) => typeIds.includes(t.id));
  const dayHeads = WEEKDAY_OF.map((d) => (
    <th key={d} className="px-1 py-2 text-center text-[12px] font-semibold text-ink">{tr.weekday(d)}</th>
  ));

  const restrictionRows: { key: keyof Restrictions; label: string; kind: "n" | "b" }[] = [
    { key: "mst", label: tr("Min Stay Through"), kind: "n" },
    { key: "msa", label: tr("Min Stay Arrival"), kind: "n" },
    { key: "mxs", label: tr("Max Stay"), kind: "n" },
    { key: "cta", label: tr("Closed To Arrival"), kind: "b" },
    { key: "ctd", label: tr("Closed To Departure"), kind: "b" },
    { key: "ss", label: tr("Stop Sell"), kind: "b" },
  ];

  return (
    <div className="mt-2 space-y-4">
      <div className="grid gap-4 sm:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="min-w-0 text-[12px] text-ink-muted">
          {tr("Season")}
          <FilterSelect label={tr("Season")} options={seasonOptions} value={[season ?? "default"]}
            onChange={(ids) => setSeason(ids[0] === "default" ? null : (ids[0] ?? null))} />
        </div>
        <div className="min-w-0 text-[12px] text-ink-muted">
          {tr("Affected Room Types")}
          <FilterSelect multi label={tr("Affected Room Types")} value={typeIds} onChange={setTypeIds}
            options={roomTypes.map((t) => ({ id: t.id, name: t.displayName ?? t.name }))} />
        </div>
      </div>
      {season === null && !derived && (
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" className="h-4 w-4 accent-brass" checked={replaceRates}
            onChange={(e) => setReplaceRates(e.target.checked)} />
          {tr("Replace prices already on these nights")}
        </label>
      )}

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[46rem] text-[12.5px]">
          <thead className="bg-shell/80">
            <tr className="border-b border-line">
              <th className="px-3 py-2 text-left text-[12px] font-semibold text-ink">{tr("Room Type")}</th>
              <th className="w-9" aria-label={tr("Copy Monday to every day")} />
              {dayHeads}
            </tr>
          </thead>
          <tbody>
            {shownTypes.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-ink-muted">{tr("Choose Room Type to fill rates")}</td>
              </tr>
            )}
            {shownTypes.map((t) => {
              const d = typeDraft(t);
              const b = baseOf(t);
              const name = t.displayName ?? t.name;
              const c = coverage.find((x) => x.ratePlanId === plan.id && x.roomTypeId === t.id);
              const adultsList = adultsFor(t, d);
              const canAddOcc =
                canEdit && mode === "per_occupancy" && !derived
                  ? Array.from({ length: t.maxOccupancy }, (_, x) => x + 1).filter((a) => !adultsList.includes(a))
                  : [];
              return (
                <FragmentRows key={t.id}>
                  <tr className="border-b border-line bg-shell/40">
                    <td colSpan={9} className="px-3 py-2">
                      <span className="text-[12.5px] font-semibold text-ink">
                        {tr("{name} (Max Occ. {n})", { name, n: t.maxOccupancy })}
                      </span>
                      <span className={cn("ml-3 text-[11px]", c ? "text-emerald-700" : "text-ink-faint")}>
                        {c ? tr.plural(c.pricedNights, "{n} night priced", "{n} nights priced") : tr("Not priced")}
                      </span>
                    </td>
                  </tr>
                  {adultsList.map((a) => (
                    <tr key={a} className="border-b border-line">
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-2 text-ink">
                          {mode === "per_person" && !derived && (
                            <input type="radio" name={`base-${t.id}`} className="h-3.5 w-3.5 accent-brass"
                              aria-label={tr("Type the price for {n} adults", { n: a })}
                              checked={d.radio === a} onChange={() => setRadio(t, a)} />
                          )}
                          {mode === "single" || derived ? (
                            <span className="text-[12px] text-ink-muted">
                              {derived && parent ? tr("Derived from {name}", { name: parent.name }) : tr("All occupancies")}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[12.5px]" aria-label={tr.plural(a, "{n} adult", "{n} adults")}>
                              <PersonIcon />{a}
                              <span className="ml-1 flex items-center gap-0.5 text-ink-faint"><ChildIcon />0</span>
                              {canEdit && mode === "per_occupancy" && a !== b && (
                                <button type="button" onClick={() => removeOcc(t, a)} title={tr("Remove")}
                                  aria-label={tr("Remove the {n} adults price for {name}", { n: a, name })}
                                  className="ml-1 grid h-5 w-5 place-items-center rounded text-[14px] leading-none text-ink-faint hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass">
                                  ×
                                </button>
                              )}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-0.5">
                        {canEdit && !derived && !(mode === "per_person" && a !== d.radio) && (
                          <button type="button" className={fillBtn}
                            aria-label={tr("Copy Monday to every day for {name}, {n} adults", { name, n: a })}
                            title={tr("Copy Monday to every day")}
                            onClick={() => setRow(t, a, "all", d.rows[a]?.[0] ?? "")}>
                            <FillIcon />
                          </button>
                        )}
                      </td>
                      {WEEKDAY_OF.map((wd, i) => {
                        if (derived) {
                          const w = parent ? weekRates.find((x) => x.ratePlanId === parent.id && x.roomTypeId === t.id
                            && x.seasonTypeId === season && x.weekday === i + 1) : undefined;
                          return (
                            <td key={wd} className="tnum px-1 py-1.5 text-center text-ink-muted">
                              {w?.rateCents != null ? formatMoneyInput(derive(w.rateCents, plan)) : "—"}
                            </td>
                          );
                        }
                        const s = shown(t, d, a, i);
                        return (
                          <td key={wd} className="px-1 py-1.5">
                            {s.computed ? (
                              <span className="tnum block py-1 text-center text-ink-faint">{s.text || "—"}</span>
                            ) : (
                              <input inputMode="decimal" value={s.text} readOnly={!canEdit}
                                aria-label={tr("{name}, {n} adults, {day}", { name, n: a, day: tr.weekday(wd) })}
                                onChange={(e) => setRow(t, a, i, e.target.value)} className={cell} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {canAddOcc.length > 0 && (
                    <tr className="border-b border-line">
                      <td colSpan={9} className="px-3 py-1.5">
                        <select value=""
                          aria-label={tr("Add an occupancy price for {name}", { name })}
                          onChange={(e) => {
                            const a = Number(e.target.value);
                            if (a) setAddedOcc([...addedOcc, `${k(t.id)}|${a}`]);
                          }}
                          className="rounded border border-line bg-white px-2 py-1 text-[12px] text-ink-muted hover:border-ink-faint focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass">
                          <option value="">{tr("+ Occupancy")}</option>
                          {canAddOcc.map((a) => (
                            <option key={a} value={a}>{tr.plural(a, "{n} adult", "{n} adults")}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )}
                </FragmentRows>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded border border-line">
        <h6 className="border-b border-line px-3 py-2 text-[13px] font-semibold text-ink">{tr("Rate Category Restrictions")}</h6>
        <table className="w-full min-w-[46rem] text-[12.5px]">
          <thead className="bg-shell/80">
            <tr className="border-b border-line">
              <th className="px-3 py-2 text-left text-[12px] font-semibold text-ink">{tr("Restriction")}</th>
              <th className="w-9" aria-label={tr("Copy Monday to every day")} />
              {dayHeads}
            </tr>
          </thead>
          <tbody>
            {restrictionRows.map((row) => (
              <tr key={row.key} className="border-b border-line">
                <td className="px-3 py-1.5 text-ink">{row.label}</td>
                <td className="px-0.5">
                  {canEdit && (
                    <button type="button" className={fillBtn}
                      aria-label={tr("Copy Monday to every day for {name}", { name: row.label })}
                      title={tr("Copy Monday to every day")}
                      onClick={() => setRestriction(row.key, "all", restrictions[row.key][0])}>
                      <FillIcon />
                    </button>
                  )}
                </td>
                {WEEKDAY_OF.map((wd, i) => (
                  <td key={wd} className="px-1 py-1.5 text-center">
                    {row.kind === "n" ? (
                      <input inputMode="numeric" value={restrictions[row.key][i] as string} readOnly={!canEdit}
                        aria-label={tr("{name}, {day}", { name: row.label, day: tr.weekday(wd) })}
                        onChange={(e) => setRestriction(row.key, i, e.target.value)} className={cell} />
                    ) : (
                      <input type="checkbox" className="h-4 w-4 accent-brass" checked={restrictions[row.key][i] as boolean}
                        aria-label={tr("{name}, {day}", { name: row.label, day: tr.weekday(wd) })}
                        onChange={(e) => canEdit && setRestriction(row.key, i, e.target.checked)} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
