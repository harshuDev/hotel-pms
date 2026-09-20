import { format, parseISO } from "date-fns";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import { ReportAccessError, getBusinessDate, getManagerReport } from "@/lib/queries";
import type { ManagerRow } from "@/lib/types";

export const metadata = { title: "Manager report" };

/**
 * The page a general manager opens first: how full, at what rate, how much was
 * earned and how much of it was collected.
 *
 * Nothing here is computed in this file. Every figure comes out of
 * `manager_report()`, which works each one out the same way the report it
 * belongs to works it out — so this page and the occupancy report cannot drift
 * apart, which is the usual fate of a summary screen.
 */
export default async function ManagerReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: ManagerRow[];
  try {
    rows = await getManagerReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Manager" >
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const roomsSold = rows.reduce((s, r) => s + r.roomsSold, 0);
  const roomRevenue = rows.reduce((s, r) => s + r.roomRevenueCents, 0);
  const otherRevenue = rows.reduce((s, r) => s + r.otherRevenueCents, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenueCents, 0);
  const payments = rows.reduce((s, r) => s + r.paymentsCents, 0);
  const arrivals = rows.reduce((s, r) => s + r.arrivals, 0);
  const departures = rows.reduce((s, r) => s + r.departures, 0);
  const sellable = rows[0]?.sellableRooms ?? 0;
  const nights = rows.length;

  // Averaged over the range rather than averaging the daily averages: a day
  // that sold two rooms should not weigh the same as one that sold ninety.
  const adr = roomsSold > 0 ? Math.round(roomRevenue / roomsSold) : 0;
  const revpar =
    sellable > 0 && nights > 0 ? Math.round(roomRevenue / (sellable * nights)) : 0;
  const occupancy =
    sellable > 0 && nights > 0
      ? Math.round((roomsSold / (sellable * nights)) * 1000) / 10
      : 0;

  return (
    <ReportShell
      title="Manager"
      action="/reports/manager"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Occupancy"
          value={`${occupancy}%`}
          detail={`${roomsSold} of ${sellable * nights} room nights`}
          emphasis
        />
        <ReportFigure label="ADR" value={formatMoneyShort(adr)} detail="Per room sold" />
        <ReportFigure
          label="RevPAR"
          value={formatMoneyShort(revpar)}
          detail="Per room available"
        />
        <ReportFigure
          label="Revenue"
          value={formatMoneyShort(totalRevenue)}
          detail={`${formatMoneyShort(roomRevenue)} rooms, ${formatMoneyShort(otherRevenue)} other`}
        />
      </ReportFigures>

      <ReportTable<ManagerRow>
        rows={rows}
        rowKey={(r) => r.businessDate}
        minWidth="980px"
        emptyTitle="Nothing happened in this range"
        emptyHint="Pick a range that covers dates the hotel has traded."
        footLabel={`${nights} night${nights === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Date",
            cell: (r) => (
              <span className="whitespace-nowrap font-medium text-ink">
                {format(parseISO(r.businessDate), "EEE d MMM")}
              </span>
            ),
          },
          {
            header: "Sold",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{r.roomsSold}</span>,
            foot: String(roomsSold),
          },
          {
            header: "Occ",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{r.occupancyPct}%</span>,
            foot: `${occupancy}%`,
          },
          {
            header: "ADR",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.adrCents)}</span>,
            foot: formatMoney(adr),
          },
          {
            header: "RevPAR",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.revparCents)}</span>,
            foot: formatMoney(revpar),
          },
          {
            header: "Rooms",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.roomRevenueCents)}</span>,
            foot: formatMoney(roomRevenue),
          },
          {
            header: "Other",
            align: "right",
            cell: (r) => <span className="tnum text-ink-faint">{formatMoney(r.otherRevenueCents)}</span>,
            foot: formatMoney(otherRevenue),
          },
          {
            header: "Total",
            align: "right",
            cell: (r) => (
              <span className="tnum font-medium text-ink">
                {formatMoney(r.totalRevenueCents)}
              </span>
            ),
            foot: formatMoney(totalRevenue),
          },
          {
            header: "Collected",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.paymentsCents)}</span>,
            foot: formatMoney(payments),
          },
          {
            header: "In / out",
            align: "right",
            cell: (r) => (
              <span className="tnum text-ink-faint">
                {r.arrivals} / {r.departures}
              </span>
            ),
            foot: `${arrivals} / ${departures}`,
          },
        ]}
      />
    </ReportShell>
  );
}
