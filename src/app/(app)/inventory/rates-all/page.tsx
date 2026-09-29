import { getT, pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";
import { RatesPage } from "@/components/inventory/rates-page";

export const generateMetadata = pageTitle(msg("Rates (All)"));

/**
 * Every rate plan, under every room type, priced per night -- each night's
 * price typed into its own cell (0110). "You will see the room and then below
 * the room all the rates and then you will be able to change the price on
 * those rates."
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const tr = await getT();
  const sp = await searchParams;
  return <RatesPage title={tr("Rates (All)")} basePath="/inventory/rates-all" mainOnly={false} from={sp.from} />;
}
