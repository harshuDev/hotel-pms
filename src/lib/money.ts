export const CURRENCY = "INR";
export const LOCALE = "en-IN";

/**
 * All currency in this app is stored as integer minor units (cents/paise).
 * This is the ONLY place currency becomes a string. Never format inline.
 */
export function formatMoney(cents: number, currency: string = CURRENCY): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Compact form for chart axes and headline totals. */
export function formatMoneyShort(cents: number, currency: string = CURRENCY): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

/**
 * Amount due is stored positive when the guest owes the hotel.
 * The reference PMS displays it inverted. That inversion happens HERE,
 * in the formatter, and nowhere else.
 */
export function formatDue(balanceCents: number, currency: string = CURRENCY): string {
  return formatMoney(-balanceCents, currency);
}

export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (!cleaned || !/^-?\d*\.?\d{0,2}$/.test(cleaned)) {
    throw new Error(`Not a valid amount: ${input}`);
  }
  return Math.round(parseFloat(cleaned) * 100);
}
