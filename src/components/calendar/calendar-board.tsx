import Link from "next/link";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import type {
  AvailabilityCell,
  BookingStatus,
  CalendarBar,
  CalendarSeason,
} from "@/lib/types";

/**
 * The calendar board: room types down the rail, dates across the top, one bar
 * per booked room across the nights it covers.
 *
 * Cloned from the tape chart in the client's reference system.
 *
 * **Scrolling is the part to be careful with.** One element scrolls in both
 * directions and everything freezes against it with `sticky`: the date header
 * and the season band hold their place down the page, the room-type rail holds
 * its place across, and the corner holds both. Splitting it into panes that
 * sync their scroll positions is the other way to do this and it always drifts
 * by a pixel on a trackpad. One scroller cannot drift from itself.
 *
 * Sticky offsets are arithmetic over the constants below, so the header and the
 * band must be exactly `HEAD_H` and `SEASON_H` tall. Padding them by eye puts
 * a gap between the two where rows show through.
 */

/** Width of the room-type rail, in pixels. */
const RAIL_W = 168;
/** Width of one date column. Wide enough for "19 Saturday" without wrapping. */
const COL_W = 118;
/** The date header. The season band sticks to exactly this offset. */
const HEAD_H = 54;
const SEASON_H = 24;
/** Two lines and a value badge, like the reference's. */
const BAR_H = 44;
const BAR_GAP = 4;
const ROW_PAD = 6;
/**
 * The strip under the bars where each cell's free-to-sell figure sits.
 *
 * Reserved rather than overlaid: drawn behind the bars, the figure vanished
 * under every booking while cells without one still showed theirs, so the row
 * read as half broken.
 */
const FOOT_H = 16;
/** How tall the board gets before it scrolls rather than pushing the page. */
const MAX_H = 620;

/**
 * A bar carries its booking's status on its edge, which the reference's do not.
 * White fill with a coloured edge keeps the look and says which kind of booking
 * it is without a legend.
 */
const BAR_TONE: Record<BookingStatus, { edge: string; badge: string }> = {
  pending: { edge: "border-warn", badge: "bg-warn" },
  confirmed: { edge: "border-brass", badge: "bg-brass" },
  checked_in: { edge: "border-emerald-500", badge: "bg-emerald-600" },
  checked_out: { edge: "border-slate-400", badge: "bg-slate-500" },
  canceled: { edge: "border-rose-400", badge: "bg-rose-500" },
  no_show: { edge: "border-rose-400", badge: "bg-rose-500" },
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
 * Greedy, over bars sorted by arrival: each takes the first lane whose last bar
 * has ended. Layout, not aggregation — the counting happens in Postgres.
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

    return { ...bar, lane, startIdx, endIdx, clipLeft: rawStart < 0, clipRight: rawEnd > dates.length };
  });

  return { placed, lanes: Math.max(1, laneEnds.length) };
}

function rowHeight(lanes: number, withFoot: boolean) {
  return (
    ROW_PAD * 2 +
    lanes * BAR_H +
    (lanes - 1) * BAR_GAP +
    (withFoot ? FOOT_H : 0)
  );
}

/** The dot beside a room type: how tight the whole window is, at a glance. */
function pressureDot(cells: AvailabilityCell[]) {
  if (cells.length === 0) return "bg-white/30";
  const tightest = Math.min(...cells.map((c) => c.available));
  if (tightest < 0) return "bg-rose-500";
  if (tightest === 0) return "bg-warn";
  const smallest = Math.min(
    ...cells.map((c) => Math.max(1, Math.round(c.sellable * 0.15))),
  );
  if (tightest <= smallest) return "bg-warn/70";
  return "bg-emerald-400";
}

function Bars({ placed }: { placed: Placed[] }) {
  return (
    <>
      {placed.map((bar) => {
        const tone = BAR_TONE[bar.status];
        return (
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
              "absolute flex flex-col justify-between overflow-hidden border-2 bg-white px-2 py-1 shadow-card transition hover:shadow-lift",
              tone.edge,
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
            <span className="flex items-center gap-1.5 truncate text-[12.5px] font-medium leading-none text-ink">
              {bar.roomNumber && (
                <span className="tnum shrink-0 rounded bg-shell px-1 text-xxs font-semibold text-ink-muted">
                  {bar.roomNumber}
                </span>
              )}
              <span className="truncate">{bar.guestName}</span>
            </span>
            <span className="flex items-end justify-between gap-1">
              <span className="tnum flex items-center gap-1 text-xxs text-ink-muted">
                <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 fill-current">
                  <circle cx="8" cy="5" r="2.6" />
                  <path d="M2.6 14a5.4 5.4 0 0 1 10.8 0z" />
                </svg>
                {bar.guests}
              </span>
              <span
                className={cn(
                  "tnum shrink-0 rounded px-1 text-xxs font-semibold text-white",
                  tone.badge,
                )}
              >
                {formatMoney(bar.valueCents)}
              </span>
            </span>
          </Link>
        );
      })}
    </>
  );
}

