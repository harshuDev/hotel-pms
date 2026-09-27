import { InventoryPage } from "@/components/inventory/inventory-page";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Max stay"));

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="max_stay" searchParams={searchParams} />;
}
