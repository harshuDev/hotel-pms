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
      subtitle="Bookings with money still owed, largest first"
    >
      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        {rows.length === 0 ? (
          <EmptyState
            title="Nobody owes anything"
            hint="Every folio with a balance would appear here."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {[
                      "Booking",
                      "Status",
                      "Departure",
                      "Overdue",
                      "Charges",
                      "Paid",
                      "Outstanding",
                    ].map((c, i) => (
                      <th
                        key={c}
                        className={cn(
                          "whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                          i >= 3 && "text-right",
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
                    <td colSpan={6} className="px-3 pt-3 text-right font-medium text-ink">
                      {rows.length} booking{rows.length === 1 ? "" : "s"} owing
                    </td>
                    <td className="tnum whitespace-nowrap px-3 pt-3 text-right font-semibold text-rose-600">
                      {formatMoney(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              Overdue counts from the departure date against the business date,
              so a guest still in house is never late. A booking with several
              folios appears once: it is one debt to chase.
            </p>
          </>
        )}
      </div>
    </ReportShell>
  );
}
