import { addDays, format, parseISO } from "date-fns";
import { PageHeader } from "@/components/ui";
import { NewBookingForm } from "@/components/bookings/new-booking-form";
import {
  getBookableRoomTypes,
  getBusinessDate,
  getChannels,
  getCurrentStaffUser,
  getRatePlans,
  getTaxRates,
} from "@/lib/queries";

export const metadata = { title: "New booking" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ check_in?: string; room_type?: string; group?: string }>;
}) {
  const sp = await searchParams;
  const staff = await getCurrentStaffUser();

  // Postgres refuses this too — create_booking() checks the role itself. This
  // is so a housekeeper is told why rather than filling a form that will fail.
  if (staff && !["admin", "manager", "front_desk"].includes(staff.role)) {
    return (
      <div>
        <PageHeader title="New booking" />
        <div className="rounded-lg border border-line bg-white p-8 text-center shadow-card">
          <p className="font-display text-lg font-semibold tracking-tightest text-ink">
            Taking bookings is not available to your role
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
            Front desk, manager and admin accounts can take a booking. Ask a
            manager if you need access.
          </p>
        </div>
      </div>
    );
  }

  const businessDate = await getBusinessDate();

  // The calendar links here with the cell that was clicked. An arrival before
  // the business date is refused rather than quietly corrected: it is a date
  // somebody typed into the URL, and silently moving it would take a booking
  // for a night other than the one they asked for.
  const wanted = sp.check_in;
  const initialCheckIn =
    wanted && ISO_DATE.test(wanted) && wanted >= businessDate ? wanted : undefined;
  const arrival = initialCheckIn ?? businessDate;
  const nextDay = format(addDays(parseISO(arrival), 1), "yyyy-MM-dd");

  const [channels, taxRates, ratePlans, types] = await Promise.all([
    getChannels(),
    getTaxRates(),
    getRatePlans(),
    // For the clicked night, so the room type it preselects is one that is
    // actually bookable then.
    getBookableRoomTypes(arrival, nextDay),
  ]);

  /*
   * "Add Group Booking" is the same transaction, not a second kind of booking.
   *
   * The client's reference system offers Simple and Group as two menu items, so
   * ours does too — but a group here is one `bookings` row with several
   * `booking_rooms` on it, which `create_booking()` has always taken. There is
   * no group flag in the schema and inventing one would be a second booking
   * model to keep in step with the first. What changes is the wording, so
   * somebody who picked Group is told where the rooms go.
   */
  const group = sp.group === "1";

  return (
    <div>
      <PageHeader
        title={group ? "New group booking" : "New booking"}
      />
      <NewBookingForm
        businessDate={businessDate}
        channels={channels}
        taxRates={taxRates}
        ratePlans={ratePlans}
        initialTypes={types}
        initialCheckIn={initialCheckIn}
        initialRoomTypeId={sp.room_type?.trim() || undefined}
      />
    </div>
  );
}
