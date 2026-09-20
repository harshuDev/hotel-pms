import { PageHeader } from "@/components/ui";
import { BookingList } from "@/components/bookings/booking-list";
import { getBookings } from "@/lib/queries";

export const metadata = { title: "In house" };

export default async function InHousePage() {
  // Everyone currently checked in, however long ago they arrived.
  const { rows, total } = await getBookings({
    status: "checked_in",
    perPage: 200,
  });

  return (
    <div>
      <PageHeader
        title="In house"
      />
      <BookingList
        rows={rows}
        empty="Nobody is in house"
        hint="A booking appears here once a guest checks in, and leaves when they check out."
      />
    </div>
  );
}
