import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "The Grand Hotel — Stop sell" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="stop_sell" searchParams={searchParams} />;
}
