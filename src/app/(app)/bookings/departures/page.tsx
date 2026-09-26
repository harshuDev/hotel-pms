import { getT } from "@/lib/i18n/server";
import { format, parseISO } from "date-fns";
import { PageHeader } from "@/components/ui";
import { BookingList } from "@/components/bookings/booking-list";
import { getBusinessDate, getDepartures } from "@/lib/queries";

export const metadata = { title: "Departures" };

export default async function DeparturesPage() {
  const tr = await getT();
  const today = await getBusinessDate();
  const rows = await getDepartures(today);

  return (
    <div>
      <PageHeader
        title={tr("Departures")}
      />
      <BookingList
        rows={rows}
        empty={tr("Everyone has left")}
        hint={tr("Bookings due to check out on the business date appear here until they do.")}
      />
    </div>
  );
}
