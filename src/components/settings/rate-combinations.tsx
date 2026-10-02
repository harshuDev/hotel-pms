"use client";

import { Fragment, useState } from "react";
import { useT } from "@/components/i18n";
import { cn } from "@/components/ui";
import { useCurrency } from "@/components/currency";
import { formatMoneyInput, parseMoney } from "@/lib/money";
import type {
  CancellationPolicy,
  RatePlan,
  RatePlanCoverage,
  RoomTypeSetting,
  SeasonType,
  WeekRate,
} from "@/lib/types";
import { removeRateCombination, saveWeekRates } from "@/lib/actions/settings";
import { FilterSelect, type FilterOption } from "./filter-select";

/*
 * ROOM RATE COMBINATIONS, cloned from the client's reference (this round).
 * Every room type with each rate plan sold on it under it, Monday to Sunday:
 * the Rate, then MST MSA MXS, then CTA CTD SS -- all of it for one season, or
 * the Default Season. It is drawn in two frames: under the Rate Plans list,
 * with the season chosen in the filter, and as the panel the Seasons screen's
 * price button opens, with the season fixed.
 *
 * It is the SAME weekly template the rate plan's own form edits
 * (`rate_plan_week_rates`, saved by `save_week_rates()`), seen the other way
 * round: the form is one plan across room types, this is every pairing at
 * once. Two views of one table, not a second price list. Saving writes the
 * week onto the nights exactly as the form does: a season's own dates always
 * take its prices; the Default Season fills empty nights unless "Replace
 * prices already on these nights" is ticked.
 *
 * A PAIRING IS SHOWN WHEN IT IS IN USE -- priced from the business date or
 * given a week in any season -- or when "Add New Room Rate Combination" adds
 * it. That is what a plan being "sold on" a room type means everywhere else
 * here; there is no link table to consult.
 *
 * Occupancy rows ("Show Multi Occupancy Rates"): a plan priced per number of
 * adults types each row; one worked out per person shows them grey, from the
 * plan's increase and decrease per adult, as the plan's form does. A derived
 * plan ("Show derived and calculated rates", per room type) shows the
 * parent's rate adjusted and never sends one -- Postgres works it out -- but
 * its restrictions are its own.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

/** Monday first, as the reference's grid is; `tr.weekday` counts from Sunday. */
const WEEKDAY_OF = [1, 2, 3, 4, 5, 6, 0];

type Day = {
  rate: string;
  mst: string;
  msa: string;
  mxs: string;
  cta: boolean;
  ctd: boolean;
  ss: boolean;
  /** Adults -> price, for the occupancies other than the standard one. */
  occ: Record<number, string>;
  /** What was stored for the other occupancies, sent back untouched unless typed over. */
  storedOcc: Record<string, number> | null;
};

type Row = { days: Day[]; dirty: boolean };

const blankDay = (): Day => ({ rate: "", mst: "", msa: "", mxs: "", cta: false, ctd: false, ss: false, occ: {}, storedOcc: null });

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

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M8 1.5l1.9 4.1 4.5.5-3.3 3 .9 4.4L8 11.3l-4 2.2.9-4.4-3.3-3 4.5-.5z" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" aria-hidden="true">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
      {off && <path d="M2.5 13.5l11-11" />}
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <circle cx="8" cy="3" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="8" cy="13" r="1.4" />
    </svg>
  );
}

function BinIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </svg>
  );
}

function FillIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3.5L7.5 8 3 12.5M8.5 3.5L13 8l-4.5 4.5" />
    </svg>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="flex items-center gap-2.5 text-[12.5px] text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass">
      <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-brass" : "bg-line-strong")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

const rateBox =
  "tnum w-[4.4rem] rounded border border-line bg-white px-1 py-0.5 text-center text-[12.5px] text-ink outline-none focus:border-brass focus:ring-1 focus:ring-brass";
const tiny =
  "tnum w-6 rounded border border-transparent bg-transparent px-0 py-0 text-center text-[11.5px] text-ink outline-none hover:border-line focus:border-brass focus:bg-white";
