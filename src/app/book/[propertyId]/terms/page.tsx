import { BookingEngineDocument } from "@/components/book/booking-engine-document";

export const metadata = { title: "Terms & Conditions" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { propertyId } = await params;
  const { lang } = await searchParams;
  return <BookingEngineDocument propertyId={propertyId} lang={lang} which="terms" />;
}
