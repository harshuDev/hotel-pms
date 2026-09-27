import { getT } from "@/lib/i18n/server";
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
import { getPropertyCurrency } from "@/lib/queries";

export const metadata = { title: "Payments report" };

export default async function PaymentsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const tr = await getT();
  const currency = await getPropertyCurrency();
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
        <ReportShell title={tr("Payments")}>
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
      title={tr("Payments")}
      action="/reports/payments"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label={tr("Taken")}
          value={formatMoneyShort(net, currency)}
          detail={tr("Net of reversals")}
          emphasis
        />
        <ReportFigure
          label={tr("Through the drawer")}
          value={formatMoneyShort(drawer, currency)}
          detail={tr("Methods that move physical cash")}
        />
        <ReportFigure
          label={tr("Payments")}
          value={String(rows.length - reversals)}
          detail={
            reversals > 0
              ? tr("{reversals} reversed", { reversals: reversals })
              : tr("None reversed in this range")
          }
        />
      </ReportFigures>

      <div className="mb-3">
        <ReportTable<PaymentMethodTotal>
          rows={totals}
          rowKey={(t) => t.methodName}
          minWidth="560px"
          emptyTitle={tr("No payments in this range")}
          emptyHint={tr("Widen the dates, or take a payment on the cashier screen.")}
          footLabel={`${totals.length} method${totals.length === 1 ? "" : "s"}`}
          columns={[
            {
              header: tr("Method"),
              cell: (t) => (
                <span className="font-medium text-ink">{t.methodName}</span>
              ),
            },
            {
              header: tr("Drawer"),
              cell: (t) => (
                <span className="text-ink-muted">
                  {t.affectsDrawer ? tr("Cash") : tr("Not cash")}
                </span>
              ),
            },
            {
              header: tr("Payments"),
              align: "right",
              cell: (t) => <span className="text-ink-muted">{t.paymentCount}</span>,
            },
            {
              header: tr("Reversed"),
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
              header: tr("Net taken"),
              align: "right",
              cell: (t) => (
                <span className="font-medium text-ink">{formatMoney(t.netCents, currency)}</span>
              ),
              foot: formatMoney(net, currency),
            },
          ]}
        />
      </div>

      <ReportTable<PaymentRow>
        rows={rows}
        rowKey={(r) => r.paymentId}
        minWidth="880px"
        emptyTitle={tr("No payments in this range")}
        emptyHint={tr("Widen the dates, or take a payment on the cashier screen.")}
        columns={[
          {
            header: tr("Business date"),
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-muted">
                {tr.date(r.businessDate, "EEE d MMM")}
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
            header: tr("Method"),
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
            header: tr("Taken by"),
            cell: (r) => (
              <span className="text-ink-faint">{r.receivedBy ?? "—"}</span>
            ),
          },
          {
            header: tr("Amount"),
            align: "right",
            cell: (r) => (
              <span
                className={cn(
                  "font-medium",
                  r.isReversal ? "text-warn-deep" : "text-ink",
                )}
              >
                {formatMoney(r.amountCents, currency)}
              </span>
            ),
            foot: formatMoney(net, currency),
          },
        ]}
      />
    </ReportShell>
  );
}
