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
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: ExtrasRow[];
  try {
    rows = await getExtrasReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Extras" subtitle="Everything charged that is not the room">
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
      subtitle="Everything charged that is not the room, by type"
      action="/reports/extras"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Extras revenue"
          value={formatMoneyShort(net)}
          detail="Before tax"
          emphasis
        />
        <ReportFigure label="Tax" value={formatMoneyShort(tax)} />
        <ReportFigure
          label="Charges"
          value={String(items)}
          detail={`Across ${rows.length} type${rows.length === 1 ? "" : "s"}`}
        />
        {best && (
          <ReportFigure
            label="Biggest earner"
            value={ITEM_LABELS[best.itemType]}
            detail={formatMoney(best.netCents)}
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
        note={
          <>
            Room charges and their tax are left out: they belong to the
            occupancy report, and including them would drown everything else. A
            charge posted in error and reversed nets to nothing but still shows
            its count, because the correction is part of the record. Discounts
            appear on the financial report, not here — a discount is a deduction
            from a charge, not something sold.
          </>
        }
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
            cell: (r) => <span className="text-ink-muted">{formatMoney(r.netCents)}</span>,
            foot: formatMoney(net),
          },
          {
            header: "Tax",
            align: "right",
            cell: (r) => <span className="text-ink-faint">{formatMoney(r.taxCents)}</span>,
            foot: formatMoney(tax),
          },
          {
            header: "Gross",
            align: "right",
            cell: (r) => (
              <span className="font-medium text-ink">{formatMoney(r.grossCents)}</span>
            ),
            foot: formatMoney(gross),
          },
        ]}
      />
    </ReportShell>
  );
}
