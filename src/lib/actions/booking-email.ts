"use server";

import sanitizeHtml from "sanitize-html";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { localised } from "@/lib/i18n/localised";
import { countryName } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { mailConnected, sendMail } from "@/lib/mailer";
import { fillDropIns, type DropInKey } from "@/lib/email-drop-ins";
import { loadInvoice } from "@/lib/invoice-data";
import { confirmationPdf, invoicePdf } from "@/lib/pdf/booking-documents";
import {
  getBookingCancellationTerms,
  getBookingDetail,
  getBookingRoomLines,
  getEmailSetup,
  getPropertyCurrency,
  getPropertySettings,
} from "@/lib/queries";

/*
 * The Email tab's SEND EMAIL (0131), as the reference's.
 *
 * The browser sends the recipients, the subject, the message as the editor
 * wrote it and two tickboxes. Everything else happens here:
 *
 * 1. The message is SANITISED (sanitize-html, the same allow-list idea as the
 *    invoice template): formatting, links, images and tables survive; script,
 *    event handlers, forms and frames do not. It goes to a guest's mail
 *    program and is kept in booking_emails, which the tab shows again.
 * 2. DROP IN'S are filled from the booking, every value HTML-escaped.
 * 3. The footer from Email Setup is added when "Include footer" is on.
 * 4. The invoice and the confirmation are made as PDFs on the server.
 * 5. It is sent through SMTP (`src/lib/mailer.ts`) and recorded as sent or
 *    failed, either way -- a bounce is correspondence too.
 *
 * Without SMTP set up nothing is sent and the action says so; the tab keeps
 * its "Record email" path for mail sent from elsewhere.
 */

type Result = { ok: true; data: { status: "sent" } } | { ok: false; error: string };

