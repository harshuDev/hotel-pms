import { addDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import { getBusinessDate, getReservationsReport } from "@/lib/queries";
import type { ReservationsRow } from "@/lib/types";

export const metadata = { title: "Reservations report" };

/** Forward-looking by default: the question is what is coming, not what went. */
const FORWARD_DAYS = 28;

export default async function ReservationsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = sp.from || sp.to
    ? reportRange(businessDate, sp.from, sp.to)
    : {
        from: businessDate,
        // addDays, not millisecond arithmetic: a DST boundary inside the
        // window would otherwise shift the end date by a day twice a year.
        to: format(addDays(parseISO(businessDate), FORWARD_DAYS - 1), "yyyy-MM-dd"),
      };

  const rows = await getReservationsReport(range.from, range.to);

  const bookings = rows.reduce((s, r) => s + r.bookingCount, 0);
  const pending = rows.reduce((s, r) => s + r.pendingCount, 0);
  const rooms = rows.reduce((s, r) => s + r.roomCount, 0);
  const roomNights = rows.reduce((s, r) => s + r.roomNights, 0);
  const guests = rows.reduce((s, r) => s + r.adults + r.children, 0);
  const value = rows.reduce((s, r) => s + r.valueCents, 0);
  const busiest = rows.reduce<ReservationsRow | null>(
    (best, r) => (best === null || r.roomCount > best.roomCount ? r : best),
    null,
  );

  return (
    <ReportShell
      title="Reservations"
      action="/reports/reservations"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Arrivals expected"
          value={String(bookings)}
          detail={pending > 0 ? `${pending} still pending` : "All confirmed"}
        />
        <ReportFigure
          label="Rooms"
          value={String(rooms)}
          detail={`${roomNights} room night${roomNights === 1 ? "" : "s"}`}
        />
        <ReportFigure label="Guests" value={String(guests)} detail="Adults and children" />
        <ReportFigure
          label="Value"
          value={formatMoneyShort(value)}
          detail={
            busiest && busiest.roomCount > 0
              ? `Busiest ${format(parseISO(busiest.arrivalDate), "EEE d MMM")}`
              : undefined
          }
          emphasis
        />
      </ReportFigures>

      <ReportTable<ReservationsRow>
        rows={rows}
        rowKey={(r) => r.arrivalDate}
        minWidth="800px"
        emptyTitle="No days in this range"
        emptyHint="Widen the dates, or check that the range runs forwards."
        footLabel={`${rows.length} day${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Arrival",
            cell: (r) => (
              <span
                className={cn(
                  "whitespace-nowrap",
                  r.bookingCount > 0 ? "text-ink" : "text-ink-faint",
                )}
              >
                {format(parseISO(r.arrivalDate), "EEE d MMM")}
              </span>
            ),
          },
          {
            header: "Bookings",
            align: "right",
            cell: (r) => (
              <span className={r.bookingCount > 0 ? "text-ink-muted" : "text-ink-faint"}>
                {r.bookingCount || "—"}
              </span>
            ),
            foot: String(bookings),
          },
          {
            header: "Pending",
            align: "right",
            cell: (r) => (
              <span className={r.pendingCount > 0 ? "text-warn-deep" : "text-ink-faint"}>
                {r.pendingCount || "—"}
              </span>
            ),
            foot: pending === 0 ? "—" : String(pending),
          },
          {
            header: "Rooms",
            align: "right",
            cell: (r) => (
              <span className={r.roomCount > 0 ? "text-ink-muted" : "text-ink-faint"}>
                {r.roomCount || "—"}
              </span>
            ),
            foot: String(rooms),
          },
          {
            header: "Adults",
            align: "right",
            cell: (r) => (
              <span className="text-ink-faint">{r.adults || "—"}</span>
            ),
          },
          {
            header: "Children",
            align: "right",
            cell: (r) => (
              <span className="text-ink-faint">{r.children || "—"}</span>
            ),
          },
          {
            header: "Room nights",
            align: "right",
            cell: (r) => (
              <span className={r.roomNights > 0 ? "text-ink-muted" : "text-ink-faint"}>
                {r.roomNights || "—"}
              </span>
            ),
            foot: String(roomNights),
          },
          {
            header: "Value",
            align: "right",
            cell: (r) => (
              <span className={r.valueCents > 0 ? "font-medium text-ink" : "text-ink-faint"}>
                {r.valueCents === 0 ? "—" : formatMoney(r.valueCents)}
              </span>
            ),
            foot: formatMoney(value),
          },
        ]}
      />
    </ReportShell>
  );
}
