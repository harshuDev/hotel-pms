import { msg } from "@/lib/i18n/translate";
/**
 * Settings -> Finances -> Pos Profiles (0084) and Currencies (0083).
 * Both STORED, NOT YET LIVE -- see the migrations and CLAUDE.md.
 */

/**
 * PROVISIONAL: the reference's Type dropdown has not been seen open. The ids
 * are what `known_pos_types()` in 0084 accepts; the two lists change together.
 */
export const POS_TYPES = [
  { id: "restaurant", label: msg("Restaurant") },
  { id: "bar", label: msg("Bar") },
  { id: "room_service", label: msg("Room Service") },
  { id: "spa", label: msg("Spa") },
  { id: "shop", label: msg("Shop") },
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
  /**
   * The rate in use (0138): the fixed rate, else today's live rate, in the
   * same millionths. Null when there is none yet.
   */
  rateMicros?: number | null;
  /** The day a live rate is from; null for a fixed rate. */
  rateDate?: string | null;
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

/**
 * Settings -> Finances -> Accounting Categories (0085): the ledger accounts a
 * bookkeeper posts to. Not the Extras catalog's "Accounting Category", which
 * is the report bucket (`folio_item_type`).
 */
export interface AccountingCategory {
  id: string;
  name: string;
  internalCode: string | null;
  externalCode: string | null;
}

/** The four defaults. Always set: the migration seeds them. */
export interface AccountingDefaults {
  accommodationId: string;
  extrasId: string;
  taxesId: string;
  paymentsId: string;
}

export interface AccountingSettings {
  categories: AccountingCategory[];
  defaults: AccountingDefaults | null;
}

/** The four pickers, in the reference's order and wording. */
export const ACCOUNTING_DEFAULT_KINDS = [
  { key: "accommodationId", label: msg("Default for accommodation") },
  { key: "extrasId", label: msg("Default for extras") },
  { key: "taxesId", label: msg("Default for taxes") },
  { key: "paymentsId", label: msg("Default for payments") },
] as const satisfies readonly { key: keyof AccountingDefaults; label: string }[];

/**
 * Settings -> Finances -> Payment Gateway (0086). STORED, NOT YET LIVE: no
 * gateway is connected, and none holds credentials here. The ids are what
 * `known_payment_gateways()` accepts; the two lists change together.
 */
export const PAYMENT_GATEWAYS = [
  { id: "stripe_sca", label: msg("Stripe SCA") },
  { id: "channex_pci", label: msg("ChannexPCI") },
] as const;

export function paymentGatewayLabel(id: string): string {
  return PAYMENT_GATEWAYS.find((g) => g.id === id)?.label ?? id;
}

export interface PaymentGateway {
  id: string;
  provider: string;
  title: string;
  isDefault: boolean;
}

/**
 * Settings -> Finances -> Accounting Systems (0087). STORED, NOT YET LIVE:
 * nothing is exported. PROVISIONAL list -- the reference's add form has not
 * been seen. The ids are what `known_accounting_systems()` accepts; the two
 * lists change together.
 */
export const ACCOUNTING_SYSTEMS = [
  { id: "quickbooks_online", label: msg("QuickBooks Online") },
  { id: "xero", label: msg("Xero") },
  { id: "sage", label: msg("Sage") },
] as const;

export function accountingSystemLabel(id: string): string {
  return ACCOUNTING_SYSTEMS.find((s) => s.id === id)?.label ?? id;
}

export interface AccountingSystem {
  id: string;
  provider: string;
  isEnabled: boolean;
}

/**
 * Settings -> Inventory -> Discounts (0090). STORED, NOT YET APPLIED: nothing
 * takes a discount off a stay yet -- see the migration.
 */
export type DiscountKind = "percent" | "fixed";

export interface Discount {
  id: string;
  title: string;
  kind: DiscountKind;
  /** Basis points: 1000 is 10.0 %. Set only on a percent discount. */
  percentBps: number | null;
  /** Minor units of the property's currency. Set only on a fixed discount. */
  amountCents: number | null;
}

/**
 * "10", "10.5" or "10.25" as basis points, parsed from the string so no float
 * is involved. Null for anything else, or outside 0-100.
 */
export function parsePercentBps(input: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(input);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps >= 1 && bps <= 10000 ? bps : null;
}

/** 1000 -> "10.0", 1025 -> "10.25": at least one decimal, as the reference shows. */
export function formatPercentBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(bps % 100).padStart(2, "0");
  return `${whole}.${frac.endsWith("0") ? frac[0] : frac}`;
}

/** A currency the hotel's prices are also SHOWN in, at a rate in millionths. */
export interface DisplayCurrency {
  currency: string;
  rateMicros: number;
}

/*
 * Legal fixed pegs, in millionths of the hotel's currency per unit of the
 * other: the CFA francs are pegged to the euro by treaty at 655.957. Used
 * only when Postgres has not handed down the rate in use (0138).
 */
const PEGS: Record<string, Record<string, number>> = {
  XOF: { EUR: 655_957_000 },
  XAF: { EUR: 655_957_000 },
};

/**
 * The hotel's additional currencies (Settings -> Currencies) that a price can
 * be shown in: the rate in use as Postgres worked it out (fixed, else live),
 * else a typed fixed rate, else a legal peg.
 */
export function displayCurrencies(base: string, profiles: CurrencyProfile[]): DisplayCurrency[] {
  const b = base.trim().toUpperCase();
  const out: DisplayCurrency[] = [];
  for (const p of profiles) {
    const c = p.currency.trim().toUpperCase();
    if (c === b || out.some((d) => d.currency === c)) continue;
    const rate =
      p.rateMicros ?? (p.rateKind === "fixed" && p.fixedRateMicros ? p.fixedRateMicros : PEGS[b]?.[c]);
    if (rate && rate > 0) out.push({ currency: c, rateMicros: rate });
  }
  return out;
}

/** The smallest amount a currency is written in, in hundredths (money.ts, 0138). */
function minorStep(currency: string): bigint {
  const c = currency.trim().toUpperCase();
  return c === "XOF" || c === "XAF" ? BigInt(100) : BigInt(1);
}

/**
 * An amount in one of the hotel's currencies, in another, as
 * `convert_currency_cents()` does it: through the hotel's currency, rounded
 * once, half away from zero, to the target's smallest unit. `rates` holds
 * each other currency's rate in use; the hotel's own is one. Null without a
 * rate. BigInt, so no money passes through a float.
 */
export function convertBetween(
  cents: number,
  from: string,
  to: string,
  base: string,
  rates: DisplayCurrency[],
): number | null {
  const f = from.trim().toUpperCase();
  const t = to.trim().toUpperCase();
  if (f === t) return cents;
  const b = base.trim().toUpperCase();
  const rateOf = (c: string) => (c === b ? 1_000_000 : (rates.find((d) => d.currency === c)?.rateMicros ?? null));
  const rf = rateOf(f);
  const rt = rateOf(t);
  if (!rf || !rt || !Number.isSafeInteger(cents)) return null;
  const step = minorStep(t);
  const n = BigInt(cents) * BigInt(rf);
  const d = BigInt(rt) * step;
  const neg = n < BigInt(0);
  const a = neg ? -n : n;
  const q = ((a * BigInt(2) + d) / (BigInt(2) * d)) * step;
  return Number(neg ? -q : q);
}
