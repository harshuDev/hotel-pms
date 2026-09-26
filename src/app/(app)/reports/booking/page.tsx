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
      title="Booking"
      action="/reports/booking"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Bookings taken"
          value={String(rows.length)}
          detail={lost > 0 ? `${lost} since cancelled` : "None cancelled"}
        />
        <ReportFigure label="Room nights" value={String(roomNights)} />
        <ReportFigure
          label="Value"
          value={formatMoneyShort(value, currency)}
          detail="Rate less discount, before tax"
          emphasis
        />
        <ReportFigure
          label="Average booking"
          value={rows.length > 0 ? formatMoney(Math.round(value / rows.length), currency) : "—"}
        />
      </ReportFigures>

      <div className="mb-3">
        <ReportTable<ChannelProductionRow>
          rows={byChannel}
          rowKey={(r) => r.channelName}
          minWidth="620px"
          emptyTitle="No bookings were taken in this range"
          emptyHint="Widen the dates, or take a booking."
          footLabel={`${byChannel.length} channel${byChannel.length === 1 ? "" : "s"}`}
          columns={[
            {
              header: "Channel",
              cell: (r) => <span className="font-medium text-ink">{r.channelName}</span>,
            },
            {
              header: "Kind",
              cell: (r) => (
                <span className="text-ink-faint">{r.channelKind ?? "—"}</span>
              ),
            },
            {
              header: "Bookings",
              align: "right",
              cell: (r) => <span className="text-ink-muted">{r.bookingCount}</span>,
            },
            {
              header: "Cancelled",
              align: "right",
              cell: (r) => (
                <span className={r.canceledCount > 0 ? "text-warn-deep" : "text-ink-faint"}>
                  {r.canceledCount > 0 ? r.canceledCount : "—"}
                </span>
              ),
            },
            {
              header: "Room nights",
              align: "right",
              cell: (r) => <span className="text-ink-muted">{r.roomNights}</span>,
            },
            {
              header: "Value",
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
        emptyTitle="No bookings were taken in this range"
        emptyHint="Widen the dates, or take a booking."
        footLabel={`${rows.length} booking${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Booked",
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {format(parseISO(r.bookedOn), "d MMM")}
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
            header: "Arrival",
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
            header: "Rooms",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.roomCount}</span>,
          },
          {
            header: "Value",
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
