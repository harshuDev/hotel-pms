import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "Max stay" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="max_stay" searchParams={searchParams} />;
}
