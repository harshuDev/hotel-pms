"use client";

import { useState } from "react";
import { cn } from "@/components/ui";
import { EditIcon } from "@/components/settings/finance-panels";
import {
  ACCOUNTING_DEFAULT_KINDS,
  type AccountingCategory,
  type AccountingDefaults,
  type AccountingSettings,
} from "@/lib/finance-profiles";
import {
  deleteAccountingCategory,
  saveAccountingCategory,
  saveAccountingDefaults,
} from "@/lib/actions/settings";

/*
 * Settings -> Finances -> Accounting Categories (0085), cloned from the
 * client's reference: the list (Name, Internal Code, External Code, a pencil
 * and a cross) with "Add new accounting category" opening a Create form INSIDE
 * the card, under the rows; then Default Accounting Categories, four pickers
 * and one Save.
 *
 * The defaults are read by the Accounting report, which names the account
 * beside every line. A category that is a default is refused on delete by
 * name -- the pickers cannot be left empty.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "overflow-hidden rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell disabled:opacity-50";
const th = "px-3 py-3 text-left text-[12.5px] font-semibold text-ink";
const iconButton =
  "grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const line =
  "w-full border-0 border-b border-line bg-transparent px-0.5 py-2 text-[14px] text-ink outline-none placeholder:text-ink-muted focus:border-brass";
const footer = "border-t border-line bg-shell/60 px-4 py-4";

function CrossIcon() {
  // The reference's delete is a bold cross, not a bin.
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

type Draft = { id: string | null; name: string; internalCode: string; externalCode: string };

export function AccountingCategoriesPanel({
  settings,
  canEdit,
  pending,
  run,
}: {
  settings: AccountingSettings;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const { categories } = settings;
  const [draft, setDraft] = useState<Draft | null>(null);

  function save(d: Draft) {
    run(async () => {
      const result = await saveAccountingCategory(d);
      if (result.ok) setDraft(null);
      return result;
    }, `${d.name.trim() || "Accounting category"} saved.`);
  }

  function remove(c: AccountingCategory) {
    if (!confirm(`Delete ${c.name}?`)) return;
    run(async () => {
      const result = await deleteAccountingCategory(c.id);
      if (result.ok && draft?.id === c.id) setDraft(null);
      return result;
    }, `${c.name} deleted.`);
  }

  return (
    <div className="max-w-5xl space-y-7">
      <section className={card}>
        <h2 className="border-b border-line px-4 py-4 text-[17px] text-ink">Accounting Categories</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <th className={cn(th, "w-[40%]")}>Name</th>
                <th className={cn(th, "w-[24%]")}>Internal Code</th>
                <th className={th}>External Code</th>
                <th className="w-20" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr
                  key={c.id}
                  className={cn("border-b border-line", draft?.id === c.id && "bg-shell/70")}
                >
                  <td className="px-3 py-1.5 text-ink">{c.name}</td>
                  <td className="tnum px-3 py-1.5 text-ink">{c.internalCode ?? ""}</td>
                  <td className="tnum px-3 py-1.5 text-ink">{c.externalCode ?? ""}</td>
                  <td className="px-2 py-0.5">
                    {canEdit && (
                      <span className="flex justify-end">
                        <button
                          type="button"
                          aria-label={`Edit ${c.name}`}
                          className={iconButton}
                          onClick={() =>
                            setDraft({
                              id: c.id,
                              name: c.name,
                              internalCode: c.internalCode ?? "",
                              externalCode: c.externalCode ?? "",
                            })
                          }
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${c.name}`}
                          className={iconButton}
                          onClick={() => remove(c)}
                        >
                          <CrossIcon />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-5 text-[13px] text-ink-muted">
                    None yet. Add the accounts your books post to.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {draft && (
          <form
            className="m-1 rounded border border-line"
            onSubmit={(e) => {
              e.preventDefault();
              save(draft);
            }}
          >
            <div className="px-4 pb-6 pt-3">
              <h3 className="border-b border-line pb-2 text-[17px] text-ink">
                {draft.id ? "Edit" : "Create"}
              </h3>
              <div className="mt-4 space-y-5">
                <input
                  aria-label="Name"
                  placeholder="Name"
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  maxLength={120}
                  className={line}
                />
                <input
                  aria-label="Internal Code"
                  placeholder="Internal Code"
                  value={draft.internalCode}
                  onChange={(e) => setDraft({ ...draft, internalCode: e.target.value })}
                  maxLength={60}
                  className={cn(line, "tnum")}
                />
                <input
                  aria-label="External Code"
                  placeholder="External Code"
                  value={draft.externalCode}
                  onChange={(e) => setDraft({ ...draft, externalCode: e.target.value })}
                  maxLength={60}
                  className={cn(line, "tnum")}
                />
              </div>
            </div>
            <div className={cn(footer, "flex justify-end gap-3")}>
              <button type="button" className={secondary} onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className={primary} disabled={pending}>
                Save
              </button>
            </div>
          </form>
        )}

        {canEdit && !draft && (
          <div className={footer}>
            <button
              type="button"
              className={primary}
              onClick={() => setDraft({ id: null, name: "", internalCode: "", externalCode: "" })}
            >
              Add new accounting category
            </button>
          </div>
        )}
      </section>

      {/* Keyed on the saved defaults, so the pickers re-seed when they change
          -- without resetting a Create form open in the card above. */}
      <DefaultsCard
        key={Object.values(settings.defaults ?? {}).join()}
        settings={settings}
        canEdit={canEdit}
        pending={pending}
        run={run}
      />
    </div>
  );
}

function DefaultsCard({
  settings,
  canEdit,
  pending,
  run,
}: {
  settings: AccountingSettings;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const { categories, defaults } = settings;
  const [form, setForm] = useState<AccountingDefaults>(
    defaults ?? { accommodationId: "", extrasId: "", taxesId: "", paymentsId: "" },
  );

  return (
    <section className={card}>
      <h2 className="border-b border-line px-4 py-4 text-[17px] text-ink">Default Accounting Categories</h2>
      <div className="space-y-1 px-3 pb-2 pt-1">
        {ACCOUNTING_DEFAULT_KINDS.map((k) => {
          // A category deleted since the page loaded is not offered.
          const value = categories.some((c) => c.id === form[k.key]) ? form[k.key] : "";
          return (
            <label key={k.key} className="block">
              <span className="block text-[10.5px] text-ink-muted">{k.label}</span>
              <select
                value={value}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, [k.key]: e.target.value })}
                className={cn(line, "cursor-pointer px-3 pt-1 disabled:cursor-default disabled:opacity-100")}
              >
                {value === "" && <option value="">Choose a category</option>}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {canEdit && (
        <div className={footer}>
          <button
            type="button"
            className={primary}
            disabled={pending}
            onClick={() => run(() => saveAccountingDefaults(form), "Default accounting categories saved.")}
          >
            Save
          </button>
        </div>
      )}
    </section>
  );
}
