import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { formatMoney } from "@/lib/money";
import type { Translator } from "@/lib/i18n/translate";
import type { InvoiceView } from "@/lib/invoice-data";
import type { BookingCancellationTerms, BookingDetail, BookingRoomLine } from "@/lib/types";
import { renderPdf } from "@/lib/pdf/engine";

/*
 * The Email tab's two attachments (0131), as PDFs.
 *
 * The invoice is drawn from loadInvoice() -- the same figures the printed
 * invoice shows, never recomputed here. The confirmation is the booking as
 * sold: its rooms, the stay's total including tax (the header's own sum of
 * each live room's value and tax), what is paid and what is due.
 */

const INK = "#0F1B2D";
const MUTED = "#5B6B82";
const LINE = "#D9E1EC";

const day = (tr: Translator, d: string) => tr.date(d, "d MMM yyyy");

/** A public image (the invoice logo) as a data URL, or null. Never more than 2 MB. */
async function imageData(url: string | null): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(png|jpe?g)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2_000_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function header(left: Content[], title: string, right: [string, string][]): Content {
  return {
    columns: [
      { width: "*", stack: left },
      {
        width: "auto",
        stack: [
          { text: title, fontSize: 18, bold: true, color: INK, alignment: "right", margin: [0, 0, 0, 6] },
          {
            table: {
              body: right.map(([k, v]) => [
                { text: k, color: MUTED, alignment: "right" },
                { text: v, alignment: "right", bold: true },
              ]),
            },
            layout: "noBorders",
          },
        ],
      },
    ],
    margin: [0, 0, 0, 18],
  };
}

const tableLayout = {
  hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
  vLineWidth: () => 0,
  hLineColor: () => LINE,
  paddingTop: () => 5,
  paddingBottom: () => 5,
};

function totalsBlock(rows: [string, string, boolean?][]): Content {
  return {
    columns: [
      { width: "*", text: "" },
      {
        width: 220,
        table: {
          widths: ["*", "auto"],
          body: rows.map(([k, v, strong]) => [
            { text: k, color: strong ? INK : MUTED, bold: !!strong },
            { text: v, alignment: "right", bold: !!strong },
          ]),
        },
        layout: "noBorders",
      },
    ],
    margin: [0, 10, 0, 0],
  };
}

export async function invoicePdf(v: InvoiceView, tr: Translator): Promise<Buffer> {
  const money = (c: number) => formatMoney(c, v.currency);
  const logo = await imageData(v.logoUrl);
  const issuer: Content[] = [
    ...(logo ? [{ image: logo, fit: [140, 60] as [number, number], margin: [0, 0, 0, 6] as [number, number, number, number] }] : []),
    ...(v.logoText && !logo ? [{ text: v.logoText, fontSize: 14, bold: true, margin: [0, 0, 0, 4] as [number, number, number, number] }] : []),
    { text: v.issuer, bold: true, fontSize: 11 },
    { text: v.issuerAddress, color: MUTED },
    ...(v.phone ? [{ text: v.phone, color: MUTED }] : []),
    ...(v.email ? [{ text: v.email, color: MUTED }] : []),
  ];

  const cols: { key: string; label: string; right?: boolean }[] = [
    { key: "date", label: tr("Date") },
    { key: "description", label: tr("Description") },
    ...(v.showRoom ? [{ key: "room", label: tr("Room") }] : []),
    ...(v.vatRegistered
      ? [
          { key: "net", label: tr("Net"), right: true },
          { key: "tax", label: tr("VAT"), right: true },
        ]
      : []),
    { key: "amount", label: tr("Amount"), right: true },
  ];
  const body: TableCell[][] = [
    cols.map((c) => ({ text: c.label, bold: true, color: MUTED, alignment: c.right ? "right" : "left" })),
    ...v.rows.map((r) =>
      cols.map((c) => {
        const text =
          c.key === "date" ? day(tr, r.date)
          : c.key === "description" ? r.description
          : c.key === "room" ? r.room ?? ""
          : c.key === "net" ? money(r.netCents)
          : c.key === "tax" ? money(r.taxCents)
          : money(r.grossCents);
        return { text, alignment: c.right ? "right" : "left" } as TableCell;
      }),
    ),
  ];

  const totals: [string, string, boolean?][] = [
    ...(v.vatRegistered ? ([[tr("Net"), money(v.netCents)]] as [string, string][]) : []),
    ...v.taxes.map((t) => [t.name, money(t.cents)] as [string, string]),
    [tr("Total"), money(v.totalCents), true],
    ...v.payments.map((p) => [`${day(tr, p.date)} ${p.description}`, money(p.reversed ? p.amountCents : -p.amountCents)] as [string, string]),
    [tr("Balance due"), money(v.balanceCents), true],
  ];

  const doc: TDocumentDefinitions = {
    pageMargins: [40, 40, 40, 40],
    info: { title: `${tr("Invoice")} ${v.invoiceNumber ?? v.reference}` },
    content: [
      header(issuer, tr("Invoice").toUpperCase(), [
        [tr("No."), String(v.invoiceNumber ?? "—")],
        [tr("Date"), day(tr, v.date)],
        [tr("Booking"), v.reference],
      ]),
      {
        columns: [
          {
            stack: [
              { text: tr("Bill to"), color: MUTED },
              { text: v.guest.name, bold: true },
              ...(v.guest.email ? [{ text: v.guest.email }] : []),
              ...(v.guest.phone ? [{ text: v.guest.phone }] : []),
            ],
          },
          {
            stack: [
              { text: tr("Stay"), color: MUTED },
              { text: `${day(tr, v.checkIn)} – ${day(tr, v.checkOut)}` },
              ...(v.roomsLabel ? [{ text: v.roomsLabel }] : []),
            ],
          },
        ],
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: cols.map((c) => (c.key === "description" ? "*" : "auto")),
          body,
        },
        layout: tableLayout,
      },
      totalsBlock(totals),
      ...(v.notes ? [{ text: v.notes, color: MUTED, margin: [0, 24, 0, 0] as [number, number, number, number] }] : []),
    ],
  };
  return renderPdf(doc);
}

