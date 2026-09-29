import { getT, pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";
import { RatesPage } from "@/components/inventory/rates-page";

export const generateMetadata = pageTitle(msg("Rates (Main)"));

/**
 * The same per-night rate grid as Rates (All), pinned to the property's main
 * plan. Two entries for one field is not duplication: changing the main rate
 * is most of what anybody does here, and picking the plan first every time
 * is a click that is always the same click. `?plan=` is ignored, so a link
 * carrying one cannot turn the pinned screen into the unpinned one.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const tr = await getT();
  const sp = await searchParams;
  return <RatesPage title={tr("Rates (Main)")} basePath="/inventory/rates-main" mainOnly from={sp.from} />;
}
