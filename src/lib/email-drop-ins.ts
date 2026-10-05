import { msg } from "@/lib/i18n/translate";

/*
 * DROP IN'S (0131): the placeholders the Email tab's editor inserts at the
 * cursor, as the reference's button does, filled from the booking when the
 * message is sent. Pure, so the editor and the server read one list.
 *
 * Filled on the server only, after the message is sanitised, and every value
 * is HTML-escaped there -- a guest's name comes from the public booking page.
 */

export const DROP_INS = [
  { key: "guest_name", label: msg("Guest name") },
  { key: "guest_first_name", label: msg("Guest first name") },
  { key: "guest_email", label: msg("Guest email") },
  { key: "booking_reference", label: msg("Booking reference") },
  { key: "channel_reference", label: msg("Channel reference") },
  { key: "check_in", label: msg("Check-in date") },
  { key: "check_out", label: msg("Check-out date") },
  { key: "nights", label: msg("Nights") },
  { key: "adults", label: msg("Adults") },
  { key: "children", label: msg("Children") },
  { key: "rooms", label: msg("Rooms") },
  { key: "total", label: msg("Total incl. tax") },
  { key: "paid", label: msg("Paid") },
  { key: "balance_due", label: msg("Balance due") },
  { key: "hotel_name", label: msg("Hotel name") },
  { key: "hotel_address", label: msg("Hotel address") },
  { key: "hotel_phone", label: msg("Hotel phone") },
  { key: "hotel_email", label: msg("Hotel email") },
] as const;

export type DropInKey = (typeof DROP_INS)[number]["key"];

export function dropInToken(key: DropInKey): string {
  return `{{${key}}}`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Replaces every `{{key}}` known to DROP_INS. `html` escapes the values; an
 * unknown token is left as typed, so a typo shows rather than vanishing.
 */
export function fillDropIns(text: string, values: Partial<Record<DropInKey, string>>, html: boolean): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) => {
    if (!(key in values)) return whole;
    const v = values[key as DropInKey] ?? "";
    return html ? escapeHtml(v) : v;
  });
}
