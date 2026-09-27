// Builds the staff translation catalog (0106): every key the staff
// application can look up, in one file the dictionaries are checked against.
//
//   node scripts/i18n-extract.mjs            writes src/lib/i18n/staff/catalog.json
//   node scripts/i18n-extract.mjs --check    exits 1 if the catalog is stale
//
// Two sources:
//
//  1. The application. The first argument of tr(), msg(), localised(),
//     failed() and failure(), both text arguments of tr.plural(), and both of
//     localisedAs() -- including literals inside a `?? "fallback"` or a
//     conditional, which is how an action says what to show when Postgres
//     gave no message.
//
//  2. Postgres. A raise message, a format() template and a plain literal in a
//     function body reach the screen as text -- an error through localised(),
//     an activity summary or a folio description through tr.message(). Their
//     `%` and `%s` become {0}, {1}, ... so tr.message() can match the text
//     Postgres actually sent and put the values back in order.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "src/lib/i18n/staff/catalog.json");

/* The guest booking page and the public API have their own language, or none. */
const SKIP_DIRS = ["src/app/book", "src/components/book", "src/app/api", "src/lib/i18n"];
const SKIP_FILES = new Set(["src/lib/database.types.ts", "src/lib/actions/public-booking.ts"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.includes(rel)) walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !SKIP_FILES.has(rel)) out.push(p);
  }
  return out;
}

const keys = new Map(); // key -> { kind, one?, from: Set }
function add(key, kind, from, one) {
  if (typeof key !== "string" || !/[\p{L}]/u.test(key)) return;
  const prev = keys.get(key);
  if (prev) {
    prev.from.add(from);
    if (kind === "plural") Object.assign(prev, { kind, one });
    return;
  }
  keys.set(key, { kind, one, from: new Set([from]) });
}

/* ---------------------------------------------------------------- app */

const SIMPLE = new Set(["tr", "msg", "localised", "failed", "failure", "pageTitle"]);

/** Literals an expression can evaluate to: `"a"`, `x ?? "a"`, `c ? "a" : "b"`. */
function literalsOf(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return literalsOf(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalsOf(node.whenTrue), ...literalsOf(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken)
      return [...literalsOf(node.left), ...literalsOf(node.right)];
  }
  return [];
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression))
    return `${expr.expression.text}.${expr.name.text}`;
  return null;
}

const dynamicCalls = [];

