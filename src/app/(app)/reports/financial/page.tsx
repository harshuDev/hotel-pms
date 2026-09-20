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
  getFinancialReport,
} from "@/lib/queries";
import type { FinancialRow } from "@/lib/types";

export const metadata = { title: "Financial report" };

export default async function FinancialReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: FinancialRow[];
  try {
    rows = await getFinancialReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell
          title="Financial"
        >
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const sum = (pick: (r: FinancialRow) => number) =>
    rows.reduce((total, r) => total + pick(r), 0);

  const room = sum((r) => r.roomRevenueCents);
  const extras = sum((r) => r.extrasRevenueCents);
  const discounts = sum((r) => r.discountsCents);
  const tax = sum((r) => r.taxCents);
  const charges = sum((r) => r.chargesCents);
  const payments = sum((r) => r.paymentsCents);
  const drawer = sum((r) => r.drawerPaymentsCents);

  return (
    <ReportShell
      title="Financial"
      action="/reports/financial"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Revenue"
          value={formatMoneyShort(room + extras + discounts)}
          detail="Room and extras, less discounts, before tax"
          emphasis
        />
        <ReportFigure label="Tax" value={formatMoneyShort(tax)} detail="Posted with the charge" />
        <ReportFigure
          label="Charged"
          value={formatMoneyShort(charges)}
          detail="Everything posted to folios"
        />
        <ReportFigure
          label="Received"
          value={formatMoneyShort(payments)}
          detail={`${formatMoneyShort(drawer)} through the drawer`}
        />
      </ReportFigures>

      <ReportTable<FinancialRow>
        rows={rows}
        rowKey={(r) => r.businessDate}
        minWidth="880px"
        emptyTitle="No days in this range"
        emptyHint="Widen the dates, or check that the range runs forwards."
        footLabel={`${rows.length} day${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Business date",
            cell: (r) => (
              <span className="whitespace-nowrap text-ink">
                {format(parseISO(r.businessDate), "EEE d MMM")}
              </span>
            ),
          },
          {
            header: "Room",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{formatMoney(r.roomRevenueCents)}</span>,
            foot: formatMoney(room),
          },
          {
            header: "Extras",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{formatMoney(r.extrasRevenueCents)}</span>,
            foot: formatMoney(extras),
          },
          {
            header: "Discounts",
            align: "right",
            cell: (r) => (
              <span className={r.discountsCents < 0 ? "text-warn-deep" : "text-ink-faint"}>
                {r.discountsCents === 0 ? "—" : formatMoney(r.discountsCents)}
              </span>
            ),
            foot: discounts === 0 ? "—" : formatMoney(discounts),
          },
          {
            header: "Tax",
            align: "right",
            cell: (r) => <span className="text-ink-faint">{formatMoney(r.taxCents)}</span>,
            foot: formatMoney(tax),
          },
          {
            header: "Charged",
            align: "right",
            cell: (r) => <span className="font-medium text-ink">{formatMoney(r.chargesCents)}</span>,
            foot: formatMoney(charges),
          },
          {
            header: "Received",
            align: "right",
            cell: (r) => (
              <span className={cn(r.paymentsCents > 0 ? "text-ink" : "text-ink-faint")}>
                {formatMoney(r.paymentsCents)}
              </span>
            ),
            foot: formatMoney(payments),
          },
          {
            header: "Of which cash",
            align: "right",
            cell: (r) => <span className="text-ink-faint">{formatMoney(r.drawerPaymentsCents)}</span>,
            foot: formatMoney(drawer),
          },
        ]}
      />
    </ReportShell>
  );
}
