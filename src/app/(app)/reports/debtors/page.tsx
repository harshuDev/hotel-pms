import { format, parseISO } from "date-fns";
import { EmptyState, StatusBadge, cn } from "@/components/ui";
import { ReportShell } from "@/components/reports/report-shell";
import { formatMoney } from "@/lib/money";
import { getDebtorsReport } from "@/lib/queries";

export const metadata = { title: "Debtors report" };

export default async function DebtorsReportPage() {
  const rows = await getDebtorsReport();
  const total = rows.reduce((sum, r) => sum + r.outstandingCents, 0);

  return (
    <ReportShell
      title="Debtors"
    >
      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        {rows.length === 0 ? (
          <EmptyState
            title="Nobody owes anything"
            hint="Every folio with a balance appears here, for room bookings and meeting rooms alike."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {[
                      "Booking",
                      "Kind",
                      "Status",
                      "Last day",
                      "Overdue",
                      "Charges",
                      "Paid",
                      "Outstanding",
                    ].map((c, i) => (
                      <th
                        key={c}
                        className={cn(
                          "whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                          i >= 4 && "text-right",
                        )}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.bookingId} className="hover:bg-shell">
                      <td className="whitespace-nowrap px-3 py-3 font-medium text-ink">
                        {r.reference}
                        <span className="block text-xxs font-normal text-ink-faint">
                          {r.customerName}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-xxs font-medium ring-1 ring-inset",
                            r.kind === "meeting_room"
                              ? "bg-chrome-900/5 text-chrome-800 ring-chrome-800/20"
                              : "bg-shell text-ink-muted ring-line",
                          )}
                        >
                          {r.kind === "meeting_room" ? "Meeting room" : "Room"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-muted">
                        {format(parseISO(r.checkOut), "d MMM yyyy")}
                      </td>
                      <td
                        className={cn(
                          "tnum px-3 py-3 text-right",
                          r.daysOverdue > 0
                            ? "font-medium text-warn-deep"
                            : "text-ink-faint",
                        )}
                      >
                        {r.daysOverdue > 0 ? `${r.daysOverdue}d` : "—"}
                      </td>
                      <td className="tnum whitespace-nowrap px-3 py-3 text-right text-ink-muted">
                        {formatMoney(r.chargesCents)}
                      </td>
                      <td className="tnum whitespace-nowrap px-3 py-3 text-right text-ink-muted">
                        {formatMoney(r.paymentsCents)}
                      </td>
                      <td className="tnum whitespace-nowrap px-3 py-3 text-right font-medium text-rose-600">
                        {formatMoney(r.outstandingCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-strong">
                    <td colSpan={7} className="px-3 pt-3 text-right font-medium text-ink">
                      {rows.length} booking{rows.length === 1 ? "" : "s"} owing
                    </td>
                    <td className="tnum whitespace-nowrap px-3 pt-3 text-right font-semibold text-rose-600">
                      {formatMoney(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </ReportShell>
  );
}
