/**
 * Settings -> Finances -> Pos Profiles (0084) and Currencies (0083).
 * Both STORED, NOT YET LIVE -- see the migrations and CLAUDE.md.
 */

/**
 * PROVISIONAL: the reference's Type dropdown has not been seen open. The ids
 * are what `known_pos_types()` in 0084 accepts; the two lists change together.
 */
export const POS_TYPES = [
  { id: "restaurant", label: "Restaurant" },
  { id: "bar", label: "Bar" },
  { id: "room_service", label: "Room Service" },
  { id: "spa", label: "Spa" },
  { id: "shop", label: "Shop" },
] as const;

export type PosType = (typeof POS_TYPES)[number]["id"];

export function posTypeLabel(id: string): string {
  return POS_TYPES.find((t) => t.id === id)?.label ?? id;
}

export interface PosProfile {
  id: string;
  posType: string;
  isEnabled: boolean;
}

export type CurrencyRateKind = "live" | "fixed";

/** An additional currency. The default is `properties.currency`, not a row. */
export interface CurrencyProfile {
  id: string;
  currency: string;
  rateKind: CurrencyRateKind;
  /** Units of the default currency one unit of this one buys, in millionths. */
  fixedRateMicros: number | null;
}

/**
 * "17.25" -> 17250000. String arithmetic, so a typed rate never passes
 * through a float. Null when it is not a positive number with at most six
 * decimals.
 */
export function parseRateMicros(input: string): number | null {
  const s = input.trim();
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0") || "0");
  return micros > 0 ? micros : null;
}

/** 17250000 -> "17.25". */
export function formatRateMicros(micros: number): string {
  const whole = Math.floor(micros / 1_000_000);
  const frac = String(micros % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
