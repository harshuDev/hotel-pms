import { ReportFigure, ReportFigures, ReportShell } from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import { ReportAccessError, getBusinessDate, getRatePlanReport } from "@/lib/queries";
import type { RatePlanReportRow } from "@/lib/types";
import { getPropertyCurrency } from "@/lib/queries";

export const metadata = { title: "Rate plan report" };

/**
 * Which rate plans are actually selling, and at what average.
 *
 * Nights sold before the rate plan was recorded against a booking group under
 * "Not recorded" rather than disappearing — the totals have to tie to the
 * occupancy report, and a report that quietly excludes a stretch of history is
 * worse than one that labels it.
 */
export default async function RatePlanReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const currency = await getPropertyCurrency();
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: RatePlanReportRow[];
  try {
    rows = await getRatePlanReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Rate plans">
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const nights = rows.reduce((s, r) => s + r.roomNights, 0);
  const gross = rows.reduce((s, r) => s + r.grossCents, 0);
  const discount = rows.reduce((s, r) => s + r.discountCents, 0);
  const net = rows.reduce((s, r) => s + r.netCents, 0);
  const adr = nights > 0 ? Math.round(net / nights) : 0;
  const top = rows[0];
  const unrecorded = rows.find((r) => r.ratePlanId === null);

  return (
    <ReportShell
      title="Rate plans"
      action="/reports/rate-plan"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Room nights"
          value={String(nights)}
          detail={`Across ${rows.length} plan${rows.length === 1 ? "" : "s"}`}
          emphasis
        />
        {top && (
          <ReportFigure
            label="Best seller"
            value={top.planName}
            detail={`${top.roomNights} night${top.roomNights === 1 ? "" : "s"}`}
          />
        )}
        <ReportFigure label="ADR" value={formatMoneyShort(adr, currency)} detail="Net of discount" />
        <ReportFigure
          label="Discount given"
          value={formatMoneyShort(discount, currency)}
          detail={gross > 0 ? `${Math.round((discount / gross) * 100)}% of rack` : "—"}
        />
      </ReportFigures>

      <ReportTable<RatePlanReportRow>
        rows={rows}
        rowKey={(r) => r.ratePlanId ?? "unrecorded"}
        minWidth="860px"
        emptyTitle="Nothing sold in this range"
        emptyHint="Pick a range that covers dates guests have stayed."
        footLabel={`${rows.length} plan${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Plan",
            cell: (r) => (
              <span
                className={
                  r.ratePlanId === null ? "text-ink-faint" : "font-medium text-ink"
                }
              >
                {r.planName}
              </span>
            ),
          },
          {
            header: "Published",
            cell: (r) =>
              r.ratePlanId === null ? (
                <span className="text-ink-faint">—</span>
              ) : (
                <span className={r.isPublic ? "text-emerald-600" : "text-ink-faint"}>
                  {r.isPublic ? "Yes" : "No"}
                </span>
              ),
          },
          {
            header: "Bookings",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{r.bookings}</span>,
          },
          {
            header: "Nights",
            align: "right",
            cell: (r) => <span className="tnum font-medium text-ink">{r.roomNights}</span>,
            foot: String(nights),
          },
          {
            header: "Rack",
            align: "right",
            cell: (r) => <span className="tnum text-ink-faint">{formatMoney(r.grossCents, currency)}</span>,
            foot: formatMoney(gross, currency),
          },
          {
            header: "Discount",
            align: "right",
            cell: (r) => (
              <span className={r.discountCents > 0 ? "tnum text-warn-deep" : "tnum text-ink-faint"}>
                {r.discountCents > 0 ? formatMoney(r.discountCents, currency) : "—"}
              </span>
            ),
            foot: formatMoney(discount, currency),
          },
          {
            header: "Net",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.netCents, currency)}</span>,
            foot: formatMoney(net, currency),
          },
          {
            header: "ADR",
            align: "right",
            cell: (r) => <span className="tnum font-medium text-ink">{formatMoney(r.adrCents, currency)}</span>,
            foot: formatMoney(adr, currency),
          },
        ]}
      />
    </ReportShell>
  );
}
