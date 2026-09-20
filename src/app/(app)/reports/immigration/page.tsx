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

export const metadata = { title: "Immigration report" };

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
          title="Immigration"
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
      title="Immigration"
      action="/reports/immigration"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Stays"
          value={String(rows.length)}
          detail="In this range"
          emphasis
        />
        <ReportFigure
          label="Complete"
          value={String(rows.length - incomplete.length)}
          detail="Document, nationality and date of birth"
        />
        <ReportFigure
          label="Incomplete"
          value={String(incomplete.length)}
          detail={incomplete.length > 0 ? "Cannot be filed as they stand" : "Nothing missing"}
        />
      </ReportFigures>

      {incomplete.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn-wash px-4 py-3 text-[13px] text-warn-deep">
          {incomplete.length} of these {rows.length} stays are missing something a
          return needs. Open the guest under{" "}
          <Link href="/customers" className="underline underline-offset-2">
            Customers
          </Link>{" "}
          and fill in the Identity fields — nationality, a document number and a
          date of birth.
        </div>
      )}

      <ReportTable<ImmigrationRow>
        rows={rows}
        rowKey={(r) => r.bookingId}
        minWidth="1040px"
        emptyTitle="Nobody stayed in this range"
        emptyHint="The return covers nights actually slept, so cancellations and no-shows never appear."
        footLabel={`${rows.length} stay${rows.length === 1 ? "" : "s"}`}
        columns={[
          {
            header: "",
            cell: (r) =>
              r.isComplete ? (
                <span className="text-emerald-600" title="Complete">
                  ●
                </span>
              ) : (
                <span className="text-warn" title="Missing details">
                  ●
                </span>
              ),
          },
          {
            header: "Reference",
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
            header: "Guest",
            cell: (r) => <span className="text-ink">{r.guestName}</span>,
          },
          {
            header: "Room",
            cell: (r) => <span className="tnum text-ink-faint">{r.roomNumber}</span>,
          },
          {
            header: "Nationality",
            cell: (r) =>
              r.nationality ? (
                <span className="text-ink-muted">{countryName(r.nationality)}</span>
              ) : (
                <span className="text-warn-deep">Not recorded</span>
              ),
          },
          {
            header: "Document",
            cell: (r) => {
              const doc = r.passportNumber ?? r.nationalIdNumber;
              return doc ? (
                <span className="tnum text-ink-muted">{doc}</span>
              ) : (
                <span className="text-warn-deep">Not recorded</span>
              );
            },
          },
          {
            header: "Expires",
            cell: (r) => (
              <span className="tnum whitespace-nowrap text-ink-faint">
                {r.passportExpiry
                  ? format(parseISO(r.passportExpiry), "d MMM yyyy")
                  : "—"}
              </span>
            ),
          },
          {
            header: "Born",
            cell: (r) =>
              r.dateOfBirth ? (
                <span className="tnum whitespace-nowrap text-ink-muted">
                  {format(parseISO(r.dateOfBirth), "d MMM yyyy")}
                </span>
              ) : (
                <span className="text-warn-deep">Not recorded</span>
              ),
          },
          {
            header: "Stay",
            align: "right",
            cell: (r) => (
              <span className="tnum whitespace-nowrap text-ink-muted">
                {format(parseISO(r.checkIn), "d MMM")} –{" "}
                {format(parseISO(r.checkOut), "d MMM")}
              </span>
            ),
          },
          {
            header: "Nights",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{r.nights}</span>,
          },
        ]}
      />
    </ReportShell>
  );
}
