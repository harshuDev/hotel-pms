import { msg } from "@/lib/i18n/translate";

/*
 * How an extra sold with a rate is charged (0118), set per extra on the rate
 * plan's form. The ids are the values the `rate_plan_extras` checks allow, and
 * `post_rate_plan_extras()` / `post_room_charge()` read them -- the three
 * change together.
 */

export const EXTRA_POSTINGS = ["added", "included"] as const;
export type ExtraPosting = (typeof EXTRA_POSTINGS)[number];

export const EXTRA_FREQUENCIES = ["per_night", "per_stay"] as const;
export type ExtraFrequency = (typeof EXTRA_FREQUENCIES)[number];

export const EXTRA_PER_UNITS = ["room", "person", "adult", "child"] as const;
export type ExtraPerUnit = (typeof EXTRA_PER_UNITS)[number];

export const EXTRA_CHARGE_ONS = ["check_in", "each_night", "check_out"] as const;
export type ExtraChargeOn = (typeof EXTRA_CHARGE_ONS)[number];

export interface RatePlanExtra {
  extraId: string;
  posting: ExtraPosting;
  frequency: ExtraFrequency;
  perUnit: ExtraPerUnit;
  quantity: number;
  /** Null is the catalog price at the moment it posts. */
  priceCents: number | null;
  /** When an added extra posts; null for an included one. */
  chargeOn: ExtraChargeOn | null;
}

/** The English labels, which are also the translation keys. */
export const EXTRA_POSTING_LABEL: Record<ExtraPosting, string> = {
  added: msg("Added to the bill"),
  included: msg("Included in the rate"),
};

export const EXTRA_FREQUENCY_LABEL: Record<ExtraFrequency, string> = {
  per_night: msg("Per night"),
  per_stay: msg("Per stay"),
};

export const EXTRA_PER_UNIT_LABEL: Record<ExtraPerUnit, string> = {
  room: msg("Per room"),
  person: msg("Per person"),
  adult: msg("Per adult"),
  child: msg("Per child"),
};

export const EXTRA_CHARGE_ON_LABEL: Record<ExtraChargeOn, string> = {
  check_in: msg("At check-in"),
  each_night: msg("Each night"),
  check_out: msg("At check-out"),
};

/** A new link: charged on top, once a night, per room, at the night audit. */
export function defaultRatePlanExtra(extraId: string): RatePlanExtra {
  return {
    extraId,
    posting: "added",
    frequency: "per_night",
    perUnit: "room",
    quantity: 1,
    priceCents: null,
    chargeOn: "each_night",
  };
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

/** A row of `rate_plan_extras` as the app holds it. */
export function ratePlanExtraFromRow(row: {
  extra_id: string;
  posting: string;
  frequency: string;
  per_unit: string;
  quantity: number;
  price_cents: number | null;
  charge_on: string | null;
}): RatePlanExtra {
  const posting = oneOf(EXTRA_POSTINGS, row.posting, "added");
  return {
    extraId: row.extra_id,
    posting,
    frequency: oneOf(EXTRA_FREQUENCIES, row.frequency, "per_night"),
    perUnit: oneOf(EXTRA_PER_UNITS, row.per_unit, "room"),
    quantity: Number(row.quantity ?? 1),
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    chargeOn: posting === "added" ? oneOf(EXTRA_CHARGE_ONS, row.charge_on, "each_night") : null,
  };
}

/** Same set, same terms, regardless of order. */
export function sameRatePlanExtras(a: RatePlanExtra[], b: RatePlanExtra[]): boolean {
  const key = (xs: RatePlanExtra[]) =>
    JSON.stringify([...xs].sort((x, y) => x.extraId.localeCompare(y.extraId)));
  return key(a) === key(b);
}
