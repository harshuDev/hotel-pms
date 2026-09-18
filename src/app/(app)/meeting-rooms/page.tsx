import { isValid, parseISO } from "date-fns";
import { PageHeader } from "@/components/ui";
import { MeetingRoomsScreen } from "@/components/meeting-rooms/meeting-rooms-screen";
import {
  MEETING_ROOM_DAYS,
  getBusinessDate,
  getCurrentStaffUser,
  getMeetingRoomBooking,
  getMeetingRoomCalendar,
} from "@/lib/queries";

export const metadata = { title: "Meeting rooms" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MeetingRoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; booking?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();

  const from =
    sp.from && ISO_DATE.test(sp.from) && isValid(parseISO(sp.from))
      ? sp.from
      : businessDate;

  const [cells, staff, booking] = await Promise.all([
    getMeetingRoomCalendar(from, MEETING_ROOM_DAYS),
    getCurrentStaffUser(),
    // A malformed id would reach Postgres as a cast error rather than a miss.
    sp.booking && UUID.test(sp.booking)
      ? getMeetingRoomBooking(sp.booking)
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        title="Meeting rooms"
        subtitle="What is free, and what is booked into it"
      />
      <MeetingRoomsScreen
        cells={cells}
        from={from}
        days={MEETING_ROOM_DAYS}
        booking={booking}
        canBook={
          staff !== null &&
          ["admin", "manager", "front_desk"].includes(staff.role)
        }
        canConfigure={staff !== null && ["admin", "manager"].includes(staff.role)}
      />
    </div>
  );
}
