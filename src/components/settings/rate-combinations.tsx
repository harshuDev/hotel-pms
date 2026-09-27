"use client";

import { useT } from "@/components/i18n";
import { useState } from "react";
import { useCurrency } from "@/components/currency";
import { formatMoneyInput, parseMoney } from "@/lib/money";
import type {
  CancellationPolicy,
  RatePlan,
  RoomTypeSetting,
  SeasonType,
  WeekRate,
} from "@/lib/types";
import { saveWeekRates } from "@/lib/actions/settings";

/*
 * Settings -> Rate Plans -> Room Rate Combinations (0096), cloned from the
 * client's reference: for a season (or the Default Season), each room type
 * with each rate plan under it, and a Monday-to-Sunday rate with MST, MSA,
 * MXS, CTA, CTD and SS.
 *
 * SAVING FILLS, IT NEVER OVERWRITES -- the client's rule. A night that already
 * has a price keeps it; a restriction is added where none is set; a tick is
 * only ever added. The Inventory screens stay the way to change a night that
 * already has a value. Nights are from the business date on: a season's own
 * dates, or the next year of days no season covers.
 *
 * Not copied: "Show Multi Occupancy Rates" and "Show derived and calculated
 * rates" (there are no per-occupancy or derived rates here), and the row's
 * menu and arrow, whose actions have not been seen.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayDraft = {
  rate: string;
  mst: string;
  msa: string;
  mxs: string;
  cta: boolean;
  ctd: boolean;
  ss: boolean;
};

const EMPTY: DayDraft = { rate: "", mst: "", msa: "", mxs: "", cta: false, ctd: false, ss: false };

function draftsFor(rates: WeekRate[], plan: string, type: string, season: string | null): DayDraft[] {
  return DAYS.map((_, i) => {
    const w = rates.find(
      (r) => r.ratePlanId === plan && r.roomTypeId === type && r.seasonTypeId === season && r.weekday === i + 1,
    );
    if (!w) return EMPTY;
    return {
      rate: w.rateCents === null ? "" : formatMoneyInput(w.rateCents),
      mst: w.minStayThrough === null ? "" : String(w.minStayThrough),
      msa: w.minStayArrival === null ? "" : String(w.minStayArrival),
      mxs: w.maxStay === null ? "" : String(w.maxStay),
      cta: w.closedToArrival,
      ctd: w.closedToDeparture,
      ss: w.stopSell,
    };
  });
}

function nights(s: string): number | null | "bad" {
  if (s.trim() === "") return null;
  return /^\s*\d{1,3}\s*$/.test(s) && Number(s) >= 1 && Number(s) <= 365 ? Number(s) : "bad";
}

const small =
  "w-7 rounded border border-line bg-white px-0.5 py-0.5 text-center text-[11px] text-ink outline-none focus:border-brass";

export function RateCombinations({
  ratePlans,
  roomTypes,
  seasons,
  cancellationPolicies,
  weekRates,
  canEdit,
  pending,
  run,
}: {
  /** Selling plans only. */
  ratePlans: RatePlan[];
  roomTypes: RoomTypeSetting[];
  /** Seasons only (kind 'season'). */
  seasons: SeasonType[];
  cancellationPolicies: CancellationPolicy[];
  weekRates: WeekRate[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const currency = useCurrency();
  const [season, setSeason] = useState<string | null>(null);
  const [typeIds, setTypeIds] = useState<string[]>(roomTypes.map((t) => t.id));
  const [planIds, setPlanIds] = useState<string[]>(ratePlans.map((p) => p.id));
  const [drafts, setDrafts] = useState<Record<string, DayDraft[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const key = (plan: string, type: string) => `${season ?? "default"}|${plan}|${type}`;
  const rowDraft = (plan: string, type: string) =>
    drafts[key(plan, type)] ?? draftsFor(weekRates, plan, type, season);

  function setDay(plan: string, type: string, i: number, patch: Partial<DayDraft>) {
    const k = key(plan, type);
    const row = [...rowDraft(plan, type)];
    row[i] = { ...row[i], ...patch };
    setDrafts({ ...drafts, [k]: row });
  }

  function save(plan: RatePlan, type: RoomTypeSetting) {
    const row = rowDraft(plan.id, type.id);
    const days: Parameters<typeof saveWeekRates>[0]["days"] = [];
    for (let i = 0; i < 7; i++) {
      const d = row[i];
      let rateCents: number | null = null;
      if (d.rate.trim() !== "") {
        try {
          rateCents = parseMoney(d.rate);
        } catch {
          setNotes({ ...notes, [key(plan.id, type.id)]: `${DAYS[i]}: write the rate as a number.` });
          return;
        }
        if (rateCents < 0) {
          setNotes({ ...notes, [key(plan.id, type.id)]: `${DAYS[i]}: a rate cannot be negative.` });
          return;
        }
      }
      const mst = nights(d.mst);
      const msa = nights(d.msa);
      const mxs = nights(d.mxs);
      if (mst === "bad" || msa === "bad" || mxs === "bad") {
        setNotes({ ...notes, [key(plan.id, type.id)]: `${DAYS[i]}: a stay rule is a number of nights, 1 to 365.` });
        return;
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
      });
    }
    const k = key(plan.id, type.id);
    run(async () => {
      const result = await saveWeekRates({ ratePlanId: plan.id, roomTypeId: type.id, seasonTypeId: season, days });
      if (result.ok) {
        const n = result.data.filled;
        setNotes({ ...notes, [k]: `${n} night${n === 1 ? "" : "s"} priced` });
      }
      return result;
    }, tr("{name} on {name2} saved.", { name: plan.name, name2: type.name }));
  }

  const shownTypes = roomTypes.filter((t) => typeIds.includes(t.id));
  const shownPlans = ratePlans.filter((p) => planIds.includes(p.id));
  const policyName = (id: string | null) => cancellationPolicies.find((c) => c.id === id)?.name ?? "No policy";

  function Chips({
    all,
    chosen,
    set,
    label: l,
  }: {
    all: { id: string; name: string }[];
    chosen: string[];
    set: (ids: string[]) => void;
    label: string;
  }) {
    const rest = all.filter((a) => !chosen.includes(a.id));
    return (
      <div className="flex min-h-[34px] flex-wrap items-center gap-1 rounded border border-line bg-white px-1.5 py-1">
        {all
          .filter((a) => chosen.includes(a.id))
          .map((a) => (
            <span key={a.id} className="flex items-center gap-1 rounded border border-line bg-shell px-1.5 py-0.5 text-[11.5px] text-ink">
              {a.name}
              <button type="button" aria-label={tr("Remove {name}", { name: a.name })} className="text-ink-faint hover:text-ink"
                onClick={() => set(chosen.filter((c) => c !== a.id))}>
                ×
              </button>
            </span>
          ))}
        {rest.length > 0 && (
          <select aria-label={tr("Add {l}", { l: l })} value="" onChange={(e) => e.target.value && set([...chosen, e.target.value])}
            className="min-w-[4rem] flex-1 border-0 bg-transparent text-[11.5px] text-ink-muted outline-none">
            <option value="">{tr("Add…")}</option>
            {rest.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
      </div>
    );
  }

  return (
    <section className="rounded border border-line bg-white p-4 shadow-card sm:p-6">
      <h3 className="border-b border-line pb-1 text-[14px] text-ink">{tr("Filters")}</h3>
      <div className="mt-3 grid gap-4 md:grid-cols-[14rem_1fr_1fr]">
        <label className="block text-[11px] text-ink-muted">
          {tr("Season")}
          <select value={season ?? ""} onChange={(e) => setSeason(e.target.value || null)}
            className="mt-1 w-full rounded border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink">
            <option value="">{tr("Default Season")}</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <div className="text-[11px] text-ink-muted">
          {tr("Room types")}
          <div className="mt-1">
            {Chips({ all: roomTypes.map((t) => ({ id: t.id, name: t.displayName ?? t.name })), chosen: typeIds, set: setTypeIds, label: tr("room type") })}
          </div>
        </div>
        <div className="text-[11px] text-ink-muted">
          {tr("Rate Categories")}
          <div className="mt-1">
            {Chips({ all: ratePlans.map((p) => ({ id: p.id, name: p.name })), chosen: planIds, set: setPlanIds, label: tr("rate category") })}
          </div>
        </div>
      </div>

      <h3 className="mt-6 border-b border-line pb-1 text-[14px] text-ink">{tr("Room Rate Combinations")}</h3>
      {shownTypes.length === 0 || shownPlans.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-ink-muted">{tr("Choose at least one room type and one rate category.")}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[64rem] text-[11.5px]">
            <thead>
              <tr>
                <th className="px-2 py-2 text-left align-bottom text-[12px] font-semibold text-ink">{tr("Room types")}</th>
                {DAYS.map((d) => (
                  <th key={d} className="px-1 py-2 text-center font-normal text-ink-muted">
                    <span className="block text-[12px] font-semibold text-ink">{d}</span>
                    <span className="block">{tr("Rate")}</span>
                    <span className="block text-[9.5px]">{tr("MST MSA MXS")}</span>
                    <span className="block text-[9.5px]">{tr("CTA CTD SS")}</span>
                  </th>
                ))}
                <th className="w-20" aria-label={tr("Save")} />
              </tr>
            </thead>
            <tbody>
              {shownTypes.map((t) => (
                <FragmentRows key={t.id}>
                  <tr className="bg-shell/80">
                    <td colSpan={9} className="px-2 py-2 text-[12px] text-ink">{t.displayName ?? t.name}</td>
                  </tr>
                  {shownPlans.map((p) => {
                    const row = rowDraft(p.id, t.id);
                    const note = notes[key(p.id, t.id)];
                    return (
                      <tr key={p.id} className="border-b border-line align-top">
                        <td className="px-2 py-2">
                          <p className="text-[12.5px] font-semibold text-ink">{p.name}</p>
                          <p className="text-[11px] text-ink-muted">
                            {tr("Sleeps")}{" "}{t.baseOccupancy}
                            {t.maxOccupancy > t.baseOccupancy ? ` + ${t.maxOccupancy - t.baseOccupancy}` : ""}
                          </p>
                          <p className="text-[11px] text-ink-muted">
                            {policyName(p.cancellationPolicyId)}, {currency}
                          </p>
                        </td>
                        {row.map((d, i) => (
                          <td key={i} className="px-1 py-2 text-center">
                            <input aria-label={tr("{name}, {name2}, {value} rate", { name: p.name, name2: t.name, value: DAYS[i] })} inputMode="decimal"
                              value={d.rate} readOnly={!canEdit}
                              onChange={(e) => setDay(p.id, t.id, i, { rate: e.target.value })}
                              className="tnum w-[4.6rem] rounded border border-line bg-white px-1 py-0.5 text-center text-[12px] text-ink outline-none focus:border-brass" />
                            <span className="mt-1 flex justify-center gap-0.5">
                              <input aria-label={tr("{value} min stay through", { value: DAYS[i] })} inputMode="numeric" value={d.mst} readOnly={!canEdit}
                                onChange={(e) => setDay(p.id, t.id, i, { mst: e.target.value })} className={small} />
                              <input aria-label={tr("{value} min stay arrival", { value: DAYS[i] })} inputMode="numeric" value={d.msa} readOnly={!canEdit}
                                onChange={(e) => setDay(p.id, t.id, i, { msa: e.target.value })} className={small} />
                              <input aria-label={tr("{value} max stay", { value: DAYS[i] })} inputMode="numeric" value={d.mxs} readOnly={!canEdit}
                                onChange={(e) => setDay(p.id, t.id, i, { mxs: e.target.value })} className={small} />
                            </span>
                            <span className="mt-1 flex justify-center gap-2.5">
                              <input type="checkbox" aria-label={tr("{value} closed to arrival", { value: DAYS[i] })} checked={d.cta} readOnly={!canEdit}
                                onChange={(e) => canEdit && setDay(p.id, t.id, i, { cta: e.target.checked })} className="h-3 w-3 accent-brass" />
                              <input type="checkbox" aria-label={tr("{value} closed to departure", { value: DAYS[i] })} checked={d.ctd} readOnly={!canEdit}
                                onChange={(e) => canEdit && setDay(p.id, t.id, i, { ctd: e.target.checked })} className="h-3 w-3 accent-brass" />
                              <input type="checkbox" aria-label={tr("{value} stop sell", { value: DAYS[i] })} checked={d.ss} readOnly={!canEdit}
                                onChange={(e) => canEdit && setDay(p.id, t.id, i, { ss: e.target.checked })} className="h-3 w-3 accent-brass" />
                            </span>
                          </td>
                        ))}
                        <td className="px-1 py-2 text-right">
                          {canEdit && (
                            <button type="button" disabled={pending} onClick={() => save(p, t)}
                              className="rounded-md bg-chrome-800 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-chrome-900 disabled:opacity-50">
                              {tr("Save")}
                            </button>
                          )}
                          {note && <p className="mt-1 text-[10.5px] text-ink-muted">{note}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </FragmentRows>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
