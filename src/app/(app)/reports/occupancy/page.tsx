import { format, parseISO } from "date-fns";
import { EmptyState, cn } from "@/components/ui";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import {
  getBusinessDate,
  getOccupancyReport,
  getOccupancySummary,
} from "@/lib/queries";

export const metadata = { title: "Occupancy report" };

export default async function OccupancyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  const [rows, summary] = await Promise.all([
    getOccupancyReport(range.from, range.to),
    getOccupancySummary(range.from, range.to),
  ]);

  return (
    <ReportShell
      title="Occupancy"
      subtitle="Rooms sold, ADR and RevPAR, night by night"
      action="/reports/occupancy"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Occupancy"
          value={`${summary.occupancyPct}%`}
          detail={`${summary.roomsSold} of ${summary.roomNightsAvailable} room nights`}
        />
        <ReportFigure
          label="Room revenue"
          value={formatMoneyShort(summary.roomRevenueCents)}
          detail="Rate less discount, excluding tax"
        />
        <ReportFigure
          label="ADR"
          value={formatMoney(summary.adrCents)}
          detail="Revenue over rooms sold"
          emphasis
        />
        <ReportFigure
          label="RevPAR"
          value={formatMoney(summary.revparCents)}
          detail="Revenue over rooms available"
        />
      </ReportFigures>

      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        {rows.length === 0 ? (
          <EmptyState
            title="No nights in this range"
            hint="Widen the dates, or check that the range runs forwards."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  {[
                    "Night",
                    "Rooms sold",
                    "Sellable",
                    "Occupancy",
                    "Room revenue",
                    "ADR",
                    "RevPAR",
                  ].map((c, i) => (
                    <th
                      key={c}
                      className={cn(
                        "whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                        i >= 1 && "text-right",
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.date} className="hover:bg-shell">
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink">
                      {format(parseISO(r.date), "EEE d MMM")}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-muted">
                      {r.roomsSold}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-faint">
                      {r.sellableRooms}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-muted">
                      {r.occupancyPct}%
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-ink">
                      {formatMoney(r.roomRevenueCents)}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-ink-muted">
                      {formatMoney(r.adrCents)}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-ink-muted">
                      {formatMoney(r.revparCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          Sellable is the number of rooms not currently out of order, so taking
          a room out of service today changes the occupancy shown for past
          nights too. ADR for the period is total revenue over total rooms
          sold, which is not the same as averaging the nightly figures above.
        </p>
      </div>
    </ReportShell>
  );
}
