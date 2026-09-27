// Fills the country names in every staff dictionary from the platform's own
// data (Intl.DisplayNames, full ICU in Node), keyed by the English name the
// application looks them up by. Run after adding a country to countries.ts.
//
//   node scripts/i18n-countries.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIR = path.join(ROOT, "src/lib/i18n/staff");
const LOCALES = ["de", "el", "es", "fr", "id", "it", "pt", "ro", "sl-SI", "th", "is"];

const catalog = JSON.parse(fs.readFileSync(path.join(DIR, "catalog.json"), "utf8"));
const countries = Object.entries(catalog).filter(([, v]) => v.kind === "country");

for (const locale of LOCALES) {
  const file = path.join(DIR, `${locale}.json`);
  const dict = JSON.parse(fs.readFileSync(file, "utf8"));
  const names = new Intl.DisplayNames([locale === "sl-SI" ? "sl" : locale], { type: "region", fallback: "none" });
  for (const [english, { code }] of countries) dict[english] = names.of(code) ?? english;
  const sorted = Object.fromEntries(Object.keys(dict).sort((a, b) => a.localeCompare(b, "en")).map((k) => [k, dict[k]]));
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 1)}\n`);
}
console.log(`${countries.length} country names written in ${LOCALES.length} languages.`);
