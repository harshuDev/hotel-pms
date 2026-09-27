"use client";

import { useT } from "@/components/i18n";
import { useMemo, useState } from "react";
import { cn } from "@/components/ui";
import { useCurrency } from "@/components/currency";
import type {
  CancellationPolicy,
  ChannelSetting,
  MealType,
  RatePlan,
  RatePlanCoverage,
  RoomTypeSetting,
  TaxRateSetting,
} from "@/lib/types";
import type { AccountingCategory } from "@/lib/finance-profiles";
import { formatPercentBps, parsePercentBps } from "@/lib/finance-profiles";
import { formatMoneyInput, parseMoney } from "@/lib/money";
import {
  deleteRatePlan,
  saveRatePlan,
  setRatePlanCancellationPolicy,
  setRatePlanTerms,
} from "@/lib/actions/settings";
import { setRatePlanMeals } from "@/lib/actions/inventory";

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
 * (`set_rate_plan_terms()`); none is a stored wish. "Affected room types" is
 * read, not set: a plan is sold on a room type exactly when that pair has
 * prices loaded, which is done in Room Rate Combinations below.
 * "Sell with extras" is not copied -- nothing sells an extra with a rate.
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
  meals: MealType[];
  wasMeals: MealType[];
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
  perAdult: string;
  perChild: string;
  taxRateId: string;
  accountingCategoryId: string;
  allChannels: boolean;
  channelIds: string[];
};

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];

