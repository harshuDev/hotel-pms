import Link from "next/link";
import { addDays, format, isValid, parseISO, subDays } from "date-fns";
import { EmptyState, PageHeader, cn } from "@/components/ui";
import {
  CALENDAR_NIGHTS,
  getBusinessDate,
  getCalendarAvailability,
} from "@/lib/queries";
import type { AvailabilityCell } from "@/lib/types";

export const metadata = { title: "The Grand Hotel — Calendar" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function startDate(businessDate: string, from: string | undefined) {
  if (from && ISO_DATE.test(from) && isValid(parseISO(from))) return from;
  return businessDate;
}

/** Availability reads by pressure, not by exact count, at a glance. */
function cellTone(cell: AvailabilityCell) {
  if (cell.sellable === 0) return "bg-shell text-ink-faint";
  if (cell.available < 0) return "bg-rose-50 text-rose-700 font-semibold";
  if (cell.available === 0) return "bg-warn-wash text-warn-deep font-semibold";
  if (cell.available <= Math.max(1, Math.round(cell.sellable * 0.15)))
    return "bg-warn-wash/60 text-warn-deep";
  return "text-ink";
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const from = startDate(businessDate, sp.from);
  const cells = await getCalendarAvailability(from, CALENDAR_NIGHTS);

  const dates = [...new Set(cells.map((c) => c.date))].sort();
  const types = [...new Map(cells.map((c) => [c.roomTypeId, c])).values()];
  const at = new Map(cells.map((c) => [`${c.roomTypeId}|${c.date}`, c]));

  const shift = (days: number) =>
    `/calendar?from=${format(
      days < 0
        ? subDays(parseISO(from), Math.abs(days))
        : addDays(parseISO(from), days),
      "yyyy-MM-dd",
    )}`;

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Rooms free to sell, by room type, night by night"
        action={
          <div className="flex items-center gap-2">
            <Link
              href={shift(-CALENDAR_NIGHTS)}
              className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              Earlier
            </Link>
            <Link
              href="/calendar"
              className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              Today
            </Link>
            <Link
              href={shift(CALENDAR_NIGHTS)}
              className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              Later
            </Link>
          </div>
        }
      />

      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        {types.length === 0 ? (
          <EmptyState
            title="No room types are set up"
            hint="Add room types and rooms before the calendar can show anything to sell."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white px-3 pb-2.5 text-left text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                      Room type
                    </th>
                    {dates.map((d) => {
                      const day = parseISO(d);
                      const weekend = [5, 6].includes(day.getDay());
                      return (
                        <th
                          key={d}
                          className={cn(
                            "min-w-[46px] px-1 pb-2.5 text-center text-xxs font-semibold uppercase tracking-[0.06em]",
                            d === businessDate
                              ? "text-brass"
                              : weekend
                                ? "text-ink-muted"
                                : "text-ink-faint",
                          )}
                        >
                          <span className="block">{format(day, "EEE")}</span>
                          <span className="tnum block text-[11px] font-normal">
                            {format(day, "d MMM")}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.roomTypeId}>
                      <td className="sticky left-0 z-10 whitespace-nowrap border-t border-line bg-white px-3 py-2.5">
                        <span className="font-medium text-ink">
                          {t.roomTypeName}
                        </span>
                        <span className="tnum ml-1.5 text-xxs text-ink-faint">
                          {t.totalRooms} room{t.totalRooms === 1 ? "" : "s"}
                        </span>
                      </td>
                      {dates.map((d) => {
                        const cell = at.get(`${t.roomTypeId}|${d}`);
                        if (!cell) {
                          return (
                            <td
                              key={d}
                              className="border-t border-line px-1 py-2.5 text-center text-ink-faint"
                            >
                              —
                            </td>
                          );
                        }
                        return (
                          <td
                            key={d}
                            title={`${cell.sold} sold of ${cell.sellable} sellable${
                              cell.outOfOrder > 0
                                ? `, ${cell.outOfOrder} out of order`
                                : ""
                            }`}
                            className={cn(
                              "tnum border-t border-line px-1 py-2.5 text-center",
                              cellTone(cell),
                            )}
                          >
                            {cell.available}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              Each figure is rooms still free to sell that night: sellable rooms
              less rooms sold. A negative number means the night is overbooked,
              and is shown rather than hidden. Rows are room types, not rooms —
              a property can run well over a thousand rooms, and a grid with one
              row each would be unusable.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
