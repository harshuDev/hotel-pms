import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import { getBusinessDate, getChannelReport } from "@/lib/queries";
import type { ChannelRevenueRow } from "@/lib/types";

export const metadata = { title: "Channel report" };

export default async function ChannelReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  const rows = await getChannelReport(range.from, range.to);

  const revenue = rows.reduce((s, r) => s + r.roomRevenueCents, 0);
  const commission = rows.reduce((s, r) => s + r.commissionCents, 0);
  const net = rows.reduce((s, r) => s + r.netRevenueCents, 0);
  const roomNights = rows.reduce((s, r) => s + r.roomNights, 0);
  const direct = rows
    .filter((r) => r.channelKind === "direct")
    .reduce((s, r) => s + r.roomRevenueCents, 0);

  return (
    <ReportShell
      title="Channel"
      action="/reports/channel"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Room revenue"
          value={formatMoneyShort(revenue)}
          detail={`${roomNights} room night${roomNights === 1 ? "" : "s"}`}
        />
        <ReportFigure
          label="Commission"
          value={formatMoneyShort(commission)}
          detail="What the channels are owed"
        />
        <ReportFigure
          label="Net to the hotel"
          value={formatMoneyShort(net)}
          emphasis
        />
        <ReportFigure
          label="Direct share"
          value={revenue > 0 ? `${Math.round((direct / revenue) * 100)}%` : "—"}
          detail="Revenue booked with no commission"
        />
      </ReportFigures>

      <ReportTable<ChannelRevenueRow>
        rows={rows}
        rowKey={(r) => r.channelName}
        minWidth="820px"
        emptyTitle="Nothing was stayed in this range"
        emptyHint="Room nights are counted against the nights stayed, so widen the dates."
        footLabel={`${rows.length} channel${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Channel",
            cell: (r) => <span className="font-medium text-ink">{r.channelName}</span>,
          },
          {
            header: "Kind",
            cell: (r) => <span className="text-ink-faint">{r.channelKind ?? "—"}</span>,
          },
          {
            header: "Rate",
            align: "right",
            cell: (r) => (
              <span className="text-ink-faint">
                {r.commissionBps === 0 ? "—" : `${(r.commissionBps / 100).toFixed(2)}%`}
              </span>
            ),
          },
          {
            header: "Bookings",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.bookingCount}</span>,
          },
          {
            header: "Room nights",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.roomNights}</span>,
            foot: String(roomNights),
          },
          {
            header: "Room revenue",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{formatMoney(r.roomRevenueCents)}</span>,
            foot: formatMoney(revenue),
          },
          {
            header: "Commission",
            align: "right",
            cell: (r) => (
              <span className={r.commissionCents > 0 ? "text-warn-deep" : "text-ink-faint"}>
                {r.commissionCents === 0 ? "—" : formatMoney(r.commissionCents)}
              </span>
            ),
            foot: formatMoney(commission),
          },
          {
            header: "Net",
            align: "right",
            cell: (r) => (
              <span className="font-medium text-ink">{formatMoney(r.netRevenueCents)}</span>
            ),
            foot: formatMoney(net),
          },
        ]}
      />
    </ReportShell>
  );
}
