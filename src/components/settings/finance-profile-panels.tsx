"use client";

import { useT } from "@/components/i18n";
import { msg } from "@/lib/i18n/translate";
import { useState } from "react";
import { cn } from "@/components/ui";
import { EditIcon, TrashIcon } from "@/components/settings/finance-panels";
import { CURRENCIES } from "@/lib/currencies";
import {
  POS_TYPES,
  formatRateMicros,
  parseRateMicros,
  posTypeLabel,
  type CurrencyProfile,
  type CurrencyRateKind,
  type PosProfile,
} from "@/lib/finance-profiles";
import {
  deleteCurrencyProfile,
  deletePosProfile,
  saveCurrencyProfile,
  savePosProfile,
} from "@/lib/actions/settings";

/*
 * Settings -> Finances -> Pos Profiles (0084) and Currencies (0083), cloned
 * from the client's reference. Both are STORED, NOT YET LIVE: no point of sale
 * is connected, and nothing converts money into a second currency yet. See the
 * migrations and CLAUDE.md.
 *
 * Adding and editing open a form INSIDE the list card, above the Add button,
 * as the reference's Create Pos Profile does -- not a dialog.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "overflow-hidden rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell disabled:opacity-50";
const th = "px-4 py-3 text-left text-[12.5px] font-semibold text-ink";
const iconButton =
  "grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const line =
  "w-full border-0 border-b border-line bg-transparent px-0.5 py-1.5 text-[14px] text-ink outline-none focus:border-brass";

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="border-b border-line pb-1">
      <h2 className="text-[24px] text-ink">{title}</h2>
      <p className="text-[12px] text-ink">{subtitle}</p>
    </div>
  );
}

function Tick({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={label} className="h-3.5 w-3.5 fill-ink">
      <circle cx="8" cy="8" r="8" />
      <path d="M4.5 8.2l2.2 2.2 4.8-4.8" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Pos Profiles                                                               */
/* -------------------------------------------------------------------------- */

type PosDraft = { id: string | null; posType: string; isEnabled: boolean };

