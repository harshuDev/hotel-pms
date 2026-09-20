import { format, parseISO } from "date-fns";
import { PageHeader } from "@/components/ui";
import { BookingList } from "@/components/bookings/booking-list";
import { getBusinessDate, getDepartures } from "@/lib/queries";

export const metadata = { title: "Departures" };

export default async function DeparturesPage() {
  const today = await getBusinessDate();
  const rows = await getDepartures(today);

  return (
    <div>
      <PageHeader
        title="Departures"
      />
      <BookingList
        rows={rows}
        empty="Everyone has left"
        hint="Bookings due to check out on the business date appear here until they do."
      />
    </div>
  );
}
