import Link from "next/link";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import type { AvailabilityCell, BookingStatus, CalendarBar } from "@/lib/types";

/**
 * The calendar board: room types down the side, dates across the top, one bar
 * per booked room across the nights it covers.
 *
 * Cloned from the tape chart in the client's reference system, which they
 * asked for by name. Two things about it are ours rather than theirs, and both
 * are noted where they appear: the faint figure in each cell, which is what
 * this screen used to be and is the only thing on it that answers "can I sell
 * tonight"; and the bar colours, which carry booking status rather than being
 * uniform, because the information was free.
 *
 * Rows are room types, never rooms. A property may run ~1,800 rooms and a row
 * each would be unusable — the same reason the dashboard has a house board and
 * not a key rack.
 */

/** Width of the room-type rail, in pixels. */
const RAIL_W = 156;
/** Width of one date column. Wide enough for "19 Saturday" without wrapping. */
const COL_W = 116;
const BAR_H = 26;
const BAR_GAP = 4;
const ROW_PAD = 7;
/**
 * The strip under the bars where each cell's free-to-sell figure sits.
 *
 * It is reserved rather than overlaid: the figure and the first lane of bars
 * were drawn in the same place, so on any row with a booking the number
 * vanished under it — which is worse than not showing it, because the cells
 * without a booking still showed one and the row read as partly blank.
 */
const FOOT_H = 18;

/**
 * A bar carries its booking's status, which the reference system's bars do not.
 * White fill with a coloured edge keeps the reference's look and says which
 * kind of booking it is without a legend.
 */
const BAR_TONE: Record<BookingStatus, string> = {
  pending: "border-warn/70 ring-warn/25",
  confirmed: "border-brass/60 ring-brass/20",
  checked_in: "border-emerald-500/70 ring-emerald-500/20",
  checked_out: "border-slate-300 ring-slate-200",
  canceled: "border-line ring-line",
  no_show: "border-line ring-line",
};

interface Placed extends CalendarBar {
  lane: number;
  startIdx: number;
  endIdx: number;
  clipLeft: boolean;
  clipRight: boolean;
}

/**
 * Packs a room type's bars into lanes so overlapping stays sit above one
 * another rather than on top of one another.
 *
 * Greedy, over bars already sorted by arrival: each takes the first lane whose
 * last bar has ended. This is layout, not aggregation — the counting all
 * happens in Postgres.
 */
function packLanes(bars: CalendarBar[], dates: string[]) {
  const first = parseISO(dates[0]);
  const sorted = [...bars].sort(
    (a, b) =>
      a.checkIn.localeCompare(b.checkIn) || a.reference.localeCompare(b.reference),
  );

  const laneEnds: number[] = [];
  const placed: Placed[] = sorted.map((bar) => {
    const rawStart = differenceInCalendarDays(parseISO(bar.checkIn), first);
    const rawEnd = differenceInCalendarDays(parseISO(bar.checkOut), first);
    const startIdx = Math.max(0, rawStart);
    const endIdx = Math.min(dates.length, rawEnd);

    let lane = laneEnds.findIndex((end) => end <= startIdx);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endIdx);
    } else {
      laneEnds[lane] = endIdx;
    }

    return {
      ...bar,
      lane,
      startIdx,
      endIdx,
      clipLeft: rawStart < 0,
      clipRight: rawEnd > dates.length,
    };
  });

  return { placed, lanes: Math.max(1, laneEnds.length) };
}

/** The dot beside a room type: how tight the whole window is, at a glance. */
function pressureDot(cells: AvailabilityCell[]) {
  if (cells.length === 0) return "bg-line";
  const tightest = Math.min(...cells.map((c) => c.available));
  if (tightest < 0) return "bg-rose-500";
  if (tightest === 0) return "bg-warn";
  const smallest = Math.min(
    ...cells.map((c) => Math.max(1, Math.round(c.sellable * 0.15))),
  );
  if (tightest <= smallest) return "bg-warn/60";
  return "bg-emerald-500";
}

