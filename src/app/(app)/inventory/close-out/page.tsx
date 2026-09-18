import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "Close out" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="close_out" searchParams={searchParams} />;
}
