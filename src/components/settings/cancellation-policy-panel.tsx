"use client";

import { useT } from "@/components/i18n";
import { useState } from "react";
import { cn } from "@/components/ui";
import { useCurrency } from "@/components/currency";
import { EditIcon } from "@/components/settings/finance-panels";
import { formatMoneyInput, parseMoney } from "@/lib/money";
import { formatPercentBps, parsePercentBps } from "@/lib/finance-profiles";
import {
  BALANCE_DUE_OPTIONS,
  cancellationPolicySummary,
  type BalanceDue,
  type CancelRule,
  type CancelUnit,
  type CancellationTerms,
  type DepositRule,
  type NoShowRule,
  type RefundRule,
} from "@/lib/cancellation-policy";
import type { CancellationPolicy } from "@/lib/types";
import { deleteCancellationPolicy, saveCancellationPolicyTerms } from "@/lib/actions/settings";

/*
 * Settings -> Inventory -> Cancellation Policy (0093), cloned from the
 * client's reference: the list (Policy Name, Default, a pencil, a cross) and
 * the form under it, section by section, ending in the sentence the choices
 * add up to -- which is saved as the wording the guest page shows.
 *
 * The CANCELLATION choice is what the booking screen enforces; Postgres turns
 * it into the kind and free days. Deposits, refunds, other details, no-show
 * and breakfast are the hotel's stated terms: nothing collects or charges a
 * deposit (there is no card capture). "Flexible Cancellation Fee based at
 * cancellation period" is not built -- its fee schedule has not been seen.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

/** The form keeps numbers as typed strings, so an emptied box stays empty. */
type Draft = {
  id: string | null;
  name: string;
  isDefault: boolean;
  depositRule: DepositRule | null;
  depositNights: string;
  depositPercent: string;
  depositAmount: string;
  refundRule: RefundRule | null;
  refundDays: string;
  refundCustom: string;
  balanceOn: boolean;
  balanceDue: BalanceDue | "";
  preauthoriseCard: boolean;
  otherOn: boolean;
  otherCustom: string;
  cancelRule: CancelRule | null;
  cancelValue: string;
  cancelUnit: CancelUnit | "";
  cancelCustom: string;
  noShowRule: NoShowRule | null;
  noShowCustom: string;
  breakfastOmit: boolean;
  breakfastCustom: string;
};

const card = "rounded-lg border border-line bg-white shadow-card";
const heading = "mt-5 border-b border-line pb-1 text-[16px] text-ink";
const option = "flex flex-wrap items-center gap-1.5 py-[3px] text-[12.5px] text-ink-muted";
const small =
  "w-14 rounded border border-line bg-white px-1.5 py-0.5 text-center text-[12.5px] text-ink outline-none focus:border-brass";
const text =
  "mt-1 w-full rounded border border-line bg-white px-2 py-1 text-[12.5px] text-ink outline-none focus:border-brass";
const iconButton =
  "grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell";

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function draftOf(p: CancellationPolicy | null, total: number): Draft {
  const t = p?.terms;
  return {
    id: p?.id ?? null,
    name: p?.name ?? "",
    isDefault: p?.isDefault ?? total === 0,
    depositRule: t?.depositRule ?? null,
    depositNights: t?.depositNights != null ? String(t.depositNights) : "",
    depositPercent: t?.depositPercentBps != null ? formatPercentBps(t.depositPercentBps) : "",
    depositAmount: t?.depositAmountCents != null ? formatMoneyInput(t.depositAmountCents) : "",
    refundRule: t?.refundRule ?? null,
    refundDays: t?.refundDays != null ? String(t.refundDays) : "",
    refundCustom: t?.refundCustom ?? "",
    balanceOn: Boolean(t?.balanceDue),
    balanceDue: t?.balanceDue ?? "",
    preauthoriseCard: t?.preauthoriseCard ?? false,
    otherOn: Boolean(t?.otherCustom),
    otherCustom: t?.otherCustom ?? "",
    cancelRule: t?.cancelRule ?? null,
    cancelValue: t?.cancelValue != null ? String(t.cancelValue) : "",
    cancelUnit: t?.cancelUnit ?? "days",
    cancelCustom: t?.cancelCustom ?? "",
    noShowRule: t?.noShowRule ?? null,
    noShowCustom: t?.noShowCustom ?? "",
    breakfastOmit: t?.breakfastOmit ?? true,
    breakfastCustom: t?.breakfastCustom ?? "",
  };
}

function wholeOrNull(s: string): number | null {
  return /^\s*\d{1,5}\s*$/.test(s) ? Number(s) : null;
}

