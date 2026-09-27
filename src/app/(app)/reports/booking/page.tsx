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
import {
  getBookingByChannel,
  getBookingReport,
  getBusinessDate,
} from "@/lib/queries";
import type { BookingProductionRow, ChannelProductionRow } from "@/lib/types";
import { getPropertyCurrency } from "@/lib/queries";

export const metadata = { title: "Booking report" };

export default async function BookingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const tr = await getT();
  const currency = await getPropertyCurrency();
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  const [rows, byChannel] = await Promise.all([
    getBookingReport(range.from, range.to),
    getBookingByChannel(range.from, range.to),
  ]);

  const value = rows.reduce((s, r) => s + r.valueCents, 0);
  const roomNights = rows.reduce((s, r) => s + r.roomNights, 0);
  const lost = rows.filter(
    (r) => r.status === "canceled" || r.status === "no_show",
  ).length;
  const channelValue = byChannel.reduce((s, r) => s + r.valueCents, 0);

  return (
    <ReportShell
      title={tr("Booking")}
      action="/reports/booking"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label={tr("Bookings taken")}
          value={String(rows.length)}
          detail={lost > 0 ? tr("{lost} since cancelled", { lost: lost }) : tr("None cancelled")}
        />
        <ReportFigure label={tr("Room nights")} value={String(roomNights)} />
        <ReportFigure
          label={tr("Value")}
          value={formatMoneyShort(value, currency)}
          detail={tr("Rate less discount, before tax")}
          emphasis
        />
        <ReportFigure
          label={tr("Average booking")}
          value={rows.length > 0 ? formatMoney(Math.round(value / rows.length), currency) : "—"}
        />
      </ReportFigures>

      <div className="mb-3">
        <ReportTable<ChannelProductionRow>
          rows={byChannel}
          rowKey={(r) => r.channelName}
          minWidth="620px"
          emptyTitle={tr("No bookings were taken in this range")}
          emptyHint={tr("Widen the dates, or take a booking.")}
          footLabel={`${byChannel.length} channel${byChannel.length === 1 ? "" : "s"}`}
          columns={[
            {
              header: tr("Channel"),
              cell: (r) => <span className="font-medium text-ink">{r.channelName}</span>,
            },
            {
              header: tr("Kind"),
              cell: (r) => (
                <span className="text-ink-faint">{r.channelKind ?? "—"}</span>
              ),
            },
            {
              header: tr("Bookings"),
              align: "right",
              cell: (r) => <span className="text-ink-muted">{r.bookingCount}</span>,
            },
            {
              header: tr("Cancelled"),
              align: "right",
              cell: (r) => (
                <span className={r.canceledCount > 0 ? "text-warn-deep" : "text-ink-faint"}>
                  {r.canceledCount > 0 ? r.canceledCount : "—"}
                </span>
              ),
            },
            {
              header: tr("Room nights"),
              align: "right",
              cell: (r) => <span className="text-ink-muted">{r.roomNights}</span>,
            },
            {
              header: tr("Value"),
              align: "right",
              cell: (r) => (
                <span className="font-medium text-ink">{formatMoney(r.valueCents, currency)}</span>
              ),
              foot: formatMoney(channelValue, currency),
            },
          ]}
        />
      </div>

      <ReportTable<BookingProductionRow>
        rows={rows}
        rowKey={(r) => r.bookingId}
        minWidth="900px"
        emptyTitle={tr("No bookings were taken in this range")}
        emptyHint={tr("Widen the dates, or take a booking.")}
        footLabel={`${rows.length} booking${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: tr("Booked"),
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {tr.date(r.bookedOn, "d MMM")}
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
            header: tr("Arrival"),
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
            header: tr("Rooms"),
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.roomCount}</span>,
          },
          {
            header: tr("Value"),
            align: "right",
            cell: (r) => (
              <span className="font-medium text-ink">{formatMoney(r.valueCents, currency)}</span>
            ),
            foot: formatMoney(value, currency),
          },
        ]}
      />
    </ReportShell>
  );
}
