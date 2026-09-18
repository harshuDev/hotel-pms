/**
 * The guest booking page speaks these; the staff app does not.
 *
 * That split is deliberate. A guest arrives from anywhere and reads a handful
 * of screens, so translating them is worth it and the vocabulary is ordinary
 * — dates, a room, a price, a name. The staff app is thirty-four screens of
 * hotel and accounting terms (blind close, close out, closed to arrival,
 * paid-out, RevPAR) where a wrong word in a cash screen is a real operational
 * risk, and those want a translator rather than a best guess.
 */

export const LOCALES = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "sv", label: "Svenska" },
  { code: "da", label: "Dansk" },
  { code: "no", label: "Norsk" },
  { code: "fi", label: "Suomi" },
  { code: "cs", label: "Čeština" },
  { code: "el", label: "Ελληνικά" },
  { code: "ro", label: "Română" },
  { code: "hu", label: "Magyar" },
  { code: "uk", label: "Українська" },
  { code: "ru", label: "Русский" },
  { code: "tr", label: "Türkçe" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.some((l) => l.code === value);
}

/**
 * The BCP 47 tag to format dates and money with. Same as the locale code for
 * every language here, but kept separate because the two are not the same
 * thing and conflating them is how "no" ends up formatting as Norwegian
 * Nynorsk on some platforms and Bokmål on others.
 */
export function bcp47(locale: Locale): string {
  return locale === "no" ? "nb-NO" : locale;
}
