"use client";

import { useT } from "@/components/i18n";
import { useMemo, useState } from "react";
import { cn } from "@/components/ui";
import { useCurrency } from "@/components/currency";
import { Dialog } from "@/components/settings/finance-panels";
import { CURRENCIES } from "@/lib/currencies";
import { formatMoney, formatMoneyInput, parseMoney } from "@/lib/money";
import {
  formatPercentBps,
  parsePercentBps,
  type Discount,
  type DiscountKind,
} from "@/lib/finance-profiles";
import { deleteDiscount, saveDiscount } from "@/lib/actions/settings";

/*
 * Settings -> Inventory -> Discounts (0090), cloned from the client's
 * reference: a search box, a list (Title sortable, Type filterable, Amount)
 * and "Add Discount" opening a dialog -- Title, Amount with a % or currency
 * prefix, and Type as Percent or Fixed.
 *
 * STORED, NOT YET APPLIED: nothing takes a discount off a stay yet. See the
 * migration and CLAUDE.md.
 *
 * Each row carries the reference's pencil and bin, each in a ring.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

type Draft = { id: string | null; title: string; kind: DiscountKind; amount: string };

const primary =
  "rounded-md bg-chrome-800 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-4 py-2 text-[12.5px] font-semibold text-ink hover:bg-shell disabled:opacity-50";
const input =
  "w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-[13.5px] text-ink outline-none focus:border-brass";
const th = "px-3 py-3 text-left text-[12px] font-semibold text-ink";

/** Both arrows faint when this column is not the sort; one lit when it is. */
function SortIcon({ active, desc }: { active: boolean; desc: boolean }) {
  return (
    <svg viewBox="0 0 10 12" className="h-3 w-2.5" aria-hidden="true">
      <path d="M5 1l3.5 4h-7z" className={active && !desc ? "fill-brass" : "fill-ink-faint"} />
      <path d="M5 11l3.5-4h-7z" className={active && desc ? "fill-brass" : "fill-ink-faint"} />
    </svg>
  );
}

// The reference's row controls: a pencil and a bin, each in a ring.
function RingPencil() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    </svg>
  );
}

function RingBin() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
    </svg>
  );
}

function FunnelIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("h-3.5 w-3.5", active ? "fill-brass" : "fill-ink-faint")} aria-hidden="true">
      <path d="M1.5 2h13l-5 6v5l-3 1.5V8z" />
    </svg>
  );
}

