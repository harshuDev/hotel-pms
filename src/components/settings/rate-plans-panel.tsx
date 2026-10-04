"use client";

import { useT } from "@/components/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/components/ui";
import { useCurrency } from "@/components/currency";
import type {
  CancellationPolicy,
  ChannelSetting,
  MealType,
  RatePlan,
  RatePlanCoverage,
  RoomTypeSetting,
  SeasonType,
  TaxRateSetting,
  WeekRate,
} from "@/lib/types";
import { PlanRates, type PlanRatesHandle } from "@/components/settings/plan-rates";
import { RateCombinations } from "@/components/settings/rate-combinations";
import type { AccountingCategory } from "@/lib/finance-profiles";
import { formatPercentBps, parsePercentBps } from "@/lib/finance-profiles";
import { formatMoneyInput, parseMoney } from "@/lib/money";
import {
  deleteRatePlan,
  saveRatePlan,
  setRatePlanCancellationPolicy,
  setRatePlanTerms,
  saveWeekRates,
} from "@/lib/actions/settings";
import { setRatePlanExtras, setRatePlanMealPlan } from "@/lib/actions/inventory";
import { FilterSelect } from "@/components/settings/filter-select";
import type { ExtrasCatalog } from "@/lib/extras";
import { MEAL_PLANS, MEAL_PLAN_LABEL, type MealPlan } from "@/lib/meal-plans";
import {
  EXTRA_CHARGE_ONS,
  EXTRA_CHARGE_ON_LABEL,
  EXTRA_FREQUENCIES,
  EXTRA_FREQUENCY_LABEL,
  EXTRA_PER_UNITS,
  EXTRA_PER_UNIT_LABEL,
  EXTRA_POSTINGS,
  EXTRA_POSTING_LABEL,
  defaultRatePlanExtra,
  sameRatePlanExtras,
  type ExtraChargeOn,
  type ExtraFrequency,
  type ExtraPerUnit,
  type ExtraPosting,
  type RatePlanExtra,
} from "@/lib/rate-plan-extras";

/*
 * Settings -> Inventory -> Rate Plans, cloned from the client's reference's
 * "Rate categories": Title, Currency, Cancellation Policy, the main rate's
 * tick, a pencil and a red bin, "Add New Rate Plan" and "Show Expired Rates".
 *
 * "Expired" is a plan no longer selling (`is_active = false`): hidden until
 * the box is ticked, and put back on sale from its form. The bin is refused
 * for the main rate and for a plan anything was sold on (0094).
 *
 * "Show Special Offer Rates" is not copied: offers here reduce a stay
 * (promotions), they do not create rate plans, so there are none to show.
 *
 * THE FORM CARRIES THE REFERENCE'S RATE PLAN TERMS (0109): meals, booking
 * conditions, a derived rate, occupancy pricing, the tax and ledger account,
 * and the channels. Every one is enforced or applied in Postgres
 * (`set_rate_plan_terms()`); none is a stored wish.
 *
 * THE PLAN'S PRICES ARE IN ITS FORM (0110), as the reference has them and as
 * the client asked in a Loom: season, affected room types, a row per number
 * of adults, ">>" to copy Monday across, and the restrictions as their own
 * rows -- `PlanRates`. One Save stores the terms and then the week, which is
 * written onto the nights.
 *
 * THE FORM IS A POPUP, THE REFERENCE'S (0115): the pencil opens it over the
 * list, laid out as theirs -- Title and Meal Type, Cancellation Policy and
 * Currency, the advance days, "Active at specific date range", Max Adults and
 * Max Children, Derived Rate, One Price For All Occupancies, the prices and
 * restrictions, Sell With Extras, Attached Taxes, Accounting Category, "Only
 * For Channels (Hide on IBE)" and "Save as default rate". Meal Type is one of
 * the reference's eight (`rate_plans.meal_plan`); Sell With Extras is stored,
 * not charged. The code is not on the form -- the reference has none -- so a
 * new plan is given one from its title.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

type Relation = "up_percent" | "down_percent" | "up_amount" | "down_amount";

type Draft = {
  id: string | null;
  code: string;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  cancellationPolicyId: string;
  /** What the policy was when the form opened, so only a change is sent. */
  wasPolicyId: string;
  mealPlan: MealPlan;
  wasMealPlan: MealPlan;
  meals: MealType[];
  wasMeals: MealType[];
  /** Sell With Extras with their terms (0118); the price as typed, blank is the catalog's. */
  extras: ExtraDraft[];
  wasExtras: RatePlanExtra[];
  /** "Active at specific date range". */
  dated: boolean;
  /** The minimums are not on the reference's form; drawn only when a plan has one. */
  showMinimums: boolean;
  minDaysAdvance: string;
  maxDaysAdvance: string;
  minAdults: string;
  maxAdults: string;
  minChildren: string;
  maxChildren: string;
  validFrom: string;
  validTo: string;
  derived: boolean;
  parentRatePlanId: string;
  relation: Relation;
  adjustment: string;
  singlePrice: boolean;
  /** "Automatic Calculation": the other occupancies worked out per person. */
  automatic: boolean;
  perAdult: string;
  decreaseAdult: string;
  perChild: string;
  /** In the order chosen; none is no tax. */
  taxRateIds: string[];
  accountingCategoryId: string;
  /** None is every channel. */
  channelIds: string[];
};

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];

/** A whole number from a field, null when blank, "bad" when not a number. */
function count(s: string): number | null | "bad" {
  if (s.trim() === "") return null;
  return /^\s*\d{1,4}\s*$/.test(s) ? Number(s) : "bad";
}

