/**
 * The staff application writes figures the English way ("1,284.00") because
 * it speaks English. The CURRENCY is the property's own -- `properties.currency`
 * -- and every formatter here takes it as a required argument.
 *
 * It used to default to a constant "GBP", so a hotel set up in pesos had every
 * staff screen print pounds. Required rather than defaulted, so a call that
 * forgets it is a compile error rather than a quiet pound sign; the same move
 * as removing PageHeader's subtitle. Server pages read it with
 * `getPropertyCurrency()`, client components with `useCurrency()`.
 *
 * It cannot be a module-level setting: this file renders on the server for
 * every hotel at once, and two requests interleaving would print one hotel's
 * money in another's currency.
 */
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

/**
 * The same figure, written the way the reader's language writes it.
 *
 * The staff app has one audience in one country, so formatMoney() pins en-GB
 * and that is right. The guest booking page does not: a German guest expects
 * "120,00 £" and a French one a space before the symbol. Only the formatting
 * locale moves — the currency is still the property's, and the value is still
 * integer pence, because a price is not a different price in another language.
 */
export function formatMoneyIn(
  cents: number,
  currency: string,
  locale: string,
): string {
  assertMinorUnits(cents);

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatMoney(cents: number, currency: string): string {
  assertMinorUnits(cents);

  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    // "$24.00" for a peso hotel rather than en-GB's "MX$24.00". A screen shows
    // one property's money, so the narrow symbol is never ambiguous on it.
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Compact form for chart axes and headline totals. */
export function formatMoneyShort(cents: number, currency: string): string {
  assertMinorUnits(cents);

  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

/**
 * Amount due is stored positive when the guest owes the hotel.
 * The reference PMS displays it inverted. That inversion happens here,
 * in the formatter, and nowhere else.
 */
export function formatDue(balanceCents: number, currency: string): string {
  return formatMoney(-balanceCents, currency);
}

/**
 * The plain editable form of an amount: "15.00" — no symbol, no grouping — for
 * a text input whose value goes straight back to parseMoney().
 *
 * It lives here for the same reason every other formatter does. Doing it in a
 * component would be a second place where a number becomes a currency string,
 * and `cents / 100` in JSX is float arithmetic on money. This stays on
 * integers: whole pounds and the remainder, padded.
 */
export function formatMoneyInput(cents: number): string {
  assertMinorUnits(cents);

  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const remainder = abs % 100;

  return `${negative ? "-" : ""}${whole}.${String(remainder).padStart(2, "0")}`;
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
