import { getT } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton, PrintOnArrival } from "@/components/bookings/print-button";
import { formatMoney } from "@/lib/money";
import { getDocumentTemplate } from "@/lib/queries";
import { invoiceDay, invoiceLiquidData, loadInvoice } from "@/lib/invoice-data";
import { renderInvoiceTemplate } from "@/lib/document-template";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Invoice"));

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
 *
 * THE HOTEL'S OWN TEMPLATE (0105), when Settings -> Other -> Templates has one
 * active, replaces the layout below. It is filled from the same
 * `loadInvoice()` figures and rendered and SANITISED on the server by
 * `renderInvoiceTemplate()` -- the only reason printing browser-typed HTML
 * here is acceptable. A template that fails to render prints the built-in
 * layout, with the error above it where only the screen shows it.
 */

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const tr = await getT();
  const { id } = await params;
  const autoPrint = (await searchParams).print === "1";
  if (!UUID.test(id)) notFound();

  const [v, template] = await Promise.all([loadInvoice(id), getDocumentTemplate("folio")]);
  if (!v) notFound();

  const rendered =
    template?.isActive && template.liquid.trim() !== ""
      ? await renderInvoiceTemplate(template.liquid, template.css, invoiceLiquidData(v, tr))
      : null;

  const toolbar = (
    <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
      {autoPrint && <PrintOnArrival />}
      <Link
        href={`/bookings/${v.bookingId}`}
        className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        ← {v.reference}
      </Link>
      <PrintButton />
    </div>
  );

  if (rendered?.ok) {
    return (
      <div className="mx-auto max-w-4xl">
        {toolbar}
        {/* Sanitised HTML and escaped CSS, from renderInvoiceTemplate(). */}
        <style dangerouslySetInnerHTML={{ __html: rendered.css }} />
        <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
      </div>
    );
  }

  const money = (cents: number) => formatMoney(cents, v.currency);
  const day = (d: string) => invoiceDay(tr, d);
  const vat = v.vatRegistered;

  const th = "px-2 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint";
  const td = "px-2 py-1.5 text-[13px] text-ink";

  return (
    <div className="mx-auto max-w-3xl">
      {toolbar}
      {rendered && !rendered.ok && (
        <p role="alert" className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 print:hidden">
          {tr("The folio template could not be rendered: {error}. This is the built-in layout.", { error: rendered.error })}
        </p>
      )}

      <article className="rounded-lg border border-line bg-white p-8 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-4">
          <div className="min-w-0">
            {v.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- the bucket
              // is a runtime host; next/image would need it in remotePatterns.
              <img src={v.logoUrl} alt={v.issuer} className="mb-3 max-h-20 max-w-[16rem] object-contain" />
            ) : v.logoText ? (
              <p className="mb-2 font-display text-[22px] font-semibold tracking-tightest text-ink">
                {v.logoText}
              </p>
            ) : null}
            <p className="text-[14px] font-semibold text-ink">{v.issuer}</p>
            {v.issuerAddress && <p className="mt-0.5 text-[12.5px] text-ink-muted">{v.issuerAddress}</p>}
            {(v.phone || v.email) && (
              <p className="text-[12.5px] text-ink-muted">
                {[v.phone, v.email].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-display text-[20px] font-semibold tracking-tightest text-ink">{tr("Invoice")}</p>
            {v.invoiceNumber !== null && (
              <p className="tnum mt-1 text-[13px] text-ink">{tr("No. {n}", { n: v.invoiceNumber })}</p>
            )}
            <p className="tnum text-[13px] text-ink-muted">{v.reference}</p>
            <p className="tnum text-[13px] text-ink-muted">{day(v.date)}</p>
          </div>
        </header>

        <section className="mt-5 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{tr("Bill to")}</p>
            <p className="mt-1 text-[14px] text-ink">{v.guest.name}</p>
            {v.guest.email && <p className="text-[12.5px] text-ink-muted">{v.guest.email}</p>}
            {v.guest.phone && <p className="text-[12.5px] text-ink-muted">{v.guest.phone}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{tr("Stay")}</p>
            <p className="tnum mt-1 text-[13px] text-ink">
              {day(v.checkIn)} – {day(v.checkOut)}
            </p>
            <p className="text-[12.5px] text-ink-muted">{v.roomsLabel}</p>
          </div>
        </section>

        <table className="mt-6 w-full">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>{tr("Date")}</th>
              <th className={th}>{tr("Description")}</th>
              {v.showRoom && <th className={th}>{tr("Room")}</th>}
              {vat && <th className={`${th} text-right`}>{tr("Net")}</th>}
              {vat && <th className={`${th} text-right`}>{tr("VAT")}</th>}
              <th className={`${th} text-right`}>{vat ? tr("Total") : tr("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-[13px] text-ink-muted">
                  {tr("Nothing charged yet.")}
                </td>
              </tr>
            ) : (
              v.rows.map((r) => (
                <tr key={r.key} className="border-b border-line/70">
                  <td className={`${td} tnum whitespace-nowrap`}>{day(r.date)}</td>
                  <td className={td}>{r.description}</td>
                  {v.showRoom && <td className={`${td} tnum`}>{r.room ?? ""}</td>}
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
                <span>{tr("Net")}</span>
                <span className="tnum">{money(v.netCents)}</span>
              </div>
              {v.taxes.length > 0 ? (
                v.taxes.map((t) => (
                  <div key={t.name} className="flex justify-between py-0.5 text-ink-muted">
                    <span>{t.name}</span>
                    <span className="tnum">{money(t.cents)}</span>
                  </div>
                ))
              ) : (
                <div className="flex justify-between py-0.5 text-ink-muted">
                  <span>{tr("VAT")}</span>
                  <span className="tnum">{money(v.taxCents)}</span>
                </div>
              )}
            </>
          )}
          <div className="flex justify-between border-t border-line py-1 font-semibold text-ink">
            <span>{tr("Total")}</span>
            <span className="tnum">{money(v.totalCents)}</span>
          </div>
          {v.payments.length > 0 && (
            <p className="pt-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{tr("Paid")}</p>
          )}
          {v.payments.map((p) => (
            <div key={p.key} className="flex justify-between py-0.5 text-ink-muted">
              <span>
                {p.description}
                {p.reversed ? ` (${tr("reversed")})` : ""}, {day(p.date)}
              </span>
              <span className="tnum">{money(p.amountCents)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t-2 border-ink py-1 font-semibold text-ink">
            <span>{tr("Balance due")}</span>
            <span className="tnum">{money(v.balanceCents)}</span>
          </div>
        </section>

        {v.notes && (
          <p className="mt-8 whitespace-pre-line border-t border-line pt-4 text-[12.5px] leading-relaxed text-ink-muted">
            {v.notes}
          </p>
        )}
      </article>
    </div>
  );
}
