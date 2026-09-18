import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "Min stay through" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="min_stay_through" searchParams={searchParams} />;
}
