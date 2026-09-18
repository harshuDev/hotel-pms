import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "Rates" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="rate" searchParams={searchParams} />;
}
