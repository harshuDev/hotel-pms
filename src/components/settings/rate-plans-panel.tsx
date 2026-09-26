"use client";

import { useMemo, useState } from "react";
import { cn } from "@/components/ui";
import { useCurrency } from "@/components/currency";
import type { CancellationPolicy, RatePlan } from "@/lib/types";
import {
  deleteRatePlan,
  saveRatePlan,
  setRatePlanCancellationPolicy,
} from "@/lib/actions/settings";

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
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

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
};

const th = "px-3 py-3 text-left text-[12px] font-semibold text-ink";
const label = "block text-[12px] text-ink-muted";
const field =
  "mt-1 w-full rounded-md border border-line px-3 py-2 text-[14px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const primary =
  "rounded-md bg-chrome-800 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-chrome-900 disabled:opacity-50";
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
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label="Main rate" className="h-3.5 w-3.5">
      <circle cx="8" cy="8" r="8" className="fill-emerald-500" />
      <path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RatePlansPanel({
  ratePlans,
  cancellationPolicies,
  canEdit,
  pending,
  run,
}: {
  /** Every plan, retired ones included. */
  ratePlans: RatePlan[];
  cancellationPolicies: CancellationPolicy[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const currency = useCurrency();
  const [showExpired, setShowExpired] = useState(false);
  const [sortBy, setSortBy] = useState<"title" | "policy" | null>(null);
  const [desc, setDesc] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [policyFilter, setPolicyFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const policyName = (id: string | null) =>
    cancellationPolicies.find((c) => c.id === id)?.name ?? "Not set";
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
        sortBy === "title" ? p.name : (names.get(p.cancellationPolicyId ?? "") ?? "Not set");
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
    const policy = p ? (p.cancellationPolicyId ?? "") : defaultPolicyId;
    setDraft({
      id: p?.id ?? null,
      code: p?.code ?? "",
      name: p?.name ?? "",
      description: p?.description ?? "",
      isDefault: p?.isDefault ?? false,
      isActive: p?.isActive ?? true,
      cancellationPolicyId: policy,
      wasPolicyId: p ? policy : "",
    });
  }

  function save(d: Draft) {
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
      setDraft(null);
      return { ok: true };
    }, d.id ? "Rate plan saved." : "Rate plan created.");
  }

  return (
    <div className="max-w-6xl space-y-2">
      <h2 className="border-b border-line pb-1 text-[20px] text-ink">Rate Plans</h2>
      <section className="rounded border border-line bg-white p-4 shadow-card sm:p-10">
        <div className="rounded border border-line">
          <h3 className="border-b border-line px-4 py-3 text-[13px] font-semibold text-ink">Rate categories</h3>
          <div className="p-3 sm:p-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-[12.5px]">
                <thead className="bg-shell/80">
                  <tr className="border-b border-line">
                    <th className={cn(th, "w-[34%]")}>
                      <span className="flex items-center justify-between gap-2">
                        {search === null ? (
                          "Title"
                        ) : (
                          <input
                            autoFocus
                            aria-label="Search rate plans"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search"
                            className="w-full rounded border border-line bg-white px-2 py-0.5 text-[12px] font-normal text-ink outline-none focus:border-brass"
                          />
                        )}
                        <span className="flex shrink-0 items-center gap-1.5">
                          <button type="button" aria-label="Sort by title" onClick={() => sort("title")} className="p-0.5">
                            <SortIcon active={sortBy === "title"} desc={desc} />
                          </button>
                          <button
                            type="button"
                            aria-label={search === null ? "Search titles" : "Stop searching"}
                            onClick={() => setSearch(search === null ? "" : null)}
                            className="p-0.5"
                          >
                            <SearchIcon active={search !== null && search.trim() !== ""} />
                          </button>
                        </span>
                      </span>
                    </th>
                    <th className={cn(th, "w-[22%]")}>Currency</th>
                    <th className={cn(th, "relative w-[30%]")}>
                      <span className="flex items-center justify-between gap-2">
                        Cancellation Policy
                        <span className="flex items-center gap-1.5">
                          <button type="button" aria-label="Sort by cancellation policy" onClick={() => sort("policy")} className="p-0.5">
                            <SortIcon active={sortBy === "policy"} desc={desc} />
                          </button>
                          <button
                            type="button"
                            aria-label="Filter by cancellation policy"
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
                    <th className="w-16" aria-label="Main rate" />
                    <th className="w-24" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={cn("border-b border-line", draft?.id === p.id && "bg-shell/70")}>
                      <td className={cn("px-3 py-3.5", p.isActive ? "text-ink" : "text-ink-faint")}>
                        {p.name}
                      </td>
                      <td className="px-3 py-3.5 text-ink">{currency}</td>
                      <td className="bg-shell/40 px-3 py-3.5 text-ink">{policyName(p.cancellationPolicyId)}</td>
                      <td className="px-3 py-3.5">{p.isDefault && <TickCircle />}</td>
                      <td className="px-3 py-2">
                        {canEdit && (
                          <span className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              aria-label={`Edit ${p.name}`}
                              onClick={() => open(p)}
                              className="rounded p-1 text-ink hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                            >
                              <PencilIcon />
                            </button>
                            {/* Not on the main rate; a sold plan is refused by name. */}
                            {!p.isDefault && (
                              <button
                                type="button"
                                aria-label={`Delete ${p.name}`}
                                disabled={pending}
                                onClick={() => {
                                  if (!confirm(`Delete ${p.name}? Its prices go with it.`)) return;
                                  run(async () => {
                                    const result = await deleteRatePlan(p.id);
                                    if (result.ok && draft?.id === p.id) setDraft(null);
                                    return result;
                                  }, `${p.name} deleted.`);
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
                        {ratePlans.length === 0 ? "None yet. Add the rate the hotel sells." : "No rate plan matches."}
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
                  {draft.id ? `Edit ${draft.name || "rate plan"}` : "Add New Rate Plan"}
                </h4>
                <div className="mt-4 grid gap-4 sm:grid-cols-4">
                  <label className={label}>
                    Code
                    <input value={draft.code} placeholder="BB" className={cn(field, "uppercase")}
                      onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
                  </label>
                  <label className={cn(label, "sm:col-span-3")}>
                    Title
                    <input autoFocus value={draft.name} placeholder="Bed and Breakfast" className={field}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </label>
                  <label className={cn(label, "sm:col-span-2")}>
                    Description
                    <input value={draft.description} placeholder="What a guest gets on this rate" className={field}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  </label>
                  <label className={cn(label, "sm:col-span-2")}>
                    Cancellation Policy
                    <select value={draft.cancellationPolicyId} className={field}
                      onChange={(e) => setDraft({ ...draft, cancellationPolicyId: e.target.value })}>
                      <option value="">Not set</option>
                      {cancellationPolicies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-ink">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.isDefault} className="h-4 w-4 accent-brass"
                      onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
                    Main rate
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.isActive} className="h-4 w-4 accent-brass"
                      onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
                    Still selling
                  </label>
                </div>
                <div className="mt-5 flex justify-end gap-3">
                  <button type="button" className={secondary} onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                  <button type="submit" className={primary} disabled={pending}>
                    Save
                  </button>
                </div>
              </form>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
              {canEdit && (
                <button type="button" className={primary} onClick={() => open(null)}>
                  Add New Rate Plan
                </button>
              )}
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                <input type="checkbox" checked={showExpired} className="h-3.5 w-3.5 accent-brass"
                  onChange={(e) => setShowExpired(e.target.checked)} />
                Show Expired Rates
              </label>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