function moneyOrNull(s: string): number | null {
  try {
    const v = parseMoney(s);
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** The draft as the stored choices. Unparseable numbers become null, which
 *  Postgres then refuses by name for the choice that needs them. */
function termsOf(d: Draft): CancellationTerms {
  return {
    depositRule: d.depositRule,
    depositNights: d.depositRule === "nights" ? wholeOrNull(d.depositNights) : null,
    depositPercentBps: d.depositRule === "percent" ? parsePercentBps(d.depositPercent) : null,
    depositAmountCents:
      d.depositRule === "per_booking" || d.depositRule === "per_room" ? moneyOrNull(d.depositAmount) : null,
    refundRule: d.refundRule,
    refundDays: d.refundRule === "until_days" ? wholeOrNull(d.refundDays) : null,
    refundCustom: d.refundRule === "custom" ? d.refundCustom : null,
    balanceDue: d.balanceOn && d.balanceDue !== "" ? d.balanceDue : null,
    preauthoriseCard: d.preauthoriseCard,
    otherCustom: d.otherOn && d.otherCustom.trim() !== "" ? d.otherCustom : null,
    cancelRule: d.cancelRule,
    cancelValue: d.cancelRule === "free_until" ? wholeOrNull(d.cancelValue) : null,
    cancelUnit: d.cancelRule === "free_until" && d.cancelUnit !== "" ? d.cancelUnit : null,
    cancelCustom: d.cancelRule === "custom" ? d.cancelCustom : null,
    noShowRule: d.noShowRule,
    noShowCustom: d.noShowRule === "custom" ? d.noShowCustom : null,
    breakfastOmit: d.breakfastOmit,
    breakfastCustom: d.breakfastOmit ? null : d.breakfastCustom,
  };
}

export function CancellationPolicyPanel({
  policies,
  canEdit,
  pending,
  run,
}: {
  policies: CancellationPolicy[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const currency = useCurrency();
  // The reference writes the currency code beside a deposit amount ("MXN").
  const symbol = currency;
  const [draft, setDraft] = useState<Draft | null>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  const summary = draft ? cancellationPolicySummary(termsOf(draft), currency, tr) : "";

  function save(d: Draft) {
    run(async () => {
      const result = await saveCancellationPolicyTerms({
        id: d.id,
        name: d.name,
        terms: termsOf(d),
        isDefault: d.isDefault,
        summary: cancellationPolicySummary(termsOf(d), currency, tr),
      });
      if (result.ok) setDraft(null);
      return result;
    }, tr("{name} saved.", { name: d.name.trim() || tr("Cancellation policy") }));
  }

  function radio<K extends "depositRule" | "refundRule" | "cancelRule" | "noShowRule">(
    key: K,
    value: NonNullable<Draft[K]>,
    group: string,
  ) {
    return (
      <input
        type="radio"
        name={group}
        checked={draft?.[key] === value}
        onChange={() => set(key, value as Draft[K])}
        className="h-3.5 w-3.5 accent-brass"
      />
    );
  }

  return (
    <div className="max-w-5xl space-y-2">
      <h2 className="border-b border-line pb-1 text-[22px] text-ink">{tr("Cancellation Policy")}</h2>
      <section className={cn(card, "px-4 pb-6 pt-5 sm:px-10")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-[13px]">
            <thead>
              <tr className="border-b-2 border-line">
                <th className="w-[60%] px-2 py-2.5 text-left font-semibold text-ink">{tr("Policy Name")}</th>
                <th className="px-2 py-2.5 text-left font-semibold text-ink">{tr("Default")}</th>
                <th className="w-20" aria-label={tr("Actions")} />
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id} className={cn("border-b border-line", draft?.id === p.id && "bg-shell/70")}>
                  <td className="px-2 py-2.5 text-ink">{p.name}</td>
                  <td className="px-2 py-2.5">
                    <span
                      role="img"
                      aria-label={p.isDefault ? tr("Default") : tr("Not default")}
                      className={cn("block h-3 w-3 rounded-full", p.isDefault ? "bg-emerald-500" : "bg-slate-400")}
                    />
                  </td>
                  <td className="py-0.5">
                    {canEdit && (
                      <span className="flex justify-end">
                        <button
                          type="button"
                          aria-label={tr("Edit {name}", { name: p.name })}
                          className={iconButton}
                          onClick={() => setDraft(draftOf(p, policies.length))}
                        >
                          <EditIcon />
                        </button>
                        {/* Not on the default, as the reference's; one on a
                            rate plan is refused by name. */}
                        {!p.isDefault && (
                          <button
                            type="button"
                            aria-label={tr("Delete {name}", { name: p.name })}
                            className={iconButton}
                            onClick={() => {
                              if (!confirm(tr("Delete {name}?", { name: p.name }))) return;
                              run(async () => {
                                const result = await deleteCancellationPolicy(p.id);
                                if (result.ok && draft?.id === p.id) setDraft(null);
                                return result;
                              }, tr("{name} deleted.", { name: p.name }));
                            }}
                          >
                            <CrossIcon />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {policies.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-2 py-5 text-ink-muted">
                    {tr("None yet. Add the terms your rates are sold under.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canEdit && !draft && (
          <button
            type="button"
            className="mt-3 text-[13px] font-semibold text-brass hover:underline"
            onClick={() => setDraft(draftOf(null, policies.length))}
          >
            {tr("+ Add Cancellation Policy")}
          </button>
        )}

        {draft && (
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              save(draft);
            }}
          >
            <label className="flex flex-wrap items-center gap-4 px-2 text-[13.5px] text-ink-muted">
              <span className="w-32">{tr("Policy Title:")}</span>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                className="min-w-0 flex-1 rounded border border-line px-3 py-1.5 text-[13.5px] text-ink outline-none focus:border-brass"
              />
            </label>

            <h3 className={heading}>{tr("How do you handle deposits?")}</h3>
            <div className="mt-2 px-2">
              <label className={option}>{radio("depositRule", "none", "dep")}{tr("No deposit is required")}</label>
              <label className={option}>
                {radio("depositRule", "full", "dep")}{tr("A deposit equal to the total cost is required at the time of booking")}
              </label>
              <label className={option}>
                {radio("depositRule", "nights", "dep")}
                <input aria-label={tr("Nights")} inputMode="numeric" value={draft.depositNights} className={small}
                  onFocus={() => set("depositRule", "nights")}
                  onChange={(e) => set("depositNights", e.target.value)} />
                {tr("night deposit is required at the time of booking")}
              </label>
              <label className={option}>
                {radio("depositRule", "percent", "dep")}
                <input aria-label={tr("Percent")} inputMode="decimal" value={draft.depositPercent} className={small}
                  onFocus={() => set("depositRule", "percent")}
                  onChange={(e) => set("depositPercent", e.target.value)} />
                {tr("% deposit is required at the time of booking")}
              </label>
              <label className={option}>
                {radio("depositRule", "per_booking", "dep")}
                <input aria-label={tr("Amount per booking")} inputMode="decimal"
                  value={draft.depositRule === "per_booking" ? draft.depositAmount : ""} className={small}
                  onFocus={() => set("depositRule", "per_booking")}
                  onChange={(e) => set("depositAmount", e.target.value)} />
                {symbol} {tr("is required per booking")}
              </label>
              <label className={option}>
                {radio("depositRule", "per_room", "dep")}
                <input aria-label={tr("Amount per room")} inputMode="decimal"
                  value={draft.depositRule === "per_room" ? draft.depositAmount : ""} className={small}
                  onFocus={() => set("depositRule", "per_room")}
                  onChange={(e) => set("depositAmount", e.target.value)} />
                {symbol} {tr("is required per room booked")}
              </label>
            </div>

            <h3 className={heading}>{tr("How do you handle refunds of deposits?")}</h3>
            <div className="mt-2 px-2">
              <label className={option}>{radio("refundRule", "non_refundable", "ref")}{tr("All deposits are non-refundable")}</label>
              <label className={option}>
                {radio("refundRule", "until_days", "ref")}{tr("Deposits are refundable up to")}
                <input aria-label={tr("Days")} inputMode="numeric" value={draft.refundDays} className={small}
                  onFocus={() => set("refundRule", "until_days")}
                  onChange={(e) => set("refundDays", e.target.value)} />
                {tr("days prior to arrival")}
              </label>
              <label className={option}>{radio("refundRule", "custom", "ref")}{tr("Custom Policy")}</label>
              {draft.refundRule === "custom" && (
                <textarea aria-label={tr("Custom refund policy")} rows={2} value={draft.refundCustom} className={text}
                  onChange={(e) => set("refundCustom", e.target.value)} />
              )}
            </div>

            <h3 className={heading}>{tr("Do you have any other details?")}</h3>
            <div className="mt-2 px-2">
              <label className={option}>
                <input type="checkbox" checked={draft.balanceOn} className="h-3.5 w-3.5 accent-brass"
                  onChange={(e) => set("balanceOn", e.target.checked)} />
                {tr("Remaining balance to be paid on")}
                <select aria-label={tr("Paid on")} value={draft.balanceDue}
                  onChange={(e) => {
                    set("balanceDue", e.target.value as BalanceDue | "");
                    if (e.target.value) set("balanceOn", true);
                  }}
                  className="rounded border border-line bg-white px-1.5 py-0.5 text-[12.5px] text-ink">
                  <option value="" />
                  {BALANCE_DUE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{tr(o.label)}</option>
                  ))}
                </select>
              </label>
              <label className={option}>
                <input type="checkbox" checked={draft.preauthoriseCard} className="h-3.5 w-3.5 accent-brass"
                  onChange={(e) => set("preauthoriseCard", e.target.checked)} />
                {tr("We have the right to pre-authorise your card prior to arrival")}
              </label>
              <label className={option}>
                <input type="checkbox" checked={draft.otherOn} className="h-3.5 w-3.5 accent-brass"
                  onChange={(e) => set("otherOn", e.target.checked)} />
                {tr("Custom Policy")}
              </label>
              {draft.otherOn && (
                <textarea aria-label={tr("Other details")} rows={2} value={draft.otherCustom} className={text}
                  onChange={(e) => set("otherCustom", e.target.value)} />
              )}
            </div>

            <h3 className={heading}>{tr("Cancellation Policy")}</h3>
            <div className="mt-2 px-2">
              <label className={option}>{radio("cancelRule", "free_any_time", "can")}{tr("Free cancellation at any time")}</label>
              <label className={option}>
                {radio("cancelRule", "no_cancellation", "can")}{tr("No cancellation or modification can be applied to this booking")}
              </label>
              <label className={option}>
                {radio("cancelRule", "free_until", "can")}{tr("Free cancellation up")}
                <input aria-label={tr("How long before arrival")} inputMode="numeric" value={draft.cancelValue} className={small}
                  onFocus={() => set("cancelRule", "free_until")}
                  onChange={(e) => set("cancelValue", e.target.value)} />
                <select aria-label={tr("Days or hours")} value={draft.cancelUnit}
                  onChange={(e) => set("cancelUnit", e.target.value as CancelUnit)}
                  className="rounded border border-line bg-white px-1.5 py-0.5 text-[12.5px] text-ink">
                  <option value="days">{tr("days")}</option>
                  <option value="hours">{tr("hours")}</option>
                </select>
                {tr("before arrival")}
              </label>
              <label className={option}>{radio("cancelRule", "custom", "can")}{tr("Custom Policy")}</label>
              {draft.cancelRule === "custom" && (
                <textarea aria-label={tr("Custom cancellation policy")} rows={2} value={draft.cancelCustom} className={text}
                  onChange={(e) => set("cancelCustom", e.target.value)} />
              )}
            </div>

            <h3 className={heading}>{tr("No-Show or late cancellation policy")}</h3>
            <div className="mt-2 px-2">
              <label className={option}>
                {radio("noShowRule", "first_night", "ns")}{tr("In case of no-show or late cancellation the first night will be charged")}
              </label>
              <label className={option}>
                {radio("noShowRule", "total", "ns")}{tr("In case of no-show or late cancellation the total cost will be charged")}
              </label>
              <label className={option}>{radio("noShowRule", "custom", "ns")}{tr("Custom Policy")}</label>
              {draft.noShowRule === "custom" && (
                <textarea aria-label={tr("Custom no-show policy")} rows={2} value={draft.noShowCustom} className={text}
                  onChange={(e) => set("noShowCustom", e.target.value)} />
              )}
            </div>

            <h3 className={heading}>{tr("Breakfast")}</h3>
            <div className="mt-2 px-2">
              <label className={option}>
                <input type="checkbox" checked={draft.breakfastOmit} className="h-3.5 w-3.5 accent-brass"
                  onChange={(e) => set("breakfastOmit", e.target.checked)} />
                {tr("Omit policy")}
              </label>
              {!draft.breakfastOmit && (
                <textarea aria-label={tr("Breakfast policy")} rows={2} value={draft.breakfastCustom} className={text}
                  onChange={(e) => set("breakfastCustom", e.target.value)} />
              )}
              <label className={cn(option, "mt-3")}>
                <input type="checkbox" checked={draft.isDefault} className="h-3.5 w-3.5 accent-brass"
                  onChange={(e) => set("isDefault", e.target.checked)} />
                {tr("Use as default policy")}
              </label>
            </div>

            <p className="mt-4 px-2 text-[12px] text-ink">{summary}</p>

            <div className="mt-5 flex justify-center gap-3">
              <button type="submit" className={primary} disabled={pending}>
                {tr("Save")}
              </button>
              <button type="button" className={secondary} onClick={() => setDraft(null)}>
                {tr("Cancel")}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
