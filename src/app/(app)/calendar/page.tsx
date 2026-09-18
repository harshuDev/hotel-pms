import { addDays, format, isValid, parseISO, subDays } from "date-fns";
import { EmptyState, PageHeader } from "@/components/ui";
import { CalendarBoard } from "@/components/calendar/calendar-board";
import {
  CALENDAR_MAX_BARS_PER_TYPE,
  CALENDAR_NIGHTS,
  getBusinessDate,
  getCalendarAvailability,
  getCalendarBookings,
  getCalendarSeasons,
  getRoomStatusByType,
} from "@/lib/queries";

export const metadata = { title: "Calendar" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Narrower than a week is unreadable; wider than a month draws nothing legible. */
const MIN_DAYS = 7;
const MAX_DAYS = 35;

function startDate(businessDate: string, from: string | undefined) {
  if (from && ISO_DATE.test(from) && isValid(parseISO(from))) return from;
  return businessDate;
}

function span(raw: string | undefined) {
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return CALENDAR_NIGHTS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const from = startDate(businessDate, sp.from);
  const days = span(sp.days);

  // Four reads, deliberately. The counts answer "can I sell tonight" and the
  // bars answer "who is in, and when"; neither is the other. Cancelled rooms
  // come back separately because they belong in their own row, not among the
  // live ones where they would read as sold.
  const [cells, bars, canceledBars, seasons, status] = await Promise.all([
    getCalendarAvailability(from, days),
    getCalendarBookings(from, days, CALENDAR_MAX_BARS_PER_TYPE),
    getCalendarBookings(from, days, CALENDAR_MAX_BARS_PER_TYPE, true),
    getCalendarSeasons(from, days),
    // Housekeeping, for the dot on the rail. It is counts per type, not a room
    // list, so it stays the same size at 40 rooms and at 1,800.
    getRoomStatusByType(),
  ]);

  const dates = Array.from({ length: days }, (_, i) =>
    format(addDays(parseISO(from), i), "yyyy-MM-dd"),
  );
  const types = [...new Map(cells.map((c) => [c.roomTypeId, c])).values()];
  const cellAt = new Map(cells.map((c) => [`${c.roomTypeId}|${c.date}`, c]));
  const statusByType = new Map(status.map((s) => [s.roomTypeId, s]));

  const barsByType = new Map<string, typeof bars>();
  for (const bar of bars) {
    const list = barsByType.get(bar.roomTypeId);
    if (list) list.push(bar);
    else barsByType.set(bar.roomTypeId, [bar]);
  }

  const href = (nextFrom: string, nextDays: number) =>
    `/calendar?from=${nextFrom}&days=${nextDays}`;

  const shiftHref = (by: number) =>
    href(
      format(
        by < 0
          ? subDays(parseISO(from), Math.abs(by))
          : addDays(parseISO(from), by),
        "yyyy-MM-dd",
      ),
      days,
    );

  const spanHref = (by: number) =>
    href(from, Math.min(MAX_DAYS, Math.max(MIN_DAYS, days + by)));

  const capped = [...barsByType.values()].some(
    (list) => (list[0]?.typeTotal ?? 0) > list.length,
  );

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Who is in, by room type, night by night"
      />

      {types.length === 0 ? (
        <div className="rounded-lg border border-line bg-white p-4 shadow-card">
          <EmptyState
            title="No room types are set up"
            hint="Add room types and rooms in Settings before the calendar can show anything."
          />
        </div>
      ) : (
        <>
          <CalendarBoard
            dates={dates}
            businessDate={businessDate}
            types={types}
            cellAt={cellAt}
            barsByType={barsByType}
            canceledBars={canceledBars}
            seasons={seasons}
            statusByType={statusByType}
            jumpAction="/calendar"
            shiftHref={shiftHref}
            spanHref={spanHref}
            todayHref={href(businessDate, days)}
            days={days}
          />

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-faint">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Nothing to clean
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> Rooms waiting to be cleaned
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-400" /> All out of order
            </span>
            <span>
              The dot is housekeeping — hover it for the breakdown. Bars are
              bookings; click one to open it. The faint figure in each cell is
              rooms still free to sell that night.
            </span>
          </div>

          {capped && (
            <p className="mt-2 text-xs leading-relaxed text-warn-deep">
              Some room types have more bookings than the board draws. The rail
              says how many of how many are shown. Narrow the dates to see fewer
              at a time.
            </p>
          )}

          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            Rows are room types, not rooms. A property can run well over a
            thousand rooms, and a row each would be unusable. A bar covers the
            nights stayed and stops at the departure morning, which is not a
            night. The band across the top is the season covering those dates;
            seasons are named in Settings and change no price.
          </p>
        </>
      )}
    </div>
  );
}
