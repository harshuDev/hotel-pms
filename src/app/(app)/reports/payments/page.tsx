import { format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import {
  ReportAccessError,
  getBusinessDate,
  getPaymentsByMethod,
  getPaymentsReport,
} from "@/lib/queries";
import type { PaymentMethodTotal, PaymentRow } from "@/lib/types";

export const metadata = { title: "Payments report" };

export default async function PaymentsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: PaymentRow[];
  let totals: PaymentMethodTotal[];
  try {
    [rows, totals] = await Promise.all([
      getPaymentsReport(range.from, range.to),
      getPaymentsByMethod(range.from, range.to),
    ]);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Payments" subtitle="Every payment taken, by method">
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const net = totals.reduce((sum, t) => sum + t.netCents, 0);
  const drawer = totals
    .filter((t) => t.affectsDrawer)
    .reduce((sum, t) => sum + t.netCents, 0);
  const reversals = totals.reduce((sum, t) => sum + t.reversalCount, 0);

  return (
    <ReportShell
      title="Payments"
      subtitle="Every payment taken, by method and one by one"
      action="/reports/payments"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Taken"
          value={formatMoneyShort(net)}
          detail="Net of reversals"
          emphasis
        />
        <ReportFigure
          label="Through the drawer"
          value={formatMoneyShort(drawer)}
          detail="Methods that move physical cash"
        />
        <ReportFigure
          label="Payments"
          value={String(rows.length - reversals)}
          detail={
            reversals > 0
              ? `${reversals} reversed`
              : "None reversed in this range"
          }
        />
      </ReportFigures>

      <div className="mb-3">
        <ReportTable<PaymentMethodTotal>
          rows={totals}
          rowKey={(t) => t.methodName}
          minWidth="560px"
          emptyTitle="No payments in this range"
          emptyHint="Widen the dates, or take a payment on the cashier screen."
          footLabel={`${totals.length} method${totals.length === 1 ? "" : "s"}`}
          columns={[
            {
              header: "Method",
              cell: (t) => (
                <span className="font-medium text-ink">{t.methodName}</span>
              ),
            },
            {
              header: "Drawer",
              cell: (t) => (
                <span className="text-ink-muted">
                  {t.affectsDrawer ? "Cash" : "Not cash"}
                </span>
              ),
            },
            {
              header: "Payments",
              align: "right",
              cell: (t) => <span className="text-ink-muted">{t.paymentCount}</span>,
            },
            {
              header: "Reversed",
              align: "right",
              cell: (t) => (
                <span
                  className={t.reversalCount > 0 ? "text-warn-deep" : "text-ink-faint"}
                >
                  {t.reversalCount > 0 ? t.reversalCount : "—"}
                </span>
              ),
            },
            {
              header: "Net taken",
              align: "right",
              cell: (t) => (
                <span className="font-medium text-ink">{formatMoney(t.netCents)}</span>
              ),
              foot: formatMoney(net),
            },
          ]}
        />
      </div>

      <ReportTable<PaymentRow>
        rows={rows}
        rowKey={(r) => r.paymentId}
        minWidth="880px"
        emptyTitle="No payments in this range"
        emptyHint="Widen the dates, or take a payment on the cashier screen."
        note={
          <>
            Dated by business date, not by the clock, so a payment taken after
            midnight belongs to the night still open. A reversal is its own row
            and shows as a negative: nothing is edited or deleted once posted.
          </>
        }
        columns={[
          {
            header: "Business date",
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {format(parseISO(r.businessDate), "EEE d MMM")}
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
            header: "Method",
            cell: (r) => (
              <>
                <span className="text-ink-muted">{r.methodName}</span>
                {r.externalReference && (
                  <span className="block text-xxs text-ink-faint">
                    {r.externalReference}
                  </span>
                )}
              </>
            ),
          },
          {
            header: "Taken by",
            cell: (r) => (
              <span className="text-ink-faint">{r.receivedBy ?? "—"}</span>
            ),
          },
          {
            header: "Amount",
            align: "right",
            cell: (r) => (
              <span
                className={cn(
                  "font-medium",
                  r.isReversal ? "text-warn-deep" : "text-ink",
                )}
              >
                {formatMoney(r.amountCents)}
              </span>
            ),
            foot: formatMoney(net),
          },
        ]}
      />
    </ReportShell>
  );
}
