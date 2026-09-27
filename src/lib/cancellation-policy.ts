import { formatMoney } from "@/lib/money";
import { msg, type Translator } from "@/lib/i18n/translate";

/**
 * Settings -> Inventory -> Cancellation Policy (0093): the reference's form as
 * data, and the sentence it adds up to.
 *
 * The ids are what the check constraints in 0093 allow; the lists change
 * together. `cancellationPolicySummary()` is pure, runs in the form as the
 * hotel types, and is what `save_cancellation_policy_terms()` stores as the
 * policy's wording -- which the guest booking page already shows.
 */

export type DepositRule = "none" | "full" | "nights" | "percent" | "per_booking" | "per_room";
export type RefundRule = "non_refundable" | "until_days" | "custom";
export type BalanceDue = "arrival" | "departure";
export type CancelRule = "free_any_time" | "no_cancellation" | "free_until" | "custom";
export type CancelUnit = "days" | "hours";
export type NoShowRule = "first_night" | "total" | "custom";

export interface CancellationTerms {
  depositRule: DepositRule | null;
  depositNights: number | null;
  depositPercentBps: number | null;
  depositAmountCents: number | null;
  refundRule: RefundRule | null;
  refundDays: number | null;
  refundCustom: string | null;
  /** Null when "Remaining balance to be paid on" is unticked. */
  balanceDue: BalanceDue | null;
  preauthoriseCard: boolean;
  /** Null when the other-details Custom Policy is unticked. */
  otherCustom: string | null;
  cancelRule: CancelRule | null;
  cancelValue: number | null;
  cancelUnit: CancelUnit | null;
  cancelCustom: string | null;
  noShowRule: NoShowRule | null;
  noShowCustom: string | null;
  breakfastOmit: boolean;
  breakfastCustom: string | null;
}

/** "Remaining balance to be paid on" -- PROVISIONAL: the reference's list has not been seen open. */
export const BALANCE_DUE_OPTIONS: { id: BalanceDue; label: string }[] = [
  { id: "arrival", label: msg("arrival") },
  { id: "departure", label: msg("departure") },
];

function percent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** The choices as a guest reads them, one sentence per answered question. */
export function cancellationPolicySummary(t: CancellationTerms, currency: string, tr: Translator): string {
  const out: string[] = [];

  switch (t.depositRule) {
    case "none":
      out.push(tr("No deposit is required."));
      break;
    case "full":
      out.push(tr("A deposit equal to the total cost is required at the time of booking."));
      break;
    case "nights":
      if (t.depositNights)
        out.push(tr.plural(t.depositNights, "A {n} night deposit is required at the time of booking.", "A {n} night deposit is required at the time of booking."));
      break;
    case "percent":
      if (t.depositPercentBps)
        out.push(tr("A {percent}% deposit is required at the time of booking.", { percent: percent(t.depositPercentBps) }));
      break;
    case "per_booking":
      if (t.depositAmountCents)
        out.push(tr("{amount} is required per booking.", { amount: formatMoney(t.depositAmountCents, currency) }));
      break;
    case "per_room":
      if (t.depositAmountCents)
        out.push(tr("{amount} is required per room booked.", { amount: formatMoney(t.depositAmountCents, currency) }));
      break;
  }

  if (t.refundRule === "non_refundable") out.push(tr("All deposits are non-refundable."));
  if (t.refundRule === "until_days" && t.refundDays !== null)
    out.push(tr.plural(t.refundDays, "Deposits are refundable up to {n} day prior to arrival.", "Deposits are refundable up to {n} days prior to arrival."));
  if (t.refundRule === "custom" && t.refundCustom?.trim()) out.push(t.refundCustom.trim());

  if (t.balanceDue === "arrival") out.push(tr("The remaining balance is to be paid on arrival."));
  if (t.balanceDue === "departure") out.push(tr("The remaining balance is to be paid on departure."));
  if (t.preauthoriseCard) out.push(tr("We have the right to pre-authorise your card prior to arrival."));
  if (t.otherCustom?.trim()) out.push(t.otherCustom.trim());

  if (t.cancelRule === "free_any_time") out.push(tr("Free cancellation at any time."));
  if (t.cancelRule === "no_cancellation")
    out.push(tr("No cancellation or modification can be applied to this booking."));
  if (t.cancelRule === "free_until" && t.cancelValue !== null && t.cancelUnit === "days")
    out.push(tr.plural(t.cancelValue, "Free cancellation up to {n} day before arrival.", "Free cancellation up to {n} days before arrival."));
  if (t.cancelRule === "free_until" && t.cancelValue !== null && t.cancelUnit === "hours")
    out.push(tr.plural(t.cancelValue, "Free cancellation up to {n} hour before arrival.", "Free cancellation up to {n} hours before arrival."));
  if (t.cancelRule === "custom" && t.cancelCustom?.trim()) out.push(t.cancelCustom.trim());

  if (t.noShowRule === "first_night")
    out.push(tr("In case of no-show or late cancellation the first night will be charged."));
  if (t.noShowRule === "total")
    out.push(tr("In case of no-show or late cancellation the total cost will be charged."));
  if (t.noShowRule === "custom" && t.noShowCustom?.trim()) out.push(t.noShowCustom.trim());

  if (!t.breakfastOmit && t.breakfastCustom?.trim()) out.push(t.breakfastCustom.trim());

  return out.join(" ");
}
