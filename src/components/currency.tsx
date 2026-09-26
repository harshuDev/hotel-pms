"use client";

import { createContext, useContext } from "react";

/*
 * The property's currency for client components, which cannot await
 * getProperty() the way a Server Component does. The app layout provides it
 * once from the property row; a component that formats money reads it with
 * useCurrency() and hands it to money.ts.
 *
 * No default value: a component rendered outside the provider would otherwise
 * quietly print one currency for every hotel, which is the bug this replaced.
 */
const CurrencyContext = createContext<string | null>(null);

export function CurrencyProvider({
  currency,
  children,
}: {
  currency: string;
  children: React.ReactNode;
}) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): string {
  const currency = useContext(CurrencyContext);
  if (currency === null) {
    throw new Error("useCurrency() needs a <CurrencyProvider> above it");
  }
  return currency;
}
