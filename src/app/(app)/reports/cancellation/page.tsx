import { getT } from "@/lib/i18n/server";
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
import { getPropertyCurrency } from "@/lib/queries";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Cancellation report"));

export default async function CancellationReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const tr = await getT();
  const currency = await getPropertyCurrency();
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  const rows = await getCancellationReport(range.from, range.to);

  const lost = rows.reduce((s, r) => s + r.lostValueCents, 0);
  const roomNights = rows.reduce((s, r) => s + r.roomNights, 0);
  const noShows = rows.filter((r) => r.status === "no_show").length;

  return (
    <ReportShell
      title={tr("Cancellation")}
      action="/reports/cancellation"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label={tr("Lost arrivals")}
          value={String(rows.length)}
          detail={
            noShows > 0
              ? tr.plural(noShows, "{n} no show", "{n} no shows")
              : tr("No no-shows")
          }
        />
        <ReportFigure label={tr("Room nights lost")} value={String(roomNights)} />
        <ReportFigure
          label={tr("Value lost")}
          value={formatMoneyShort(lost, currency)}
          detail={tr("Rate less discount, before tax")}
          emphasis
        />
      </ReportFigures>

      <ReportTable<CancellationRow>
        rows={rows}
        rowKey={(r) => r.bookingId}
        minWidth="920px"
        emptyTitle={tr("Nothing was cancelled for these arrival dates")}
        emptyHint={tr("Cancellations and no-shows appear here against the date they were due to arrive.")}
        footLabel={tr.plural(rows.length, "{n} booking", "{n} bookings")}
        columns={[
          {
            header: tr("Arrival"),
            cell: (r) => (
              <span className="whitespace-nowrap text-ink">
                {tr.date(r.checkIn, "d MMM yyyy")}
              </span>
            ),
          },
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
            header: tr("Status"),
            cell: (r) => <StatusBadge status={r.status} />,
          },
          {
            header: tr("Channel"),
            cell: (r) => (
              <span className="text-ink-faint">{r.channelName ?? "—"}</span>
            ),
          },
          {
            header: tr("Booked"),
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {tr.date(r.bookedOn, "d MMM")}
              </span>
            ),
          },
          {
            header: tr("Cancelled"),
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {r.cancelledOn
                  ? tr.date(r.cancelledOn, "d MMM")
                  : tr("Not recorded")}
              </span>
            ),
          },
          {
            header: tr("Nights"),
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.nights}</span>,
          },
          {
            header: tr("Rooms"),
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.roomCount}</span>,
          },
          {
            header: tr("Value lost"),
            align: "right",
            cell: (r) => (
              <span className="font-medium text-warn-deep">
                {formatMoney(r.lostValueCents, currency)}
              </span>
            ),
            foot: formatMoney(lost, currency),
          },
        ]}
      />
    </ReportShell>
  );
}