function DayCells({
  dates,
  businessDate,
  cells,
  withFoot,
}: {
  dates: string[];
  businessDate: string;
  cells?: Map<string, AvailabilityCell>;
  withFoot: boolean;
}) {
  return (
    <div className="absolute inset-0 flex">
      {dates.map((d) => {
        const cell = cells?.get(d);
        return (
          <div
            key={d}
            className={cn(
              "flex shrink-0 flex-col justify-end border-r border-board-line last:border-r-0",
              d === businessDate
                ? "bg-board-today"
                : d < businessDate
                  ? "bg-board-past"
                  : "bg-board",
            )}
            style={{ width: COL_W }}
          >
            {withFoot && cell && (
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
  );
}

export function CalendarBoard({
  dates,
  businessDate,
  types,
  cellAt,
  barsByType,
  canceledBars,
  seasons,
  shiftHref,
  spanHref,
  todayHref,
  days,
}: {
  dates: string[];
  businessDate: string;
  types: {
    roomTypeId: string;
    roomTypeCode: string;
    roomTypeName: string;
    totalRooms: number;
  }[];
  cellAt: Map<string, AvailabilityCell>;
  barsByType: Map<string, CalendarBar[]>;
  canceledBars: CalendarBar[];
  seasons: CalendarSeason[];
  shiftHref: (days: number) => string;
  spanHref: (days: number) => string;
  todayHref: string;
  days: number;
}) {
  const gridW = dates.length * COL_W;
  const first = parseISO(dates[0]);

  const railCell =
    "sticky left-0 z-10 shrink-0 border-b border-r border-chrome-700 bg-chrome-800";

  return (
    // w-fit so the card ends where the board does. Columns are a fixed width
    // because bars are positioned by arithmetic over it; letting them stretch
    // to fill would put every bar in the wrong place.
    <div className="relative w-fit max-w-full overflow-hidden rounded-lg border border-line shadow-card">
      {/*
        Paging sits OUTSIDE the scroller, over the season band. Inside it the
        two chevrons scrolled away with the dates, so once you had moved right
        there was no way left to page — the control vanished exactly when it
        was needed.
      */}
      <Link
        href={shiftHref(-days)}
        aria-label="Earlier dates"
        className="absolute z-40 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-ink-muted shadow-card hover:text-ink"
        style={{ left: RAIL_W + 6, top: HEAD_H + (SEASON_H - 20) / 2 }}
      >
        ‹
      </Link>
      <Link
        href={shiftHref(days)}
        aria-label="Later dates"
        className="absolute right-2 z-40 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-ink-muted shadow-card hover:text-ink"
        style={{ top: HEAD_H + (SEASON_H - 20) / 2 }}
      >
        ›
      </Link>
      {/* One scroller. Everything else freezes against it with `sticky`. */}
      <div className="overflow-auto" style={{ maxHeight: MAX_H }}>
        <div style={{ width: RAIL_W + gridW }}>
          {/* Date header */}
          <div className="sticky top-0 z-30 flex" style={{ height: HEAD_H }}>
            <div
              className={cn(railCell, "z-40 px-3 py-1.5")}
              style={{ width: RAIL_W }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xxs font-semibold uppercase tracking-[0.12em] text-white/70">
                  Date
                </span>
                <Link
                  href={spanHref(7)}
                  aria-label="Show a week more"
                  className="flex h-4 w-4 items-center justify-center rounded-sm bg-white/15 text-xs leading-none text-white hover:bg-white/30"
                >
                  +
                </Link>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <Link
                  href={todayHref}
                  className="text-xxs font-semibold uppercase tracking-[0.12em] text-white hover:underline"
                >
                  Today
                </Link>
                <Link
                  href={spanHref(-7)}
                  aria-label="Show a week less"
                  className="flex h-4 w-4 items-center justify-center rounded-sm bg-white/15 text-xs leading-none text-white hover:bg-white/30"
                >
                  −
                </Link>
              </div>
            </div>

            <div className="flex bg-white" style={{ width: gridW }}>
              {dates.map((d) => {
                const day = parseISO(d);
                const isToday = d === businessDate;
                return (
                  <div
                    key={d}
                    className={cn(
                      "shrink-0 border-b border-r border-board-line px-2 py-1.5 text-center last:border-r-0",
                      isToday ? "bg-white" : d < businessDate ? "bg-board-past" : "bg-white",
                    )}
                    style={{ width: COL_W }}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={cn(
                          "tnum font-display text-[15px] font-semibold tracking-tightest",
                          isToday
                            ? "flex h-[22px] w-[22px] items-center justify-center rounded-full bg-rose-500 text-white"
                            : "text-ink",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      <span className="text-[12.5px] text-ink">
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

          {/* Season band, frozen directly under the header */}
          <div
            className="sticky z-20 flex"
            style={{ top: HEAD_H, height: SEASON_H }}
          >
            <div className={cn(railCell, "z-30")} style={{ width: RAIL_W }} />
            <div
              className="relative border-b border-board-line bg-board"
              style={{ width: gridW }}
            >
              {seasons.map((s) => {
                const startIdx = Math.max(
                  0,
                  differenceInCalendarDays(parseISO(s.startsOn), first),
                );
                // ends_on is inclusive, so the band covers that day too.
                const endIdx = Math.min(
                  dates.length,
                  differenceInCalendarDays(parseISO(s.endsOn), first) + 1,
                );
                if (endIdx <= startIdx) return null;
                return (
                  <div
                    key={s.id}
                    // No `overflow-hidden` here: it would become the sticky
                    // containing block for the label below and pin it in place,
                    // which is exactly the bug this is meant to avoid.
                    className="absolute inset-y-0 flex items-center bg-board-season"
                    style={{
                      left: startIdx * COL_W,
                      width: (endIdx - startIdx) * COL_W,
                    }}
                  >
                    {/*
                      Sticky so the name rides the left edge of what is on
                      screen. Pinned to the band's start it scrolled out of
                      sight the moment you moved right, and the band then said
                      nothing at all.
                    */}
                    <span
                      className="sticky truncate whitespace-nowrap px-2 text-xxs font-bold uppercase tracking-[0.14em] text-white"
                      style={{ left: RAIL_W + 28 }}
                    >
                      {s.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* One row per room type */}
          {types.map((t) => {
            const bars = barsByType.get(t.roomTypeId) ?? [];
            const { placed, lanes } = packLanes(bars, dates);
            const rowH = rowHeight(lanes, true);
            const windowCells = dates
              .map((d) => cellAt.get(`${t.roomTypeId}|${d}`))
              .filter((c): c is AvailabilityCell => Boolean(c));
            const byDate = new Map(
              windowCells.map((c) => [c.date, c] as const),
            );
            const total = bars[0]?.typeTotal ?? 0;

            return (
              <div key={t.roomTypeId} className="flex items-stretch">
                <div
                  className={cn(railCell, "px-3 py-2")}
                  style={{ width: RAIL_W }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-bold uppercase tracking-[0.06em] text-white">
                        {t.roomTypeCode}
                      </div>
                      <div className="text-xxs leading-tight text-white/75">
                        {t.roomTypeName}
                      </div>
                      <div className="tnum mt-0.5 text-xxs text-white/50">
                        {t.totalRooms} room{t.totalRooms === 1 ? "" : "s"}
                        {total > bars.length && ` · ${bars.length} of ${total}`}
                      </div>
                    </div>
                    <span
                      title="How tight this room type is across the dates shown"
                      className={cn(
                        "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                        pressureDot(windowCells),
                      )}
                    />
                  </div>
                </div>

                <div
                  className="relative border-b border-board-line"
                  style={{ width: gridW, minHeight: rowH }}
                >
                  <DayCells
                    dates={dates}
                    businessDate={businessDate}
                    cells={byDate}
                    withFoot
                  />
                  <Bars placed={placed} />
                </div>
              </div>
            );
          })}

          {/* Cancelled, kept off the live rows so it cannot be misread as sold */}
          {(() => {
            const { placed, lanes } = packLanes(canceledBars, dates);
            const rowH = rowHeight(lanes, false);
            return (
              <div className="flex items-stretch">
                <div
                  className={cn(railCell, "px-3 py-2")}
                  style={{ width: RAIL_W }}
                >
                  <div className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-white/80">
                    Cancelled
                  </div>
                  <div className="text-xxs leading-tight text-white/50">
                    {canceledBars.length === 0
                      ? "None in these dates"
                      : "Rooms back on sale"}
                  </div>
                </div>
                <div
                  className="relative border-b border-board-line"
                  style={{ width: gridW, minHeight: rowH }}
                >
                  <DayCells
                    dates={dates}
                    businessDate={businessDate}
                    withFoot={false}
                  />
                  <Bars placed={placed} />
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
