import { notFound } from "next/navigation";
import { BookingDetailView } from "@/components/bookings/booking-detail";
import { getCustomerForEdit } from "@/lib/actions/customers";
import {
  getBookingActivity,
  getBookingDetail,
  getBookingFolioLines,
  getBookingNights,
  getBookingRoomLines,
  getChannels,
  getCurrentStaffUser,
  getProperty,
  getBookingCancellationTerms,
} from "@/lib/queries";

export const metadata = { title: "Booking" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where "back" goes, from `?back=`.
 *
 * The calendar sends the board's own URL so a receptionist who opened a
 * booking from it returns to the same dates and rail width rather than to a
 * board reset to today.
 *
 * ONLY A PATH ON THIS SITE IS ACCEPTED. The value arrives in a URL and ends up
 * in an href, so anything not starting with a single "/" is dropped — a
 * protocol-relative "//evil.example" is a link off this site wearing a path's
 * clothes.
 */
function backTarget(back: string | undefined) {
  if (back && back.startsWith("/") && !back.startsWith("//")) {
    return { href: back, label: back.startsWith("/calendar") ? "Calendar" : "Back" };
  }
  return { href: "/bookings", label: "All bookings" };
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // A malformed id would reach Postgres as a cast error rather than a miss.
  if (!UUID.test(id)) notFound();

  const detail = await getBookingDetail(id);
  if (!detail) notFound();

  const [rooms, nights, folio, activity, channels, staff, guest, property, cancellationTerms] =
    await Promise.all([
      getBookingRoomLines(id),
      getBookingNights(id),
      getBookingFolioLines(id),
      getBookingActivity(id),
      getChannels(),
      getCurrentStaffUser(),
      // The existing guest read, reused rather than a second one written. It
      // returns a Result, so a refusal leaves the tab saying so instead of
      // taking the whole page down with it.
      getCustomerForEdit(detail.customerId),
      // Free: getProperty() is cache()d and the app layout has already called
      // it in this same request. It carries the timezone the History tab's
      // posting times are rendered on.
      getProperty(),
      // What this booking may be cancelled under. It reports; it never blocks
      // the Cancel button, because a hotel has to be able to cancel its own
      // booking whatever the guest was sold.
      getBookingCancellationTerms(id),
    ]);

  const back = backTarget(sp.back);

  return (
    <BookingDetailView
      detail={detail}
      rooms={rooms}
      nights={nights}
      folio={folio}
      activity={activity}
      channels={channels}
      guest={guest.ok ? guest.data : null}
      cancellationTerms={cancellationTerms}
      timezone={property.timezone}
      backHref={back.href}
      backLabel={back.label}
      canEdit={
        staff !== null &&
        ["admin", "manager", "front_desk"].includes(staff.role)
      }
    />
  );
}
