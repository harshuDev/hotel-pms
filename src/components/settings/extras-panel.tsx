"use client";

import { Fragment, useMemo, useState } from "react";
import { cn } from "@/components/ui";
import { formatMoney, formatMoneyInput } from "@/lib/money";
import {
  EXTRA_ACCOUNTING_CATEGORIES,
  accountingCategoryLabel,
  isMealExtra,
  type ExtraItemType,
  type ExtrasCatalog,
} from "@/lib/extras";
import {
  deleteExtra,
  deleteExtraCategory,
  mergeExtra,
  mergeExtraCategory,
  saveExtra,
  saveExtraCategory,
} from "@/lib/actions/settings";
import type { TaxRateSetting } from "@/lib/types";
import { useCurrency } from "@/components/currency";

/*
 * Hotel Content -> Extras (0069), cloned from the client's reference: an
 * "Extras Categories" table with its own add link, then a searchable, paged
 * "Extras" table with an "Add Extra" button at its foot.
 *
 * The "Is Meal" column is drawn but not stored -- a fork and knife on any
 * extra whose accounting category is food and beverage (see extras.ts).
 *
 * The arrows icon is MERGE, as in theirs: "Merge <x> to:" with a searchable
 * picker of the others. On an extra (0071) the kept one stays and the other
 * leaves the catalog; on a category (0072) its extras move to the kept one
 * first. Either way the activity log says where it went.
 *
 * The catalog is dozens of rows, not thousands, so search and paging happen
 * here over what the page already holds.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink";
const iconButton =
  "grid h-8 w-8 place-items-center rounded-full hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";

const PAGE_SIZES = [10, 20, 50] as const;

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h16" />
      <path d="M14.5 5.5l3 3L8 18H5v-3z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[16px] w-[16px]" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

function MergeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20l6-6M10 14H5.5M10 14v4.5" />
      <path d="M20 4l-6 6M14 10h4.5M14 10V5.5" />
    </svg>
  );
}

function MealIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img"
      aria-label="Meal">
      <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" />
      <path d="M16 21V3c-2 1.5-3 4-3 7v3h3" />
    </svg>
  );
}

type CategoryDraft = { id: string | null; title: string; taxRateId: string };
type ExtraDraft = {
  id: string | null;
  categoryId: string;
  title: string;
  price: string;
  taxRateId: string;
  itemType: ExtraItemType;
};

export function ExtrasPanel({
  catalog,
  taxRates,
  canEdit,
  pending,
  run,
}: {
  catalog: ExtrasCatalog;
  taxRates: TaxRateSetting[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const currency = useCurrency();
  const { categories, extras } = catalog;

  const taxName = (id: string | null) =>
    id ? taxRates.find((t) => t.id === id)?.name ?? "" : "";
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  // Retired rates stay choosable only by the row already on one.
  const taxOptions = (current: string) =>
    taxRates.filter((t) => t.isActive || t.id === current);

  /* -- Categories ------------------------------------------------------- */
  const [cat, setCat] = useState<CategoryDraft | null>(null);
  const [mergingCat, setMergingCat] = useState<{ id: string; title: string } | null>(null);

  function saveCategory() {
    if (!cat) return;
    const draft = cat;
    run(async () => {
      const result = await saveExtraCategory({
        id: draft.id,
        title: draft.title,
        taxRateId: draft.taxRateId || null,
      });
      if (result.ok) setCat(null);
      return result;
    }, draft.id ? "Extra category saved." : "Extra category added.");
  }

  function categoryEditor() {
    if (!cat) return null;
    return (
      <tr className="border-b border-line bg-shell/60">
        <td className="px-0 py-2.5 pr-3">
          <input
            autoFocus
            aria-label="Category title"
            value={cat.title}
            onChange={(e) => setCat({ ...cat, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCategory();
              if (e.key === "Escape") setCat(null);
            }}
            className={field}
          />
        </td>
        <td className="py-2.5 pr-3">
          <select
            aria-label="Category taxes"
            value={cat.taxRateId}
            onChange={(e) => setCat({ ...cat, taxRateId: e.target.value })}
            className={field}
          >
            <option value="">No tax</option>
            {taxOptions(cat.taxRateId).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </td>
        <td className="whitespace-nowrap py-2.5 text-right">
          <button type="button" onClick={() => setCat(null)} className={cn(secondary, "mr-2")}>
            Cancel
          </button>
          <button type="button" onClick={saveCategory} disabled={pending} className={primary}>
            Save
          </button>
        </td>
      </tr>
    );
  }

  /* -- Extras ------------------------------------------------------------ */
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(PAGE_SIZES[0]);
  const [ex, setEx] = useState<ExtraDraft | null>(null);
  const [merging, setMerging] = useState<{ id: string; title: string } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return extras;
    return extras.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (categoryById.get(e.categoryId)?.title.toLowerCase().includes(q) ?? false),
    );
  }, [extras, query, categoryById]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * perPage, current * perPage);

  function newExtra() {
    setEx({
      id: null,
      categoryId: categories[0]?.id ?? "",
      title: "",
      price: "",
      taxRateId: "",
      itemType: "miscellaneous",
    });
  }

  function saveExtraDraft() {
    if (!ex) return;
    const draft = ex;
    run(async () => {
      const result = await saveExtra({
        id: draft.id,
        categoryId: draft.categoryId,
        title: draft.title,
        price: draft.price,
        taxRateId: draft.taxRateId || null,
        itemType: draft.itemType,
      });
      if (result.ok) setEx(null);
      return result;
    }, draft.id ? "Extra saved." : "Extra added.");
  }

  const head =
    "whitespace-nowrap px-4 py-4 text-left text-[13.5px] font-normal text-ink";

  return (
    <div className="max-w-6xl space-y-5">
      {/* Extras Categories -------------------------------------------- */}
      <h2 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
        Extras Categories
      </h2>
      <div className={cn(card, "px-6 py-7 sm:px-10")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-[13.5px]">
            <thead>
              <tr className="border-b-2 border-line text-left text-ink">
                <th className="w-[48%] pb-2 font-semibold">Title</th>
                <th className="pb-2 font-semibold">Taxes</th>
                <th className="w-44 pb-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) =>
                cat?.id === c.id ? (
                  <Fragment key={c.id}>{categoryEditor()}</Fragment>
                ) : (
                  <tr key={c.id} className="border-b border-line">
                    <td className="py-3 text-ink">{c.title}</td>
                    <td className="py-3 text-ink">{taxName(c.taxRateId)}</td>
                    <td className="py-1.5">
                      {canEdit && (
                        <span className="flex justify-end gap-1">
                          <button
                            type="button"
                            title="Edit"
                            aria-label={`Edit ${c.title}`}
                            onClick={() =>
                              setCat({ id: c.id, title: c.title, taxRateId: c.taxRateId ?? "" })
                            }
                            className={cn(iconButton, "text-brass")}
                          >
                            <PencilIcon />
                          </button>
                          <button
                            type="button"
                            title="Merge"
                            aria-label={`Merge ${c.title}`}
                            onClick={() => setMergingCat({ id: c.id, title: c.title })}
                            className={cn(iconButton, "text-brass")}
                          >
                            <MergeIcon />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            aria-label={`Delete ${c.title}`}
                            disabled={pending}
                            onClick={() => {
                              if (!confirm(`Delete the category ${c.title}?`)) return;
                              run(() => deleteExtraCategory(c.id), `${c.title} deleted.`);
                            }}
                            className={cn(iconButton, "text-lg font-semibold leading-none text-brass")}
                          >
                            <span aria-hidden="true">✕</span>
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ),
              )}
              {cat?.id === null && categoryEditor()}
            </tbody>
          </table>
        </div>
        {categories.length === 0 && cat === null && (
          <p className="py-4 text-[13px] text-ink-muted">
            None yet. Add a category, then the extras in it.
          </p>
        )}
        {canEdit && cat === null && (
          <button
            type="button"
            onClick={() => setCat({ id: null, title: "", taxRateId: "" })}
            className="mt-4 text-[13.5px] font-semibold text-brass hover:underline"
          >
            + Add Extra Category
          </button>
        )}
      </div>

      {/* Extras ---------------------------------------------------------- */}
      <h2 className="pt-4 font-display text-[26px] font-semibold tracking-tightest text-ink">
        Extras
      </h2>
      <div className={cn(card, "px-6 py-8 sm:px-10")}>
        <label className="relative block">
          <span className="sr-only">Search extras</span>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search"
            className={cn(field, "py-2.5 pl-9 text-[14px]")}
          />
        </label>

        <div className="mt-7 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-[13.5px]">
            <thead>
              <tr className="bg-shell">
                {["Title", "Category", "Is Meal", "Price", "Taxes", "Accounting Category"].map(
                  (h) => (
                    <th key={h} className={head}>
                      <span className="block border-r border-line pr-4">{h}</span>
                    </th>
                  ),
                )}
                <th className="w-32 px-4 py-4" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const category = categoryById.get(e.categoryId);
                const inherited = e.taxRateId === null ? category?.taxRateId ?? null : null;
                return (
                  <tr key={e.id} className="border-b border-line odd:bg-white even:bg-shell/50">
                    <td className="px-4 py-4 text-ink">{e.title}</td>
                    <td className="px-4 py-4 text-ink">{category?.title ?? ""}</td>
                    <td className="px-4 py-4 text-ink">
                      {isMealExtra(e.itemType) && <MealIcon />}
                    </td>
                    <td className="tnum px-4 py-4 text-ink">{formatMoney(e.priceCents, currency)}</td>
                    <td className="px-4 py-4">
                      {e.taxRateId ? (
                        <span className="text-ink">{taxName(e.taxRateId)}</span>
                      ) : (
                        <span className="text-ink-faint">{taxName(inherited)}</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-ink">{accountingCategoryLabel(e.itemType)}</td>
                    <td className="px-4 py-2">
                      {canEdit && (
                        <span className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            title="Edit"
                            aria-label={`Edit ${e.title}`}
                            onClick={() =>
                              setEx({
                                id: e.id,
                                categoryId: e.categoryId,
                                title: e.title,
                                price: formatMoneyInput(e.priceCents),
                                taxRateId: e.taxRateId ?? "",
                                itemType: e.itemType,
                              })
                            }
                            className={cn(iconButton, "text-ink")}
                          >
                            <PencilIcon />
                          </button>
                          <button
                            type="button"
                            title="Merge"
                            aria-label={`Merge ${e.title}`}
                            onClick={() => setMerging({ id: e.id, title: e.title })}
                            className={cn(iconButton, "border border-line text-ink")}
                          >
                            <MergeIcon />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            aria-label={`Delete ${e.title}`}
                            disabled={pending}
                            onClick={() => {
                              if (!confirm(`Delete the extra ${e.title}?`)) return;
                              run(() => deleteExtra(e.id), `${e.title} deleted.`);
                            }}
                            className={cn(iconButton, "border border-line text-ink")}
                          >
                            <TrashIcon />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-[13px] text-ink-muted">
                    {extras.length === 0
                      ? categories.length === 0
                        ? "None yet. Add a category above first."
                        : "None yet. Add the first extra."
                      : "No extra matches that search."}
                  </td>
                </tr>
              )}
            </tbody>
            {canEdit && categories.length > 0 && (
              <tfoot>
                <tr className="bg-shell/50">
                  <td colSpan={7} className="px-4 py-3">
                    <button type="button" onClick={newExtra} className={primary}>
                      <span aria-hidden="true" className="mr-1.5">⊕</span>Add Extra
                    </button>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {filtered.length > PAGE_SIZES[0] && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 text-[13px]">
            <button
              type="button"
              aria-label="Previous page"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
              className="h-8 w-8 rounded border border-line text-ink-muted hover:bg-shell disabled:opacity-40"
            >
              ‹
            </button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-current={n === current ? "page" : undefined}
                onClick={() => setPage(n)}
                className={cn(
                  "tnum h-8 min-w-[2rem] rounded border px-2",
                  n === current ? "border-brass text-brass" : "border-line text-ink hover:bg-shell",
                )}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              aria-label="Next page"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
              className="h-8 w-8 rounded border border-line text-ink-muted hover:bg-shell disabled:opacity-40"
            >
              ›
            </button>
            <select
              aria-label="Extras per page"
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
              className="ml-2 h-8 rounded border border-line px-2 text-ink-muted"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {ex && canEdit && (
        <div className={cn(card, "p-6 sm:p-7")}>
          <h3 className="mb-5 font-display text-[18px] font-semibold tracking-tightest text-ink">
            {ex.id ? ex.title || "Extra" : "Add Extra"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-[13px] text-ink">
              Title
              <input
                autoFocus
                value={ex.title}
                onChange={(e) => setEx({ ...ex, title: e.target.value })}
                className={cn(field, "mt-1")}
              />
            </label>
            <label className="block text-[13px] text-ink">
              Category
              <select
                value={ex.categoryId}
                onChange={(e) => setEx({ ...ex, categoryId: e.target.value })}
                className={cn(field, "mt-1")}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[13px] text-ink">
              Price
              <input
                inputMode="decimal"
                value={ex.price}
                onChange={(e) => setEx({ ...ex, price: e.target.value })}
                placeholder="0.00"
                className={cn(field, "tnum mt-1")}
              />
            </label>
            <label className="block text-[13px] text-ink">
              Taxes
              <select
                value={ex.taxRateId}
                onChange={(e) => setEx({ ...ex, taxRateId: e.target.value })}
                className={cn(field, "mt-1")}
              >
                <option value="">
                  {taxName(categoryById.get(ex.categoryId)?.taxRateId ?? null)
                    ? `As category (${taxName(categoryById.get(ex.categoryId)?.taxRateId ?? null)})`
                    : "No tax"}
                </option>
                {taxOptions(ex.taxRateId).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[13px] text-ink">
              Accounting Category
              <select
                value={ex.itemType}
                onChange={(e) => setEx({ ...ex, itemType: e.target.value as ExtraItemType })}
                className={cn(field, "mt-1")}
              >
                {EXTRA_ACCOUNTING_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setEx(null)} className={secondary}>
              Cancel
            </button>
            <button type="button" onClick={saveExtraDraft} disabled={pending} className={primary}>
              Save
            </button>
          </div>
        </div>
      )}
      {mergingCat && (
        <MergeDialog
          key={mergingCat.id}
          source={mergingCat}
          options={categories.filter((c) => c.id !== mergingCat.id)}
          placeholder="Choose category"
          pending={pending}
          onClose={() => setMergingCat(null)}
          onMerge={(targetId) => {
            const source = mergingCat;
            const target = categories.find((c) => c.id === targetId);
            run(async () => {
              const result = await mergeExtraCategory({ sourceId: source.id, targetId });
              if (result.ok) setMergingCat(null);
              return result;
            }, `${source.title} merged into ${target?.title ?? "the chosen category"}.`);
          }}
        />
      )}
      {merging && (
        <MergeDialog
          key={merging.id}
          source={merging}
          options={extras.filter((e) => e.id !== merging.id)}
          placeholder="Choose extra"
          pending={pending}
          onClose={() => setMerging(null)}
          onMerge={(targetId) => {
            const source = merging;
            const target = extras.find((e) => e.id === targetId);
            run(async () => {
              const result = await mergeExtra({ sourceId: source.id, targetId });
              if (result.ok) setMerging(null);
              return result;
            }, `${source.title} merged into ${target?.title ?? "the chosen extra"}.`);
          }}
        />
      )}
    </div>
  );
}

/*
 * "Merge <extra> to:" -- the reference's dialog: a search field that lists
 * the other extras, a close cross, and Merge. The list filters as you type.
 * Merge is never greyed out: pressed with nothing chosen, the refusal says
 * what to do, which is how every other control here behaves.
 */
function MergeDialog({
  source,
  options,
  placeholder,
  pending,
  onClose,
  onMerge,
}: {
  source: { id: string; title: string };
  options: { id: string; title: string }[];
  placeholder: string;
  pending: boolean;
  onClose: () => void;
  onMerge: (targetId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState("");
  const [open, setOpen] = useState(true);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.title.toLowerCase().includes(q)) : options;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 id="merge-title" className="text-[16px] text-ink">
            Merge <span className="font-semibold">{source.title}</span> to:
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-muted hover:bg-shell hover:text-ink"
          >
            <span aria-hidden="true" className="text-lg leading-none">✕</span>
          </button>
        </div>
        <div className="relative px-6 py-5">
          <input
            autoFocus
            role="combobox"
            aria-expanded={open}
            aria-controls="merge-options"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setTargetId("");
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className={cn(field, "pr-9 text-[14px]")}
          />
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-9 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          {open && (
            <ul
              id="merge-options"
              role="listbox"
              className="absolute inset-x-6 top-full z-10 -mt-3 max-h-64 overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lg"
            >
              {shown.length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-ink-muted">Nothing matches that search.</li>
              ) : (
                shown.map((o) => (
                  <li key={o.id} role="option" aria-selected={o.id === targetId}>
                    <button
                      type="button"
                      onClick={() => {
                        setTargetId(o.id);
                        setQuery(o.title);
                        setOpen(false);
                      }}
                      className={cn(
                        "block w-full px-3 py-2 text-left text-[14px] text-ink hover:bg-shell",
                        o.id === targetId && "bg-shell",
                      )}
                    >
                      {o.title}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <div className="flex justify-end border-t border-line px-6 py-3">
          <button
            type="button"
            onClick={() => onMerge(targetId)}
            disabled={pending}
            className={primary}
          >
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}