const iconBtn =
  "grid h-7 w-7 place-items-center rounded text-ink-muted hover:bg-shell hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";

export function RateCombinations({
  ratePlans,
  roomTypes,
  seasons,
  cancellationPolicies,
  weekRates,
  coverage,
  initialSeasonId = null,
  lockSeason = false,
  onEditPlan,
  canEdit,
  pending,
  run,
}: {
  ratePlans: RatePlan[];
  roomTypes: RoomTypeSetting[];
  seasons: SeasonType[];
  cancellationPolicies: CancellationPolicy[];
  weekRates: WeekRate[];
  coverage: RatePlanCoverage[];
  /** The season to open on; null is the Default Season. */
  initialSeasonId?: string | null;
  /** The Seasons screen's panel prices one season, so its picker is fixed. */
  lockSeason?: boolean;
  /** The row's ⋮: opens the plan's own form. */
  onEditPlan?: (ratePlanId: string) => void;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const currency = useCurrency();
  const plans = ratePlans.filter((p) => p.isActive);
  // Seasons, then events, then the Default Season -- the reference's list.
  // Events price their own nights as of 0114.
  const seasonOptions: FilterOption[] = [
    ...seasons.filter((s) => s.kind === "season").map((s) => ({ id: s.id, name: s.name, color: s.color })),
    ...seasons.filter((s) => s.kind === "event").map((s) => ({ id: s.id, name: s.name, color: s.color, tag: tr("Event") })),
    { id: "default", name: tr("Default Season") },
  ];

  const [season, setSeason] = useState<string | null>(initialSeasonId);
  const [typeIds, setTypeIds] = useState<string[]>(roomTypes.map((t) => t.id));
  const [planIds, setPlanIds] = useState<string[]>(plans.map((p) => p.id));
  const [multi, setMulti] = useState(false);
  const [derivedOn, setDerivedOn] = useState<Record<string, boolean>>({});
  // Occupancy rows added in this session to a per-occupancy plan, before they
  // hold a price: "<season>|<plan>|<type>|<adults>".
  const [addedOcc, setAddedOcc] = useState<string[]>([]);
  // Rows removed and not yet saved, same keys: the Default Season only clears
  // a removed party's nightly prices when it replaces (save_week_rates()).
  const [removedOcc, setRemovedOcc] = useState<string[]>([]);
  const [replaceRates, setReplaceRates] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Row>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [adding, setAdding] = useState<{ typeId: string; planId: string } | null>(null);
  // The pair whose bin was pressed, awaiting its confirmation.
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  const seasonKey = season ?? "default";
  const k = (planId: string, typeId: string) => `${seasonKey}|${planId}|${typeId}`;
  const pairKey = (planId: string, typeId: string) => `${planId}|${typeId}`;
  const baseOf = (t: RoomTypeSetting) => Math.min(Math.max(t.baseOccupancy, 1), t.maxOccupancy);
  const typeName = (t: RoomTypeSetting) => t.displayName ?? t.name;

  const inUse = (planId: string, typeId: string) =>
    added.includes(pairKey(planId, typeId)) ||
    coverage.some((c) => c.ratePlanId === planId && c.roomTypeId === typeId) ||
    weekRates.some((w) => w.ratePlanId === planId && w.roomTypeId === typeId);

  function load(planId: string, t: RoomTypeSetting): Row {
    const b = baseOf(t);
    const days = WEEKDAY_OF.map((_, i) => {
      const w = weekRates.find(
        (x) => x.ratePlanId === planId && x.roomTypeId === t.id && x.seasonTypeId === season && x.weekday === i + 1,
      );
      if (!w) return blankDay();
      const occ: Record<number, string> = {};
      for (const [a, cents] of Object.entries(w.occupancyRates ?? {})) {
        if (Number(a) !== b) occ[Number(a)] = formatMoneyInput(cents);
      }
      return {
        rate: w.rateCents === null ? "" : formatMoneyInput(w.rateCents),
        mst: w.minStayThrough === null ? "" : String(w.minStayThrough),
        msa: w.minStayArrival === null ? "" : String(w.minStayArrival),
        mxs: w.maxStay === null ? "" : String(w.maxStay),
        cta: w.closedToArrival,
        ctd: w.closedToDeparture,
        ss: w.stopSell,
        occ,
        storedOcc: w.occupancyRates,
      };
    });
    return { days, dirty: false };
  }

  const row = (planId: string, t: RoomTypeSetting) => drafts[k(planId, t.id)] ?? load(planId, t);

  /*
   * The occupancy rows a plan draws under its standard row (video 2: "we want
   * the possibility to delete the one we don't want"). A per-person plan's
   * rows are worked out from the standard price, so all of them show. A
   * per-occupancy plan shows only the rows that hold a price, plus any added
   * here -- because an EMPTY row is exactly "this party pays the standard
   * price" (rate_plan_night_rate() falls back to it), removing a row is
   * clearing it, and a removed row stays removed after a reload.
   */
  function occupancyRows(p: RatePlan, t: RoomTypeSetting, r: Row): number[] {
    const b = baseOf(t);
    const all = Array.from({ length: t.maxOccupancy }, (_, x) => x + 1).filter((a) => a !== b);
    if (p.occupancyPricing === "per_person") return all;
    return all.filter(
      (a) => r.days.some((d) => (d.occ[a] ?? "").trim() !== "") || addedOcc.includes(`${k(p.id, t.id)}|${a}`),
    );
  }

  function removeOcc(p: RatePlan, t: RoomTypeSetting, a: number) {
    const r = row(p.id, t);
    const days = r.days.map((d) => {
      const occ = { ...d.occ };
      delete occ[a];
      return { ...d, occ };
    });
    setDrafts({ ...drafts, [k(p.id, t.id)]: { days, dirty: true } });
    setAddedOcc(addedOcc.filter((x) => x !== `${k(p.id, t.id)}|${a}`));
    setRemovedOcc([...removedOcc, `${k(p.id, t.id)}|${a}`]);
  }

  function setDay(planId: string, t: RoomTypeSetting, i: number | "all", patch: Partial<Day>) {
    const r = row(planId, t);
    const days = r.days.map((d, x) => {
      if (i === "all") return { ...r.days[0], ...patch, storedOcc: d.storedOcc };
      return x === i ? { ...d, ...patch } : d;
    });
    setDrafts({ ...drafts, [k(planId, t.id)]: { days, dirty: true } });
  }

  /** What an occupancy row shows: typed, or worked out per person from the standard price. */
  function occShown(plan: RatePlan, t: RoomTypeSetting, d: Day, adults: number): { text: string; computed: boolean } {
    if (plan.occupancyPricing === "per_occupancy") return { text: d.occ[adults] ?? "", computed: false };
    if (d.occ[adults]) return { text: d.occ[adults], computed: true };
    const base = money(d.rate);
    if (typeof base !== "number") return { text: "", computed: true };
    const b = baseOf(t);
    const up = plan.adultAdjustCents ?? 0;
    const down = plan.adultDecreaseCents ?? up;
    const cents = adults > b ? base + (adults - b) * up : base - (b - adults) * down;
    return { text: formatMoneyInput(Math.max(0, cents)), computed: true };
  }

  const parentRate = (plan: RatePlan, t: RoomTypeSetting, i: number): string => {
    if (!plan.parentRatePlanId) return "";
    const v = money(row(plan.parentRatePlanId, t).days[i].rate);
    return typeof v === "number" ? formatMoneyInput(derive(v, plan)) : "";
  };

  function collect(): { plan: RatePlan; type: RoomTypeSetting; days: Parameters<typeof saveWeekRates>[0]["days"] }[] | string {
    const out: { plan: RatePlan; type: RoomTypeSetting; days: Parameters<typeof saveWeekRates>[0]["days"] }[] = [];
    for (const t of roomTypes) {
      for (const p of plans) {
        const r = drafts[k(p.id, t.id)];
        if (!r?.dirty) continue;
        const name = `${p.name}, ${typeName(t)}`;
        const b = baseOf(t);
        const days: Parameters<typeof saveWeekRates>[0]["days"] = [];
        for (let i = 0; i < 7; i++) {
          const d = r.days[i];
          const day = tr.weekday(WEEKDAY_OF[i]);
          const mst = nights(d.mst);
          const msa = nights(d.msa);
          const mxs = nights(d.mxs);
          if (mst === "bad" || msa === "bad" || mxs === "bad") {
            return tr("{name}, {day}: a stay rule is a number of nights, 1 to 365.", { name, day });
          }
          let rateCents: number | null = null;
          let occupancyRates: Record<string, number> | null = null;
          if (!p.parentRatePlanId) {
            const v = money(d.rate);
            if (v === "bad") return tr("{name}, {day}: write the price as a number, such as 120 or 99.50.", { name, day });
            rateCents = v;
            if (p.occupancyPricing === "per_occupancy") {
              const typed: Record<string, number> = {};
              for (let a = 1; a <= t.maxOccupancy; a++) {
                if (a === b) continue;
                const o = money(d.occ[a] ?? "");
                if (o === "bad") return tr("{name}, {day}: write the price as a number, such as 120 or 99.50.", { name, day });
                if (o !== null) typed[a] = o;
              }
              if (rateCents === null && Object.keys(typed).length > 0) {
                return tr("{name}, {day}: fill the price for {n} adults first. It is the room's standard price.", { name, day, n: b });
              }
              occupancyRates = typed;
            } else if (p.occupancyPricing === "per_person") {
              occupancyRates = d.storedOcc ?? {};
            }
          }
          days.push({
            weekday: i + 1,
            rateCents,
            minStayThrough: mst,
            minStayArrival: msa,
            maxStay: mxs,
            closedToArrival: d.cta,
            closedToDeparture: d.ctd,
            stopSell: d.ss,
            occupancyRates,
          });
        }
        out.push({ plan: p, type: t, days });
      }
    }
    return out;
  }

  function saveAll() {
    setProblem("");
    const rows = collect();
    if (typeof rows === "string") return setProblem(rows);
    if (rows.length === 0) return setProblem(tr("Nothing has changed."));
    if (season === null && !replaceRates && removedOcc.some((x) => x.startsWith(`${seasonKey}|`))) {
      return setProblem(
        tr("Tick Replace prices already on these nights to take a removed occupancy price off the nights already priced."),
      );
    }
    run(async () => {
      for (const r of rows) {
        const result = await saveWeekRates({
          ratePlanId: r.plan.id,
          roomTypeId: r.type.id,
          seasonTypeId: season,
          days: r.days,
          replaceRates,
        });
        if (!result.ok) return result;
        // Saved rows are the stored state now; clear their drafts one by one
        // so a failure further down keeps only the rows that did not save.
        setDrafts((all) => {
          const next = { ...all };
          delete next[k(r.plan.id, r.type.id)];
          return next;
        });
        setRemovedOcc((all) => all.filter((x) => !x.startsWith(`${k(r.plan.id, r.type.id)}|`)));
      }
      return { ok: true };
    }, tr.plural(rows.length, "{n} room rate combination saved.", "{n} room rate combinations saved."));
  }

  const shownTypes = roomTypes.filter((t) => typeIds.includes(t.id));
  const plansFor = (t: RoomTypeSetting) =>
    plans.filter((p) => planIds.includes(p.id) && inUse(p.id, t.id) && (!p.parentRatePlanId || derivedOn[t.id]));
  const policyName = (id: string | null) => cancellationPolicies.find((c) => c.id === id)?.name ?? tr("Not set");
  const anyRows = shownTypes.some((t) => plansFor(t).length > 0);
  const dirty = Object.values(drafts).some((r) => r.dirty);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h3 className="shrink-0 text-[17px] text-ink">{tr("Filters")}</h3>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)_minmax(0,1fr)]">
        {lockSeason ? (
          <div className="min-w-0 text-[12px] text-ink-muted">
            {tr("Season")}
            <p className="mt-1 flex items-center gap-2 rounded border border-line bg-shell px-3 py-2 text-[14px] text-ink-muted">
              {seasonOptions.find((o) => o.id === seasonKey)?.color && (
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: seasonOptions.find((o) => o.id === seasonKey)?.color }} />
              )}
              {seasonOptions.find((o) => o.id === seasonKey)?.name ?? ""}
            </p>
          </div>
        ) : (
          <div className="min-w-0 text-[12px] text-ink-muted">
            {tr("Season")}
            <FilterSelect label={tr("Season")} options={seasonOptions} value={[seasonKey]}
              onChange={(ids) => setSeason(ids[0] === "default" ? null : (ids[0] ?? null))} />
          </div>
        )}
        <div className="min-w-0 text-[12px] text-ink-muted">
          {tr("Room types")}
          <FilterSelect multi label={tr("Room types")} value={typeIds} onChange={setTypeIds}
            options={roomTypes.map((t) => ({ id: t.id, name: typeName(t) }))} />
        </div>
        <div className="min-w-0 text-[12px] text-ink-muted">
          {tr("Rate Categories")}
          <FilterSelect multi label={tr("Rate Categories")} value={planIds} onChange={setPlanIds}
            options={plans.map((p) => ({ id: p.id, name: p.name }))} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <Switch on={multi} onChange={setMulti} label={tr("Show Multi Occupancy Rates")} />
        {season === null && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" className="h-4 w-4 accent-brass" checked={replaceRates}
              onChange={(e) => setReplaceRates(e.target.checked)} />
            {tr("Replace prices already on these nights")}
          </label>
        )}
      </div>

      <div className="flex items-center gap-4">
        <h3 className="shrink-0 text-[17px] text-ink">{tr("Room Rate Combinations")}</h3>
        <span className="h-px flex-1 bg-line" />
      </div>

      {!anyRows ? (
        <p className="text-[13px] text-ink-muted">{tr("No room rate combinations yet. Add one.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[68rem] text-[12px]">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left align-bottom text-[14px] font-semibold text-ink">{tr("Room types")}</th>
                <th className="w-16" aria-label={tr("Copy Monday to every day")} />
                {WEEKDAY_OF.map((wd) => (
                  <th key={wd} className="px-1 py-2 text-center align-bottom font-normal text-ink-muted">
                    <span className="block text-[14px] font-semibold text-ink">{tr.weekday(wd)}</span>
                    <span className="block text-[12px] text-ink">{tr("Rate")}</span>
                    <span className="mt-0.5 flex justify-center gap-1 text-[10.5px] text-ink">
                      <abbr title={tr("Min Stay Through")} className="w-6 no-underline">{tr("MST")}</abbr>
                      <abbr title={tr("Min Stay Arrival")} className="w-6 no-underline">{tr("MSA")}</abbr>
                      <abbr title={tr("Max Stay")} className="w-6 no-underline">{tr("MXS")}</abbr>
                    </span>
                    <span className="flex justify-center gap-1 text-[10.5px] text-ink">
                      <abbr title={tr("Closed To Arrival")} className="w-6 no-underline">{tr("CTA")}</abbr>
                      <abbr title={tr("Closed To Departure")} className="w-6 no-underline">{tr("CTD")}</abbr>
                      <abbr title={tr("Stop Sell")} className="w-6 no-underline">{tr("SS")}</abbr>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownTypes.map((t) => {
                const rows = plansFor(t);
                const hasDerived = plans.some((p) => p.parentRatePlanId && planIds.includes(p.id) && inUse(p.id, t.id));
                if (rows.length === 0 && !hasDerived) return null;
                const b = baseOf(t);
                return (
                  <Fragment key={t.id}>
                    <tr className="border-y border-line bg-shell/70">
                      <td className="px-3 py-3 text-[14px] text-ink">{typeName(t)}</td>
                      <td colSpan={8} className="px-3 py-2">
                        <Switch on={!!derivedOn[t.id]} onChange={(v) => setDerivedOn({ ...derivedOn, [t.id]: v })}
                          label={tr("Show derived and calculated rates")} />
                      </td>
                    </tr>
                    {rows.map((p) => {
                      const r = row(p.id, t);
                      const derived = !!p.parentRatePlanId;
                      // The top switch shows every type's occupancy rows; a room
                      // type's own switch shows its derived plans AND its
                      // occupancy rows ("derived and calculated rates"). It used
                      // to show derived plans only, so on a type with none the
                      // switch moved and nothing appeared.
                      const showOcc = (multi || !!derivedOn[t.id]) && !derived && p.occupancyPricing !== "single";
                      const occRows = showOcc ? occupancyRows(p, t, r) : [];
                      const canAddOcc =
                        showOcc && canEdit && p.occupancyPricing === "per_occupancy"
                          ? Array.from({ length: t.maxOccupancy }, (_, x) => x + 1).filter(
                              (a) => a !== b && !occRows.includes(a),
                            )
                          : [];
                      return (
                        <Fragment key={p.id}>
                          <tr className={cn("align-top", occRows.length === 0 && canAddOcc.length === 0 && "border-b border-line")}>
                            <td className="px-3 py-3">
                              <p className="text-[15px] font-semibold text-ink">{p.name}</p>
                              <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink">
                                <span className="flex items-center gap-0.5" title={tr.plural(b, "{n} adult", "{n} adults")}><PersonIcon />{b}</span>
                                <span className="flex items-center gap-0.5" title={tr.plural(0, "{n} child", "{n} children")}><ChildIcon />0</span>
                                {p.isDefault && <span title={tr("Main rate")}><StarIcon /></span>}
                                <span title={p.isPublic ? tr("On the guest booking page") : tr("Not on the guest booking page")}>
                                  <EyeIcon off={!p.isPublic} />
                                </span>
                              </p>
                              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                                {policyName(p.cancellationPolicyId)}, {currency}
                              </p>
                              {derived && (
                                <p className="text-[11.5px] text-ink-muted">
                                  {tr("Derived from {name}", { name: plans.find((x) => x.id === p.parentRatePlanId)?.name ?? "" })}
                                </p>
                              )}
                            </td>
                            <td className="px-0 py-3">
                              <span className="flex items-center">
                                {onEditPlan && (
                                  <button type="button" className={iconBtn} title={tr("Edit rate plan")}
                                    aria-label={tr("Edit {name}", { name: p.name })} onClick={() => onEditPlan(p.id)}>
                                    <KebabIcon />
                                  </button>
                                )}
                                {canEdit && (
                                  <button type="button" className={iconBtn} title={tr("Copy Monday to every day")}
                                    aria-label={tr("Copy Monday to every day for {name}", { name: `${p.name}, ${typeName(t)}` })}
                                    onClick={() => setDay(p.id, t, "all", {})}>
                                    <FillIcon />
                                  </button>
                                )}
                                {canEdit && !derived && (
                                  <button type="button" className={cn(iconBtn, "text-rose-600")} title={tr("Remove from this room type")}
                                    aria-label={tr("Remove {plan} from {type}", { plan: p.name, type: typeName(t) })}
                                    onClick={() => setRemoving(pairKey(p.id, t.id))}>
                                    <BinIcon />
                                  </button>
                                )}
                              </span>
                              {removing === pairKey(p.id, t.id) && (
                                <span className="mt-1 flex w-max flex-col gap-1 rounded border border-rose-200 bg-rose-50 p-2 text-[12px] text-ink">
                                  {tr("Remove {plan} from {type}?", { plan: p.name, type: typeName(t) })}
                                  <span className="flex gap-1">
                                    <button type="button" className="rounded bg-rose-600 px-2 py-0.5 font-semibold text-white disabled:opacity-60"
                                      disabled={pending}
                                      onClick={() => {
                                        const key = pairKey(p.id, t.id);
                                        setRemoving(null);
                                        const saved =
                                          coverage.some((c) => c.ratePlanId === p.id && c.roomTypeId === t.id) ||
                                          weekRates.some((w) => w.ratePlanId === p.id && w.roomTypeId === t.id);
                                        setAdded(added.filter((x) => x !== key));
                                        setDrafts(Object.fromEntries(Object.entries(drafts).filter(([dk]) => !dk.endsWith(`|${key}`))));
                                        if (!saved) return;
                                        run(
                                          () => removeRateCombination({ ratePlanId: p.id, roomTypeId: t.id }),
                                          tr("{plan} removed from {type}.", { plan: p.name, type: typeName(t) }),
                                        );
                                      }}>
                                      {tr("Remove")}
                                    </button>
                                    <button type="button" className="rounded border border-line bg-white px-2 py-0.5"
                                      onClick={() => setRemoving(null)}>
                                      {tr("Cancel")}
                                    </button>
                                  </span>
                                </span>
                              )}
                            </td>
                            {WEEKDAY_OF.map((wd, i) => {
                              const d = r.days[i];
                              const day = tr.weekday(wd);
                              const label = (what: string) => tr("{name}, {day}: {what}", { name: `${p.name}, ${typeName(t)}`, day, what });
                              return (
                                <td key={wd} className="px-1 py-3 text-center">
                                  {derived ? (
                                    <span className="tnum block py-0.5 text-[12.5px] text-ink-muted">{parentRate(p, t, i) || "—"}</span>
                                  ) : (
                                    <input inputMode="decimal" value={d.rate} readOnly={!canEdit} aria-label={label(tr("Rate"))}
                                      onChange={(e) => setDay(p.id, t, i, { rate: e.target.value })} className={rateBox} />
                                  )}
                                  <span className="mt-1.5 flex justify-center gap-1">
                                    <input inputMode="numeric" value={d.mst} readOnly={!canEdit} aria-label={label(tr("Min Stay Through"))}
                                      placeholder="1" onChange={(e) => setDay(p.id, t, i, { mst: e.target.value })} className={tiny} />
                                    <input inputMode="numeric" value={d.msa} readOnly={!canEdit} aria-label={label(tr("Min Stay Arrival"))}
                                      placeholder="1" onChange={(e) => setDay(p.id, t, i, { msa: e.target.value })} className={tiny} />
                                    <input inputMode="numeric" value={d.mxs} readOnly={!canEdit} aria-label={label(tr("Max Stay"))}
                                      placeholder="0" onChange={(e) => setDay(p.id, t, i, { mxs: e.target.value })} className={tiny} />
                                  </span>
                                  <span className="mt-1.5 flex justify-center gap-1">
                                    {(["cta", "ctd", "ss"] as const).map((f) => (
                                      <span key={f} className="grid w-6 place-items-center">
                                        <input type="checkbox" className="h-3.5 w-3.5 accent-brass" checked={d[f]}
                                          aria-label={label(f === "cta" ? tr("Closed To Arrival") : f === "ctd" ? tr("Closed To Departure") : tr("Stop Sell"))}
                                          onChange={(e) => canEdit && setDay(p.id, t, i, { [f]: e.target.checked })} />
                                      </span>
                                    ))}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                          {occRows.map((a, x) => (
                            <tr key={a} className={cn(x === occRows.length - 1 && "border-b border-line")}>
                              <td className="px-3 pb-2 text-[12.5px] text-ink-muted">
                                <span className="flex items-center gap-1.5" aria-label={tr.plural(a, "{n} adult", "{n} adults")}>
                                  <span className="flex items-center gap-0.5"><PersonIcon />{a}</span>
                                  <span className="flex items-center gap-0.5"><ChildIcon />0</span>
                                  {canEdit && p.occupancyPricing === "per_occupancy" && (
                                    <button type="button" onClick={() => removeOcc(p, t, a)}
                                      title={tr("Remove")}
                                      aria-label={tr("Remove the {n} adults price for {name}", { n: a, name: `${p.name}, ${typeName(t)}` })}
                                      className="ml-1 grid h-5 w-5 place-items-center rounded text-[14px] leading-none text-ink-faint hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass">
                                      ×
                                    </button>
                                  )}
                                </span>
                              </td>
                              <td />
                              {WEEKDAY_OF.map((wd, i) => {
                                const s = occShown(p, t, r.days[i], a);
                                return (
                                  <td key={wd} className="px-1 pb-2 text-center">
                                    {s.computed ? (
                                      <span className="tnum block py-0.5 text-[12.5px] text-ink-faint">{s.text || "—"}</span>
                                    ) : (
                                      <input inputMode="decimal" value={s.text} readOnly={!canEdit}
                                        aria-label={tr("{name}, {n} adults, {day}", { name: `${p.name}, ${typeName(t)}`, n: a, day: tr.weekday(wd) })}
                                        onChange={(e) => setDay(p.id, t, i, { occ: { ...r.days[i].occ, [a]: e.target.value } })}
                                        className={rateBox} />
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                          {canAddOcc.length > 0 && (
                            <tr className="border-b border-line">
                              <td colSpan={9} className="px-3 pb-2.5">
                                <select
                                  value=""
                                  aria-label={tr("Add an occupancy price for {name}", { name: `${p.name}, ${typeName(t)}` })}
                                  onChange={(e) => {
                                    const a = Number(e.target.value);
                                    if (a) setAddedOcc([...addedOcc, `${k(p.id, t.id)}|${a}`]);
                                  }}
                                  className="rounded border border-line bg-white px-2 py-1 text-[12px] text-ink-muted hover:border-ink-faint focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass"
                                >
                                  <option value="">{tr("+ Occupancy")}</option>
                                  {canAddOcc.map((a) => (
                                    <option key={a} value={a}>{tr.plural(a, "{n} adult", "{n} adults")}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {problem && <p role="alert" className="text-[12.5px] text-rose-700">{problem}</p>}

      {canEdit && (
        <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
          {adding ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[12px] text-ink-muted">
                {tr("Room type")}
                <select value={adding.typeId} onChange={(e) => setAdding({ ...adding, typeId: e.target.value })}
                  className="mt-1 block rounded border border-line bg-white px-2 py-1.5 text-[13px] text-ink">
                  {roomTypes.map((t) => <option key={t.id} value={t.id}>{typeName(t)}</option>)}
                </select>
              </label>
              <label className="text-[12px] text-ink-muted">
                {tr("Rate category")}
                <select value={adding.planId} onChange={(e) => setAdding({ ...adding, planId: e.target.value })}
                  className="mt-1 block rounded border border-line bg-white px-2 py-1.5 text-[13px] text-ink">
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <button type="button" className="rounded bg-brass px-3 py-2 text-[13px] text-white hover:bg-brass/90"
                onClick={() => {
                  const plan = plans.find((p) => p.id === adding.planId);
                  setAdded([...added, pairKey(adding.planId, adding.typeId)]);
                  if (!typeIds.includes(adding.typeId)) setTypeIds([...typeIds, adding.typeId]);
                  if (!planIds.includes(adding.planId)) setPlanIds([...planIds, adding.planId]);
                  if (plan?.parentRatePlanId) setDerivedOn({ ...derivedOn, [adding.typeId]: true });
                  setAdding(null);
                }}>
                {tr("Add")}
              </button>
              <button type="button" className="rounded border border-line px-3 py-2 text-[13px] text-ink hover:bg-shell"
                onClick={() => setAdding(null)}>
                {tr("Cancel")}
              </button>
            </div>
          ) : (
            <button type="button" className="rounded bg-brass px-4 py-2 text-[13.5px] text-white hover:bg-brass/90"
              onClick={() => roomTypes[0] && plans[0] && setAdding({ typeId: roomTypes[0].id, planId: plans[0].id })}>
              {tr("Add New Room Rate Combination")}
            </button>
          )}
          <div className="flex gap-2">
            <button type="button" className="rounded border border-line bg-white px-4 py-2 text-[13.5px] text-ink hover:bg-shell"
              onClick={() => { setDrafts({}); setAddedOcc([]); setRemovedOcc([]); setProblem(""); }}>
              {tr("Reset Changes")}
            </button>
            <button type="button" disabled={pending} onClick={saveAll}
              className={cn(
                "rounded px-4 py-2 text-[13.5px] font-medium disabled:opacity-50",
                dirty ? "bg-chrome-800 text-white hover:bg-chrome-900" : "border border-line bg-white text-ink hover:bg-shell",
              )}>
              {tr("Save Changes")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
