import { BookingEngineDocument } from "@/components/book/booking-engine-document";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Privacy Policy"));

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { propertyId } = await params;
  const { lang } = await searchParams;
  return <BookingEngineDocument propertyId={propertyId} lang={lang} which="privacy" />;
}
