import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from "@/lib/i18n/locales";

/**
 * Settings -> System Settings -> Language Settings (0078): which of the guest
 * booking page's languages the hotel offers, and which one a guest lands on.
 *
 * No row reads as English by default and every language supported, which is
 * what the page did before the setting existed.
 */
export interface LanguageSettings {
  defaultLocale: Locale;
  supportedLocales: Locale[];
}

export const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = {
  defaultLocale: DEFAULT_LOCALE,
  supportedLocales: LOCALES.map((l) => l.code),
};

/** Stored values over the defaults, dropping anything this build does not speak. */
export function resolveLanguageSettings(
  row: { default_locale: string; supported_locales: string[] } | null | undefined,
): LanguageSettings {
  if (!row) return DEFAULT_LANGUAGE_SETTINGS;
  const supported = LOCALES.map((l) => l.code).filter((c) =>
    row.supported_locales.includes(c),
  );
  const defaultLocale = isLocale(row.default_locale) ? row.default_locale : DEFAULT_LOCALE;
  return {
    defaultLocale,
    supportedLocales: supported.length > 0 ? supported : [defaultLocale],
  };
}