/** A whole number from a field, null when blank, "bad" when not a number. */
function count(s: string): number | null | "bad" {
  if (s.trim() === "") return null;
  return /^\s*\d{1,4}\s*$/.test(s) ? Number(s) : "bad";
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
    meals: p?.meals ?? [],
    wasMeals: p?.meals ?? [],
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
    perAdult: p?.adultAdjustCents != null ? formatMoneyInput(p.adultAdjustCents) : "",
    perChild: p?.childAdjustCents != null ? formatMoneyInput(p.childAdjustCents) : "",
    taxRateId: p?.taxRateId ?? "",
    accountingCategoryId: p?.accountingCategoryId ?? "",
    allChannels: (p?.channelIds.length ?? 0) === 0,
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
  coverage,
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
  coverage: RatePlanCoverage[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const currency = useCurrency();
  const [showExpired, setShowExpired] = useState(false);
  const [sortBy, setSortBy] = useState<"title" | "policy" | null>(null);
  const [desc, setDesc] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [policyFilter, setPolicyFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

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
    setDraft(draftOf(p, defaultPolicyId));
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
    if (!d.singlePrice) {
      try {
        adultAdjustCents = d.perAdult.trim() === "" ? 0 : parseMoney(d.perAdult);
        childAdjustCents = d.perChild.trim() === "" ? 0 : parseMoney(d.perChild);
      } catch {
        return tr("Write the amounts per adult and per child as numbers, such as 15 or -10.");
      }
    }
    return {
      minDaysAdvance: nums.minDaysAdvance as number | null,
      maxDaysAdvance: nums.maxDaysAdvance as number | null,
      minAdults: nums.minAdults as number | null,
      maxAdults: nums.maxAdults as number | null,
      minChildren: nums.minChildren as number | null,
      maxChildren: nums.maxChildren as number | null,
      validFrom: d.validFrom || null,
      validTo: d.validTo || null,
      parentRatePlanId: d.derived ? d.parentRatePlanId : null,
      derivedKind,
      derivedPercentBps,
      derivedAmountCents,
      occupancyPricing: d.singlePrice ? "single" : "per_person",
      adultAdjustCents,
      childAdjustCents,
      taxRateId: d.taxRateId || null,
      accountingCategoryId: d.accountingCategoryId || null,
      channelIds: d.allChannels ? [] : d.channelIds,
    };
  }

  const [formError, setFormError] = useState<string | null>(null);

  function save(d: Draft) {
    const terms = termsOf(d);
    if (typeof terms === "string") {
      setFormError(terms);
      return;
    }
    setFormError(null);
    run(async () => {
      const saved = await saveRatePlan({
        id: d.id,
        code: d.code,
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
      if ([...d.meals].sort().join() !== [...d.wasMeals].sort().join()) {
        const meals = await setRatePlanMeals({ ratePlanId: saved.data.id, meals: d.meals });
        if (!meals.ok) return meals;
      }
      setDraft(null);
      return { ok: true };
    }, d.id ? tr("Rate plan saved.") : tr("Rate plan created."));
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

            {draft && (
              <form
                className="mt-4 rounded border border-line p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  save(draft);
                }}
              >
                <h4 className="border-b border-line pb-1 text-[16px] text-ink">
                  {draft.id
                    ? draft.name
                      ? tr("Edit {name}", { name: draft.name })
                      : tr("Edit rate plan")
                    : tr("Add New Rate Plan")}
                </h4>
                <div className="mt-4 grid gap-4 sm:grid-cols-4">
                  <label className={label}>
                    {tr("Code")}
                    <input value={draft.code} placeholder={tr("BB")} className={cn(field, "uppercase")}
                      onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
                  </label>
                  <label className={cn(label, "sm:col-span-3")}>
                    {tr("Title")}
                    <input autoFocus value={draft.name} placeholder={tr("Bed and Breakfast")} className={field}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </label>
                  <label className={cn(label, "sm:col-span-2")}>
                    {tr("Description")}
                    <input value={draft.description} placeholder={tr("What a guest gets on this rate")} className={field}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  </label>
                  <label className={label}>
                    {tr("Cancellation Policy")}
                    <select value={draft.cancellationPolicyId} className={field}
                      onChange={(e) => setDraft({ ...draft, cancellationPolicyId: e.target.value })}>
                      <option value="">{tr("Not set")}</option>
                      {cancellationPolicies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className={label}>
                    {tr("Currency")}
                    <p className="mt-1 py-2 text-[14px] text-ink">{currency}</p>
                  </div>
                </div>

                <fieldset className="mt-4">
                  <legend className={label}>{tr("Meal Type")}</legend>
                  <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-ink">
                    {MEALS.map((m) => (
                      <label key={m} className="flex items-center gap-2">
                        <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.meals.includes(m)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              meals: e.target.checked ? [...draft.meals, m] : draft.meals.filter((x) => x !== m),
                            })
                          } />
                        {m === "breakfast" ? tr("Breakfast") : m === "lunch" ? tr("Lunch") : tr("Dinner")}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <h5 className={section}>{tr("Booking conditions")}</h5>
                <div className="mt-2 grid gap-4 sm:grid-cols-4">
                  {([
                    ["minDaysAdvance", tr("Minimum Days Advance")],
                    ["maxDaysAdvance", tr("Maximum Days Advance")],
                    ["minAdults", tr("Minimum Adults")],
                    ["maxAdults", tr("Maximum Adults")],
                    ["minChildren", tr("Minimum Children")],
                    ["maxChildren", tr("Maximum Children")],
                  ] as const).map(([k, l]) => (
                    <label key={k} className={label}>
                      {l}
                      <input inputMode="numeric" value={draft[k]} className={cn(field, "tnum")}
                        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                    </label>
                  ))}
                  <label className={label}>
                    {tr("Active from")}
                    <input type="date" value={draft.validFrom} className={field}
                      onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} />
                  </label>
                  <label className={label}>
                    {tr("Active to")}
                    <input type="date" value={draft.validTo} className={field}
                      onChange={(e) => setDraft({ ...draft, validTo: e.target.value })} />
                  </label>
                </div>

                <h5 className={section}>{tr("Pricing")}</h5>
                <label className="mt-2 flex items-center gap-2 text-[13.5px] text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.derived}
                    onChange={(e) => setDraft({ ...draft, derived: e.target.checked })} />
                  {tr("Derived Rate")}
                </label>
                {draft.derived && (
                  <div className="mt-2 grid gap-4 sm:grid-cols-4">
                    <label className={cn(label, "sm:col-span-2")}>
                      {tr("Parent Rate")}
                      <select value={draft.parentRatePlanId} className={field}
                        onChange={(e) => setDraft({ ...draft, parentRatePlanId: e.target.value })}>
                        <option value="">{tr("Choose…")}</option>
                        {ratePlans
                          .filter((p) => p.id !== draft.id && !p.parentRatePlanId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                      </select>
                    </label>
                    <label className={label}>
                      {tr("Relation")}
                      <select value={draft.relation} className={field}
                        onChange={(e) => setDraft({ ...draft, relation: e.target.value as Relation })}>
                        <option value="down_percent">{tr("Decrease by %")}</option>
                        <option value="up_percent">{tr("Increase by %")}</option>
                        <option value="down_amount">{tr("Decrease by amount")}</option>
                        <option value="up_amount">{tr("Increase by amount")}</option>
                      </select>
                    </label>
                    <label className={label}>
                      {tr("Adjustment")}
                      <input inputMode="decimal" value={draft.adjustment} className={cn(field, "tnum")}
                        placeholder={draft.relation.endsWith("percent") ? "10" : "10.00"}
                        onChange={(e) => setDraft({ ...draft, adjustment: e.target.value })} />
                    </label>
                  </div>
                )}
                <label className="mt-3 flex items-center gap-2 text-[13.5px] text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.singlePrice}
                    onChange={(e) => setDraft({ ...draft, singlePrice: e.target.checked })} />
                  {tr("One Price For All Occupancies")}
                </label>
                {!draft.singlePrice && (
                  <div className="mt-2 grid gap-4 sm:grid-cols-4">
                    <label className={label}>
                      {tr("Increase/Decrease per Adult")}
                      <input inputMode="decimal" value={draft.perAdult} placeholder="0.00" className={cn(field, "tnum")}
                        onChange={(e) => setDraft({ ...draft, perAdult: e.target.value })} />
                    </label>
                    <label className={label}>
                      {tr("Increase/Decrease per Child")}
                      <input inputMode="decimal" value={draft.perChild} placeholder="0.00" className={cn(field, "tnum")}
                        onChange={(e) => setDraft({ ...draft, perChild: e.target.value })} />
                    </label>
                  </div>
                )}

                <h5 className={section}>{tr("Taxes and accounting")}</h5>
                <div className="mt-2 grid gap-4 sm:grid-cols-4">
                  <label className={cn(label, "sm:col-span-2")}>
                    {tr("Attached Taxes")}
                    <select value={draft.taxRateId} className={field}
                      onChange={(e) => setDraft({ ...draft, taxRateId: e.target.value })}>
                      <option value="">{tr("No tax")}</option>
                      {taxRates
                        .filter((t) => t.isActive || t.id === draft.taxRateId)
                        .map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                  </label>
                  <label className={cn(label, "sm:col-span-2")}>
                    {tr("Accounting Category")}
                    <select value={draft.accountingCategoryId} className={field}
                      onChange={(e) => setDraft({ ...draft, accountingCategoryId: e.target.value })}>
                      <option value="">{tr("The room type's")}</option>
                      {accountingCategories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <h5 className={section}>{tr("Channels")}</h5>
                <label className="mt-2 flex items-center gap-2 text-[13.5px] text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.allChannels}
                    onChange={(e) => setDraft({ ...draft, allChannels: e.target.checked })} />
                  {tr("All channels")}
                </label>
                {!draft.allChannels && (
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-ink">
                    {channels.map((c) => (
                      <label key={c.id} className="flex items-center gap-2">
                        <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.channelIds.includes(c.id)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              channelIds: e.target.checked
                                ? [...draft.channelIds, c.id]
                                : draft.channelIds.filter((x) => x !== c.id),
                            })
                          } />
                        {c.name}
                      </label>
                    ))}
                  </div>
                )}

                {draft.id && (
                  <>
                    <h5 className={section}>{tr("Affected Room Types")}</h5>
                    <ul className="mt-2 grid gap-x-10 gap-y-1 text-[13px] sm:grid-cols-2">
                      {roomTypes.map((t) => {
                        const c = coverage.find((x) => x.ratePlanId === draft.id && x.roomTypeId === t.id);
                        return (
                          <li key={t.id} className="flex justify-between gap-3 border-b border-line py-1">
                            <span className="text-ink">{t.displayName ?? t.name}</span>
                            <span className={cn("tnum", c ? "text-ink-muted" : "text-ink-faint")}>
                              {c
                                ? tr("{n} nights priced, {from} to {to}", {
                                    n: c.pricedNights,
                                    from: tr.date(c.firstNight, "d MMM yyyy"),
                                    to: tr.date(c.lastNight, "d MMM yyyy"),
                                  })
                                : tr("Not priced")}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}

                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-ink">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.isDefault} className="h-4 w-4 accent-brass"
                      onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
                    {tr("Main rate")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.isActive} className="h-4 w-4 accent-brass"
                      onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
                    {tr("Still selling")}
                  </label>
                </div>
                {formError && <p role="alert" className="mt-3 text-[12.5px] text-rose-700">{formError}</p>}
                <div className="mt-5 flex justify-end gap-3">
                  <button type="button" className={secondary} onClick={() => setDraft(null)}>
                    {tr("Cancel")}
                  </button>
                  <button type="submit" className={primary} disabled={pending}>
                    {tr("Save")}
                  </button>
                </div>
              </form>
            )}

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
    </div>
  );
}
