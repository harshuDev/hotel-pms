import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "Rates (All)" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return (
    <InventoryPage
      fieldName="rate"
      searchParams={searchParams}
      title="Rates (All)"
      subtitle="The price of one room, per night, on any rate plan"
    />
  );
}
