import { notFound } from "next/navigation";
import { BookingWidget } from "@/components/book/booking-widget";
import {
  getPublicProperty,
  getPublicRatePlans,
} from "@/lib/actions/public-booking";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";

export const metadata = { title: "Book a room" };

/**
 * The public booking page. No session, no staff account, no nav.
 *
 * The property is in the URL because a guest has nothing else to identify it
 * by: current_property_id() reads staff_users, and a stranger has no row
 * there. An inactive property, or one with no published rate plan, is a 404
 * rather than an empty page — there is nothing for a guest to do on either.
 */
export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { propertyId } = await params;
  const { lang } = await searchParams;

  const property = await getPublicProperty(propertyId);
  if (!property) notFound();

  const ratePlans = await getPublicRatePlans(propertyId);
  if (ratePlans.length === 0) notFound();

  return (
    <BookingWidget
      property={property}
      ratePlans={ratePlans}
      locale={isLocale(lang) ? lang : DEFAULT_LOCALE}
    />
  );
}
