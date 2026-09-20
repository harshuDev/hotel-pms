import { format, parseISO } from "date-fns";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import type { InHouseRow } from "@/lib/types";
import { ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { getBusinessDate, getInHouseReport } from "@/lib/queries";

export const metadata = { title: "In house report" };

export default async function InHouseReportPage() {
  // Not behind the money gate: knowing who is in which room is an operational
  // question every role needs answered, housekeeping included.
  const [businessDate, rows] = await Promise.all([
    getBusinessDate(),
    getInHouseReport(),
  ]);

  const guests = rows.reduce((s, r) => s + r.adults + r.children, 0);
  const owing = rows.reduce((s, r) => s + r.balanceCents, 0);
  const dueOut = rows.filter((r) => r.nightsLeft === 0).length;
  const unassigned = rows.filter((r) => r.roomNumber === null).length;

  return (
    <ReportShell
      title="In house"
      date={businessDate}
    >
      <ReportFigures>
        <ReportFigure
          label="Rooms occupied"
          value={String(rows.length)}
          detail={unassigned > 0 ? `${unassigned} with no room assigned` : undefined}
        />
        <ReportFigure label="Guests" value={String(guests)} detail="Adults and children" />
        <ReportFigure
          label="Due out tomorrow"
          value={String(dueOut)}
          detail={dueOut === 0 ? "Nobody leaving" : undefined}
        />
        <ReportFigure
          label="Owed by the house"
          value={formatMoneyShort(owing)}
          detail="Across every folio on these bookings"
          emphasis
        />
      </ReportFigures>

      <ReportTable<InHouseRow>
        rows={rows}
        rowKey={(r) => `${r.bookingId}-${r.roomNumber ?? "none"}`}
        minWidth="900px"
        emptyTitle="Nobody is in house tonight"
        emptyHint="Guests appear here once they are checked in against the open business date."
        footLabel={`${rows.length} room${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Room",
            cell: (r) => (
              <>
                <span className="tnum font-medium text-ink">
                  {r.roomNumber ?? "Not assigned"}
                </span>
                <span className="block text-xxs text-ink-faint">{r.roomTypeName}</span>
              </>
            ),
          },
          {
            header: "Guest",
            cell: (r) => (
              <>
                <span className="text-ink">{r.guestName}</span>
                <span className="block text-xxs text-ink-faint">{r.reference}</span>
              </>
            ),
          },
          {
            header: "Channel",
            cell: (r) => <span className="text-ink-faint">{r.channelName ?? "—"}</span>,
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
            header: "Departs",
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {format(parseISO(r.checkOut), "d MMM")}
              </span>
            ),
          },
          {
            header: "Stayed",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.nightsStayed}</span>,
          },
          {
            header: "Left",
            align: "right",
            cell: (r) => (
              <span className={r.nightsLeft === 0 ? "font-medium text-warn-deep" : "text-ink-muted"}>
                {r.nightsLeft === 0 ? "Due out" : r.nightsLeft}
              </span>
            ),
          },
          {
            header: "Guests",
            align: "right",
            cell: (r) => (
              <span className="text-ink-faint">
                {r.adults}
                {r.children > 0 ? ` + ${r.children}` : ""}
              </span>
            ),
          },
          {
            header: "Balance",
            align: "right",
            cell: (r) => (
              <span
                className={
                  r.balanceCents > 0 ? "font-medium text-rose-600" : "text-ink-faint"
                }
              >
                {r.balanceCents === 0 ? "Settled" : formatMoney(r.balanceCents)}
              </span>
            ),
            foot: formatMoney(owing),
          },
        ]}
      />
    </ReportShell>
  );
}
