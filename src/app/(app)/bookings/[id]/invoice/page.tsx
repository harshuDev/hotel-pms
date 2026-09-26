import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { PrintButton } from "@/components/bookings/print-button";
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
import { invoiceRows } from "@/lib/invoice";

export const metadata = { title: "Invoice" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * THE PRINTABLE INVOICE (0080) -- what Settings -> Finances -> Invoice
 * Settings prints on. Read off the folio, never recomputed: every figure is a
 * posted charge or payment, so the invoice and the Folio tab cannot disagree.
 *
 * What each setting does here:
 *   - Company information overrides the hotel's name and address as issuer;
 *     blank fields fall back to the hotel's own.
 *   - The logo, or the text instead of it, heads the page.
 *   - Show nights breakdown: one line per night charged, or one line per room.
 *   - Show room number for extras: extras carry the room, when the booking has
 *     exactly one -- an extra is posted to the booking, so on a group there
 *     is no room to name and none is guessed.
 *   - VAT registered: Net / VAT / Total columns and a VAT total, or amounts
 *     only.
 *   - Notes print at the foot, with the hotel's line breaks.
 *
 * THE NUMBER is the reference's default, "a simple increment number": the
 * booking's primary folio number, from `folio_number_seq` (0082). The primary
 * folio is made on the first charge, so it is the lowest number the booking
 * carries; nothing posted means no folio and no number yet. The custom scheme
 * behind "Enable Custom Invoice Number Settings" is stored, not yet live.
 */

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const detail = await getBookingDetail(id);
  if (!detail) notFound();

  const [lines, folio, rooms, property, settings, currency, today] = await Promise.all([
    getBookingInvoiceLines(id),
    getBookingFolioLines(id),
    getBookingRoomLines(id),
    getPropertySettings(),
    getInvoiceSettings(),
    getPropertyCurrency(),
    getBusinessDate(),
  ]);

  const money = (cents: number) => formatMoney(cents, currency);
  const day = (d: string) => format(parseISO(d), "d MMM yyyy");

  /* Who the invoice is from: the override where it is set, else the hotel. */
  const issuer = settings.companyName ?? property.name;
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

  const payments = folio.filter((f) => f.kind === "payment");
  const invoiceNumber = folio.length > 0 ? Math.min(...folio.map((f) => f.folioNumber)) : null;
  const net = rows.reduce((s, r) => s + r.netCents, 0);
  const tax = rows.reduce((s, r) => s + r.taxCents, 0);
  // Total, paid and due are the booking's own figures -- the ones the Folio
  // tab shows -- so the printout cannot disagree with the screen.
  const showRoom = rows.some((r) => r.room);
  const vat = settings.vatRegistered;

  const th = "px-2 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint";
  const td = "px-2 py-1.5 text-[13px] text-ink";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/bookings/${detail.bookingId}`}
          className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          ← {detail.reference}
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-lg border border-line bg-white p-8 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-4">
          <div className="min-w-0">
            {!settings.useTextInsteadOfLogo && settings.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- the bucket
              // is a runtime host; next/image would need it in remotePatterns.
              <img src={settings.logoUrl} alt={issuer} className="mb-3 max-h-20 max-w-[16rem] object-contain" />
            ) : settings.useTextInsteadOfLogo && settings.logoText ? (
              <p className="mb-2 font-display text-[22px] font-semibold tracking-tightest text-ink">
                {settings.logoText}
              </p>
            ) : null}
            <p className="text-[14px] font-semibold text-ink">{issuer}</p>
            {issuerAddress && <p className="mt-0.5 text-[12.5px] text-ink-muted">{issuerAddress}</p>}
            {(property.phone || property.email) && (
              <p className="text-[12.5px] text-ink-muted">
                {[property.phone, property.email].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-display text-[20px] font-semibold tracking-tightest text-ink">Invoice</p>
            {invoiceNumber !== null && (
              <p className="tnum mt-1 text-[13px] text-ink">No. {invoiceNumber}</p>
            )}
            <p className="tnum text-[13px] text-ink-muted">{detail.reference}</p>
            <p className="tnum text-[13px] text-ink-muted">{day(today)}</p>
          </div>
        </header>

        <section className="mt-5 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Bill to</p>
            <p className="mt-1 text-[14px] text-ink">{detail.customerName}</p>
            {detail.customerEmail && <p className="text-[12.5px] text-ink-muted">{detail.customerEmail}</p>}
            {detail.customerPhone && <p className="text-[12.5px] text-ink-muted">{detail.customerPhone}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Stay</p>
            <p className="tnum mt-1 text-[13px] text-ink">
              {day(detail.checkIn)} – {day(detail.checkOut)}
            </p>
            <p className="text-[12.5px] text-ink-muted">
              {liveRooms
                .map((r) => (r.roomNumber ? `${r.roomNumber} · ${r.roomTypeName}` : r.roomTypeName))
                .join(", ")}
            </p>
          </div>
        </section>

        <table className="mt-6 w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Date</th>
              <th className={th}>Description</th>
              {showRoom && <th className={th}>Room</th>}
              {vat && <th className={`${th} text-right`}>Net</th>}
              {vat && <th className={`${th} text-right`}>VAT</th>}
              <th className={`${th} text-right`}>{vat ? "Total" : "Amount"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-[13px] text-ink-muted">
                  Nothing charged yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key} className="border-b border-line/70">
                  <td className={`${td} tnum whitespace-nowrap`}>{day(r.date)}</td>
                  <td className={td}>{r.description}</td>
                  {showRoom && <td className={`${td} tnum`}>{r.room ?? ""}</td>}
                  {vat && <td className={`${td} tnum text-right`}>{money(r.netCents)}</td>}
                  {vat && <td className={`${td} tnum text-right`}>{money(r.taxCents)}</td>}
                  <td className={`${td} tnum text-right`}>{money(r.grossCents)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <section className="mt-4 ml-auto w-full max-w-xs text-[13px]">
          {vat && (
            <>
              <div className="flex justify-between py-0.5 text-ink-muted">
                <span>Net</span>
                <span className="tnum">{money(net)}</span>
              </div>
              <div className="flex justify-between py-0.5 text-ink-muted">
                <span>VAT</span>
                <span className="tnum">{money(tax)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-line py-1 font-semibold text-ink">
            <span>Total</span>
            <span className="tnum">{money(detail.chargesCents)}</span>
          </div>
          {payments.length > 0 && (
            <p className="pt-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Paid</p>
          )}
          {payments.map((p) => (
            <div key={p.lineId} className="flex justify-between py-0.5 text-ink-muted">
              <span>
                {p.description}
                {p.isReversal ? " (reversed)" : ""}, {day(p.businessDate)}
              </span>
              <span className="tnum">{money(p.amountCents)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t-2 border-ink py-1 font-semibold text-ink">
            <span>Balance due</span>
            <span className="tnum">{money(detail.balanceCents)}</span>
          </div>
        </section>

        {settings.notes && (
          <p className="mt-8 whitespace-pre-line border-t border-line pt-4 text-[12.5px] leading-relaxed text-ink-muted">
            {settings.notes}
          </p>
        )}
      </article>
    </div>
  );
}
