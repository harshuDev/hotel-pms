import { format, isValid, parseISO } from "date-fns";
import { EmptyState } from "@/components/ui";
import { ReportFigure, ReportFigures, ReportShell } from "@/components/reports/report-shell";
import { ReportNoAccess } from "@/components/reports/report-table";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { ReportAccessError, getBusinessDate, getEndOfDayReport } from "@/lib/queries";
import type { EndOfDayRow } from "@/lib/types";

export const metadata = { title: "End of day report" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One date, the way the night audit left it. What a duty manager signs off.
 *
 * ONE DATE AND NOT A RANGE, because that is the unit the thing describes: the
 * audit closes a day at a time and this is the record of one closing. A range of
 * them is the manager report, which is a different screen for a different
 * question.
 */
export default async function EndOfDayReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();

  // Anything unparseable falls back to the open business date rather than
  // reaching Postgres, where a bad date is an error and not an empty report.
  const date =
    sp.date && ISO_DATE.test(sp.date) && isValid(parseISO(sp.date))
      ? sp.date
      : businessDate;

  let row: EndOfDayRow | null;
  try {
    row = await getEndOfDayReport(date);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="End of day" subtitle="One date, as the audit left it">
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const pretty = format(parseISO(date), "EEEE d MMMM yyyy");

  return (
    <ReportShell
      title="End of day"
      subtitle={`The audit record for ${pretty}`}
      action="/reports/end-of-day"
      date={date}
    >
      {!row ? (
        <div className="rounded-lg border border-line bg-white p-4 shadow-card">
          <EmptyState
            title="Nothing is recorded for that date"
            hint="Pick a date the hotel has traded. The business date only exists once it has been opened."
          />
        </div>
      ) : (
        <>
          <ReportFigures>
            <ReportFigure
              label="Occupancy"
              value={`${row.occupancyPct}%`}
              detail={`${row.roomsSold} of ${row.sellableRooms} rooms`}
              emphasis
            />
            <ReportFigure
              label="Revenue"
              value={formatMoneyShort(row.roomRevenueCents + row.otherRevenueCents)}
              detail={`${formatMoneyShort(row.roomRevenueCents)} rooms`}
            />
            <ReportFigure
              label="Collected"
              value={formatMoneyShort(row.paymentsCents)}
              detail={`${formatMoneyShort(row.drawerCents)} in cash`}
            />
            <ReportFigure
              label="Day"
              value={row.dateStatus === "closed" ? "Closed" : "Open"}
              detail={
                row.closedAt
                  ? `by ${row.closedBy ?? "somebody"} at ${format(parseISO(row.closedAt), "HH:mm")}`
                  : "Not yet closed"
              }
            />
          </ReportFigures>

          {row.shiftsOpen > 0 && (
            <div className="mb-4 rounded-lg border border-warn/40 bg-warn-wash px-4 py-3 text-[13px] text-warn-deep">
              {row.shiftsOpen} cashier shift
              {row.shiftsOpen === 1 ? " is" : "s are"} still open on this date. The
              night audit refuses to close a day while one is, so the figures below
              can still move.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Panel title="Movements">
              <Line label="Arrivals" value={String(row.arrivals)} />
              <Line label="Departures" value={String(row.departures)} />
              <Line label="In house that night" value={String(row.inHouse)} />
              <Line
                label="No-shows"
                value={String(row.noShows)}
                tone={row.noShows > 0 ? "warn" : undefined}
              />
            </Panel>

            <Panel title="Rooms">
              <Line label="Rooms sold" value={String(row.roomsSold)} />
              <Line label="Rooms sellable" value={String(row.sellableRooms)} />
              <Line label="Occupancy" value={`${row.occupancyPct}%`} />
            </Panel>

            <Panel title="Revenue posted">
              <Line label="Accommodation" value={formatMoney(row.roomRevenueCents)} />
              <Line label="Everything else" value={formatMoney(row.otherRevenueCents)} />
              <Line label="Tax" value={formatMoney(row.taxCents)} />
            </Panel>

            <Panel title="Money taken">
              <Line label="All methods" value={formatMoney(row.paymentsCents)} />
              <Line label="Of which cash" value={formatMoney(row.drawerCents)} />
              <Line
                label="Shifts still open"
                value={String(row.shiftsOpen)}
                tone={row.shiftsOpen > 0 ? "warn" : undefined}
              />
            </Panel>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            Room revenue is the night&rsquo;s own rate less discount, taken from
            the booking rather than the folio, so it is the same figure the
            occupancy report shows. Money taken is every payment dated to this
            business date, against any stay — so it will not equal the revenue
            above, and is not meant to. Cash is whatever was taken on a method
            that touches the drawer, which follows from the method&rsquo;s kind
            and is never set by hand.
          </p>
        </>
      )}
    </ReportShell>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-card">
      <h2 className="mb-2.5 text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
        {title}
      </h2>
      <dl className="divide-y divide-line">{children}</dl>
    </div>
  );
}

function Line({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="flex items-baseline justify-between py-2">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd
        className={
          tone === "warn"
            ? "tnum text-[13px] font-medium text-warn-deep"
            : "tnum text-[13px] font-medium text-ink"
        }
      >
        {value}
      </dd>
    </div>
  );
}
