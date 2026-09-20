import { format, parseISO } from "date-fns";
import Link from "next/link";
import { ReportFigure, ReportFigures, ReportShell } from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { ReportAccessError, getDepositReport } from "@/lib/queries";
import type { DepositRow } from "@/lib/types";

export const metadata = { title: "Deposit report" };

/**
 * Money the hotel is holding against stays that have not happened.
 *
 * NO DATE RANGE, deliberately. A deposit is held as of now; a range over it
 * would answer a question nobody asks and invite the reading that the figure is
 * historic.
 *
 * Nothing is flagged as a deposit in the schema and this does not add a flag: a
 * deposit is any payment taken before the guest arrives, which is a fact about
 * the booking's status rather than about the money. A column would be a second
 * thing to set correctly and a new way for this and the drawer to disagree.
 */
export default async function DepositReportPage() {
  let rows: DepositRow[];
  try {
    rows = await getDepositReport();
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Deposits" >
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const held = rows.reduce((s, r) => s + r.depositCents, 0);
  const value = rows.reduce((s, r) => s + r.stayValueCents, 0);
  const arrivingSoon = rows.filter((r) => r.daysToArrival <= 7).length;

  return (
    <ReportShell
      title="Deposits"
    >
      <ReportFigures>
        <ReportFigure
          label="Held"
          value={formatMoneyShort(held)}
          detail={`Across ${rows.length} booking${rows.length === 1 ? "" : "s"}`}
          emphasis
        />
        <ReportFigure
          label="Stay value"
          value={formatMoneyShort(value)}
          detail="What those stays are worth"
        />
        <ReportFigure
          label="Arriving within a week"
          value={String(arrivingSoon)}
          detail="Of the bookings holding a deposit"
        />
      </ReportFigures>

      <ReportTable<DepositRow>
        rows={rows}
        rowKey={(r) => r.bookingId}
        minWidth="900px"
        emptyTitle="No deposits are being held"
        emptyHint="A booking appears here once a payment is taken against it and before the guest checks in."
        footLabel={`${rows.length} booking${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Reference",
            cell: (r) => (
              <Link
                href={`/bookings/${r.bookingId}`}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                {r.reference}
              </Link>
            ),
          },
          {
            header: "Guest",
            cell: (r) => <span className="text-ink-muted">{r.guestName}</span>,
          },
          {
            header: "Status",
            cell: (r) => (
              <span
                className={
                  r.status === "pending" ? "text-warn-deep" : "text-ink-muted"
                }
              >
                {r.status}
              </span>
            ),
          },
          {
            header: "Arrives",
            cell: (r) => (
              <span className="tnum whitespace-nowrap text-ink-muted">
                {format(parseISO(r.checkIn), "EEE d MMM")}
              </span>
            ),
          },
          {
            header: "In",
            align: "right",
            cell: (r) => (
              <span
                className={
                  r.daysToArrival < 0
                    ? "tnum text-rose-600"
                    : r.daysToArrival <= 7
                      ? "tnum text-warn-deep"
                      : "tnum text-ink-faint"
                }
              >
                {r.daysToArrival < 0
                  ? `${Math.abs(r.daysToArrival)}d ago`
                  : `${r.daysToArrival}d`}
              </span>
            ),
          },
          {
            header: "Nights",
            align: "right",
            cell: (r) => <span className="tnum text-ink-faint">{r.nights}</span>,
          },
          {
            header: "Stay value",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.stayValueCents)}</span>,
            foot: formatMoney(value),
          },
          {
            header: "Held",
            align: "right",
            cell: (r) => (
              <span className="tnum font-medium text-ink">{formatMoney(r.depositCents)}</span>
            ),
            foot: formatMoney(held),
          },
        ]}
      />
    </ReportShell>
  );
}
