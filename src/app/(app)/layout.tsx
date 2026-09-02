import { format, parseISO } from "date-fns";
import { TopNav } from "@/components/top-nav";
import { TopBar } from "@/components/top-bar";
import { getBusinessDate } from "@/lib/mock/queries";

const PROPERTY_NAME = "Grand Ferndale";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const today = await getBusinessDate();
  const businessDate = format(parseISO(today), "EEE d MMM yyyy");
  return (
    <div className="min-h-screen">
      <TopNav propertyName={PROPERTY_NAME} />
      <TopBar propertyName={PROPERTY_NAME} businessDate={businessDate} />
      <main className="p-3 sm:p-5">{children}</main>
    </div>
  );
}
