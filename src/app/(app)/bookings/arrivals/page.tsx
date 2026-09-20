import { format, parseISO } from "date-fns";
import { PageHeader } from "@/components/ui";
import { BookingList } from "@/components/bookings/booking-list";
import { getArrivals, getBusinessDate } from "@/lib/queries";

export const metadata = { title: "Arrivals" };

export default async function ArrivalsPage() {
  const today = await getBusinessDate();
  const rows = await getArrivals(today);

  return (
    <div>
      <PageHeader
        title="Arrivals"
      />
      <BookingList
        rows={rows}
        empty="Nobody is arriving today"
        hint="Bookings due to check in on the business date appear here. Cancellations and no-shows do not."
      />
    </div>
  );
}
