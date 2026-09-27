import { getT } from "@/lib/i18n/server";
import { format, isValid, parseISO } from "date-fns";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import {
  ReportAccessError,
  getBusinessDate,
  getDailyCheckout,
} from "@/lib/queries";
import type { CheckoutRow } from "@/lib/types";
import { getPropertyCurrency } from "@/lib/queries";

export const metadata = { title: "Daily checkout" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DailyCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const tr = await getT();
  const currency = await getPropertyCurrency();
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const date =
    sp.date && ISO_DATE.test(sp.date) && isValid(parseISO(sp.date))
      ? sp.date
      : businessDate;

  let rows: CheckoutRow[];
  try {
    rows = await getDailyCheckout(date);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell
          title={tr("Daily checkout")}
        >
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const charges = rows.reduce((s, r) => s + r.chargesCents, 0);
  const payments = rows.reduce((s, r) => s + r.paymentsCents, 0);
  const outstanding = rows.reduce((s, r) => s + r.outstandingCents, 0);
  const owing = rows.filter((r) => r.outstandingCents > 0).length;

  return (
    <ReportShell
      title={tr("Daily checkout")}
      action="/reports/daily-checkout"
      date={date}
    >
      <ReportFigures>
        <ReportFigure
          label={tr("Departures")}
          value={String(rows.length)}
          detail={date === businessDate ? tr("Due out today") : tr("Due out that day")}
        />
        <ReportFigure label={tr("Charged")} value={formatMoneyShort(charges, currency)} />
        <ReportFigure label={tr("Settled")} value={formatMoneyShort(payments, currency)} />
        <ReportFigure
          label={tr("Left owing")}
          value={formatMoneyShort(outstanding, currency)}
          detail={
            owing === 0
              ? tr("Every folio settled")
              : `${owing} booking${owing === 1 ? "" : "s"} still owing`
          }
          emphasis
        />
      </ReportFigures>

      <ReportTable<CheckoutRow>
        rows={rows}
        rowKey={(r) => r.bookingId}
        minWidth="860px"
        emptyTitle={tr("Nobody is due out on this date")}
        emptyHint={tr("Pick another business date, or check the arrivals and departures lists.")}
        footLabel={`${rows.length} departure${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: tr("Booking"),
            cell: (r) => (
              <>
                <span className="font-medium text-ink">{r.reference}</span>
                <span className="block text-xxs text-ink-faint">{r.guestName}</span>
              </>
            ),
          },
          {
            header: tr("Room"),
            cell: (r) => (
              <span className="tnum text-ink-muted">{r.roomNumbers ?? "—"}</span>
            ),
          },
          {
            header: tr("Channel"),
            cell: (r) => (
              <span className="text-ink-faint">{r.channelName ?? "—"}</span>
            ),
          },
          {
            header: tr("Arrived"),
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {tr.date(r.checkIn, "d MMM")}
              </span>
            ),
          },
          {
            header: tr("Nights"),
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.nights}</span>,
          },
          {
            header: tr("Charged"),
            align: "right",
            cell: (r) => <span className="text-ink-muted">{formatMoney(r.chargesCents, currency)}</span>,
            foot: formatMoney(charges, currency),
          },
          {
            header: tr("Paid"),
            align: "right",
            cell: (r) => <span className="text-ink-muted">{formatMoney(r.paymentsCents, currency)}</span>,
            foot: formatMoney(payments, currency),
          },
          {
            header: tr("Outstanding"),
            align: "right",
            cell: (r) => (
              <span
                className={
                  r.outstandingCents > 0
                    ? "font-medium text-rose-600"
                    : "text-ink-faint"
                }
              >
                {r.outstandingCents === 0 ? tr("Settled") : formatMoney(r.outstandingCents, currency)}
              </span>
            ),
            foot: formatMoney(outstanding, currency),
          },
        ]}
      />
    </ReportShell>
  );
}
