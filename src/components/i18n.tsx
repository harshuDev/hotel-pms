"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { makeTranslator, type Dictionary, type Translator } from "@/lib/i18n/translate";
import type { StaffLocale } from "@/lib/i18n/staff-locales";

/*
 * The staff translator for client components (0106), from the dictionary the
 * server loaded for this person. Same `makeTranslator()` on both sides, so a
 * client component's server render and its browser render print the same
 * words. No default and a throw outside the provider -- as `useCurrency()` --
 * rather than quietly printing English to somebody who chose Greek.
 */

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: StaffLocale;
  dictionary: Dictionary;
  children: React.ReactNode;
}) {
  const t = useMemo(() => makeTranslator(locale, dictionary), [locale, dictionary]);
  // The root layout cannot know the staff language without a query on every
  // route, the guest pages included; screen readers pronounce by this.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): Translator {
  const t = useContext(I18nContext);
  if (!t) throw new Error("useT() is used outside <I18nProvider>");
  return t;
}
