import { format, parseISO } from "date-fns";
import { countryName } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import {
  getBookingDetail,
  getBookingFolioLines,
  getBookingInvoiceLines,
  getBookingRoomLines,
  getBusinessDate,
  getInvoiceSettings,
  getPropertyCurrency,
  getPropertySettings,
} from "@/lib/queries";
import { invoiceRows, type InvoiceRow } from "@/lib/invoice";

/*
 * ONE INVOICE, TWO LAYOUTS. The printable invoice (0080) is either the
 * built-in layout or the hotel's own Folio/invoice template (0105), and both
 * are filled from what this returns -- so a template can arrange the figures
 * but never arrive at different ones. Every figure is read off the folio,
 * never recomputed; see the invoice page for what each Invoice Setting does.
 */

export interface InvoiceView {
  bookingId: string;
  reference: string;
  issuer: string;
  issuerAddress: string;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  logoText: string | null;
  invoiceNumber: number | null;
  date: string;
  guest: { name: string; email: string | null; phone: string | null };
  checkIn: string;
  checkOut: string;
  roomsLabel: string;
  rows: InvoiceRow[];
  showRoom: boolean;
  vatRegistered: boolean;
  netCents: number;
  taxCents: number;
  totalCents: number;
  payments: { key: string; date: string; description: string; amountCents: number; reversed: boolean }[];
  balanceCents: number;
  notes: string | null;
  currency: string;
}

export async function loadInvoice(bookingId: string): Promise<InvoiceView | null> {
  const detail = await getBookingDetail(bookingId);
  if (!detail) return null;

  const [lines, folio, rooms, property, settings, currency, today] = await Promise.all([
    getBookingInvoiceLines(bookingId),
    getBookingFolioLines(bookingId),
    getBookingRoomLines(bookingId),
    getPropertySettings(),
    getInvoiceSettings(),
    getPropertyCurrency(),
    getBusinessDate(),
  ]);

  /* Who the invoice is from: the override where it is set, else the hotel. */
  const overridden =
    settings.address || settings.city || settings.region || settings.postcode || settings.country;
  const issuerAddress = (
    overridden
      ? [settings.address, settings.city, settings.region, settings.postcode, countryName(settings.country)]
      : [
          property.addressLine1,
          property.addressLine2,
          property.city,
          property.region,
          property.postcode,
          countryName(property.country),
        ]
  )
    .filter((x) => x && String(x).trim() !== "")
    .join(", ");

  /* The one room an extra can be said to belong to, if there is exactly one. */
  const liveRooms = rooms.filter((r) => r.status !== "canceled");
  const soleRoom = liveRooms.length === 1 ? liveRooms[0].roomNumber ?? null : null;

  const rows = invoiceRows(lines, {
    showNightsBreakdown: settings.showNightsBreakdown,
    showRoomNumberForExtras: settings.showRoomNumberForExtras,
    soleRoom,
  });

  return {
    bookingId: detail.bookingId,
    reference: detail.reference,
    issuer: settings.companyName ?? property.name,
    issuerAddress,
    phone: property.phone,
    email: property.email,
    logoUrl: !settings.useTextInsteadOfLogo ? settings.logoUrl : null,
    logoText: settings.useTextInsteadOfLogo ? settings.logoText : null,
    invoiceNumber: folio.length > 0 ? Math.min(...folio.map((f) => f.folioNumber)) : null,
    date: today,
    guest: { name: detail.customerName, email: detail.customerEmail, phone: detail.customerPhone },
    checkIn: detail.checkIn,
    checkOut: detail.checkOut,
    roomsLabel: liveRooms
      .map((r) => (r.roomNumber ? `${r.roomNumber} · ${r.roomTypeName}` : r.roomTypeName))
      .join(", "),
    rows,
    showRoom: rows.some((r) => r.room),
    vatRegistered: settings.vatRegistered,
    // Column sums of posted integer cents, as the reports' totals are.
    netCents: rows.reduce((s, r) => s + r.netCents, 0),
    taxCents: rows.reduce((s, r) => s + r.taxCents, 0),
    // Total and balance are the booking's own figures -- the ones the Folio
    // tab shows -- so the printout cannot disagree with the screen.
    totalCents: detail.chargesCents,
    payments: folio
      .filter((f) => f.kind === "payment")
      .map((p) => ({
        key: p.lineId,
        date: p.businessDate,
        description: p.description,
        amountCents: p.amountCents,
        reversed: p.isReversal,
      })),
    balanceCents: detail.balanceCents,
    notes: settings.notes,
    currency,
  };
}

export const invoiceDay = (d: string) => format(parseISO(d), "d MMM yyyy");

/**
 * The variables a Liquid template sees. Money arrives FORMATTED, in the
 * property's currency, beside its integer `_cents` -- so a template never has
 * to do arithmetic on money, and `money.ts` stays the one place a number
 * becomes a currency string. Dates arrive formatted beside their ISO form.
 * Keys are snake_case, as Liquid templates conventionally are.
 */
export function invoiceLiquidData(v: InvoiceView) {
  const money = (cents: number) => formatMoney(cents, v.currency);
  return {
    hotel: {
      name: v.issuer,
      address: v.issuerAddress,
      phone: v.phone ?? "",
      email: v.email ?? "",
      logo_url: v.logoUrl ?? "",
      logo_text: v.logoText ?? "",
    },
    invoice: {
      number: v.invoiceNumber ?? "",
      reference: v.reference,
      date: invoiceDay(v.date),
      date_iso: v.date,
      vat_registered: v.vatRegistered,
      show_room: v.showRoom,
      notes: v.notes ?? "",
      currency: v.currency,
    },
    guest: { name: v.guest.name, email: v.guest.email ?? "", phone: v.guest.phone ?? "" },
    stay: {
      check_in: invoiceDay(v.checkIn),
      check_out: invoiceDay(v.checkOut),
      check_in_iso: v.checkIn,
      check_out_iso: v.checkOut,
      rooms: v.roomsLabel,
    },
    lines: v.rows.map((r) => ({
      date: invoiceDay(r.date),
      date_iso: r.date,
      description: r.description,
      room: r.room ?? "",
      net: money(r.netCents),
      tax: money(r.taxCents),
      amount: money(r.grossCents),
      net_cents: r.netCents,
      tax_cents: r.taxCents,
      amount_cents: r.grossCents,
    })),
    payments: v.payments.map((p) => ({
      date: invoiceDay(p.date),
      date_iso: p.date,
      description: p.description,
      amount: money(p.amountCents),
      amount_cents: p.amountCents,
      reversed: p.reversed,
    })),
    totals: {
      net: money(v.netCents),
      tax: money(v.taxCents),
      total: money(v.totalCents),
      balance: money(v.balanceCents),
      net_cents: v.netCents,
      tax_cents: v.taxCents,
      total_cents: v.totalCents,
      balance_cents: v.balanceCents,
    },
  };
}

export type InvoiceLiquidData = ReturnType<typeof invoiceLiquidData>;
