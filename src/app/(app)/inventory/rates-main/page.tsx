import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "Rates (Main)" };

/**
 * The same rate grid as Rates (All), pinned to the property's default plan.
 *
 * Two entries for one field looks like duplication and is not: changing the
 * main rate is most of what anybody does on this screen, and making them pick
 * the plan first every time is a click that is always the same click. Rates
 * (All) is there for the rest.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return (
    <InventoryPage
      fieldName="rate"
      searchParams={searchParams}
      lockedToDefaultPlan
      title="Rates (Main)"
    />
  );
}
