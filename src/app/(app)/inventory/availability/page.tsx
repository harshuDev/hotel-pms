import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "Availability" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="allotment" searchParams={searchParams} />;
}
