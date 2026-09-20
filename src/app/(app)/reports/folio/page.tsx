import { format, parseISO } from "date-fns";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import { ReportAccessError, getBusinessDate, getFolioReport } from "@/lib/queries";
import type { FolioReportRow } from "@/lib/types";

export const metadata = { title: "Folio report" };

/**
 * Every folio charged or paid in the range.
 *
 * The debtors report answers "who owes us". This answers "what happened on this
 * account", which includes the ones that balance to nothing — a folio that was
 * charged and settled the same day is invisible on debtors and is exactly what
 * somebody checking a day's work wants to see.
 */
export default async function FolioReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: FolioReportRow[];
  try {
    rows = await getFolioReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Folios" >
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const charges = rows.reduce((s, r) => s + r.chargesCents, 0);
  const payments = rows.reduce((s, r) => s + r.paymentsCents, 0);
  const balance = rows.reduce((s, r) => s + r.balanceCents, 0);
  const owing = rows.filter((r) => r.balanceCents > 0).length;

  return (
    <ReportShell
      title="Folios"
      action="/reports/folio"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Outstanding"
          value={formatMoneyShort(balance)}
          detail={`Across ${owing} folio${owing === 1 ? "" : "s"}`}
          emphasis
        />
        <ReportFigure label="Charged" value={formatMoneyShort(charges)} />
        <ReportFigure label="Paid" value={formatMoneyShort(payments)} />
        <ReportFigure
          label="Folios"
          value={String(rows.length)}
          detail="Touched in this range"
        />
      </ReportFigures>

      <ReportTable<FolioReportRow>
        rows={rows}
        rowKey={(r) => r.folioId}
        minWidth="900px"
        emptyTitle="No folio was charged or paid in this range"
        emptyHint="A folio is created on its first charge, so a booking that has taken no money yet has none."
        footLabel={`${rows.length} folio${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "Folio",
            cell: (r) => <span className="tnum text-ink-muted">#{r.folioNumber}</span>,
          },
          {
            header: "Reference",
            cell: (r) =>
              r.reference === "Meeting room" ? (
                <span className="text-ink-muted">{r.reference}</span>
              ) : (
                <span className="font-medium text-ink">{r.reference}</span>
              ),
          },
          {
            header: "Guest",
            cell: (r) => <span className="text-ink-muted">{r.guestName}</span>,
          },
          {
            header: "Opened",
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-faint">
                {format(parseISO(r.openedAt), "d MMM yyyy")}
              </span>
            ),
          },
          {
            header: "Status",
            cell: (r) => (
              <span
                className={
                  r.status === "open"
                    ? "text-[13px] text-ink"
                    : "text-[13px] text-ink-faint"
                }
              >
                {r.status}
              </span>
            ),
          },
          {
            header: "Charged",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.chargesCents)}</span>,
            foot: formatMoney(charges),
          },
          {
            header: "Paid",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.paymentsCents)}</span>,
            foot: formatMoney(payments),
          },
          {
            header: "Balance",
            align: "right",
            cell: (r) => (
              <span
                className={
                  r.balanceCents > 0
                    ? "tnum font-medium text-rose-600"
                    : "tnum text-ink-faint"
                }
              >
                {formatMoney(r.balanceCents)}
              </span>
            ),
            foot: formatMoney(balance),
          },
        ]}
      />
    </ReportShell>
  );
}
