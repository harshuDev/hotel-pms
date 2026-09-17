import { addDays, format, parseISO } from "date-fns";
import { PageHeader } from "@/components/ui";
import { NewBookingForm } from "@/components/bookings/new-booking-form";
import {
  getBookableRoomTypes,
  getBusinessDate,
  getChannels,
  getCurrentStaffUser,
  getTaxRates,
} from "@/lib/queries";

export const metadata = { title: "The Grand Hotel — New booking" };

export default async function NewBookingPage() {
  const staff = await getCurrentStaffUser();

  // Postgres refuses this too — create_booking() checks the role itself. This
  // is so a housekeeper is told why rather than filling a form that will fail.
  if (staff && !["admin", "manager", "front_desk"].includes(staff.role)) {
    return (
      <div>
        <PageHeader title="New booking" subtitle="Take a booking" />
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
  const tomorrow = format(addDays(parseISO(businessDate), 1), "yyyy-MM-dd");

  const [channels, taxRates, types] = await Promise.all([
    getChannels(),
    getTaxRates(),
    getBookableRoomTypes(businessDate, tomorrow),
  ]);

  return (
    <div>
      <PageHeader
        title="New booking"
        subtitle="Dates, rooms and a guest. The rate is per room per night, before tax."
      />
      <NewBookingForm
        businessDate={businessDate}
        channels={channels}
        taxRates={taxRates}
        initialTypes={types}
      />
    </div>
  );
}
