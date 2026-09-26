import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import { ReportAccessError, getBusinessDate, getExtrasReport } from "@/lib/queries";
import type { ExtrasRow, FolioItemType } from "@/lib/types";
import { getPropertyCurrency } from "@/lib/queries";

export const metadata = { title: "Extras report" };

/** The folio item types a guest sees on a bill, in plain words. */
const ITEM_LABELS: Record<FolioItemType, string> = {
  room_charge: "Room",
  tax: "Tax",
  food_beverage: "Food and drink",
  laundry: "Laundry",
  minibar: "Minibar",
  transport: "Transport",
  miscellaneous: "Miscellaneous",
  discount: "Discount",
  adjustment: "Adjustment",
  reversal: "Reversal",
};

export default async function ExtrasReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const currency = await getPropertyCurrency();
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: ExtrasRow[];
  try {
    rows = await getExtrasReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Extras">
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const net = rows.reduce((s, r) => s + r.netCents, 0);
  const tax = rows.reduce((s, r) => s + r.taxCents, 0);
  const gross = rows.reduce((s, r) => s + r.grossCents, 0);
  const items = rows.reduce((s, r) => s + r.itemCount, 0);
  const best = rows[0];

  return (
    <ReportShell
      title="Extras"
      action="/reports/extras"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Extras revenue"
          value={formatMoneyShort(net, currency)}
          detail="Before tax"
          emphasis
        />
        <ReportFigure label="Tax" value={formatMoneyShort(tax, currency)} />
        <ReportFigure
          label="Charges"
          value={String(items)}
          detail={`Across ${rows.length} type${rows.length === 1 ? "" : "s"}`}
        />
        {best && (
          <ReportFigure
            label="Biggest earner"
            value={ITEM_LABELS[best.itemType]}
            detail={formatMoney(best.netCents, currency)}
          />
        )}
      </ReportFigures>

      <ReportTable<ExtrasRow>
        rows={rows}
        rowKey={(r) => r.itemType}
        minWidth="660px"
        emptyTitle="Nothing but rooms was charged in this range"
        emptyHint="Minibar, laundry and food charges posted to a folio appear here."
        footLabel={`${rows.length} type${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Type",
            cell: (r) => (
              <span className="font-medium text-ink">{ITEM_LABELS[r.itemType]}</span>
            ),
          },
          {
            header: "Charges",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{r.itemCount}</span>,
            foot: String(items),
          },
          {
            header: "Reversed",
            align: "right",
            cell: (r) => (
              <span className={r.reversalCount > 0 ? "text-warn-deep" : "text-ink-faint"}>
                {r.reversalCount > 0 ? r.reversalCount : "—"}
              </span>
            ),
          },
          {
            header: "Net",
            align: "right",
            cell: (r) => <span className="text-ink-muted">{formatMoney(r.netCents, currency)}</span>,
            foot: formatMoney(net, currency),
          },
          {
            header: "Tax",
            align: "right",
            cell: (r) => <span className="text-ink-faint">{formatMoney(r.taxCents, currency)}</span>,
            foot: formatMoney(tax, currency),
          },
          {
            header: "Gross",
            align: "right",
            cell: (r) => (
              <span className="font-medium text-ink">{formatMoney(r.grossCents, currency)}</span>
            ),
            foot: formatMoney(gross, currency),
          },
        ]}
      />
    </ReportShell>
  );
}
