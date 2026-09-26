import { formatMoney } from "@/lib/money";

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
  { id: "arrival", label: "arrival" },
  { id: "departure", label: "departure" },
];

function percent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** The choices as a guest reads them, one sentence per answered question. */
export function cancellationPolicySummary(t: CancellationTerms, currency: string): string {
  const out: string[] = [];

  switch (t.depositRule) {
    case "none":
      out.push("No deposit is required.");
      break;
    case "full":
      out.push("A deposit equal to the total cost is required at the time of booking.");
      break;
    case "nights":
      if (t.depositNights)
        out.push(`A ${t.depositNights} night deposit is required at the time of booking.`);
      break;
    case "percent":
      if (t.depositPercentBps)
        out.push(`A ${percent(t.depositPercentBps)}% deposit is required at the time of booking.`);
      break;
    case "per_booking":
      if (t.depositAmountCents)
        out.push(`${formatMoney(t.depositAmountCents, currency)} is required per booking.`);
      break;
    case "per_room":
      if (t.depositAmountCents)
        out.push(`${formatMoney(t.depositAmountCents, currency)} is required per room booked.`);
      break;
  }

  if (t.refundRule === "non_refundable") out.push("All deposits are non-refundable.");
  if (t.refundRule === "until_days" && t.refundDays !== null)
    out.push(`Deposits are refundable up to ${t.refundDays} days prior to arrival.`);
  if (t.refundRule === "custom" && t.refundCustom?.trim()) out.push(t.refundCustom.trim());

  if (t.balanceDue) out.push(`The remaining balance is to be paid on ${t.balanceDue}.`);
  if (t.preauthoriseCard) out.push("We have the right to pre-authorise your card prior to arrival.");
  if (t.otherCustom?.trim()) out.push(t.otherCustom.trim());

  if (t.cancelRule === "free_any_time") out.push("Free cancellation at any time.");
  if (t.cancelRule === "no_cancellation")
    out.push("No cancellation or modification can be applied to this booking.");
  if (t.cancelRule === "free_until" && t.cancelValue !== null && t.cancelUnit)
    out.push(`Free cancellation up to ${t.cancelValue} ${t.cancelUnit} before arrival.`);
  if (t.cancelRule === "custom" && t.cancelCustom?.trim()) out.push(t.cancelCustom.trim());

  if (t.noShowRule === "first_night")
    out.push("In case of no-show or late cancellation the first night will be charged.");
  if (t.noShowRule === "total")
    out.push("In case of no-show or late cancellation the total cost will be charged.");
  if (t.noShowRule === "custom" && t.noShowCustom?.trim()) out.push(t.noShowCustom.trim());

  if (!t.breakfastOmit && t.breakfastCustom?.trim()) out.push(t.breakfastCustom.trim());

  return out.join(" ");
}