export interface ConfirmationData {
  hotel: { name: string; address: string; phone: string | null; email: string | null };
  detail: BookingDetail;
  rooms: BookingRoomLine[];
  terms: BookingCancellationTerms | null;
  /** The hotel's own words from Email Setup, printed as written. */
  message: string | null;
  checkinNotes: string | null;
  currency: string;
}

export async function confirmationPdf(d: ConfirmationData, tr: Translator): Promise<Buffer> {
  const money = (c: number) => formatMoney(c, d.currency);
  const live = d.rooms.filter((r) => !["canceled", "no_show"].includes(r.status));
  const stayTotal = live.reduce((s, r) => s + r.valueCents + r.taxCents, 0);
  const stayTax = live.reduce((s, r) => s + r.taxCents, 0);
  const b = d.detail;

  const policy =
    !d.terms || d.terms.hasNoPolicy
      ? null
      : d.terms.kind === "non_refundable"
        ? tr("{name}: non-refundable", { name: d.terms.policyName ?? "" })
        : d.terms.kind === "flexible" && d.terms.freeUntil
          ? tr("{name}: free cancellation until {date}", { name: d.terms.policyName ?? "", date: day(tr, d.terms.freeUntil) })
          : d.terms.policyName;

  const doc: TDocumentDefinitions = {
    pageMargins: [40, 40, 40, 40],
    info: { title: `${tr("Booking confirmation")} ${b.reference}` },
    content: [
      header(
        [
          { text: d.hotel.name, bold: true, fontSize: 11 },
          { text: d.hotel.address, color: MUTED },
          ...(d.hotel.phone ? [{ text: d.hotel.phone, color: MUTED }] : []),
          ...(d.hotel.email ? [{ text: d.hotel.email, color: MUTED }] : []),
        ],
        tr("Booking confirmation").toUpperCase(),
        [
          [tr("Booking"), b.reference],
          ...(b.externalReference ? ([[tr("Channel reference"), b.externalReference]] as [string, string][]) : []),
          [tr("Booked on"), day(tr, b.bookedOn.slice(0, 10))],
        ],
      ),
      ...(d.message ? [{ text: d.message, margin: [0, 0, 0, 14] as [number, number, number, number] }] : []),
      {
        table: {
          widths: ["auto", "*"],
          body: [
            [{ text: tr("Guest"), color: MUTED }, { text: b.customerName, bold: true }],
            [{ text: tr("Check-in"), color: MUTED }, `${tr.date(b.checkIn, "EEEE d MMMM yyyy")}${b.arrivalTime ? `, ${b.arrivalTime.slice(0, 5)}` : ""}`],
            [{ text: tr("Check-out"), color: MUTED }, `${tr.date(b.checkOut, "EEEE d MMMM yyyy")}${b.departureTime ? `, ${b.departureTime.slice(0, 5)}` : ""}`],
            [{ text: tr("Nights"), color: MUTED }, String(b.nights)],
            [
              { text: tr("Guests"), color: MUTED },
              tr("{adults} adults, {children} children", { adults: b.adults, children: b.children }),
            ],
          ],
        },
        layout: "noBorders",
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", "auto", "auto", "auto", "auto", "auto"],
          body: [
            [tr("Room type"), tr("Room"), tr("Rate plan"), tr("Guests"), tr("Nights"), tr("Total")].map((t, i) => ({
              text: t,
              bold: true,
              color: MUTED,
              alignment: i >= 3 ? "right" : "left",
            })) as TableCell[],
            ...live.map((r) => [
              r.roomTypeName,
              r.roomNumber ?? "—",
              r.ratePlanName ?? "—",
              { text: String(r.adults + r.children), alignment: "right" },
              { text: String(r.nights), alignment: "right" },
              { text: money(r.valueCents + r.taxCents), alignment: "right" },
            ] as TableCell[]),
          ],
        },
        layout: tableLayout,
      },
      totalsBlock([
        ...(stayTax > 0 ? ([[tr("Tax"), money(stayTax)]] as [string, string][]) : []),
        [tr("Total incl. tax"), money(stayTotal), true],
        [tr("Paid"), money(b.paymentsCents)],
        [tr("Balance due"), money(Math.max(stayTotal, b.chargesCents) - b.paymentsCents), true],
      ]),
      ...(policy
        ? [
            { text: tr("Cancellation policy"), bold: true, margin: [0, 20, 0, 2] as [number, number, number, number] },
            { text: policy, color: MUTED },
          ]
        : []),
      ...(d.checkinNotes
        ? [
            { text: tr("Check-in notes"), bold: true, margin: [0, 14, 0, 2] as [number, number, number, number] },
            { text: d.checkinNotes, color: MUTED },
          ]
        : []),
      ...(b.guestNotes
        ? [
            { text: tr("Guest notes"), bold: true, margin: [0, 14, 0, 2] as [number, number, number, number] },
            { text: b.guestNotes, color: MUTED },
          ]
        : []),
    ],
  };
  return renderPdf(doc);
}
