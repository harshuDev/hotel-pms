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

export const metadata = { title: "Daily checkout" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DailyCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
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
          title="Daily checkout"
          subtitle="Who departed and what they left owing"
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
      title="Daily checkout"
      subtitle="Who departed on this business date, and what they left owing"
      action="/reports/daily-checkout"
      date={date}
    >
      <ReportFigures>
        <ReportFigure
          label="Departures"
          value={String(rows.length)}
          detail={date === businessDate ? "Due out today" : "Due out that day"}
        />
        <ReportFigure label="Charged" value={formatMoneyShort(charges)} />
        <ReportFigure label="Settled" value={formatMoneyShort(payments)} />
        <ReportFigure
          label="Left owing"
          value={formatMoneyShort(outstanding)}
          detail={
            owing === 0
              ? "Every folio settled"
              : `${owing} booking${owing === 1 ? "" : "s"} still owing`
          }
          emphasis
        />
      </ReportFigures>

      <ReportTable<CheckoutRow>
        rows={rows}
        rowKey={(r) => r.bookingId}
        minWidth="860px"
        emptyTitle="Nobody is due out on this date"
        emptyHint="Pick another business date, or check the arrivals and departures lists."
        footLabel={`${rows.length} departure${rows.length === 1 ? "" : "s"}`}
        note={
          <>
            Bookings still showing as checked in are included: a guest whose
            departure date has come but who has not been checked out is exactly
            what this report is for. Amounts cover every folio on the booking,
            so a split bill appears once.
          </>
        }
        columns={[
          {
            header: "Booking",
            cell: (r) => (
              <>
                <span className="font-medium text-ink">{r.reference}</span>
                <span className="block text-xxs text-ink-faint">{r.guestName}</span>
              </>
            ),
          },
          {
            header: "Room",
            cell: (r) => (
              <span className="tnum text-ink-muted">{r.roomNumbers ?? "—"}</span>
            ),
          },
          {
            header: "Channel",
            cell: (r) => (
              <span className="text-ink-faint">{r.channelName ?? "—"}</span>
            ),
          },
          {
            header: "Arrived",
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {format(parseISO(r.checkIn), "d MMM")}
              </span>
            ),
          },
          {
            header: "Nights",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.nights}</span>,
          },
          {
            header: "Charged",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{formatMoney(r.chargesCents)}</span>,
            foot: formatMoney(charges),
          },
          {
            header: "Paid",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{formatMoney(r.paymentsCents)}</span>,
            foot: formatMoney(payments),
          },
          {
            header: "Outstanding",
            align: "right",
            cell: (r) => (
              <span
                className={
                  r.outstandingCents > 0
                    ? "font-medium text-rose-600"
                    : "text-ink-faint"
                }
              >
                {r.outstandingCents === 0 ? "Settled" : formatMoney(r.outstandingCents)}
              </span>
            ),
            foot: formatMoney(outstanding),
          },
        ]}
      />
    </ReportShell>
  );
}
