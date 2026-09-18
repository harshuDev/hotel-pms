import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "Min stay arrival" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="min_stay_arrival" searchParams={searchParams} />;
}
