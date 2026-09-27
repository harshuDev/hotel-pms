import { getT } from "@/lib/i18n/server";
import { ReportFigure, ReportFigures, ReportShell } from "@/components/reports/report-shell";
import { ReportFeatureOff, ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import {
  ReportAccessError,
  getAccountingReport,
  getAccountingRoomRevenue,
  getBusinessDate,
} from "@/lib/queries";
import type { AccountingRoomRevenueRow, AccountingRow, FolioItemType } from "@/lib/types";
import { FOLIO_ITEM_LABEL } from "@/lib/folio-items";
import { getAccountingSettings, getHotelFeatures, getPropertyCurrency } from "@/lib/queries";
import type { AccountingCategory } from "@/lib/finance-profiles";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Accounting report"));

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
  const tr = await getT();
  // Hotel Features -> "Enable Accounting Report" (0076). The menu entry goes
  // with the switch; this answers a bookmark or a typed address.
  if (!(await getHotelFeatures()).accounting_report) {
    return (
      <ReportShell title={tr("Accounting")}>
        <ReportFeatureOff feature={msg("Enable Accounting Report")} />
      </ReportShell>
    );
  }
  const currency = await getPropertyCurrency();
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: AccountingRow[];
  let byType: AccountingRoomRevenueRow[];
  try {
    [rows, byType] = await Promise.all([
      getAccountingReport(range.from, range.to),
      getAccountingRoomRevenue(range.from, range.to),
    ]);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title={tr("Accounting")}>
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  /*
   * THE ACCOUNT each line posts to, from Settings -> Finances -> Accounting
   * Categories (0085): room revenue to the accommodation default, every other
   * revenue line to the extras default, the tax to the taxes default and every
   * payment method to the payments default. A lookup, not a sum -- the figures
   * are still all Postgres's.
   */
  const accounting = await getAccountingSettings();
  const byId = new Map(accounting.categories.map((c) => [c.id, c]));
  const d = accounting.defaults;
  const account = (id: string | undefined) => (id ? byId.get(id) ?? null : null);
  const revenueAccount = (r: AccountingRow) =>
    r.code === "room_charge"
      ? account(r.accountingCategoryId ?? d?.accommodationId)
      : account(d?.extrasId);
  const taxAccount = account(d?.taxesId);
  const paymentsAccount = account(d?.paymentsId);
  const accountCell = (a: AccountingCategory | null) =>
    a ? (
      <span className="text-ink">
        {a.name}
        {codes(a) && <span className="tnum ml-1.5 text-ink-faint">{codes(a)}</span>}
      </span>
    ) : (
      <span className="text-ink-faint">—</span>
    );

  /*
   * ROOM REVENUE, ONE LINE PER ROOM TYPE (0108), so a type with its own
   * accounting category posts there rather than to the accommodation default.
   * The split is Postgres's and always adds up to the room_charge line; if it
   * ever did not, the single line is shown rather than figures that disagree.
   */
  const roomLine = rows.find((r) => r.section === "revenue" && r.code === "room_charge");
  const splitGross = byType.reduce((s, r) => s + r.grossCents, 0);
  const splitRoom =
    roomLine && byType.length > 0 && splitGross === roomLine.grossCents
      ? byType.map<AccountingRow>((r) => ({
          section: "revenue",
          code: "room_charge",
          label: roomLine.label,
          netCents: r.netCents,
          taxCents: r.taxCents,
          grossCents: r.grossCents,
          roomTypeName: r.roomTypeName ?? tr("Not recorded"),
          accountingCategoryId: r.accountingCategoryId,
        }))
      : null;
  const revenue = rows
    .filter((r) => r.section === "revenue")
    .flatMap((r) => (r.code === "room_charge" && splitRoom ? splitRoom : [r]));
  const receipts = rows.filter((r) => r.section === "payments");

  const net = revenue.reduce((s, r) => s + r.netCents, 0);
  const tax = revenue.reduce((s, r) => s + r.taxCents, 0);
  const gross = revenue.reduce((s, r) => s + r.grossCents, 0);
  const collected = receipts.reduce((s, r) => s + r.grossCents, 0);

  return (
    <ReportShell
      title={tr("Accounting")}
      action="/reports/accounting"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label={tr("Revenue")}
          value={formatMoneyShort(net, currency)}
          detail={tr("Net of tax")}
          emphasis
        />
        <ReportFigure
          label={tr("Tax")}
          value={formatMoneyShort(tax, currency)}
          detail={taxAccount ? [taxAccount.name, codes(taxAccount)].filter(Boolean).join(" · ") : undefined}
        />
        <ReportFigure label={tr("Gross")} value={formatMoneyShort(gross, currency)} />
        <ReportFigure
          label={tr("Collected")}
          value={formatMoneyShort(collected, currency)}
          detail={tr("Money received in this range")}
        />
      </ReportFigures>

      <div className="mb-4">
        <h2 className="mb-2 font-display text-[15px] tracking-tightest text-ink">
          {tr("Revenue earned")}
        </h2>
        <ReportTable<AccountingRow>
          rows={revenue}
          rowKey={(r) => `revenue-${r.code}-${r.roomTypeName ?? ""}`}
          minWidth="780px"
          emptyTitle={tr("Nothing was earned in this range")}
          emptyHint={tr("Revenue posts on the night audit, so a range with no closed days shows nothing.")}
          footLabel={tr.plural(revenue.length, "{n} category", "{n} categories")}
          columns={[
            {
              header: tr("Category"),
              // Postgres writes the type as a label ("Food Beverage"); the code is what is looked up.
              cell: (r) => (
                <span className="font-medium text-ink">
                  {r.code in FOLIO_ITEM_LABEL ? tr(FOLIO_ITEM_LABEL[r.code as FolioItemType]) : r.label}
                  {r.roomTypeName && (
                    <span className="ml-1.5 font-normal text-ink-muted">· {tr.message(r.roomTypeName)}</span>
                  )}
                </span>
              ),
            },
            {
              header: tr("Code"),
              cell: (r) => <span className="text-ink-faint">{r.code}</span>,
            },
            {
              header: tr("Account"),
              cell: (r) => accountCell(revenueAccount(r)),
            },
            {
              header: tr("Net"),
              align: "right",
              cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.netCents, currency)}</span>,
              foot: formatMoney(net, currency),
            },
            {
              header: tr("Tax"),
              align: "right",
              cell: (r) => <span className="tnum text-ink-faint">{formatMoney(r.taxCents, currency)}</span>,
              foot: formatMoney(tax, currency),
            },
            {
              header: tr("Gross"),
              align: "right",
              cell: (r) => (
                <span className="tnum font-medium text-ink">{formatMoney(r.grossCents, currency)}</span>
              ),
              foot: formatMoney(gross, currency),
            },
          ]}
        />
      </div>

      <div>
        <h2 className="mb-2 font-display text-[15px] tracking-tightest text-ink">
          {tr("Money received")}
        </h2>
        <ReportTable<AccountingRow>
          rows={receipts}
          rowKey={(r) => `payments-${r.code}-${r.label}`}
          minWidth="780px"
          emptyTitle={tr("Nothing was collected in this range")}
          emptyHint={tr("Payments are dated to the business date they were taken on.")}
          footLabel={tr.plural(receipts.length, "{n} method", "{n} methods")}
          columns={[
            {
              header: tr("Method"),
              cell: (r) => <span className="font-medium text-ink">{r.label}</span>,
            },
            {
              header: tr("Kind"),
              cell: (r) => <span className="text-ink-faint">{r.code}</span>,
            },
            {
              header: tr("Account"),
              cell: () => accountCell(paymentsAccount),
            },
            {
              header: tr("Received"),
              align: "right",
              cell: (r) => (
                <span className="tnum font-medium text-ink">{formatMoney(r.grossCents, currency)}</span>
              ),
              foot: formatMoney(collected, currency),
            },
          ]}
        />
      </div>
    </ReportShell>
  );
}

/** "4000 / ACC-4000": the internal code, then the external, whichever are set. */
function codes(a: AccountingCategory): string {
  return [a.internalCode, a.externalCode].filter(Boolean).join(" / ");
}
