import { getT } from "@/lib/i18n/server";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { countryName } from "@/lib/countries";
import { reportRange } from "@/lib/reports";
import {
  ReportAccessError,
  getBusinessDate,
  getImmigrationReport,
} from "@/lib/queries";
import type { ImmigrationRow } from "@/lib/types";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Immigration report"));

/**
 * The return a hotel files with the police or the border force.
 *
 * RANGED ON THE NIGHT STAYED, not on arrival: a return is filed for a date, and
 * who was in the building on the 5th includes the guest who arrived on the 1st.
 *
 * Incomplete rows are shown, flagged, and counted at the top. Hiding them would
 * turn a return that cannot be filed into one that looks finished, which is the
 * one failure mode this report exists to prevent.
 */
export default async function ImmigrationReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const tr = await getT();
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: ImmigrationRow[];
  try {
    rows = await getImmigrationReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell
          title={tr("Immigration")}
        >
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const incomplete = rows.filter((r) => !r.isComplete);

  return (
    <ReportShell
      title={tr("Immigration")}
      action="/reports/immigration"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label={tr("Stays")}
          value={String(rows.length)}
          detail={tr("In this range")}
          emphasis
        />
        <ReportFigure
          label={tr("Complete")}
          value={String(rows.length - incomplete.length)}
          detail={tr("Document, nationality and date of birth")}
        />
        <ReportFigure
          label={tr("Incomplete")}
          value={String(incomplete.length)}
          detail={incomplete.length > 0 ? tr("Cannot be filed as they stand") : tr("Nothing missing")}
        />
      </ReportFigures>

      {incomplete.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn-wash px-4 py-3 text-[13px] text-warn-deep">
          {incomplete.length} {tr("of these")}{" "}{rows.length} {tr("stays are missing something a return needs. Open the guest under")}{" "}
          <Link href="/customers" className="underline underline-offset-2">
            {tr("Customers")}
          </Link>{" "}
          {tr("and fill in the Identity fields — nationality, a document number and a date of birth.")}
        </div>
      )}

      <ReportTable<ImmigrationRow>
        rows={rows}
        rowKey={(r) => r.bookingId}
        minWidth="1040px"
        emptyTitle={tr("Nobody stayed in this range")}
        emptyHint={tr("The return covers nights actually slept, so cancellations and no-shows never appear.")}
        footLabel={tr.plural(rows.length, "{n} stay", "{n} stays")}
        columns={[
          {
            header: "",
            cell: (r) =>
              r.isComplete ? (
                <span className="text-emerald-600" title={tr("Complete")}>
                  ●
                </span>
              ) : (
                <span className="text-warn" title={tr("Missing details")}>
                  ●
                </span>
              ),
          },
          {
            header: tr("Reference"),
            cell: (r) => (
              <Link
                href={`/bookings/${r.bookingId}`}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                {r.reference}
              </Link>
            ),
          },
          {
            header: tr("Guest"),
            cell: (r) => <span className="text-ink">{r.guestName}</span>,
          },
          {
            header: tr("Room"),
            cell: (r) => <span className="tnum text-ink-faint">{r.roomNumber}</span>,
          },
          {
            header: tr("Nationality"),
            cell: (r) =>
              r.nationality ? (
                <span className="text-ink-muted">{tr(countryName(r.nationality))}</span>
              ) : (
                <span className="text-warn-deep">{tr("Not recorded")}</span>
              ),
          },
          {
            header: tr("Document"),
            cell: (r) => {
              const doc = r.passportNumber ?? r.nationalIdNumber;
              return doc ? (
                <span className="tnum text-ink-muted">{doc}</span>
              ) : (
                <span className="text-warn-deep">{tr("Not recorded")}</span>
              );
            },
          },
          {
            header: tr("Expires"),
            cell: (r) => (
              <span className="tnum whitespace-nowrap text-ink-faint">
                {r.passportExpiry
                  ? tr.date(r.passportExpiry, "d MMM yyyy")
                  : "—"}
              </span>
            ),
          },
          {
            header: tr("Born"),
            cell: (r) =>
              r.dateOfBirth ? (
                <span className="tnum whitespace-nowrap text-ink-muted">
                  {tr.date(r.dateOfBirth, "d MMM yyyy")}
                </span>
              ) : (
                <span className="text-warn-deep">{tr("Not recorded")}</span>
              ),
          },
          {
            header: tr("Stay"),
            align: "right",
            cell: (r) => (
              <span className="tnum whitespace-nowrap text-ink-muted">
                {tr.date(r.checkIn, "d MMM")} –{" "}
                {tr.date(r.checkOut, "d MMM")}
              </span>
            ),
          },
          {
            header: tr("Nights"),
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{r.nights}</span>,
          },
        ]}
      />
    </ReportShell>
  );
}
