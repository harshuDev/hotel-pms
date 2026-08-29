import { format, parseISO } from "date-fns";
import { SideNav } from "@/components/side-nav";
import { TopBar } from "@/components/top-bar";
import { getBusinessDate } from "@/lib/mock/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const today = await getBusinessDate();
  const businessDate = format(parseISO(today), "EEE d MMM yyyy");
  return (
    <div className="min-h-screen">
      <SideNav />
      <div className="lg:ml-[212px]">
        <TopBar propertyName="Grand Ferndale" businessDate={businessDate} />
        <main className="p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}
