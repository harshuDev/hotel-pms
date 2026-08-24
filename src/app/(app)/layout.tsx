import { format, parseISO } from "date-fns";
import { SideNav } from "@/components/side-nav";
import { getBusinessDate } from "@/lib/mock/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const today = await getBusinessDate();

  return (
    <div className="min-h-screen">
      <SideNav businessDate={format(parseISO(today), "EEE d MMM yyyy")} />
      <main className="p-3 sm:p-5 lg:ml-[212px]">{children}</main>
    </div>
  );
}
