import { format, parseISO } from "date-fns";
import { TopNav } from "@/components/top-nav";
import { TopBar } from "@/components/top-bar";
import {
  getBusinessDate,
  getProperty,
} from "@/lib/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [property, today] = await Promise.all([
    getProperty(),
    getBusinessDate(),
  ]);

  const businessDate = format(parseISO(today), "EEE d MMM yyyy");

  return (
    <div className="min-h-screen">
      <TopNav propertyName={property.name} />
      <TopBar
        propertyName={property.name}
        businessDate={businessDate}
      />
      <main className="p-3 sm:p-5">{children}</main>
    </div>
  );
}
