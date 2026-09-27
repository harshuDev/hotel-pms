// Checks every staff dictionary against the catalog (0106).
//
//   node scripts/i18n-check.mjs
//
// Fails when a language is missing a key, carries a key nothing uses any
// more, drops or invents a placeholder, or gives a plural as a plain string
// (or the reverse). The catalog itself is checked for freshness by
// `node scripts/i18n-extract.mjs --check`; `pnpm i18n:check` runs both.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIR = path.join(ROOT, "src/lib/i18n/staff");
const LOCALES = ["de", "el", "es", "fr", "id", "it", "pt", "ro", "sl-SI", "th", "is"];

const catalog = JSON.parse(fs.readFileSync(path.join(DIR, "catalog.json"), "utf8"));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

let problems = 0;
const report = (locale, msg) => {
  problems++;
  if (problems <= 200) console.error(`${locale}: ${msg}`);
};

for (const locale of LOCALES) {
  const dict = JSON.parse(fs.readFileSync(path.join(DIR, `${locale}.json`), "utf8"));
  for (const [key, meta] of Object.entries(catalog)) {
    const value = dict[key];
    if (value === undefined) {
      report(locale, `missing ${JSON.stringify(key)}`);
      continue;
    }
    const want = placeholders(key);
    if (meta.kind === "plural") {
      if (typeof value !== "object" || value === null || typeof value.other !== "string") {
        report(locale, `plural ${JSON.stringify(key)} needs an object with "other"`);
        continue;
      }
      for (const [form, text] of Object.entries(value)) {
        if (!["zero", "one", "two", "few", "many", "other"].includes(form))
          report(locale, `plural ${JSON.stringify(key)} has an unknown form ${form}`);
        if (typeof text !== "string" || text.trim() === "") {
          report(locale, `plural ${JSON.stringify(key)} form ${form} is empty`);
          continue;
        }
        // "one" may say the number in words ("a night"), so {n} may be left out there.
        const got = placeholders(text);
        const wantHere = form === "other" ? want : want.split(",").filter((p) => p !== "n").join(",");
        const gotHere = form === "other" ? got : got.split(",").filter((p) => p !== "n").join(",");
        if (gotHere !== wantHere)
          report(locale, `plural ${JSON.stringify(key)} form ${form}: placeholders {${got}} but the key has {${want}}`);
      }
      continue;
    }
    if (typeof value !== "string") {
      report(locale, `${JSON.stringify(key)} should be a string`);
      continue;
    }
    if (value.trim() === "") report(locale, `${JSON.stringify(key)} is empty`);
    if (placeholders(value) !== want)
      report(locale, `${JSON.stringify(key)}: placeholders {${placeholders(value)}} but the key has {${want}}`);
  }
  for (const key of Object.keys(dict)) {
    if (!(key in catalog)) report(locale, `stale key ${JSON.stringify(key)} is not in the catalog`);
  }
}

if (problems > 0) {
  console.error(`\n${problems} problem(s) in the staff dictionaries.`);
  process.exit(1);
}
console.log(`${LOCALES.length} staff dictionaries complete: ${Object.keys(catalog).length} keys each.`);
