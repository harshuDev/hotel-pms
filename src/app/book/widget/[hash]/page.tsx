import { notFound } from "next/navigation";
import { EmbedWidget } from "@/components/book/embed-widget";
import {
  getPublicBookingWidget,
  getPublicLanguageSettings,
  getPublicProperty,
} from "@/lib/actions/public-booking";
import { customNames, WIDGET_TEXT_DEFAULTS } from "@/lib/booking-widgets";
import { hotelToday, monthNames, weekdayNames } from "@/lib/i18n/calendar-names";
import { dictionaryFor } from "@/lib/i18n/dictionary";
import { isLocale, type Locale } from "@/lib/i18n/locales";

export const metadata = { title: "Book now" };

/**
 * A Booking Widget (0100), drawn inside the iframe a hotel pastes into its
 * own website. A static segment, so it wins over `/book/[propertyId]`, and
 * public because the whole of `/book/` is.
 *
 * Everything the widget shows is decided here, on the server: the hotel's
 * today in its own zone, and the month and weekday names -- the hotel's own
 * if it wrote twelve and seven, else the language's -- because formatting
 * names in the browser is a hydration mismatch.
 */
export default async function WidgetPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const widget = await getPublicBookingWidget(hash);
  if (!widget) notFound();
  const [property, languages] = await Promise.all([
    getPublicProperty(widget.propertyId),
    getPublicLanguageSettings(widget.propertyId),
  ]);
  if (!property) notFound();

  // The widget's language if the hotel still offers it, else the hotel's default.
  const locale: Locale =
    widget.language && isLocale(widget.language) && languages.supportedLocales.includes(widget.language)
      ? widget.language
      : languages.defaultLocale;
  const t = dictionaryFor(locale);

  return (
    <>
      {/* The app's body is grey; inside a hotel's page the widget should sit
          on the hotel's own background, not on a grey box around it. */}
      <style>{"html,body{background:transparent}"}</style>
      <EmbedWidget
      bookHref={`/book/${widget.propertyId}`}
      locale={locale}
      today={hotelToday(property.timezone)}
      months={customNames(widget.monthNames, 12, monthNames(locale))}
      weekdays={customNames(widget.weekdayNames, 7, weekdayNames(locale))}
      texts={{
        title: widget.titleText ?? WIDGET_TEXT_DEFAULTS.title,
        button: widget.buttonText ?? WIDGET_TEXT_DEFAULTS.button,
        checkIn: widget.checkInText ?? WIDGET_TEXT_DEFAULTS.checkIn,
        checkOut: widget.checkOutText ?? WIDGET_TEXT_DEFAULTS.checkOut,
        nights: widget.nightsText ?? WIDGET_TEXT_DEFAULTS.nights,
        adults: t.adults,
        children: t.children,
      }}
      showOccupancy={widget.showOccupancy}
      useCheckoutDate={widget.useCheckoutDate}
      colors={{
        primary: widget.primaryColor,
        text: widget.textColor,
        background: widget.backgroundColor,
        label: widget.labelColor,
        border: widget.borderColor,
      }}
      />
    </>
  );
}