export function CalendarBoard({
  dates,
  businessDate,
  types,
  cellAt,
  barsByType,
  shiftHref,
  spanHref,
  todayHref,
  days,
}: {
  dates: string[];
  businessDate: string;
  types: { roomTypeId: string; roomTypeCode: string; roomTypeName: string; totalRooms: number }[];
  cellAt: Map<string, AvailabilityCell>;
  barsByType: Map<string, CalendarBar[]>;
  shiftHref: (days: number) => string;
  spanHref: (days: number) => string;
  todayHref: string;
  days: number;
}) {
  const gridW = dates.length * COL_W;

  return (
    // w-fit so the card ends where the board does. The columns are a fixed
    // width because the bars are positioned by arithmetic over it; letting them
    // stretch to fill would put every bar in the wrong place.
    <div className="w-fit max-w-full overflow-hidden rounded-lg border border-line shadow-card">
      <div className="overflow-x-auto">
        <div style={{ minWidth: RAIL_W + gridW }}>
          {/* Date header */}
          <div className="flex border-b border-board-line bg-board-head">
            <div
              className="shrink-0 border-r border-board-line px-3 py-2"
              style={{ width: RAIL_W }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xxs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  Date
                </span>
                <span className="flex items-center gap-1">
                  <Link
                    href={spanHref(7)}
                    aria-label="Show a week more"
                    className="flex h-5 w-5 items-center justify-center rounded border border-line text-ink-muted hover:bg-shell hover:text-ink"
                  >
                    +
                  </Link>
                  <Link
                    href={spanHref(-7)}
                    aria-label="Show a week less"
                    className="flex h-5 w-5 items-center justify-center rounded border border-line text-ink-muted hover:bg-shell hover:text-ink"
                  >
                    −
                  </Link>
                </span>
              </div>
              <Link
                href={todayHref}
                className="mt-1 block text-xxs font-semibold uppercase tracking-[0.12em] text-brass hover:underline"
              >
                Today
              </Link>
            </div>

            <div className="relative flex" style={{ width: gridW }}>
              <Link
                href={shiftHref(-days)}
                aria-label="Earlier dates"
                className="absolute left-1 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink-muted shadow-card hover:text-ink"
              >
                ‹
              </Link>
              <Link
                href={shiftHref(days)}
                aria-label="Later dates"
                className="absolute right-1 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink-muted shadow-card hover:text-ink"
              >
                ›
              </Link>

              {dates.map((d, i) => {
                const day = parseISO(d);
                const isToday = d === businessDate;
                return (
                  <div
                    key={d}
                    className={cn(
                      "shrink-0 border-r border-board-line py-2 text-center last:border-r-0",
                      isToday && "bg-board-today",
                      i === 0 ? "pl-7 pr-2" : i === dates.length - 1 ? "pl-2 pr-7" : "px-2",
                    )}
                    style={{ width: COL_W }}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={cn(
                          "tnum font-display text-[15px] font-semibold tracking-tightest",
                          isToday
                            ? "flex h-6 w-6 items-center justify-center rounded-full bg-brass text-white"
                            : "text-ink",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      <span className="text-[12.5px] text-ink-muted">
                        {format(day, "EEEE")}
                      </span>
                    </div>
                    <div className="text-xxs text-ink-faint">
                      {format(day, "MMMM")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* One row per room type */}
          {types.map((t) => {
            const bars = barsByType.get(t.roomTypeId) ?? [];
            const { placed, lanes } = packLanes(bars, dates);
            const rowH =
              ROW_PAD + lanes * BAR_H + (lanes - 1) * BAR_GAP + FOOT_H;
            const cells = dates
              .map((d) => cellAt.get(`${t.roomTypeId}|${d}`))
              .filter((c): c is AvailabilityCell => Boolean(c));
            const shown = bars.length;
            const total = bars[0]?.typeTotal ?? 0;

            return (
              <div
                key={t.roomTypeId}
                className="flex items-stretch border-b border-board-line last:border-b-0"
              >
                <div
                  className="shrink-0 border-r border-board-line bg-board-head px-3 py-2.5"
                  style={{ width: RAIL_W }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink">
                        {t.roomTypeCode}
                      </div>
                      <div className="text-xxs leading-tight text-ink-muted">
                        {t.roomTypeName}
                      </div>
                      <div className="tnum mt-0.5 text-xxs text-ink-faint">
                        {t.totalRooms} room{t.totalRooms === 1 ? "" : "s"}
                        {total > shown && ` · ${shown} of ${total} shown`}
                      </div>
                    </div>
                    <span
                      title="How tight this room type is across the dates shown"
                      className={cn(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        pressureDot(cells),
                      )}
                    />
                  </div>
                </div>

                <div
                  className="relative bg-board"
                  style={{ width: gridW, minHeight: rowH }}
                >
                  {/* Cells. The figure is rooms still free to sell that night. */}
                  <div className="absolute inset-0 flex">
                    {dates.map((d) => {
                      const cell = cellAt.get(`${t.roomTypeId}|${d}`);
                      const isToday = d === businessDate;
                      return (
                        <div
                          key={d}
                          className={cn(
                            "flex shrink-0 flex-col justify-end border-r border-board-line last:border-r-0",
                            isToday && "bg-board-today",
                          )}
                          style={{ width: COL_W }}
                        >
                          {cell && (
                            <span
                              title={`${cell.sold} sold of ${cell.sellable} sellable`}
                              className={cn(
                                "tnum px-1.5 pb-1 text-right text-xxs leading-none",
                                cell.available < 0
                                  ? "font-semibold text-rose-600"
                                  : cell.available === 0
                                    ? "font-semibold text-warn-deep"
                                    : "text-ink-faint/70",
                              )}
                            >
                              {cell.available}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Bars */}
                  {placed.map((bar) => (
                    <Link
                      key={bar.bookingRoomId}
                      href={`/bookings/${bar.bookingId}`}
                      title={`${bar.reference} · ${bar.guestName} · ${format(
                        parseISO(bar.checkIn),
                        "d MMM",
                      )} to ${format(parseISO(bar.checkOut), "d MMM")}${
                        bar.roomNumber ? ` · room ${bar.roomNumber}` : ""
                      }`}
                      className={cn(
                        "absolute flex items-center gap-1.5 overflow-hidden whitespace-nowrap border bg-board-bar px-2 text-[12.5px] text-ink shadow-card ring-1 transition hover:shadow-lift",
                        BAR_TONE[bar.status],
                        bar.clipLeft ? "rounded-l-none border-l-0" : "rounded-l-md",
                        bar.clipRight ? "rounded-r-none border-r-0" : "rounded-r-md",
                      )}
                      style={{
                        left: bar.startIdx * COL_W + (bar.clipLeft ? 0 : 3),
                        width:
                          (bar.endIdx - bar.startIdx) * COL_W -
                          (bar.clipLeft ? 0 : 3) -
                          (bar.clipRight ? 0 : 3),
                        top: ROW_PAD + bar.lane * (BAR_H + BAR_GAP),
                        height: BAR_H,
                      }}
                    >
                      {bar.roomNumber && (
                        <span className="tnum shrink-0 rounded bg-shell px-1 text-xxs font-medium text-ink-muted">
                          {bar.roomNumber}
                        </span>
                      )}
                      <span className="truncate">{bar.guestName}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
