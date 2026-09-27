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
