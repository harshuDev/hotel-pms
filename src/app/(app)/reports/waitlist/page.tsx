import { ReportShell } from "@/components/reports/report-shell";
import { ReportNoAccess } from "@/components/reports/report-table";
import { WaitlistScreen } from "@/components/reports/waitlist-screen";
import { reportRange } from "@/lib/reports";
import {
  ReportAccessError,
  getBusinessDate,
  getCurrentStaffUser,
  getRoomTypeSettings,
  getWaitlistReport,
} from "@/lib/queries";
import type { WaitlistRow, WaitlistStatus } from "@/lib/types";

export const metadata = { title: "Booking waitlist report" };

const STATUSES: WaitlistStatus[] = [
  "waiting",
  "offered",
  "converted",
  "expired",
  "canceled",
];

/**
 * Who is waiting for dates the hotel could not sell.
 *
 * Ranged on the ARRIVAL they asked for, because that is what somebody works the
 * list against — "who wanted a room this weekend" — rather than the date they
 * rang.
 *
 * The default window is the range helper's, which looks backwards from the
 * business date; a waitlist is mostly a forward-looking thing, so the page
 * widens it to the next three months when nobody has said otherwise.
 */
export default async function WaitlistReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();

  // From today rather than back from it: an entry for last month is history,
  // and the list is worked forwards.
  const range = sp.from || sp.to
    ? reportRange(businessDate, sp.from, sp.to)
    : { from: businessDate, to: addDays(businessDate, 90) };

  const status = STATUSES.includes(sp.status as WaitlistStatus)
    ? (sp.status as WaitlistStatus)
    : null;

  let rows: WaitlistRow[];
  try {
    rows = await getWaitlistReport(range.from, range.to, status);
  } catch (error) {
    if (error instanceof ReportAccessError) {
      return (
        <ReportShell title="Booking waitlist" >
          <ReportNoAccess />
        </ReportShell>
      );
    }
    throw error;
  }

  const [staff, roomTypes] = await Promise.all([
    getCurrentStaffUser(),
    getRoomTypeSettings(),
  ]);

  return (
    <ReportShell
      title="Booking waitlist"
      action="/reports/waitlist"
      range={range}
    >
      <WaitlistScreen
        rows={rows}
        roomTypes={roomTypes}
        businessDate={businessDate}
        canEdit={
          staff !== null &&
          ["admin", "manager", "front_desk"].includes(staff.role)
        }
      />
    </ReportShell>
  );
}

/** Plain date arithmetic on an ISO string, so nothing touches server local time. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