export function DiscountsPanel({
  discounts,
  canEdit,
  pending,
  run,
}: {
  discounts: Discount[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const currency = useCurrency();
  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"title" | "amount">("title");
  const [desc, setDesc] = useState(false);
  const [kindFilter, setKindFilter] = useState<DiscountKind | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = discounts.filter(
      (d) => (!q || d.title.toLowerCase().includes(q)) && (!kindFilter || d.kind === kindFilter),
    );
    // Amount sorts percent before fixed, each by its own figure: a
    // percentage and a sum of money are not one scale.
    const amount = (d: Discount) =>
      d.kind === "percent" ? (d.percentBps ?? 0) : 1_000_000_000 + (d.amountCents ?? 0);
    list.sort(
      (a, b) =>
        (sortBy === "title" ? a.title.localeCompare(b.title) : amount(a) - amount(b)) * (desc ? -1 : 1),
    );
    return list;
  }, [discounts, query, sortBy, desc, kindFilter]);

  function sort(by: "title" | "amount") {
    if (sortBy === by) setDesc(!desc);
    else {
      setSortBy(by);
      setDesc(false);
    }
  }

  function amountLabel(d: Discount) {
    if (d.kind === "percent" && d.percentBps !== null) return `${formatPercentBps(d.percentBps)} %`;
    if (d.kind === "fixed" && d.amountCents !== null) return formatMoney(d.amountCents, currency);
    return "";
  }

  function open(d: Discount | null) {
    setError(null);
    setDraft(
      d
        ? {
            id: d.id,
            title: d.title,
            kind: d.kind,
            amount:
              d.kind === "percent"
                ? d.percentBps === null ? "" : formatPercentBps(d.percentBps)
                : d.amountCents === null ? "" : formatMoneyInput(d.amountCents, currency),
          }
        : { id: null, title: "", kind: "percent", amount: "0" },
    );
  }

  function save(d: Draft) {
    setError(null);
    let percentBps: number | null = null;
    let amountCents: number | null = null;
    if (d.kind === "percent") {
      percentBps = parsePercentBps(d.amount);
      if (percentBps === null) {
        setError(tr("Write the percentage as a number above 0 and up to 100, with up to two decimals."));
        return;
      }
    } else {
      try {
        amountCents = parseMoney(d.amount);
      } catch {
        amountCents = null;
      }
      if (amountCents === null || amountCents <= 0) {
        setError(tr("Write the amount as a number above 0, with up to two decimals."));
        return;
      }
    }
    run(async () => {
      const result = await saveDiscount({ id: d.id, title: d.title, kind: d.kind, percentBps, amountCents });
      if (result.ok) setDraft(null);
      return result;
    }, tr("{name} saved.", { name: d.title.trim() || tr("Discount") }));
  }

  return (
    <div className="max-w-5xl space-y-4">
      <h2 className="border-b border-line pb-1 text-[20px] text-ink">{tr("Discounts")}</h2>

      <label className="relative block">
        <span className="sr-only">{tr("Search discounts")}</span>
        <svg viewBox="0 0 16 16" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 fill-ink-faint" aria-hidden="true">
          <path d="M6.5 1a5.5 5.5 0 014.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 116.5 1zm0 1.5a4 4 0 100 8 4 4 0 000-8z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("Search discounts...")}
          className="w-full rounded border border-line bg-white py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-brass"
        />
      </label>

      <div className="overflow-x-auto rounded border border-line bg-white shadow-card">
        <table className="w-full min-w-[34rem] text-[13px]">
          <thead className="bg-shell/70">
            <tr className="border-b border-line">
              <th className={cn(th, "w-[38%]")}>
                <button
                  type="button"
                  onClick={() => sort("title")}
                  className="flex w-full items-center justify-between gap-2"
                  aria-label={tr("Sort by title")}
                >
                  {tr("Title")}
                  <SortIcon active={sortBy === "title"} desc={desc} />
                </button>
              </th>
              <th className={cn(th, "relative w-[35%]")}>
                <div className="flex items-center justify-between gap-2">
                  {tr("Type")}
                  <button
                    type="button"
                    onClick={() => setFilterOpen(!filterOpen)}
                    aria-label={tr("Filter by type")}
                    aria-expanded={filterOpen}
                    className="rounded p-1 hover:bg-shell"
                  >
                    <FunnelIcon active={kindFilter !== null} />
                  </button>
                </div>
                {filterOpen && (
                  <div className="absolute right-2 top-full z-20 mt-1 w-32 rounded-md border border-line bg-white py-1 text-[13px] font-normal shadow-card">
                    {([null, "percent", "fixed"] as const).map((k) => (
                      <button
                        key={k ?? "all"}
                        type="button"
                        onClick={() => {
                          setKindFilter(k);
                          setFilterOpen(false);
                        }}
                        className={cn(
                          "block w-full px-3 py-1.5 text-left hover:bg-shell",
                          kindFilter === k ? "font-semibold text-ink" : "text-ink-muted",
                        )}
                      >
                        {k === null ? tr("All") : k === "percent" ? tr("Percent") : tr("Fixed")}
                      </button>
                    ))}
                  </div>
                )}
              </th>
              <th className={cn(th, "w-[20%]")}>
                <button
                  type="button"
                  onClick={() => sort("amount")}
                  className="flex w-full items-center justify-between gap-2"
                  aria-label={tr("Sort by amount")}
                >
                  {tr("Amount")}
                  <SortIcon active={sortBy === "amount"} desc={desc} />
                </button>
              </th>
              <th className="w-28" aria-label={tr("Actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-0">
                <td className="px-3 py-3.5 text-ink">{d.title}</td>
                <td className="bg-shell/40 px-3 py-3.5 text-ink">{d.kind === "percent" ? tr("Percent") : tr("Fixed")}</td>
                <td className="tnum px-3 py-3.5 text-ink">{amountLabel(d)}</td>
                <td className="px-3 py-2">
                  {canEdit && (
                    <span className="flex justify-end gap-3">
                      <button
                        type="button"
                        aria-label={tr("Edit {name}", { name: d.title })}
                        onClick={() => open(d)}
                        className="grid h-7 w-7 place-items-center rounded-full border border-brass text-brass hover:bg-brass/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                      >
                        <RingPencil />
                      </button>
                      <button
                        type="button"
                        aria-label={tr("Delete {name}", { name: d.title })}
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(tr("Delete {name}?", { name: d.title }))) return;
                          run(() => deleteDiscount(d.id), tr("{name} deleted.", { name: d.title }));
                        }}
                        className="grid h-7 w-7 place-items-center rounded-full border border-rose-500 text-rose-600 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-500"
                      >
                        <RingBin />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-5 text-[13px] text-ink-muted">
                  {discounts.length === 0 ? tr("None yet.") : tr("No discount matches.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <button type="button" className={cn(primary, "flex items-center gap-1.5")} onClick={() => open(null)}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <circle cx="8" cy="8" r="8" className="fill-white" />
            <path d="M8 4.5v7M4.5 8h7" className="stroke-chrome-800" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {tr("Add Discount")}
        </button>
      )}

      {draft && (
        <Dialog
          title={draft.id ? tr("Edit Discount") : tr("Add Discount")}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button type="button" className={secondary} onClick={() => setDraft(null)}>
                {tr("Cancel")}
              </button>
              <button type="button" className={primary} disabled={pending} onClick={() => save(draft)}>
                {tr("Save")}
              </button>
            </>
          }
        >
          <form
            className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-4 text-[13px] text-ink sm:max-w-sm"
            onSubmit={(e) => {
              e.preventDefault();
              save(draft);
            }}
          >
            <label htmlFor="discount-title">{tr("Title:")}</label>
            <input
              id="discount-title"
              autoFocus
              value={draft.title}
              maxLength={80}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className={input}
            />

            <label htmlFor="discount-amount">{tr("Amount:")}</label>
            <div className="flex">
              <span className="grid min-w-[2.25rem] place-items-center rounded-l-md border border-r-0 border-line bg-shell px-2 text-ink-muted">
                {draft.kind === "percent" ? "%" : symbol}
              </span>
              <input
                id="discount-amount"
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                className={cn(input, "tnum rounded-l-none")}
              />
            </div>

            <span id="discount-type">{tr("Type:")}</span>
            <div role="radiogroup" aria-labelledby="discount-type" className="flex">
              {(["percent", "fixed"] as const).map((k, i) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={draft.kind === k}
                  onClick={() => setDraft({ ...draft, kind: k })}
                  className={cn(
                    "border px-3.5 py-1.5 text-[12.5px]",
                    i === 0 ? "rounded-l-md" : "-ml-px rounded-r-md",
                    draft.kind === k
                      ? "relative z-10 border-chrome-800 bg-chrome-800 font-semibold text-white"
                      : "border-line bg-white text-ink hover:bg-shell",
                  )}
                >
                  {k === "percent" ? tr("Percent") : tr("Fixed")}
                </button>
              ))}
            </div>
            {/* Enter in either field saves, as in any other form. */}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
          {error && (
            <p role="alert" className="text-[12.5px] text-rose-700">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