const MAX_RECIPIENTS = 10;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img", "span", "font", "u", "s", "strike", "h1", "h2", "h3", "h4", "h5", "h6",
  ],
  allowedAttributes: {
    "*": ["style", "align", "width", "height", "colspan", "rowspan", "title", "color", "face", "size"],
    a: ["href", "target"],
    img: ["src", "alt"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
};

/** The plain-text part of the message, and what the log's `body` holds. */
function toText(html: string): string {
  return sanitizeHtml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n"),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendBookingEmail(input: {
  bookingId: string;
  to: string;
  subject: string;
  html: string;
  attachInvoice: boolean;
  attachConfirmation: boolean;
}): Promise<Result> {
  if (!mailConnected()) {
    return { ok: false, error: await localised("Email sending is not set up") };
  }

  const recipients = input.to
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  if (recipients.length === 0) return { ok: false, error: await localised("Give the address it went to") };
  if (recipients.length > MAX_RECIPIENTS) {
    return { ok: false, error: await localised("Send to ten addresses at most") };
  }
  const bad = recipients.find((a) => !EMAIL.test(a));
  if (bad) {
    const tr = await getT();
    return { ok: false, error: tr("{address} is not an email address", { address: bad }) };
  }
  if (!input.subject.trim()) return { ok: false, error: await localised("Give a subject") };
  if (input.html.length > 400_000) return { ok: false, error: await localised("The message is too long") };

  const detail = await getBookingDetail(input.bookingId);
  if (!detail) return { ok: false, error: await localised("That booking is not on this property") };

  const [tr, property, setup, currency, rooms] = await Promise.all([
    getT(),
    getPropertySettings(),
    getEmailSetup(),
    getPropertyCurrency(),
    getBookingRoomLines(input.bookingId),
  ]);

  const live = rooms.filter((r) => !["canceled", "no_show"].includes(r.status));
  const stayTotal = live.reduce((s, r) => s + r.valueCents + r.taxCents, 0);
  const address = [
    property.addressLine1,
    property.addressLine2,
    property.city,
    property.region,
    property.postcode,
    property.country ? tr(countryName(property.country)) : null,
  ]
    .filter((x) => x && String(x).trim() !== "")
    .join(", ");
  const hotelName = property.companyName ?? property.name;

  const values: Record<DropInKey, string> = {
    guest_name: detail.customerName,
    guest_first_name: detail.customerName.split(/\s+/)[0] ?? "",
    guest_email: detail.customerEmail ?? "",
    booking_reference: detail.reference,
    channel_reference: detail.externalReference ?? "",
    check_in: tr.date(detail.checkIn, "d MMM yyyy"),
    check_out: tr.date(detail.checkOut, "d MMM yyyy"),
    nights: String(detail.nights),
    adults: String(detail.adults),
    children: String(detail.children),
    rooms: live.map((r) => (r.roomNumber ? `${r.roomTypeName} ${r.roomNumber}` : r.roomTypeName)).join(", "),
    total: formatMoney(stayTotal, currency),
    paid: formatMoney(detail.paymentsCents, currency),
    balance_due: formatMoney(Math.max(stayTotal, detail.chargesCents) - detail.paymentsCents, currency),
    hotel_name: property.name,
    hotel_address: address,
    hotel_phone: property.phone ?? "",
    hotel_email: property.email ?? "",
  };

  const subject = fillDropIns(input.subject, values, false).replace(/[\r\n]+/g, " ").trim().slice(0, 500);
  let html = fillDropIns(sanitizeHtml(input.html, SANITIZE), values, true);
  if (setup.includeFooter && setup.footerTemplate) {
    html += `<hr style="border:none;border-top:1px solid #d9e1ec;margin:24px 0 12px"><div style="color:#5b6b82;font-size:12px">${escapeHtml(
      fillDropIns(setup.footerTemplate, values, false),
    ).replace(/\n/g, "<br>")}</div>`;
  }
  const text = toText(html);

  // The attachments. A failure to make one stops the send: a message that
  // says "attached is your invoice" and arrives without it is worse than none.
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  try {
    if (input.attachInvoice) {
      const invoice = await loadInvoice(input.bookingId);
      if (invoice) {
        attachments.push({
          filename: `${tr("Invoice")} ${invoice.invoiceNumber ?? detail.reference}.pdf`,
          content: await invoicePdf(invoice, tr),
          contentType: "application/pdf",
        });
      }
    }
    if (input.attachConfirmation) {
      const terms = await getBookingCancellationTerms(input.bookingId);
      attachments.push({
        filename: `${tr("Booking confirmation")} ${detail.reference}.pdf`,
        content: await confirmationPdf(
          {
            hotel: { name: hotelName, address, phone: property.phone, email: property.email },
            detail,
            rooms,
            terms,
            message: setup.confirmationMessage,
            checkinNotes: setup.checkinNotes,
            currency,
          },
          tr,
        ),
        contentType: "application/pdf",
      });
    }
  } catch (e) {
    return {
      ok: false,
      error: `${tr("The attachment could not be made")}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let sendError: string | null = null;
  try {
    await sendMail({
      to: recipients,
      subject,
      html,
      text,
      fromName: setup.fromText || property.name,
      replyTo: setup.replyToEmails,
      attachments,
    });
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_booking_email", {
    p_booking_id: input.bookingId,
    p_to_address: recipients.join(", "),
    p_subject: subject,
    p_body: text,
    p_body_html: html,
    p_status: sendError ? "failed" : "sent",
    p_error: sendError ?? "",
    p_attachments: attachments.map((a) => a.filename),
  });

  revalidatePath(`/bookings/${input.bookingId}`);
  revalidatePath("/calendar");

  if (sendError) {
    return { ok: false, error: `${tr("The email was not sent")}: ${sendError}` };
  }
  if (error) {
    // Sent, but the log refused it: say so, so nobody sends it again.
    return { ok: false, error: `${tr("The email was sent but not recorded")}: ${tr.message(error.message)}` };
  }
  return { ok: true, data: { status: "sent" } };
}
