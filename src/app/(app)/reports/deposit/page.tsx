import { getT } from "@/lib/i18n/server";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import { ReportFigure, ReportFigures, ReportShell } from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { ReportAccessError, getDepositReport } from "@/lib/queries";
import type { DepositRow } from "@/lib/types";
import { getPropertyCurrency } from "@/lib/queries";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Deposit report"));

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
  const tr = await getT();
  const currency = await getPropertyCurrency();
  let rows: DepositRow[];
  try {
    rows = await getDepositReport();
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title={tr("Deposits")}>
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
      title={tr("Deposits")}
    >
      <ReportFigures>
        <ReportFigure
          label={tr("Held")}
          value={formatMoneyShort(held, currency)}
          detail={tr.plural(rows.length, "Across {n} booking", "Across {n} bookings")}
          emphasis
        />
        <ReportFigure
          label={tr("Stay value")}
          value={formatMoneyShort(value, currency)}
          detail={tr("What those stays are worth")}
        />
        <ReportFigure
          label={tr("Arriving within a week")}
          value={String(arrivingSoon)}
          detail={tr("Of the bookings holding a deposit")}
        />
      </ReportFigures>

      <ReportTable<DepositRow>
        rows={rows}
        rowKey={(r) => r.bookingId}
        minWidth="900px"
        emptyTitle={tr("No deposits are being held")}
        emptyHint={tr("A booking appears here once a payment is taken against it and before the guest checks in.")}
        footLabel={tr.plural(rows.length, "{n} booking", "{n} bookings")}
        columns={[
          {
            header: tr("Reference"),
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
            header: tr("Guest"),
            cell: (r) => <span className="text-ink-muted">{r.guestName}</span>,
          },
          {
            header: tr("Status"),
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
            header: tr("Arrives"),
            cell: (r) => (
              <span className="tnum whitespace-nowrap text-ink-muted">
                {tr.date(r.checkIn, "EEE d MMM")}
              </span>
            ),
          },
          {
            header: tr("In"),
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
                  ? tr("{abs}d ago", { abs: Math.abs(r.daysToArrival) })
                  : tr("{n}d", { n: r.daysToArrival })}
              </span>
            ),
          },
          {
            header: tr("Nights"),
            align: "right",
            cell: (r) => <span className="tnum text-ink-faint">{r.nights}</span>,
          },
          {
            header: tr("Stay value"),
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.stayValueCents, currency)}</span>,
            foot: formatMoney(value, currency),
          },
          {
            header: tr("Held"),
            align: "right",
            cell: (r) => (
              <span className="tnum font-medium text-ink">{formatMoney(r.depositCents, currency)}</span>
            ),
            foot: formatMoney(held, currency),
          },
        ]}
      />
    </ReportShell>
  );
}
