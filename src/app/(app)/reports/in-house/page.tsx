import { getT } from "@/lib/i18n/server";
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
import { getPropertyCurrency } from "@/lib/queries";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("In house report"));

export default async function InHouseReportPage() {
  const tr = await getT();
  const currency = await getPropertyCurrency();
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
      title={tr("In house")}
      date={businessDate}
    >
      <ReportFigures>
        <ReportFigure
          label={tr("Rooms occupied")}
          value={String(rows.length)}
          detail={unassigned > 0 ? tr("{unassigned} with no room assigned", { unassigned: unassigned }) : undefined}
        />
        <ReportFigure label={tr("Guests")} value={String(guests)} detail={tr("Adults and children")} />
        <ReportFigure
          label={tr("Due out tomorrow")}
          value={String(dueOut)}
          detail={dueOut === 0 ? tr("Nobody leaving") : undefined}
        />
        <ReportFigure
          label={tr("Owed by the house")}
          value={formatMoneyShort(owing, currency)}
          detail={tr("Across every folio on these bookings")}
          emphasis
        />
      </ReportFigures>

      <ReportTable<InHouseRow>
        rows={rows}
        rowKey={(r) => `${r.bookingId}-${r.roomNumber ?? "none"}`}
        minWidth="900px"
        emptyTitle={tr("Nobody is in house tonight")}
        emptyHint={tr("Guests appear here once they are checked in against the open business date.")}
        footLabel={tr.plural(rows.length, "{n} room", "{n} rooms")}
        columns={[
          {
            header: tr("Room"),
            cell: (r) => (
              <>
                <span className="tnum font-medium text-ink">
                  {r.roomNumber ?? tr("Not assigned")}
                </span>
                <span className="block text-xxs text-ink-faint">{r.roomTypeName}</span>
              </>
            ),
          },
          {
            header: tr("Guest"),
            cell: (r) => (
              <>
                <span className="text-ink">{r.guestName}</span>
                <span className="block text-xxs text-ink-faint">{r.reference}</span>
              </>
            ),
          },
          {
            header: tr("Channel"),
            cell: (r) => <span className="text-ink-faint">{r.channelName ?? "—"}</span>,
          },
          {
            header: tr("Arrived"),
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {tr.date(r.checkIn, "d MMM")}
              </span>
            ),
          },
          {
            header: tr("Departs"),
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {tr.date(r.checkOut, "d MMM")}
              </span>
            ),
          },
          {
            header: tr("Stayed"),
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.nightsStayed}</span>,
          },
          {
            header: tr("Left"),
            align: "right",
            cell: (r) => (
              <span className={r.nightsLeft === 0 ? "font-medium text-warn-deep" : "text-ink-muted"}>
                {r.nightsLeft === 0 ? tr("Due out") : r.nightsLeft}
              </span>
            ),
          },
          {
            header: tr("Guests"),
            align: "right",
            cell: (r) => (
              <span className="text-ink-faint">
                {r.adults}
                {r.children > 0 ? ` + ${r.children}` : ""}
              </span>
            ),
          },
          {
            header: tr("Balance"),
            align: "right",
            cell: (r) => (
              <span
                className={
                  r.balanceCents > 0 ? "font-medium text-rose-600" : "text-ink-faint"
                }
              >
                {r.balanceCents === 0 ? tr("Settled") : formatMoney(r.balanceCents, currency)}
              </span>
            ),
            foot: formatMoney(owing, currency),
          },
        ]}
      />
    </ReportShell>
  );
}
