import { format, parseISO } from "date-fns";
import { StatusBadge } from "@/components/ui";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import { getBusinessDate, getCancellationReport } from "@/lib/queries";
import type { CancellationRow } from "@/lib/types";

export const metadata = { title: "Cancellation report" };

export default async function CancellationReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  const rows = await getCancellationReport(range.from, range.to);

  const lost = rows.reduce((s, r) => s + r.lostValueCents, 0);
  const roomNights = rows.reduce((s, r) => s + r.roomNights, 0);
  const noShows = rows.filter((r) => r.status === "no_show").length;

  return (
    <ReportShell
      title="Cancellation"
      action="/reports/cancellation"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Lost arrivals"
          value={String(rows.length)}
          detail={
            noShows > 0
              ? `${noShows} no show${noShows === 1 ? "" : "s"}`
              : "No no-shows"
          }
        />
        <ReportFigure label="Room nights lost" value={String(roomNights)} />
        <ReportFigure
          label="Value lost"
          value={formatMoneyShort(lost)}
          detail="Rate less discount, before tax"
          emphasis
        />
      </ReportFigures>

      <ReportTable<CancellationRow>
        rows={rows}
        rowKey={(r) => r.bookingId}
        minWidth="920px"
        emptyTitle="Nothing was cancelled for these arrival dates"
        emptyHint="Cancellations and no-shows appear here against the date they were due to arrive."
        footLabel={`${rows.length} booking${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Arrival",
            cell: (r) => (
              <span className="whitespace-nowrap text-ink">
                {format(parseISO(r.checkIn), "d MMM yyyy")}
              </span>
            ),
          },
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
            header: "Status",
            cell: (r) => <StatusBadge status={r.status} />,
          },
          {
            header: "Channel",
            cell: (r) => (
              <span className="text-ink-faint">{r.channelName ?? "—"}</span>
            ),
          },
          {
            header: "Booked",
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {format(parseISO(r.bookedOn), "d MMM")}
              </span>
            ),
          },
          {
            header: "Cancelled",
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {r.cancelledOn
                  ? format(parseISO(r.cancelledOn), "d MMM")
                  : "Not recorded"}
              </span>
            ),
          },
          {
            header: "Nights",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.nights}</span>,
          },
          {
            header: "Rooms",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.roomCount}</span>,
          },
          {
            header: "Value lost",
            align: "right",
            cell: (r) => (
              <span className="font-medium text-warn-deep">
                {formatMoney(r.lostValueCents)}
              </span>
            ),
            foot: formatMoney(lost),
          },
        ]}
      />
    </ReportShell>
  );
}
