export const CURRENCY = "GBP";
export const LOCALE = "en-GB";

/**
 * All currency in this app is stored as integer minor units (pence).
 * This is the ONLY place currency becomes a string. Never format inline.
 */
function assertMinorUnits(pence: number): void {
  if (!Number.isSafeInteger(pence)) {
    throw new Error("Money must be a safe integer number of pence");
  }
}

export function formatMoney(
  cents: number,
  currency: string = CURRENCY,
): string {
  assertMinorUnits(cents);

  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Compact form for chart axes and headline totals. */
export function formatMoneyShort(
  cents: number,
  currency: string = CURRENCY,
): string {
  assertMinorUnits(cents);

  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

/**
 * Amount due is stored positive when the guest owes the hotel.
 * The reference PMS displays it inverted. That inversion happens here,
 * in the formatter, and nowhere else.
 */
export function formatDue(
  balanceCents: number,
  currency: string = CURRENCY,
): string {
  return formatMoney(-balanceCents, currency);
}

export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, "");

  if (!/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(cleaned)) {
    throw new Error(`Not a valid amount: ${input}`);
  }

  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const pence = Number(`${whole || "0"}${fraction.padEnd(2, "0")}`);

  return negative ? -pence : pence;
}
