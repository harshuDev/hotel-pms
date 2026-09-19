import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportNoAccess, ReportTable } from "@/components/reports/report-table";
import { countryName } from "@/lib/countries";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { reportRange } from "@/lib/reports";
import { ReportAccessError, getBusinessDate, getCountryReport } from "@/lib/queries";
import type { CountryRow } from "@/lib/types";

export const metadata = { title: "Country report" };

/**
 * Where the hotel's guests come from.
 *
 * COUNTED IN ROOM NIGHTS, not bookings: a family staying a fortnight is worth
 * more to this picture than a one-night business stay, and counting bookings
 * says the opposite.
 *
 * Reads the country of RESIDENCE, not nationality. A German passport holder
 * living in Paris is a French booking, which is the answer a marketing question
 * wants; the immigration report is the one that asks about the passport.
 */
export default async function CountryReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  let rows: CountryRow[];
  try {
    rows = await getCountryReport(range.from, range.to);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Countries" subtitle="Where the hotel's guests come from">
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const nights = rows.reduce((s, r) => s + r.roomNights, 0);
  const revenue = rows.reduce((s, r) => s + r.revenueCents, 0);
  const guests = rows.reduce((s, r) => s + r.guests, 0);
  const unknown = rows.find((r) => r.country === "Unknown");
  const known = rows.filter((r) => r.country !== "Unknown");
  const top = known[0];

  return (
    <ReportShell
      title="Countries"
      subtitle="Room nights and revenue by the guest's country of residence"
      action="/reports/country"
      range={range}
    >
      <ReportFigures>
        <ReportFigure
          label="Countries"
          value={String(known.length)}
          detail="With at least one night"
          emphasis
        />
        {top && (
          <ReportFigure
            label="Biggest market"
            value={countryName(top.country)}
            detail={`${top.roomNights} night${top.roomNights === 1 ? "" : "s"}`}
          />
        )}
        <ReportFigure label="Room nights" value={String(nights)} />
        <ReportFigure
          label="Not recorded"
          value={unknown ? `${Math.round((unknown.roomNights / (nights || 1)) * 100)}%` : "0%"}
          detail="Of nights have no country"
        />
      </ReportFigures>

      <ReportTable<CountryRow>
        rows={rows}
        rowKey={(r) => r.country}
        minWidth="720px"
        emptyTitle="No nights were stayed in this range"
        emptyHint="Pick a range that covers dates guests have stayed."
        footLabel={`${rows.length} row${rows.length === 1 ? "" : "s"}`}
        note={
          <>
            Guests whose country was never recorded are counted under
            &ldquo;Unknown&rdquo; rather than left out, so the percentages are
            of the real total. That row shrinking is the measure of how well the
            desk is filling the field in — it is set on the customer, under
            Identity. Nights are counted, not bookings, so a long stay weighs
            what it is worth.
          </>
        }
        columns={[
          {
            header: "Country",
            cell: (r) => (
              <span
                className={
                  r.country === "Unknown"
                    ? "text-ink-faint"
                    : "font-medium text-ink"
                }
              >
                {countryName(r.country)}
              </span>
            ),
          },
          {
            header: "Bookings",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{r.bookings}</span>,
          },
          {
            header: "Guests",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{r.guests}</span>,
            foot: String(guests),
          },
          {
            header: "Room nights",
            align: "right",
            cell: (r) => <span className="tnum font-medium text-ink">{r.roomNights}</span>,
            foot: String(nights),
          },
          {
            header: "Share",
            align: "right",
            cell: (r) => (
              <span className="tnum text-ink-faint">
                {nights > 0 ? `${Math.round((r.roomNights / nights) * 100)}%` : "—"}
              </span>
            ),
          },
          {
            header: "Revenue",
            align: "right",
            cell: (r) => <span className="tnum text-ink-muted">{formatMoney(r.revenueCents)}</span>,
            foot: formatMoney(revenue),
          },
        ]}
      />
    </ReportShell>
  );
}
