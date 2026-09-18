import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "Closed to arrival" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="closed_to_arrival" searchParams={searchParams} />;
}
