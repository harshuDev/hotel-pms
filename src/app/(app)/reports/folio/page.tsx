import { getT } from "@/lib/i18n/server";
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
import { getPropertyCurrency } from "@/lib/queries";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Folio report"));

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
  const tr = await getT();
  const currency = await getPropertyCurrency();
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: FolioReportRow[];
  try {
    rows = await getFolioReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title={tr("Folios")}>
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
      title={tr("Folios")}
      action="/reports/folio"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label={tr("Outstanding")}
          value={formatMoneyShort(balance, currency)}
          detail={tr.plural(owing, "Across {n} folio", "Across {n} folios")}
          emphasis
        />
        <ReportFigure label={tr("Charged")} value={formatMoneyShort(charges, currency)} />
        <ReportFigure label={tr("Paid")} value={formatMoneyShort(payments, currency)} />
        <ReportFigure
          label={tr("Folios")}
          value={String(rows.length)}
          detail={tr("Touched in this range")}
        />
      </ReportFigures>

      <ReportTable<FolioReportRow>
        rows={rows}
        rowKey={(r) => r.folioId}
        minWidth="900px"
        emptyTitle={tr("No folio was charged or paid in this range")}
        emptyHint={tr("A folio is created on its first charge, so a booking that has taken no money yet has none.")}
        footLabel={tr.plural(rows.length, "{n} folio", "{n} folios")}
        columns={[
          {
            header: tr("Folio"),
            cell: (r) => <span className="tnum text-ink-muted">#{r.folioNumber}</span>,
          },
          {
            header: tr("Reference"),
            cell: (r) =>
              r.reference === "Meeting room" ? (
                <span className="text-ink-muted">{r.reference}</span>
              ) : (
                <span className="font-medium text-ink">{r.reference}</span>
              ),
          },
          {
            header: tr("Guest"),
            cell: (r) => <span className="text-ink-muted">{r.guestName}</span>,
          },
          {
            header: tr("Opened"),
            cell: (r) => (
              <span className="whitespace-nowrap text-ink-faint">
                {tr.date(r.openedAt, "d MMM yyyy")}
              </span>
            ),
          },
          {
            header: tr("Status"),
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
            header: tr("Charged"),
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.chargesCents, currency)}</span>,
            foot: formatMoney(charges, currency),
          },
          {
            header: tr("Paid"),
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.paymentsCents, currency)}</span>,
            foot: formatMoney(payments, currency),
          },
          {
            header: tr("Balance"),
            align: "right",
            cell: (r) => (
              <span
                className={
                  r.balanceCents > 0
                    ? "tnum font-medium text-rose-600"
                    : "tnum text-ink-faint"
                }
              >
                {formatMoney(r.balanceCents, currency)}
              </span>
            ),
            foot: formatMoney(balance, currency),
          },
        ]}
      />
    </ReportShell>
  );
}