for (const file of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      const [a, b, c] = n.arguments;
      if (name && SIMPLE.has(name)) {
        const lits = literalsOf(a);
        lits.forEach((k) => add(k, "text", rel));
        if (name === "tr" && a && lits.length === 0) dynamicCalls.push(rel);
      } else if (name === "tr.plural") {
        const ones = literalsOf(b);
        const others = literalsOf(c);
        others.forEach((k, i) => add(k, "plural", rel, ones[i] ?? ones[0]));
      } else if (name === "localisedAs") {
        literalsOf(a).forEach((k) => add(k, "text", rel));
        literalsOf(b).forEach((k) => add(k, "text", rel));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

/* ---------------------------------------------------------------- Postgres */

/** Function bodies from every migration; the latest definition of a name wins. */
const bodies = new Map();
const migrations = fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
for (const f of migrations) {
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8");
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\bas\s+\$(\w*)\$([\s\S]*?)\$\3\$/gi;
  let m;
  while ((m = re.exec(sql))) bodies.set(`${m[1]}(${m[2].replace(/\s+/g, " ").slice(0, 200)})`, { name: m[1], body: m[4], file: f });
  // Trigger-less DO blocks and plain statements carry no staff text.
}

/** Drops -- and block comments, leaving string literals intact. */
function stripComments(sql) {
  let out = "";
  for (let i = 0; i < sql.length; ) {
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (sql.startsWith("--", i)) {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else out += sql[i++];
  }
  return out;
}

/** `%` (raise) and `%s` (format) become {0}, {1}...; `%%` is a literal percent. */
function toPattern(text, style) {
  let n = 0;
  const re = style === "format" ? /%%|%[sIL]/g : /%%|%/g;
  return text.replace(re, (m) => (m === "%%" ? "%" : `{${n++}}`));
}

// Machine codes queries.ts and the API routes match on, never shown as text.
const CODE = /^[A-Z][A-Z0-9_]+(:.*)?$/;
// Single words from Postgres that are labels rather than data.
const SINGLE_WORDS = new Set(["Attachment", "Guest", "Unknown"]);
// A literal that reads as a phrase: a capital, then lower case words -- or a
// message that opens on a value ("% is the main rate. ..."), which is how most
// refusals naming a plan, a room type or a tax begin. Those were skipped until
// 0109 and so reached every language in English.
const PHRASE = /^(?:[A-Z]|%s? \S)[^\n]*[a-z]{2}/;

for (const { name, body } of bodies.values()) {
  if (name.startsWith("public_") || name.startsWith("api_")) continue; // guest page and API: not staff text
  const sql = stripComments(body);
  const lit = /'((?:[^']|'')*)'/g;
  let m;
  while ((m = lit.exec(sql))) {
    const text = m[1].replace(/''/g, "'");
    const before = sql.slice(Math.max(0, m.index - 40), m.index);
    const isRaise = /raise\s+(exception|notice|warning)\s*$/i.test(before);
    const isFormat = /format\(\s*$/i.test(before);
    if (CODE.test(text)) continue;
    if (!PHRASE.test(text) || text.length > 400) continue;
    if (text !== text.trim()) continue; // a fragment of a concatenation
    if (!/\s/.test(text) && !SINGLE_WORDS.has(text)) continue; // a name or a seeded value
    if (/^(DD|FM|YYYY|HH)/.test(text)) continue; // to_char patterns
    const key = isRaise ? toPattern(text, "raise") : isFormat ? toPattern(text, "format") : text;
    add(key, "db", `db:${name}`);
  }
}

/*
 * Text Postgres makes in ways a literal scan cannot see: a label from a view,
 * a description built by concatenation, and the enum values that
 * tr.message() finds inside a message ("Room 101 status changed from
 * vacant_clean to occupied") and looks up on their own.
 */
const EXTRA_DB = [
  "Mixed",
  "Reversal: {0}",
  "vacant_clean", "vacant_dirty", "occupied", "ooo",
  "pending", "confirmed", "checked_in", "checked_out", "canceled", "no_show",
  "waiting", "offered", "converted", "expired",
  "breakfast", "lunch", "dinner",
];
EXTRA_DB.forEach((k) => add(k, "db", "db:extra"));

/*
 * Country names are looked up by their English name (countriesIn(),
 * `tr(countryName(code))`). The catalog carries the code with each, so the
 * dictionaries can be filled from the platform's own country names.
 */
const countriesSrc = fs.readFileSync(path.join(ROOT, "src/lib/countries.ts"), "utf8");
for (const m of countriesSrc.matchAll(/\{ code: "([A-Z]{2})", name: "([^"]+)" \}/g)) {
  const prev = keys.get(m[2]);
  if (prev) prev.from.add("countries");
  keys.set(m[2], { kind: "country", code: m[1], from: prev?.from ?? new Set(["countries"]) });
}

/* ---------------------------------------------------------------- write */

const catalog = {};
for (const k of [...keys.keys()].sort((a, b) => a.localeCompare(b, "en"))) {
  const v = keys.get(k);
  catalog[k] =
    v.kind === "plural" ? { kind: "plural", one: v.one } : v.kind === "country" ? { kind: "country", code: v.code } : { kind: v.kind };
}
const json = `${JSON.stringify(catalog, null, 1)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== json) {
    console.error("src/lib/i18n/staff/catalog.json is out of date: run node scripts/i18n-extract.mjs");
    process.exit(1);
  }
  console.log(`catalog up to date: ${Object.keys(catalog).length} keys`);
} else {
  fs.writeFileSync(OUT, json);
  const by = (kind) => Object.values(catalog).filter((v) => v.kind === kind).length;
  console.log(`${Object.keys(catalog).length} keys: ${by("text")} text, ${by("plural")} plural, ${by("db")} from Postgres`);
  if (process.argv.includes("--verbose"))
    console.log(`tr() with a non-literal argument in: ${[...new Set(dynamicCalls)].join(", ")}`);
}
