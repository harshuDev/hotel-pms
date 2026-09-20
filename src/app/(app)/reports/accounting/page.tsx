import { ReportFigure, ReportFigures, ReportShell } from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import { ReportAccessError, getAccountingReport, getBusinessDate } from "@/lib/queries";
import type { AccountingRow } from "@/lib/types";

export const metadata = { title: "Accounting report" };

/**
 * What a bookkeeper posts: revenue by category with its tax separated, and the
 * money received against it by method.
 *
 * TWO TABLES, ONE RANGE. They are read together and checked against each other,
 * and running them as two reports over two date pickers is how somebody ends up
 * comparing March revenue with April receipts.
 *
 * THEY ARE NOT MEANT TO AGREE. Revenue is what was earned in the range;
 * payments are what was collected in it. A guest who checks out in April having
 * paid in March moves the two apart, correctly, and the note says so — because
 * the first thing anyone does with two totals is expect them to match.
 */
export default async function AccountingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: AccountingRow[];
  try {
    rows = await getAccountingReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Accounting">
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const revenue = rows.filter((r) => r.section === "revenue");
  const receipts = rows.filter((r) => r.section === "payments");

  const net = revenue.reduce((s, r) => s + r.netCents, 0);
  const tax = revenue.reduce((s, r) => s + r.taxCents, 0);
  const gross = revenue.reduce((s, r) => s + r.grossCents, 0);
  const collected = receipts.reduce((s, r) => s + r.grossCents, 0);

  return (
    <ReportShell
      title="Accounting"
      action="/reports/accounting"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Revenue"
          value={formatMoneyShort(net)}
          detail="Net of tax"
          emphasis
        />
        <ReportFigure label="Tax" value={formatMoneyShort(tax)} />
        <ReportFigure label="Gross" value={formatMoneyShort(gross)} />
        <ReportFigure
          label="Collected"
          value={formatMoneyShort(collected)}
          detail="Money received in this range"
        />
      </ReportFigures>

      <div className="mb-4">
        <h2 className="mb-2 font-display text-[15px] tracking-tightest text-ink">
          Revenue earned
        </h2>
        <ReportTable<AccountingRow>
          rows={revenue}
          rowKey={(r) => `revenue-${r.code}`}
          minWidth="680px"
          emptyTitle="Nothing was earned in this range"
          emptyHint="Revenue posts on the night audit, so a range with no closed days shows nothing."
          footLabel={`${revenue.length} categor${revenue.length === 1 ? "y" : "ies"}`}
          columns={[
            {
              header: "Category",
              cell: (r) => <span className="font-medium text-ink">{r.label}</span>,
            },
            {
              header: "Code",
              cell: (r) => <span className="text-ink-faint">{r.code}</span>,
            },
            {
              header: "Net",
              align: "right",
              cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.netCents)}</span>,
              foot: formatMoney(net),
            },
            {
              header: "Tax",
              align: "right",
              cell: (r) => <span className="tnum text-ink-faint">{formatMoney(r.taxCents)}</span>,
              foot: formatMoney(tax),
            },
            {
              header: "Gross",
              align: "right",
              cell: (r) => (
                <span className="tnum font-medium text-ink">{formatMoney(r.grossCents)}</span>
              ),
              foot: formatMoney(gross),
            },
          ]}
        />
      </div>

      <div>
        <h2 className="mb-2 font-display text-[15px] tracking-tightest text-ink">
          Money received
        </h2>
        <ReportTable<AccountingRow>
          rows={receipts}
          rowKey={(r) => `payments-${r.code}-${r.label}`}
          minWidth="680px"
          emptyTitle="Nothing was collected in this range"
          emptyHint="Payments are dated to the business date they were taken on."
          footLabel={`${receipts.length} method${receipts.length === 1 ? "" : "s"}`}
          columns={[
            {
              header: "Method",
              cell: (r) => <span className="font-medium text-ink">{r.label}</span>,
            },
            {
              header: "Kind",
              cell: (r) => <span className="text-ink-faint">{r.code}</span>,
            },
            {
              header: "Received",
              align: "right",
              cell: (r) => (
                <span className="tnum font-medium text-ink">{formatMoney(r.grossCents)}</span>
              ),
              foot: formatMoney(collected),
            },
          ]}
        />
      </div>
    </ReportShell>
  );
}
