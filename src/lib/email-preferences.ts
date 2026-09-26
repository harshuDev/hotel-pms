/**
 * Settings -> Communications & Notifications -> Hotel Emails Preferences
 * (0074), in the client's reference's order and wording.
 *
 * The ids are the keys `save_hotel_email_settings()` accepts. A kind with no
 * stored value reads as active, as the reference ships every one ticked.
 *
 * STORED, NOT YET LIVE: there is no mail provider in this system, and every
 * kind but Pre-Arrival is a channel-manager event that cannot occur while OTA
 * bookings are entered by hand. See CLAUDE.md.
 */
export const EMAIL_PREFERENCES = [
  {
    id: "channel_booking_confirmation",
    name: "Channel - Booking Confirmation",
    description: "Send email when system receives booking via channel",
  },
  {
    id: "channel_booking_modification",
    name: "Channel - Booking Modification",
    description: "Send email when system receives booking modification via channel",
  },
  {
    id: "pre_arrival",
    name: "Pre-Arrival Email",
    description:
      "Send email each day; include pdf with guest registration forms and folios for arriving guests",
  },
  {
    id: "channel_booking_cancellation",
    name: "Channel - Booking Cancellation",
    description: "Send email when system receives a booking cancellation via channel",
  },
  {
    id: "channel_missing_booking_cancellation",
    name: "Channel - Missing Booking Cancellation",
    description:
      "Send email when system receives a booking cancellation via channel, but corresponding booking doesn't exist in system",
  },
  {
    id: "channel_missing_booking_modification",
    name: "Channel - Missing Booking Modification",
    description:
      "Send email when system receives booking modification via channel, but corresponding booking doesn't exist in system",
  },
  {
    id: "channel_overbooking",
    name: "Channel - Overbooking Notification",
    description:
      "Send email when system receives booking that cannot be allocated. Possible reasons: 1. Overbooking. 2. There is space in calendar, but it split over several rooms of that type, needs manual intervention.",
  },
  {
    id: "channel_rate_mapping_error",
    name: "Channel - Rate Mapping Error",
    description:
      "Send email when system receives booking with room rate / room type combination that is not configured for sync or improperly configured",
  },
] as const;

export type EmailPreferenceId = (typeof EMAIL_PREFERENCES)[number]["id"];

export interface HotelEmailSettings {
  notificationEmails: string[];
  /** Every kind, resolved: a kind never saved is true. */
  preferences: Record<EmailPreferenceId, boolean>;
}

/* -- Email Setup (0075) ---------------------------------------------------- */

/** The seven confirmation-email colours, in the reference's order and wording. */
export const CONFIRMATION_COLORS = [
  { id: "header_info_text", label: "Confirmation Header Info Text Color", fallback: "#003580" },
  { id: "title_text", label: "Title Text Color", fallback: "#2d90d1" },
  { id: "reservation_details_background", label: "Reservation Details Background Color", fallback: "#71bb6e" },
  { id: "reservation_details_text", label: "Reservation Details Text Color", fallback: "#ffffff" },
  { id: "room_details_background", label: "Room Details Background Color", fallback: "#eafbe9" },
  { id: "room_details_text", label: "Room Details Text Color", fallback: "#000000" },
  { id: "room_price_nights_text", label: "Room Price And Nights Text Color", fallback: "#57a571" },
] as const;

export type ConfirmationColorId = (typeof CONFIRMATION_COLORS)[number]["id"];

export interface EmailSetup {
  replyToEmails: string[];
  fromText: string | null;
  /** The same list as Hotel Emails Preferences -- one column, two pages. */
  notificationEmails: string[];
  footerTemplate: string | null;
  checkinNotes: string | null;
  directions: string | null;
  singlePropertyAddress: "hotel" | "property";
  multiPropertyAddress: "hotel_hide_properties" | "show_properties";
  confirmationMessage: string | null;
  colors: Record<ConfirmationColorId, string>;
  showHotelLogo: boolean;
  includeFooter: boolean;
  preArrivalEnabled: boolean;
  postDepartureEnabled: boolean;
  postDepartureSubject: string | null;
  postDepartureBody: string | null;
  paymentRequestSubject: string | null;
  paymentRequestBody: string | null;
}

export interface EmailTemplate {
  id: string;
  title: string;
  subject: string | null;
  body: string | null;
}
