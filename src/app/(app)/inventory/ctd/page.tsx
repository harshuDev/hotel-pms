import { InventoryPage } from "@/components/inventory/inventory-page";

export const metadata = { title: "The Grand Hotel — Closed to departure" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  return <InventoryPage fieldName="closed_to_departure" searchParams={searchParams} />;
}
