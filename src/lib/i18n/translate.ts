import { format, formatDistanceToNowStrict, parseISO, type Day } from "date-fns";
import { formatStampInProperty } from "@/lib/dates";
import { DATE_LOCALES, type StaffLocale } from "@/lib/i18n/staff-locales";

/*
 * THE STAFF APPLICATION'S TRANSLATOR (0106). Pure, so the server and the
 * browser build the same one from the same dictionary and cannot disagree.
 *
 *   - THE KEY IS THE ENGLISH TEXT. `t("Close shift")` reads as English in the
 *     code, prints English in English, and a string nobody translated falls
 *     back to its English rather than to a blank or a key name. Changing the
 *     English wording is changing the key, and `pnpm i18n:check` says which
 *     dictionaries then lack it.
 *   - `{name}` is a placeholder: `t("{n} rooms", { n })`.
 *   - Plurals follow the LANGUAGE's rules, not English's two: a dictionary
 *     entry may be `{ one, two, few, other }` and `Intl.PluralRules` picks.
 *     Slovenian has a dual; Thai and Indonesian do not inflect at all.
 *   - `message()` is for text that arrives already written -- the database's
 *     refusals, the activity log's sentences, a report's "No name recorded".
 *     Exact first; failing that, a key with numbered placeholders ("{0} is
 *     already added") is matched as a pattern and the captured values are put
 *     back into the translation. Anything unknown is returned as it came,
 *     which is also what makes it safe to pass a guest's name through it.
 *
 * Never a module-level setting: the server renders for many staff at once,
 * each in their own language -- the same reason the currency is an argument.
 * Server Components get theirs from `getT()`, client components from `useT()`.
 */

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Dictionary = Record<string, string | PluralForms>;
export type Vars = Record<string, string | number>;

export interface Translator {
  (key: string, vars?: Vars): string;
  readonly locale: StaffLocale;
  /** `t.plural(n, "{n} night", "{n} nights")`; `n` is passed to the text. */
  plural(count: number, one: string, other: string, vars?: Vars): string;
  /** Text written elsewhere -- a database refusal -- translated if it is known. */
  message(text: string): string;
  /** A date, with this language's month and weekday names (date-fns patterns). */
  date(value: Date | string, pattern: string): string;
  /** A timestamptz on the property's clock, "20 Sep, 14:32". */
  stamp(iso: string, timezone: string): string;
  /** How long ago, "5 minutes ago" -- the whole phrase, since word order varies. */
  since(iso: string): string;
  /** A weekday's name, 0 = Sunday, short or a single letter, from the same locale data as dates. */
  weekday(day: number, width?: "abbreviated" | "narrow"): string;
}

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

function asText(entry: string | PluralForms | undefined): string | undefined {
  return entry === undefined ? undefined : typeof entry === "string" ? entry : entry.other;
}

type Pattern = { re: RegExp; key: string; order: number[] };
const patternCache = new WeakMap<Dictionary, Pattern[]>();

function patternsOf(dict: Dictionary): Pattern[] {
  const cached = patternCache.get(dict);
  if (cached) return cached;
  const list: Pattern[] = [];
  for (const key of Object.keys(dict)) {
    if (!/\{\d+\}/.test(key)) continue;
    const order: number[] = [];
    const source = key
      .split(/(\{\d+\})/)
      .map((part) => {
        const m = /^\{(\d+)\}$/.exec(part);
        if (m) {
          order.push(Number(m[1]));
          return "(.*?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    // A pattern with next to no fixed text ("{0} - {1}") would match almost
    // anything, so it is left to exact lookup.
    if (key.replace(/\{\d+\}/g, "").replace(/[^\p{L}]/gu, "").length < 4) continue;
    list.push({ re: new RegExp(`^${source}$`, "s"), key, order });
  }
  // The most specific first: more fixed text is a stricter match.
  const fixed = (k: string) => k.replace(/\{\d+\}/g, "").length;
  list.sort((a, b) => fixed(b.key) - fixed(a.key));
  patternCache.set(dict, list);
  return list;
}

export function makeTranslator(locale: StaffLocale, dict: Dictionary): Translator {
  const pluralRules = new Intl.PluralRules(locale === "sl-SI" ? "sl" : locale);
  const dateLocale = DATE_LOCALES[locale];

  const t = ((key: string, vars?: Vars) => interpolate(asText(dict[key]) ?? key, vars)) as Translator;

  Object.defineProperty(t, "locale", { value: locale });

  t.plural = (count, one, other, vars) => {
    const all = { n: count, ...vars };
    const entry = dict[other];
    if (entry === undefined) return interpolate(count === 1 ? one : other, all);
    if (typeof entry === "string") return interpolate(entry, all);
    return interpolate(entry[pluralRules.select(count)] ?? entry.other, all);
  };

  t.message = (text) => {
    const exact = asText(dict[text]);
    if (exact !== undefined) return exact;
    for (const p of patternsOf(dict)) {
      const m = p.re.exec(text);
      if (!m) continue;
      // A captured value is itself looked up, exactly and once: the room
      // status in "Room 101 status changed from vacant_clean to occupied"
      // translates, while a reference or a guest's name matches no key and
      // is put back as it was.
      const values: Record<number, string> = {};
      p.order.forEach((index, i) => {
        values[index] = asText(dict[m[i + 1]]) ?? m[i + 1];
      });
      const translated = asText(dict[p.key]) ?? p.key;
      return translated.replace(/\{(\d+)\}/g, (whole, i: string) => values[Number(i)] ?? whole);
    }
    return text;
  };

  t.date = (value, pattern) =>
    format(typeof value === "string" ? parseISO(value) : value, pattern, { locale: dateLocale });

  t.stamp = (iso, timezone) => formatStampInProperty(iso, timezone, locale);

  t.weekday = (day, width = "abbreviated") =>
    dateLocale.localize.day((((day % 7) + 7) % 7) as Day, { width });

  t.since = (iso) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true, locale: dateLocale });

  return t;
}

/** Marks a string for translation where it is written, and returns it unchanged. */
export function msg<T extends string>(text: T): T {
  return text;
}
