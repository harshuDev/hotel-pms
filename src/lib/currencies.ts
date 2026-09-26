/**
 * The currencies a property can be set to, with the symbol the reference
 * shows beside each ("MXN - MXN - $").
 *
 * A static list rather than `Intl.NumberFormat(...).formatToParts()`: Node's
 * ICU and the browser's disagree about symbols -- "$" against "MX$", "kr"
 * against "Kr." -- and this list is rendered on the server and again in the
 * browser, which is exactly the hydration mismatch CLAUDE.md records for
 * dates. A list that cannot differ between the two renders is the fix.
 *
 * INR is deliberately absent, per a standing instruction on this project.
 *
 * WHAT CHANGING THIS DOES TODAY: it is the currency the guest booking page
 * prices in. The staff screens still format every amount as GBP --
 * `CURRENCY` in `src/lib/money.ts` is a constant -- so a property moved to
 * MXN here is not yet shown in pesos at the front desk. That is recorded in
 * CLAUDE.md as the next thing to fix before a non-UK hotel goes live.
 */
export const CURRENCIES: { code: string; symbol: string }[] = [
  { code: "AED", symbol: "د.إ" },
  { code: "ARS", symbol: "$" },
  { code: "AUD", symbol: "$" },
  { code: "BDT", symbol: "৳" },
  { code: "BGN", symbol: "лв" },
  { code: "BRL", symbol: "R$" },
  { code: "CAD", symbol: "$" },
  { code: "CHF", symbol: "CHF" },
  { code: "CLP", symbol: "$" },
  { code: "CNY", symbol: "¥" },
  { code: "COP", symbol: "$" },
  { code: "CZK", symbol: "Kč" },
  { code: "DKK", symbol: "kr" },
  { code: "DOP", symbol: "$" },
  { code: "EGP", symbol: "£" },
  { code: "EUR", symbol: "€" },
  { code: "GBP", symbol: "£" },
  { code: "GHS", symbol: "₵" },
  { code: "GTQ", symbol: "Q" },
  { code: "HKD", symbol: "$" },
  { code: "HUF", symbol: "Ft" },
  { code: "IDR", symbol: "Rp" },
  { code: "ILS", symbol: "₪" },
  { code: "ISK", symbol: "kr" },
  { code: "JPY", symbol: "¥" },
  { code: "KES", symbol: "KSh" },
  { code: "KRW", symbol: "₩" },
  { code: "LKR", symbol: "Rs" },
  { code: "MAD", symbol: "د.م." },
  { code: "MXN", symbol: "$" },
  { code: "MYR", symbol: "RM" },
  { code: "NGN", symbol: "₦" },
  { code: "NOK", symbol: "kr" },
  { code: "NPR", symbol: "Rs" },
  { code: "NZD", symbol: "$" },
  { code: "PEN", symbol: "S/" },
  { code: "PHP", symbol: "₱" },
  { code: "PKR", symbol: "Rs" },
  { code: "PLN", symbol: "zł" },
  { code: "QAR", symbol: "ر.ق" },
  { code: "RON", symbol: "lei" },
  { code: "SAR", symbol: "ر.س" },
  { code: "SEK", symbol: "kr" },
  { code: "SGD", symbol: "$" },
  { code: "THB", symbol: "฿" },
  { code: "TRY", symbol: "₺" },
  { code: "TWD", symbol: "$" },
  { code: "UAH", symbol: "₴" },
  { code: "USD", symbol: "$" },
  { code: "UYU", symbol: "$" },
  { code: "VND", symbol: "₫" },
  { code: "ZAR", symbol: "R" },
];

/** The reference's own format for an option: "MXN - MXN - $". */
export function currencyOptionLabel(code: string): string {
  const c = CURRENCIES.find((x) => x.code === code);
  return c ? `${c.code} - ${c.code} - ${c.symbol}` : code;
}