export function PosProfilesPanel({
  profiles,
  canEdit,
  pending,
  run,
}: {
  profiles: PosProfile[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [draft, setDraft] = useState<PosDraft | null>(null);
  // One profile per type: a new one is offered only the types not yet taken.
  const taken = new Set(profiles.filter((p) => p.id !== draft?.id).map((p) => p.posType));
  const free = POS_TYPES.filter((t) => !taken.has(t.id));

  function save(d: PosDraft) {
    run(async () => {
      const result = await savePosProfile(d);
      if (result.ok) setDraft(null);
      return result;
    }, tr("{name} profile saved.", { name: d.posType ? tr(posTypeLabel(d.posType)) : tr("Pos") }));
  }

  return (
    <div className="max-w-5xl space-y-3">
      <PageHeading title={tr("Pos Profiles")} subtitle={tr("You can add up to one profile per each pos type")} />
      <section className={card}>
        <h3 className="border-b border-line px-4 py-4 text-[19px] text-ink">{tr("Pos Profiles List")}</h3>
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-line">
              <th className={cn(th, "w-1/2")}>{tr("Pos Type")}</th>
              <th className={th}>{tr("Is Enabled")}</th>
              <th className="w-24" aria-label={tr("Actions")} />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-line even:bg-shell/70">
                <td className="px-4 py-2 text-ink">{tr(posTypeLabel(p.posType))}</td>
                <td className="px-4 py-2">{p.isEnabled ? <Tick label={tr("Enabled")} /> : null}</td>
                <td className="px-2 py-1">
                  {canEdit && (
                    <span className="flex justify-end">
                      <button
                        type="button"
                        aria-label={tr("Edit {name}", { name: tr(posTypeLabel(p.posType)) })}
                        className={iconButton}
                        onClick={() => setDraft({ id: p.id, posType: p.posType, isEnabled: p.isEnabled })}
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        aria-label={tr("Delete {name}", { name: tr(posTypeLabel(p.posType)) })}
                        className={iconButton}
                        onClick={() => {
                          if (!confirm(tr("Delete the {name} profile?", { name: tr(posTypeLabel(p.posType)) }))) return;
                          run(() => deletePosProfile(p.id), tr("{name} profile deleted.", { name: tr(posTypeLabel(p.posType)) }));
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {draft && (
          <div className="m-1 rounded border border-line p-4">
            <h4 className="border-b border-line pb-1 text-[18px] text-ink">
              {draft.id ? tr("Edit Pos Profile") : tr("Create Pos Profile")}
            </h4>
            <div className="mt-4 grid items-end gap-6 sm:grid-cols-2">
              <select
                aria-label={tr("Type")}
                value={draft.posType}
                onChange={(e) => setDraft({ ...draft, posType: e.target.value })}
                className={cn(line, "cursor-pointer", draft.posType === "" && "text-ink-muted")}
              >
                <option value="">{tr("Type")}</option>
                {free.map((t) => (
                  <option key={t.id} value={t.id} className="text-ink">
                    {tr(t.label)}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2.5 text-[14px] text-ink">
                <input
                  type="checkbox"
                  checked={draft.isEnabled}
                  onChange={(e) => setDraft({ ...draft, isEnabled: e.target.checked })}
                  className="h-[18px] w-[18px] accent-brass"
                />
                {tr("Enabled")}
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className={secondary} onClick={() => setDraft(null)}>
                {tr("Cancel")}
              </button>
              <button
                type="button"
                className={primary}
                disabled={pending}
                onClick={() => save(draft)}
              >
                {tr("Save")}
              </button>
            </div>
          </div>
        )}

        {canEdit && free.length > 0 && (
          <div className="border-t border-line bg-shell/60 px-4 py-4">
            <button
              type="button"
              className={primary}
              onClick={() => setDraft({ id: null, posType: "", isEnabled: true })}
            >
              {tr("Add new pos profile")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Currencies                                                                 */
/* -------------------------------------------------------------------------- */

type CurrencyDraft = { id: string | null; currency: string; rateKind: CurrencyRateKind; rate: string };

function rateLabel(p: CurrencyProfile, base: string) {
  if (p.rateKind === "live" || p.fixedRateMicros === null) return msg("Live Exchange");
  return `1 ${p.currency} = ${formatRateMicros(p.fixedRateMicros)} ${base}`;
}

export function CurrenciesPanel({
  defaultCurrency,
  profiles,
  canEdit,
  pending,
  run,
}: {
  /** `properties.currency` -- set in Hotel Details, shown here as the default. */
  defaultCurrency: string;
  profiles: CurrencyProfile[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [draft, setDraft] = useState<CurrencyDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taken = new Set([
    defaultCurrency,
    ...profiles.filter((p) => p.id !== draft?.id).map((p) => p.currency),
  ]);
  const free = CURRENCIES.filter((c) => !taken.has(c.code));
  // A profile that has become the default in Hotel Details is not listed twice.
  const rows = profiles.filter((p) => p.currency !== defaultCurrency);

  function save(d: CurrencyDraft) {
    setError(null);
    const micros = d.rateKind === "fixed" ? parseRateMicros(d.rate) : null;
    if (d.rateKind === "fixed" && micros === null) {
      setError(tr("Write the rate as a number above zero, with up to six decimals."));
      return;
    }
    run(async () => {
      const result = await saveCurrencyProfile({
        id: d.id,
        currency: d.currency,
        rateKind: d.rateKind,
        fixedRateMicros: micros,
      });
      if (result.ok) setDraft(null);
      return result;
    }, tr("{currency} saved.", { currency: d.currency }));
  }

  return (
    <div className="max-w-5xl space-y-3">
      <PageHeading title={tr("Currencies")} subtitle={tr("At this part you can manage hotel currencies")} />
      <section className={card}>
        <div className="overflow-x-auto px-4 pt-6 sm:px-8">
          <table className="w-full min-w-[30rem] text-[13.5px]">
            <thead>
              <tr className="border-b border-line">
                <th className={cn(th, "w-[30%] px-1")}>{tr("Currency")}</th>
                <th className={cn(th, "w-[30%] px-1")}>{tr("Is Default")}</th>
                <th className={cn(th, "px-1")}>{tr("Rate")}</th>
                <th className="w-20" aria-label={tr("Actions")} />
              </tr>
            </thead>
            <tbody>
              {/* The default: the property's own currency, set in Hotel
                  Details. No icons, as the reference's default row has none. */}
              <tr className="border-b border-line bg-shell/70">
                <td className="px-1 py-2.5 text-ink">{defaultCurrency}</td>
                <td className="px-1 py-2.5">
                  <Tick label={tr("Default")} />
                </td>
                <td className="px-1 py-2.5 text-ink-muted">—</td>
                <td />
              </tr>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <td className="px-1 py-2 text-ink">{p.currency}</td>
                  <td className="px-1 py-2" />
                  <td className="px-1 py-2 text-ink">{tr.message(rateLabel(p, defaultCurrency))}</td>
                  <td className="py-1">
                    {canEdit && (
                      <span className="flex justify-end">
                        <button
                          type="button"
                          aria-label={tr("Edit {currency}", { currency: p.currency })}
                          className={iconButton}
                          onClick={() => {
                            setError(null);
                            setDraft({
                              id: p.id,
                              currency: p.currency,
                              rateKind: p.rateKind,
                              rate: p.fixedRateMicros === null ? "" : formatRateMicros(p.fixedRateMicros),
                            });
                          }}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          aria-label={tr("Delete {currency}", { currency: p.currency })}
                          className={iconButton}
                          onClick={() => {
                            if (!confirm(tr("Delete {currency}?", { currency: p.currency }))) return;
                            run(() => deleteCurrencyProfile(p.id), tr("{currency} deleted.", { currency: p.currency }));
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {draft && (
          <div className="mx-4 mt-4 rounded border border-line p-4 sm:mx-8">
            <h4 className="border-b border-line pb-1 text-[18px] text-ink">
              {draft.id ? tr("Edit Currency Profile") : tr("Create Currency Profile")}
            </h4>
            <div className="mt-4 grid items-end gap-6 sm:grid-cols-3">
              <select
                aria-label={tr("Currency")}
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                className={cn(line, "cursor-pointer", draft.currency === "" && "text-ink-muted")}
              >
                <option value="">{tr("Currency")}</option>
                {free.map((c) => (
                  <option key={c.code} value={c.code} className="text-ink">
                    {c.code} - {c.symbol}
                  </option>
                ))}
              </select>
              <select
                aria-label={tr("Rate")}
                value={draft.rateKind}
                onChange={(e) => setDraft({ ...draft, rateKind: e.target.value as CurrencyRateKind })}
                className={cn(line, "cursor-pointer")}
              >
                <option value="live">{tr("Live Exchange")}</option>
                <option value="fixed">{tr("Fixed rate")}</option>
              </select>
              {draft.rateKind === "fixed" && (
                <label className="flex items-end gap-2 text-[14px] text-ink">
                  <span className="shrink-0 pb-1.5">1 {draft.currency || "…"} =</span>
                  <input
                    aria-label={tr("Fixed rate")}
                    inputMode="decimal"
                    value={draft.rate}
                    onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                    className={cn(line, "tnum")}
                  />
                  <span className="shrink-0 pb-1.5">{defaultCurrency}</span>
                </label>
              )}
            </div>
            {error && (
              <p role="alert" className="mt-3 text-[12.5px] text-rose-700">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className={secondary} onClick={() => setDraft(null)}>
                {tr("Cancel")}
              </button>
              <button
                type="button"
                className={primary}
                disabled={pending}
                onClick={() => save(draft)}
              >
                {tr("Save")}
              </button>
            </div>
          </div>
        )}

        {canEdit && (
          <div className="mt-6 border-t border-line bg-shell/60 px-4 py-4">
            <button
              type="button"
              className={primary}
              onClick={() => {
                setError(null);
                setDraft({ id: null, currency: "", rateKind: "live", rate: "" });
              }}
            >
              {tr("Add currency profile")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
