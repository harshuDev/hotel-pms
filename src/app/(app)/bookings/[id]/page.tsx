import { notFound } from "next/navigation";
import Link from "next/link";
import { BookingDetailView } from "@/components/bookings/booking-detail";
import {
  getBookingActivity,
  getBookingDetail,
  getBookingFolioLines,
  getBookingNights,
  getBookingRoomLines,
  getChannels,
  getCurrentStaffUser,
} from "@/lib/queries";

export const metadata = { title: "The Grand Hotel — Booking" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // A malformed id would reach Postgres as a cast error rather than a miss.
  if (!UUID.test(id)) notFound();

  const detail = await getBookingDetail(id);
  if (!detail) notFound();

  const [rooms, nights, folio, activity, channels, staff] = await Promise.all([
    getBookingRoomLines(id),
    getBookingNights(id),
    getBookingFolioLines(id),
    getBookingActivity(id),
    getChannels(),
    getCurrentStaffUser(),
  ]);

  return (
    <div>
      <Link
        href="/bookings"
        className="mb-3 inline-block text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        ← All bookings
      </Link>
      <BookingDetailView
        detail={detail}
        rooms={rooms}
        nights={nights}
        folio={folio}
        activity={activity}
        channels={channels}
        canEdit={
          staff !== null &&
          ["admin", "manager", "front_desk"].includes(staff.role)
        }
      />
    </div>
  );
}