/** A new plan's code, from its title: the initials, unique on the property. */
function codeFor(title: string, taken: string[]): string {
  const initials = title
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 6);
  const base = initials || "RATE";
  const used = new Set(taken.map((c) => c.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

/**
 * The plan a NEW draft's price grid runs on before it has an id: nothing is
 * stored against "new", so the grid starts empty, and a derivation ticked on
 * the form draws the parent's week adjusted, as it will be once saved.
 */
function newPlanFor(d: Draft): RatePlan {
  const down = d.relation.startsWith("down");
  let derivedPercentBps: number | null = null;
  let derivedAmountCents: number | null = null;
  if (d.derived && d.relation.endsWith("percent")) {
    const bps = parsePercentBps(d.adjustment);
    derivedPercentBps = bps === null ? null : down ? -bps : bps;
  } else if (d.derived) {
    try {
      const c = parseMoney(d.adjustment);
      derivedAmountCents = down ? -c : c;
    } catch {
      derivedAmountCents = null;
    }
  }
  return {
    id: "new",
    code: "",
    name: d.name,
    description: null,
    isDefault: d.isDefault,
    isActive: true,
    isPublic: false,
    mealPlan: d.mealPlan,
    meals: d.meals,
    mealValues: {},
    cancellationPolicyId: d.cancellationPolicyId || null,
    minDaysAdvance: null,
    maxDaysAdvance: null,
    minAdults: null,
    maxAdults: null,
    minChildren: null,
    maxChildren: null,
    validFrom: null,
    validTo: null,
    parentRatePlanId: d.derived && d.parentRatePlanId ? d.parentRatePlanId : null,
    derivedKind: d.derived ? (d.relation.endsWith("percent") ? "percent" : "amount") : null,
    derivedPercentBps,
    derivedAmountCents,
    occupancyPricing: d.singlePrice ? "single" : d.automatic ? "per_person" : "per_occupancy",
    adultAdjustCents: null,
    childAdjustCents: null,
    adultDecreaseCents: null,
    taxRateIds: d.taxRateIds,
    accountingCategoryId: d.accountingCategoryId || null,
    channelIds: d.channelIds,
    extras: [],
  };
}

function draftOf(p: RatePlan | null, defaultPolicyId: string): Draft {
  const policy = p ? (p.cancellationPolicyId ?? "") : defaultPolicyId;
  const n = (v: number | null) => (v === null ? "" : String(v));
  const pct = p?.derivedPercentBps ?? null;
  const amt = p?.derivedAmountCents ?? null;
  return {
    id: p?.id ?? null,
    code: p?.code ?? "",
    name: p?.name ?? "",
    description: p?.description ?? "",
    isDefault: p?.isDefault ?? false,
    isActive: p?.isActive ?? true,
    cancellationPolicyId: policy,
    wasPolicyId: p ? policy : "",
    mealPlan: p?.mealPlan ?? "room_only",
    wasMealPlan: p?.mealPlan ?? "room_only",
    meals: p?.meals ?? [],
    wasMeals: p?.meals ?? [],
    extras: (p?.extras ?? []).map(extraDraftOf),
    wasExtras: p?.extras ?? [],
    dated: !!(p?.validFrom || p?.validTo),
    showMinimums: (p?.minAdults ?? null) !== null || (p?.minChildren ?? null) !== null,
    minDaysAdvance: n(p?.minDaysAdvance ?? null),
    maxDaysAdvance: n(p?.maxDaysAdvance ?? null),
    minAdults: n(p?.minAdults ?? null),
    maxAdults: n(p?.maxAdults ?? null),
    minChildren: n(p?.minChildren ?? null),
    maxChildren: n(p?.maxChildren ?? null),
    validFrom: p?.validFrom ?? "",
    validTo: p?.validTo ?? "",
    derived: !!p?.parentRatePlanId,
    parentRatePlanId: p?.parentRatePlanId ?? "",
    relation:
      p?.derivedKind === "amount"
        ? (amt ?? 0) < 0 ? "down_amount" : "up_amount"
        : (pct ?? -1) < 0 ? "down_percent" : "up_percent",
    adjustment:
      p?.derivedKind === "amount" && amt !== null
        ? formatMoneyInput(Math.abs(amt))
        : p?.derivedKind === "percent" && pct !== null
          ? formatPercentBps(Math.abs(pct))
          : "",
    singlePrice: (p?.occupancyPricing ?? "single") === "single",
    automatic: p?.occupancyPricing === "per_person",
    perAdult: p?.adultAdjustCents != null ? formatMoneyInput(p.adultAdjustCents) : "",
    decreaseAdult:
      p?.adultDecreaseCents != null
        ? formatMoneyInput(p.adultDecreaseCents)
        : p?.adultAdjustCents != null
          ? formatMoneyInput(p.adultAdjustCents)
          : "",
    perChild: p?.childAdjustCents != null ? formatMoneyInput(p.childAdjustCents) : "",
    taxRateIds: p?.taxRateIds ?? [],
    accountingCategoryId: p?.accountingCategoryId ?? "",
    channelIds: p?.channelIds ?? [],
  };
}

const th = "px-3 py-3 text-left text-[12px] font-semibold text-ink";
const label = "block text-[12px] text-ink-muted";
const field =
  "mt-1 w-full rounded-md border border-line px-3 py-2 text-[14px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const primary =
  "rounded-md bg-chrome-800 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-chrome-900 disabled:opacity-50";
const section = "mt-5 border-b border-line pb-1 text-[13px] font-semibold text-ink";
const secondary =
  "rounded-md border border-line bg-white px-4 py-2 text-[12.5px] font-semibold text-ink hover:bg-shell";

function SortIcon({ active, desc }: { active: boolean; desc: boolean }) {
  return (
    <svg viewBox="0 0 10 12" className="h-3 w-2.5" aria-hidden="true">
      <path d="M5 1l3.5 4h-7z" className={active && !desc ? "fill-brass" : "fill-ink-faint"} />
      <path d="M5 11l3.5-4h-7z" className={active && desc ? "fill-brass" : "fill-ink-faint"} />
    </svg>
  );
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-3 w-3", active ? "fill-brass" : "fill-ink-faint")} aria-hidden="true">
      <path d="M6.5 1a5.5 5.5 0 014.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 116.5 1zm0 1.5a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  );
}

function FunnelIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-3 w-3", active ? "fill-brass" : "fill-ink-faint")} aria-hidden="true">
      <path d="M1.5 2h13l-5 6v5l-3 1.5V8z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    </svg>
  );
}

function BinIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
    </svg>
  );
}

/*
 * The reference's rate plan popup: a centred panel over the list. Portalled to
 * <body>, because the Settings page sits under the sticky top nav's stacking
 * context -- the trap the calendar's room menu documents. Escape closes it;
 * a FilterSelect that is open takes its own Escape first.
 */
function PlanPopup({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const tr = useT();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-chrome-900/50 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="rate-plan-popup-title"
        className="my-2 w-full max-w-6xl rounded-lg border border-line bg-white shadow-lift">
        <div className="flex items-center gap-4 rounded-t-lg bg-chrome-800 px-4 py-3 sm:px-6">
          <h2 id="rate-plan-popup-title" className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold tracking-tightest text-white">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label={tr("Close")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15 text-white transition hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
              <path d="M4.3 3 3 4.3 6.7 8 3 11.7 4.3 13 8 9.3l3.7 3.7 1.3-1.3L9.3 8 13 4.3 11.7 3 8 6.7z" />
            </svg>
          </button>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** A label, the reference's way: on the left, ending in a colon, "*" when required. */
type ExtraDraft = Omit<RatePlanExtra, "priceCents"> & { price: string };

const extraDraftOf = (x: RatePlanExtra): ExtraDraft => {
  const { priceCents, ...rest } = x;
  return { ...rest, price: priceCents === null ? "" : formatMoneyInput(priceCents) };
};

/*
 * How each extra sold with the rate is charged (0118) -- one row per extra,
 * so every hotel sets its own: added to the bill or included in the rate,
 * per night or per stay, per room or per person, how many, at what price,
 * and when an added one posts.
 */
function ExtrasTerms({
  extras,
  catalog,
  onChange,
}: {
  extras: ExtraDraft[];
  catalog: ExtrasCatalog;
  onChange: (extras: ExtraDraft[]) => void;
}) {
  const tr = useT();
  const currency = useCurrency();
  const cell =
    "w-full rounded border border-line bg-white px-2 py-1.5 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
  const th = "px-2 pb-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint";
  const update = (i: number, patch: Partial<ExtraDraft>) =>
    onChange(
      extras.map((x, j) => {
        if (j !== i) return x;
        const next = { ...x, ...patch };
        if (next.posting === "included") next.chargeOn = null;
        else if (next.chargeOn === null) next.chargeOn = "each_night";
        if (next.posting === "added" && next.chargeOn === "each_night") next.frequency = "per_night";
        return next;
      }),
    );
  return (
    <div className="mt-2 overflow-x-auto rounded border border-line bg-shell/60 p-2">
      <table className="w-full min-w-[46rem] text-[13px]">
        <thead>
          <tr>
            <th className={th}>{tr("Extra")}</th>
            <th className={th}>{tr("Charged")}</th>
            <th className={th}>{tr("When")}</th>
            <th className={th}>{tr("Frequency")}</th>
            <th className={th}>{tr("Per")}</th>
            <th className={`${th} w-16`}>{tr("Qty")}</th>
            <th className={`${th} w-28`}>{tr("Price")}</th>
          </tr>
        </thead>
        <tbody>
          {extras.map((x, i) => {
            const extra = catalog.extras.find((e) => e.id === x.extraId);
            const name = extra?.title ?? "";
            return (
              <tr key={x.extraId} className="align-top">
                <td className="px-2 py-1 pt-2.5 font-medium text-ink">{name}</td>
                <td className="px-1 py-1">
                  <select
                    aria-label={tr("How {name} is charged", { name })}
                    className={cell}
                    value={x.posting}
                    onChange={(e) => update(i, { posting: e.target.value as ExtraPosting })}
                  >
                    {EXTRA_POSTINGS.map((v) => (
                      <option key={v} value={v}>
                        {tr(EXTRA_POSTING_LABEL[v])}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-1">
                  {x.posting === "added" ? (
                    <select
                      aria-label={tr("When {name} is charged", { name })}
                      className={cell}
                      value={x.chargeOn ?? "each_night"}
                      onChange={(e) => update(i, { chargeOn: e.target.value as ExtraChargeOn })}
                    >
                      {EXTRA_CHARGE_ONS.map((v) => (
                        <option key={v} value={v}>
                          {tr(EXTRA_CHARGE_ON_LABEL[v])}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="px-1 pt-1.5 text-ink-muted">{tr("With the room charge")}</p>
                  )}
                </td>
                <td className="px-1 py-1">
                  {x.posting === "added" && x.chargeOn === "each_night" ? (
                    <p className="px-1 pt-1.5 text-ink-muted">{tr(EXTRA_FREQUENCY_LABEL.per_night)}</p>
                  ) : (
                    <select
                      aria-label={tr("How often {name} is charged", { name })}
                      className={cell}
                      value={x.frequency}
                      onChange={(e) => update(i, { frequency: e.target.value as ExtraFrequency })}
                    >
                      {EXTRA_FREQUENCIES.map((v) => (
                        <option key={v} value={v}>
                          {tr(EXTRA_FREQUENCY_LABEL[v])}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-1 py-1">
                  <select
                    aria-label={tr("What {name} is counted by", { name })}
                    className={cell}
                    value={x.perUnit}
                    onChange={(e) => update(i, { perUnit: e.target.value as ExtraPerUnit })}
                  >
                    {EXTRA_PER_UNITS.map((v) => (
                      <option key={v} value={v}>
                        {tr(EXTRA_PER_UNIT_LABEL[v])}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    aria-label={tr("Quantity of {name}", { name })}
                    className={`${cell} tnum`}
                    value={x.quantity}
                    onChange={(e) =>
                      update(i, { quantity: Math.min(99, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })
                    }
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    inputMode="decimal"
                    aria-label={tr("Price of {name}", { name })}
                    className={`${cell} tnum`}
                    value={x.price}
                    placeholder={extra ? formatMoneyInput(extra.priceCents) : ""}
                    onChange={(e) => update(i, { price: e.target.value })}
                  />
                  <p className="px-1 pt-0.5 text-[11px] text-ink-faint">{currency}</p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, required, htmlFor, children, wide }: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("grid items-start gap-1 sm:grid-cols-[10.5rem_1fr] sm:gap-3", wide && "lg:col-span-2")}>
      <label htmlFor={htmlFor} className="pt-2.5 text-[13px] text-ink-muted sm:text-right">
        {required && <span className="text-rose-600">* </span>}
        {label}:
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TickCircle() {
  const tr = useT();
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={tr("Main rate")} className="h-3.5 w-3.5">
      <circle cx="8" cy="8" r="8" className="fill-emerald-500" />
      <path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RatePlansPanel({
  ratePlans,
  cancellationPolicies,
  roomTypes,
  taxRates,
  accountingCategories,
  channels,
  extrasCatalog,
  coverage,
  seasons,
  weekRates,
  openPlanId = null,
  openSeasonId = null,
  canEdit,
  pending,
  run,
}: {
  /** Every plan, retired ones included. */
  ratePlans: RatePlan[];
  cancellationPolicies: CancellationPolicy[];
  roomTypes: RoomTypeSetting[];
  taxRates: TaxRateSetting[];
  accountingCategories: AccountingCategory[];
  channels: ChannelSetting[];
  /** Sell With Extras picks from the catalog (0115). */
  extrasCatalog: ExtrasCatalog;
  coverage: RatePlanCoverage[];
  seasons: SeasonType[];
  weekRates: WeekRate[];
  /** Open this plan's form on arrival -- the Seasons screen's price button (0110). */
  openPlanId?: string | null;
  /** The season its prices open on; null is the Default Season. */
  openSeasonId?: string | null;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const currency = useCurrency();
  const ratesRef = useRef<PlanRatesHandle>(null);
  const [showExpired, setShowExpired] = useState(false);
  const [sortBy, setSortBy] = useState<"title" | "policy" | null>(null);
  const [desc, setDesc] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [policyFilter, setPolicyFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() => {
    const p = openPlanId ? ratePlans.find((x) => x.id === openPlanId) : undefined;
    return p && canEdit ? draftOf(p, cancellationPolicies.find((c) => c.isDefault)?.id ?? "") : null;
  });

  const policyName = (id: string | null) =>
    cancellationPolicies.find((c) => c.id === id)?.name ?? tr("Not set");
  const defaultPolicyId = cancellationPolicies.find((c) => c.isDefault)?.id ?? "";

  const rows = useMemo(() => {
    const q = (search ?? "").trim().toLowerCase();
    const list = ratePlans.filter(
      (p) =>
        (showExpired || p.isActive) &&
        (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)) &&
        (policyFilter === null || (p.cancellationPolicyId ?? "") === policyFilter),
    );
    if (sortBy) {
      const names = new Map(cancellationPolicies.map((c) => [c.id, c.name]));
      const key = (p: RatePlan) =>
        sortBy === "title" ? p.name : (names.get(p.cancellationPolicyId ?? "") ?? tr("Not set"));
      list.sort((a, b) => key(a).localeCompare(key(b)) * (desc ? -1 : 1));
    }
    return list;
  }, [ratePlans, cancellationPolicies, showExpired, search, policyFilter, sortBy, desc]);

  function sort(by: "title" | "policy") {
    if (sortBy === by) setDesc(!desc);
    else {
      setSortBy(by);
      setDesc(false);
    }
  }

  function open(p: RatePlan | null) {
    const d = draftOf(p, defaultPolicyId);
    // A new plan starts on the hotel's default tax -- the top of Tax
    // Information, as the booking form seeds it -- not on "No tax".
    if (!p) d.taxRateIds = taxRates.filter((t) => t.isActive && t.kind === "tax").slice(0, 1).map((t) => t.id);
    setDraft(d);
  }

  const planName = (id: string | null) => ratePlans.find((p) => p.id === id)?.name ?? "";

  /** The form's text as the terms Postgres takes, or the first problem found. */
  function termsOf(d: Draft): Omit<Parameters<typeof setRatePlanTerms>[0], "ratePlanId"> | string {
    const nums = {
      minDaysAdvance: count(d.minDaysAdvance),
      maxDaysAdvance: count(d.maxDaysAdvance),
      minAdults: count(d.minAdults),
      maxAdults: count(d.maxAdults),
      minChildren: count(d.minChildren),
      maxChildren: count(d.maxChildren),
    };
    if (Object.values(nums).some((v) => v === "bad")) {
      return tr("Days, adults and children are whole numbers.");
    }
    let derivedKind: "percent" | "amount" | null = null;
    let derivedPercentBps: number | null = null;
    let derivedAmountCents: number | null = null;
    if (d.derived) {
      if (!d.parentRatePlanId) return tr("Choose the parent rate.");
      const down = d.relation.startsWith("down");
      if (d.relation.endsWith("percent")) {
        const bps = parsePercentBps(d.adjustment);
        if (bps === null) return tr("Write the adjustment as a percentage, such as 10 or 12.5.");
        derivedKind = "percent";
        derivedPercentBps = down ? -bps : bps;
      } else {
        let cents: number;
        try {
          cents = parseMoney(d.adjustment);
        } catch {
          return tr("Write the adjustment as an amount, such as 10 or 12.50.");
        }
        if (cents <= 0) return tr("Write the adjustment as an amount, such as 10 or 12.50.");
        derivedKind = "amount";
        derivedAmountCents = down ? -cents : cents;
      }
    }
    let adultAdjustCents: number | null = null;
    let childAdjustCents: number | null = null;
    let adultDecreaseCents: number | null = null;
    if (!d.singlePrice && d.automatic) {
      try {
        adultAdjustCents = d.perAdult.trim() === "" ? 0 : parseMoney(d.perAdult);
        adultDecreaseCents = d.decreaseAdult.trim() === "" ? 0 : parseMoney(d.decreaseAdult);
        childAdjustCents = d.perChild.trim() === "" ? 0 : parseMoney(d.perChild);
      } catch {
        return tr("Write the increases and the decrease as amounts, such as 50 or 12.50.");
      }
      if (adultAdjustCents < 0 || adultDecreaseCents < 0 || childAdjustCents < 0) {
        return tr("Write the increases and the decrease as amounts, such as 50 or 12.50.");
      }
    }
    return {
      minDaysAdvance: nums.minDaysAdvance as number | null,
      maxDaysAdvance: nums.maxDaysAdvance as number | null,
      minAdults: nums.minAdults as number | null,
      maxAdults: nums.maxAdults as number | null,
      minChildren: nums.minChildren as number | null,
      maxChildren: nums.maxChildren as number | null,
      validFrom: d.dated ? d.validFrom || null : null,
      validTo: d.dated ? d.validTo || null : null,
      parentRatePlanId: d.derived ? d.parentRatePlanId : null,
      derivedKind,
      derivedPercentBps,
      derivedAmountCents,
      occupancyPricing: d.singlePrice ? "single" : d.automatic ? "per_person" : "per_occupancy",
      adultAdjustCents,
      childAdjustCents,
      adultDecreaseCents,
      taxRateIds: d.taxRateIds,
      accountingCategoryId: d.accountingCategoryId || null,
      channelIds: d.channelIds,
    };
  }

  const [formError, setFormError] = useState<string | null>(null);

  function save(d: Draft) {
    const terms = termsOf(d);
    if (typeof terms === "string") {
      setFormError(terms);
      return;
    }
    // The prices are checked before anything is saved, so a typo in the
    // grid never leaves the terms saved and the week not.
    const week = ratesRef.current?.collect() ?? null;
    if (typeof week === "string") {
      setFormError(week);
      return;
    }
    const extras: RatePlanExtra[] = [];
    for (const x of d.extras) {
      let priceCents: number | null = null;
      if (x.price.trim() !== "") {
        try {
          priceCents = parseMoney(x.price);
        } catch {
          priceCents = -1;
        }
        if (priceCents < 0) {
          const title = extrasCatalog.extras.find((e) => e.id === x.extraId)?.title ?? "";
          setFormError(tr("The price of {name} is not an amount", { name: title }));
          return;
        }
      }
      extras.push({
        extraId: x.extraId,
        posting: x.posting,
        frequency: x.frequency,
        perUnit: x.perUnit,
        quantity: x.quantity,
        priceCents,
        chargeOn: x.chargeOn,
      });
    }
    setFormError(null);
    run(async () => {
      const saved = await saveRatePlan({
        id: d.id,
        code: d.code.trim() || codeFor(d.name, ratePlans.filter((p) => p.id !== d.id).map((p) => p.code)),
        name: d.name,
        description: d.description,
        isDefault: d.isDefault,
        isActive: d.isActive,
      });
      if (!saved.ok) return saved;
      // Its own RPC, so a rename never resends the policy (0060). A new plan
      // already took the default policy by trigger; only a different choice
      // is sent.
      if (d.cancellationPolicyId !== (d.id ? d.wasPolicyId : defaultPolicyId)) {
        const set = await setRatePlanCancellationPolicy(saved.data.id, d.cancellationPolicyId || null);
        if (!set.ok) return set;
      }
      const setTerms = await setRatePlanTerms({ ratePlanId: saved.data.id, ...terms });
      if (!setTerms.ok) return setTerms;
      if (
        d.mealPlan !== d.wasMealPlan ||
        (d.mealPlan === "custom" && [...d.meals].sort().join() !== [...d.wasMeals].sort().join())
      ) {
        const meals = await setRatePlanMealPlan({ ratePlanId: saved.data.id, mealPlan: d.mealPlan, meals: d.meals });
        if (!meals.ok) return meals;
      }
      if (!sameRatePlanExtras(extras, d.wasExtras)) {
        const set = await setRatePlanExtras({ ratePlanId: saved.data.id, extras });
        if (!set.ok) return set;
      }
      if (week) {
        for (const row of week.rows) {
          const result = await saveWeekRates({
            ratePlanId: saved.data.id,
            roomTypeId: row.roomTypeId,
            seasonTypeId: week.seasonTypeId,
            days: row.days,
            replaceRates: week.replaceRates,
          });
          if (!result.ok) {
            return { ok: false, error: tr("{name}: {error}", { name: row.roomTypeName, error: result.error }) };
          }
        }
      }
      // The prices went in with the plan, so a new one closes like an edit.
      setDraft(null);
      return { ok: true };
    }, d.id ? tr("Rate plan saved.") : tr("Rate plan created."));
  }

  const fieldR = "w-full rounded border border-line bg-white px-3 py-2 text-[14px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
  const tick = "flex items-center gap-2 text-[13.5px] text-ink";
  const activeExtras = [...extrasCatalog.extras].sort((a, b) => a.title.localeCompare(b.title));

  function form(draft: Draft) {
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
    const numberField = (k: "minDaysAdvance" | "maxDaysAdvance" | "minAdults" | "maxAdults" | "minChildren" | "maxChildren", l: string) => (
      <Row label={l} htmlFor={`rp-${k}`}>
        <input id={`rp-${k}`} inputMode="numeric" value={draft[k]} placeholder={l} className={cn(fieldR, "tnum")}
          onChange={(e) => set({ [k]: e.target.value } as Partial<Draft>)} />
      </Row>
    );
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(draft);
        }}
      >
        <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
          <Row label={tr("Title")} required htmlFor="rp-title">
            <input id="rp-title" autoFocus value={draft.name} className={fieldR}
              onChange={(e) => set({ name: e.target.value })} />
          </Row>
          <Row label={tr("Meal Type")} required>
            <FilterSelect
              label={tr("Meal Type")}
              value={[draft.mealPlan]}
              options={MEAL_PLANS.map((m) => ({ id: m, name: tr(MEAL_PLAN_LABEL[m]) }))}
              onChange={(ids) => ids[0] && set({ mealPlan: ids[0] as MealPlan })}
            />
            {draft.mealPlan === "custom" && (
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                {MEALS.map((m) => (
                  <label key={m} className={tick}>
                    <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.meals.includes(m)}
                      onChange={(e) =>
                        set({ meals: e.target.checked ? [...draft.meals, m] : draft.meals.filter((x) => x !== m) })
                      } />
                    {m === "breakfast" ? tr("Breakfast") : m === "lunch" ? tr("Lunch") : tr("Dinner")}
                  </label>
                ))}
              </div>
            )}
          </Row>
          <Row label={tr("Cancellation Policy")} required>
            <FilterSelect
              label={tr("Cancellation Policy")}
              value={[draft.cancellationPolicyId || "none"]}
              options={[
                ...cancellationPolicies.map((c) => ({ id: c.id, name: c.name })),
                { id: "none", name: tr("Not set") },
              ]}
              onChange={(ids) => set({ cancellationPolicyId: ids[0] === "none" ? "" : (ids[0] ?? "") })}
            />
          </Row>
          <Row label={tr("Currency")} required>
            <p className="rounded border border-line bg-shell px-3 py-2 text-[14px] text-ink-muted">{currency}</p>
          </Row>
          <Row label={tr("Description")} htmlFor="rp-description" wide>
            <input id="rp-description" value={draft.description} className={fieldR}
              onChange={(e) => set({ description: e.target.value })} />
          </Row>
          {numberField("minDaysAdvance", tr("Min Days Advance"))}
          {numberField("maxDaysAdvance", tr("Max Days Advance"))}
        </div>

        <label className={cn(tick, "mt-5")}>
          <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.dated}
            onChange={(e) => set({ dated: e.target.checked })} />
          {tr("Active at specific date range")}
        </label>
        {draft.dated && (
          <div className="mt-3 grid gap-x-8 gap-y-4 lg:grid-cols-2">
            <Row label={tr("From")} htmlFor="rp-from">
              <input id="rp-from" type="date" value={draft.validFrom} className={fieldR}
                onChange={(e) => set({ validFrom: e.target.value })} />
            </Row>
            <Row label={tr("To")} htmlFor="rp-to">
              <input id="rp-to" type="date" value={draft.validTo} className={fieldR}
                onChange={(e) => set({ validTo: e.target.value })} />
            </Row>
          </div>
        )}

        <div className="mt-5 grid gap-x-8 gap-y-4 lg:grid-cols-2">
          {numberField("maxAdults", tr("Max Adults"))}
          {numberField("maxChildren", tr("Max Children"))}
          {draft.showMinimums && numberField("minAdults", tr("Min Adults"))}
          {draft.showMinimums && numberField("minChildren", tr("Min Children"))}
        </div>

        <label className={cn(tick, "mt-5")}>
          <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.derived}
            onChange={(e) => set({ derived: e.target.checked })} />
          {tr("Derived Rate")}
        </label>
        {draft.derived && (
          <div className="mt-3 grid gap-x-8 gap-y-4 lg:grid-cols-3">
            <Row label={tr("Parent Rate")}>
              <FilterSelect
                label={tr("Parent Rate")}
                value={draft.parentRatePlanId ? [draft.parentRatePlanId] : []}
                options={ratePlans
                  .filter((p) => p.id !== draft.id && !p.parentRatePlanId)
                  .map((p) => ({ id: p.id, name: p.name }))}
                onChange={(ids) => set({ parentRatePlanId: ids[0] ?? "" })}
              />
            </Row>
            <Row label={tr("Relation")}>
              <FilterSelect
                label={tr("Relation")}
                value={[draft.relation]}
                options={[
                  { id: "down_percent", name: tr("Decrease by %") },
                  { id: "up_percent", name: tr("Increase by %") },
                  { id: "down_amount", name: tr("Decrease by amount") },
                  { id: "up_amount", name: tr("Increase by amount") },
                ]}
                onChange={(ids) => ids[0] && set({ relation: ids[0] as Relation })}
              />
            </Row>
            <Row label={tr("Amount")} htmlFor="rp-amount">
              <input id="rp-amount" inputMode="decimal" value={draft.adjustment} className={cn(fieldR, "tnum")}
                placeholder={draft.relation.endsWith("percent") ? "10" : "10.00"}
                onChange={(e) => set({ adjustment: e.target.value })} />
            </Row>
          </div>
        )}

        <label className={cn(tick, "mt-5")}>
          <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.singlePrice}
            onChange={(e) => set({ singlePrice: e.target.checked })} />
          {tr("One Price For All Occupancies")}
        </label>
        {!draft.singlePrice && (
          <div className="mt-3 grid items-end gap-4 sm:grid-cols-4">
            <label className={cn(tick, "pb-2")}>
              <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.automatic}
                onChange={(e) => set({ automatic: e.target.checked })} />
              {tr("Automatic Calculation")}
            </label>
            {draft.automatic && (
              <>
                <label className={label}>
                  {tr("Increase Per Adult")}
                  <input inputMode="decimal" value={draft.perAdult} placeholder="0.00" className={cn(field, "tnum")}
                    onChange={(e) => set({ perAdult: e.target.value })} />
                </label>
                <label className={label}>
                  {tr("Decrease Per Adult")}
                  <input inputMode="decimal" value={draft.decreaseAdult} placeholder="0.00" className={cn(field, "tnum")}
                    onChange={(e) => set({ decreaseAdult: e.target.value })} />
                </label>
                <label className={label}>
                  {tr("Increase Per Child")}
                  <input inputMode="decimal" value={draft.perChild} placeholder="0.00" className={cn(field, "tnum")}
                    onChange={(e) => set({ perChild: e.target.value })} />
                </label>
              </>
            )}
          </div>
        )}

        {(() => {
          // A new plan is priced in the same form, as the reference's is: the
          // grid runs on the draft, and one Save creates the plan and then
          // writes its week under the id it was given.
          const plan = draft.id ? ratePlans.find((p) => p.id === draft.id) : newPlanFor(draft);
          if (!plan) return null;
          const cents = (v: string) => {
            try {
              return v.trim() === "" ? 0 : Math.max(0, parseMoney(v));
            } catch {
              return 0;
            }
          };
          return (
            <>
              <h5 className={section}>{tr("Rates")}</h5>
              <PlanRates
                key={`${draft.id ?? "new"}|${openSeasonId ?? ""}`}
                ref={ratesRef}
                plan={plan}
                mode={draft.singlePrice ? "single" : draft.automatic ? "per_person" : "per_occupancy"}
                increaseAdultCents={cents(draft.perAdult)}
                decreaseAdultCents={cents(draft.decreaseAdult)}
                parent={ratePlans.find((p) => p.id === plan.parentRatePlanId) ?? null}
                roomTypes={roomTypes}
                seasons={seasons}
                weekRates={weekRates}
                coverage={coverage}
                initialSeasonId={plan.id === openPlanId ? openSeasonId : null}
                canEdit={canEdit}
              />
            </>
          );
        })()}

        <div className="mt-6 grid gap-y-4">
          <Row label={tr("Sell With Extras")}>
            <FilterSelect
              multi
              label={tr("Sell With Extras")}
              value={draft.extras.map((x) => x.extraId)}
              options={activeExtras.map((x) => ({ id: x.id, name: x.title }))}
              onChange={(ids) =>
                set({
                  extras: ids.map(
                    (id) =>
                      draft.extras.find((x) => x.extraId === id) ?? extraDraftOf(defaultRatePlanExtra(id)),
                  ),
                })
              }
            />
            {draft.extras.length > 0 && (
              <ExtrasTerms
                extras={draft.extras}
                catalog={extrasCatalog}
                onChange={(extras) => set({ extras })}
              />
            )}
          </Row>
          <Row label={tr("Attached Taxes")} required>
            <FilterSelect
              multi
              label={tr("Attached Taxes")}
              value={draft.taxRateIds}
              options={taxRates
                .filter((t) => t.isActive || draft.taxRateIds.includes(t.id))
                .map((t) => ({ id: t.id, name: t.name }))}
              onChange={(ids) => set({ taxRateIds: ids })}
            />
          </Row>
          <Row label={tr("Accounting Category")}>
            <FilterSelect
              label={tr("Accounting Category")}
              value={[draft.accountingCategoryId || "none"]}
              options={[
                ...accountingCategories.map((c) => ({ id: c.id, name: c.name })),
                { id: "none", name: tr("The room type's") },
              ]}
              onChange={(ids) => set({ accountingCategoryId: ids[0] === "none" ? "" : (ids[0] ?? "") })}
            />
          </Row>
          <Row label={tr("Only For Channels (Hide on IBE)")}>
            <FilterSelect
              multi
              label={tr("Only For Channels (Hide on IBE)")}
              value={draft.channelIds}
              options={channels.map((c) => ({ id: c.id, name: c.name }))}
              onChange={(ids) => set({ channelIds: ids })}
            />
          </Row>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 sm:pl-[11.25rem]">
          <label className={tick}>
            <input type="checkbox" checked={draft.isDefault} className="h-4 w-4 accent-brass"
              onChange={(e) => set({ isDefault: e.target.checked })} />
            {tr("Save as default rate")}
          </label>
          <label className={tick}>
            <input type="checkbox" checked={draft.isActive} className="h-4 w-4 accent-brass"
              onChange={(e) => set({ isActive: e.target.checked })} />
            {tr("Still selling")}
          </label>
        </div>

        {formError && <p role="alert" className="mt-4 text-[12.5px] text-rose-700">{formError}</p>}
        <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
          <button type="button" className={secondary} onClick={() => { setFormError(null); setDraft(null); }}>
            {tr("Cancel")}
          </button>
          <button type="submit" className={primary} disabled={pending}>
            {tr("Save")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="max-w-6xl space-y-2">
      <h2 className="border-b border-line pb-1 text-[20px] text-ink">{tr("Rate Plans")}</h2>
      <section className="rounded border border-line bg-white p-4 shadow-card sm:p-10">
        <div className="rounded border border-line">
          <h3 className="border-b border-line px-4 py-3 text-[13px] font-semibold text-ink">{tr("Rate categories")}</h3>
          <div className="p-3 sm:p-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-[12.5px]">
                <thead className="bg-shell/80">
                  <tr className="border-b border-line">
                    <th className={cn(th, "w-[34%]")}>
                      <span className="flex items-center justify-between gap-2">
                        {search === null ? (
                          tr("Title")
                        ) : (
                          <input
                            autoFocus
                            aria-label={tr("Search rate plans")}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={tr("Search")}
                            className="w-full rounded border border-line bg-white px-2 py-0.5 text-[12px] font-normal text-ink outline-none focus:border-brass"
                          />
                        )}
                        <span className="flex shrink-0 items-center gap-1.5">
                          <button type="button" aria-label={tr("Sort by title")} onClick={() => sort("title")} className="p-0.5">
                            <SortIcon active={sortBy === "title"} desc={desc} />
                          </button>
                          <button
                            type="button"
                            aria-label={search === null ? tr("Search titles") : tr("Stop searching")}
                            onClick={() => setSearch(search === null ? "" : null)}
                            className="p-0.5"
                          >
                            <SearchIcon active={search !== null && search.trim() !== ""} />
                          </button>
                        </span>
                      </span>
                    </th>
                    <th className={cn(th, "w-[22%]")}>{tr("Currency")}</th>
                    <th className={cn(th, "relative w-[30%]")}>
                      <span className="flex items-center justify-between gap-2">
                        {tr("Cancellation Policy")}
                        <span className="flex items-center gap-1.5">
                          <button type="button" aria-label={tr("Sort by cancellation policy")} onClick={() => sort("policy")} className="p-0.5">
                            <SortIcon active={sortBy === "policy"} desc={desc} />
                          </button>
                          <button
                            type="button"
                            aria-label={tr("Filter by cancellation policy")}
                            aria-expanded={filterOpen}
                            onClick={() => setFilterOpen(!filterOpen)}
                            className="p-0.5"
                          >
                            <FunnelIcon active={policyFilter !== null} />
                          </button>
                        </span>
                      </span>
                      {filterOpen && (
                        <div className="absolute right-2 top-full z-20 mt-1 w-52 rounded-md border border-line bg-white py-1 text-[12.5px] font-normal shadow-card">
                          {[{ id: null, name: "All" }, ...cancellationPolicies.map((c) => ({ id: c.id, name: c.name })), { id: "", name: "Not set" }].map((o) => (
                            <button
                              key={o.id ?? "all"}
                              type="button"
                              onClick={() => {
                                setPolicyFilter(o.id);
                                setFilterOpen(false);
                              }}
                              className={cn(
                                "block w-full px-3 py-1.5 text-left hover:bg-shell",
                                policyFilter === o.id ? "font-semibold text-ink" : "text-ink-muted",
                              )}
                            >
                              {o.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </th>
                    <th className="w-16" aria-label={tr("Main rate")} />
                    <th className="w-24" aria-label={tr("Actions")} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={cn("border-b border-line", draft?.id === p.id && "bg-shell/70")}>
                      <td className={cn("px-3 py-3.5", p.isActive ? "text-ink" : "text-ink-faint")}>
                        {p.name}
                        {p.parentRatePlanId && (
                          <span className="block text-[11px] text-ink-faint">
                            {tr("Derived from {name}", { name: planName(p.parentRatePlanId) })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-ink">{currency}</td>
                      <td className="bg-shell/40 px-3 py-3.5 text-ink">{policyName(p.cancellationPolicyId)}</td>
                      <td className="px-3 py-3.5">{p.isDefault && <TickCircle />}</td>
                      <td className="px-3 py-2">
                        {canEdit && (
                          <span className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              aria-label={tr("Edit {name}", { name: p.name })}
                              onClick={() => open(p)}
                              className="rounded p-1 text-ink hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                            >
                              <PencilIcon />
                            </button>
                            {/* Not on the main rate; a sold plan is refused by name. */}
                            {!p.isDefault && (
                              <button
                                type="button"
                                aria-label={tr("Delete {name}", { name: p.name })}
                                disabled={pending}
                                onClick={() => {
                                  if (!confirm(tr("Delete {name}? Its prices go with it.", { name: p.name }))) return;
                                  run(async () => {
                                    const result = await deleteRatePlan(p.id);
                                    if (result.ok && draft?.id === p.id) setDraft(null);
                                    return result;
                                  }, tr("{name} deleted.", { name: p.name }));
                                }}
                                className="grid h-7 w-7 place-items-center rounded-full border border-rose-500 text-rose-600 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-500"
                              >
                                <BinIcon />
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-5 text-ink-muted">
                        {ratePlans.length === 0 ? tr("None yet. Add the rate the hotel sells.") : tr("No rate plan matches.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
              {canEdit && (
                <button type="button" className={primary} onClick={() => open(null)}>
                  {tr("Add New Rate Plan")}
                </button>
              )}
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                <input type="checkbox" checked={showExpired} className="h-3.5 w-3.5 accent-brass"
                  onChange={(e) => setShowExpired(e.target.checked)} />
                {tr("Show Expired Rates")}
              </label>
            </div>
          </div>
        </div>
      </section>

      {draft && (
        <PlanPopup
          title={draft.id ? (draft.name ? tr("Edit {name}", { name: draft.name }) : tr("Edit rate plan")) : tr("Add New Rate Plan")}
          onClose={() => {
            setFormError(null);
            setDraft(null);
          }}
        >
          {form(draft)}
        </PlanPopup>
      )}

      {/*
        Room Rate Combinations under the list, as the client's reference has
        it -- every room type with each plan under it for one season. The
        same weekly template the plan's form edits, seen across plans.
      */}
      <section className="rounded border border-line bg-white p-4 shadow-card sm:p-10">
        <RateCombinations
          ratePlans={ratePlans}
          roomTypes={roomTypes}
          seasons={seasons}
          cancellationPolicies={cancellationPolicies}
          weekRates={weekRates}
          coverage={coverage}
          onEditPlan={(id) => {
            const plan = ratePlans.find((p) => p.id === id);
            if (!plan) return;
            open(plan);
          }}
          canEdit={canEdit}
          pending={pending}
          run={run}
        />
      </section>
    </div>
  );
}
