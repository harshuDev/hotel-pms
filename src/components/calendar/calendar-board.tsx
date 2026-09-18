import Link from "next/link";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { DateJump } from "@/components/calendar/date-jump";
import type {
  AvailabilityCell,
  BookingStatus,
  CalendarBar,
  CalendarSeason,
  RoomTypeStatus,
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

/**
 * Width of the room-type rail, in pixels — the default, which the + and −
 * controls move.
 *
 * Those two size the rail and nothing else. They were first built to widen and
 * narrow the date range, which was wrong: in the reference they make the blue
 * room column bigger or smaller, so a long room type name can be read in full
 * without the dates moving underneath it.
 */
const RAIL_DEFAULT_W = 180;
/** Narrow enough to be a strip, wide enough for the longest room type name. */
export const RAIL_MIN_W = 120;
export const RAIL_MAX_W = 320;
export const RAIL_STEP = 30;

/** Keeps a width from a URL inside what the board can actually draw. */
export function clampRail(width: number) {
  if (!Number.isFinite(width)) return RAIL_DEFAULT_W;
  return Math.min(RAIL_MAX_W, Math.max(RAIL_MIN_W, Math.round(width)));
}
/** Width of one date column. Wide enough for "19 Saturday" without wrapping. */
const COL_W = 118;
/**
 * The date header. The season band sticks to exactly this offset.
 *
 * Tall enough for three rows in the corner — DATE and the span controls, TODAY,
 * and the date jump. At two rows they shared a line and the "−" was pushed off
 * the end of the rail entirely.
 */
const HEAD_H = 74;
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
/**
 * How tall the board gets before it scrolls rather than pushing the page.
 *
 * Measured off the window rather than fixed, so the board fills the screen it
 * is on. At a fixed 620px it stopped well short of the bottom on a desk
 * monitor and the page below it was empty, which is what the client saw.
 * The subtraction is the chrome above it: the two sticky bars, the page
 * heading and the card's own margin.
 */
const MAX_H = "calc(100vh - 200px)";
/** Never so short that the header, the band and a row do not fit. */
const MIN_H = 360;

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

/**
 * The dot beside a room type: housekeeping, not availability.
 *
 * It used to report how tight the window was, which is what every cell on that
 * row already says. The reference system's dot is the clean status — hover it
 * and it says so — and that was the better use of the one mark on the rail.
 *
 * Aggregated, because a row is a room type and not a room. Rose while anything
 * is waiting, slate when the whole type is out of order, emerald when there is
 * nothing to do.
 */
function cleanDot(status: RoomTypeStatus | undefined) {
  if (!status || status.totalRooms === 0) return "bg-white/30";
  if (status.vacantDirty > 0) return "bg-rose-500";
  if (status.outOfOrder === status.totalRooms) return "bg-slate-400";
  return "bg-emerald-400";
}

/** What that dot means, in the words a receptionist would use. */
function cleanLabel(status: RoomTypeStatus | undefined) {
  if (!status || status.totalRooms === 0) return "No rooms on this type";
  const parts: string[] = [];
  if (status.vacantDirty > 0) parts.push(`${status.vacantDirty} to clean`);
  if (status.occupied > 0) parts.push(`${status.occupied} occupied`);
  if (status.vacantClean > 0) parts.push(`${status.vacantClean} ready`);
  if (status.outOfOrder > 0) parts.push(`${status.outOfOrder} out of order`);
  return `Room clean status: ${parts.join(", ")}`;
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
              "absolute flex flex-col justify-between overflow-hidden border-2 bg-white pl-2 pt-1 shadow-card transition hover:shadow-lift",
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
              {/*
                The reference marks a booking somebody has left a note on with
                a speech bubble here. It is the thing a receptionist scanning
                the board is looking for before they pick up the phone.
              */}
              {bar.hasNotes && (
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden
                  className="h-3 w-3 shrink-0 fill-ink-faint"
                >
                  <path d="M2 3.2A1.2 1.2 0 0 1 3.2 2h9.6A1.2 1.2 0 0 1 14 3.2v6.4a1.2 1.2 0 0 1-1.2 1.2H6.6L3.4 13.6a.5.5 0 0 1-.8-.4v-2.4A1.2 1.2 0 0 1 2 9.6z" />
                </svg>
              )}
              {bar.roomNumber && (
                <span className="tnum shrink-0 rounded bg-shell px-1 text-xxs font-semibold text-ink-muted">
                  {bar.roomNumber}
                </span>
              )}
              <span className="truncate">{bar.guestName}</span>
            </span>
            <span className="flex items-end justify-between gap-1">
              <span className="tnum mb-1 flex items-center gap-1 text-xxs text-ink-muted">
                <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 fill-current">
                  <circle cx="8" cy="5" r="2.6" />
                  <path d="M2.6 14a5.4 5.4 0 0 1 10.8 0z" />
                </svg>
                {bar.guests}
              </span>
              <span
                // Flush into the corner, like the reference's, rather than
                // floating inside the bar with padding all round it.
                className={cn(
                  "tnum shrink-0 rounded-tl px-1 text-xxs font-semibold text-white",
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
  bookHref,
}: {
  dates: string[];
  businessDate: string;
  cells?: Map<string, AvailabilityCell>;
  withFoot: boolean;
  /**
   * Where an empty cell goes when clicked — the booking form, with that date
   * and room type already chosen. Bars sit above these, so clicking a booking
   * still opens the booking.
   */
  bookHref?: (date: string) => string;
}) {
  return (
    <div className="absolute inset-0 flex">
      {dates.map((d) => {
        const cell = cells?.get(d);
        const tone = cn(
          "flex shrink-0 flex-col justify-end border-r border-board-line last:border-r-0",
          d === businessDate
            ? "bg-board-today"
            : d < businessDate
              ? "bg-board-past"
              : "bg-board",
          bookHref &&
            "transition-colors hover:bg-brass-wash focus-visible:bg-brass-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass",
        );
        const width = { width: COL_W };
        const figure =
          withFoot && cell ? (
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
          ) : null;

        // Two branches rather than a component held in a variable: the union of
        // a Link and a div does not typecheck, and spreading props onto it
        // hides which element actually renders.
        if (!bookHref) {
          return <div key={d} className={tone} style={width}>{figure}</div>;
        }
        return (
          <Link
            key={d}
            href={bookHref(d)}
            title={`Take a booking arriving ${format(parseISO(d), "d MMM")}`}
            className={tone}
            style={width}
          >
            {figure}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A standing row under the room types — Holding and Cancelled.
 *
 * Both draw bars that must not sit on a room-type row, and both keep a row's
 * worth of height when empty so the board does not jump as bookings move in
 * and out of them. One component rather than two copies, because the only
 * thing that differs is the label.
 */
function ExtraRow({
  label,
  hint,
  bars,
  dates,
  businessDate,
  railW,
  gridW,
  railCell,
}: {
  label: string;
  hint: string;
  bars: CalendarBar[];
  dates: string[];
  businessDate: string;
  railW: number;
  gridW: number;
  railCell: string;
}) {
  const { placed, lanes } = packLanes(bars, dates);
  const rowH = rowHeight(lanes, false);

  return (
    <div className="flex items-stretch">
      <div className={cn(railCell, "px-3 py-2")} style={{ width: railW }}>
        <div className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-white/80">
          {label}
        </div>
        <div className="text-xxs leading-tight text-white/50">{hint}</div>
      </div>
      <div
        className="relative border-b border-board-line"
        style={{ width: gridW, minHeight: rowH }}
      >
        <DayCells dates={dates} businessDate={businessDate} withFoot={false} />
        <Bars placed={placed} />
      </div>
    </div>
  );
}

export function CalendarBoard({
  dates,
  businessDate,
  types,
  cellAt,
  barsByType,
  holdingBars,
  canceledBars,
  seasons,
  statusByType,
  shiftHref,
  railHref,
  todayHref,
  basePath,
  bookHref,
  days,
  railW = RAIL_DEFAULT_W,
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
  /** Pending bookings: not sold, so they sit in Holding, not on a type. */
  holdingBars: CalendarBar[];
  canceledBars: CalendarBar[];
  seasons: CalendarSeason[];
  statusByType: Map<string, RoomTypeStatus>;
  shiftHref: (days: number) => string;
  /** Where + and − go: they size the rail, not the date range. */
  railHref: (delta: number) => string;
  todayHref: string;
  /** The route the board lives on; the date picker builds its own hrefs. */
  basePath: string;
  /**
   * An empty cell opens the booking form with that arrival and room type
   * already chosen. The reference opens a small dialog in place; this goes to
   * the one form that takes a booking, rather than standing up a second one
   * that would have to be kept in step with it.
   */
  bookHref: (date: string, roomTypeId: string) => string;
  days: number;
  railW?: number;
}) {
  const gridW = dates.length * COL_W;
  const first = parseISO(dates[0]);

  const railCell =
    "sticky left-0 z-10 shrink-0 border-b border-r border-chrome-700 bg-chrome-800";

  return (
    /*
      The card fills the width; the GRID inside it keeps a fixed geometry.
      Those are different things, and the card used to be `w-fit`, which left a
      band of empty page to its right whenever the dates did not happen to fill
      the screen. Columns still cannot stretch — bars are positioned by
      arithmetic over `COL_W`, so a flexible column would put every bar in the
      wrong place — but that is the inner element's width, set below, not this
      one's.
    */
    <div className="relative w-full overflow-hidden rounded-lg border border-line shadow-card">
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
        style={{ left: railW + 6, top: HEAD_H + (SEASON_H - 20) / 2 }}
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
      {/*
        A height, not a max-height. The board used to stop where its rows
        stopped, leaving a band of empty page underneath it whenever the hotel
        had few room types — which is the space the client pointed at. Filling
        the window puts the grid surface there instead, the way the reference
        system's board runs to the bottom of the screen.
      */}
      <div className="overflow-auto" style={{ height: MAX_H, minHeight: MIN_H }}>
        {/* min-h-full + column, so the filler at the foot can take the slack. */}
        <div className="flex min-h-full flex-col" style={{ width: railW + gridW }}>
          {/* Date header */}
          <div className="sticky top-0 z-30 flex" style={{ height: HEAD_H }}>
            <div
              className={cn(railCell, "z-40 px-3 py-1.5")}
              style={{ width: railW }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xxs font-semibold uppercase tracking-[0.12em] text-white/70">
                  Date
                </span>
                <span className="flex items-center gap-1">
                  <Link
                    href={railHref(RAIL_STEP)}
                    aria-label="Widen the room column"
                    title="Widen the room column"
                    className="flex h-4 w-4 items-center justify-center rounded-sm bg-white/15 text-xs leading-none text-white hover:bg-white/30"
                  >
                    +
                  </Link>
                  <Link
                    href={railHref(-RAIL_STEP)}
                    aria-label="Narrow the room column"
                    title="Narrow the room column"
                    className="flex h-4 w-4 items-center justify-center rounded-sm bg-white/15 text-xs leading-none text-white hover:bg-white/30"
                  >
                    −
                  </Link>
                </span>
              </div>
              <Link
                href={todayHref}
                className="mt-0.5 block text-xxs font-semibold uppercase tracking-[0.12em] text-white hover:underline"
              >
                Today
              </Link>
              {/*
                Paging a month at a time is fine for next week and useless for
                next November. This opens a month you can see and click — the
                native date input drew one only behind a small icon in an
                18px field on a dark rail, which the client rightly did not
                read as a calendar at all.
              */}
              <div className="mt-1">
                <DateJump
                  from={dates[0]}
                  businessDate={businessDate}
                  basePath={basePath}
                  railW={railW}
                />
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
            <div className={cn(railCell, "z-30")} style={{ width: railW }} />
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
                      style={{ left: railW + 28 }}
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
            const byDate = new Map(
              dates
                .map((d) => cellAt.get(`${t.roomTypeId}|${d}`))
                .filter((c): c is AvailabilityCell => Boolean(c))
                .map((c) => [c.date, c] as const),
            );
            const total = bars[0]?.typeTotal ?? 0;

            return (
              <div key={t.roomTypeId} className="flex items-stretch">
                <div
                  className={cn(railCell, "group/rail relative px-3 py-2")}
                  style={{ width: railW }}
                >
                  {/*
                    Renaming a room type belongs in Settings, so this is a way
                    in rather than a second editor. It appears on hover and on
                    keyboard focus — hover alone would hide it from anyone
                    working by tab, which a front desk does.
                  */}
                  <Link
                    href={`/settings?tab=room-types&edit=${t.roomTypeId}`}
                    title={`Rename ${t.roomTypeCode} in Settings`}
                    aria-label={`Rename ${t.roomTypeCode} in Settings`}
                    className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded bg-white/15 text-white opacity-0 transition hover:bg-white/30 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-white group-hover/rail:opacity-100"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 fill-current">
                      <path d="M11.5 1.5a1.7 1.7 0 0 1 2.4 2.4l-.8.8-2.4-2.4zM9.6 3.4 2 11v2.4h2.4L12 5.8z" />
                    </svg>
                  </Link>

                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate pr-6 text-[12.5px] font-bold uppercase tracking-[0.06em] text-white">
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
                      title={cleanLabel(statusByType.get(t.roomTypeId))}
                      className={cn(
                        "mt-6 h-2.5 w-2.5 shrink-0 rounded-full",
                        cleanDot(statusByType.get(t.roomTypeId)),
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
                    bookHref={(d) => bookHref(d, t.roomTypeId)}
                  />
                  <Bars placed={placed} />
                </div>
              </div>
            );
          })}

          {/*
            The two standing rows, below the room types and off the live ones.

            HOLDING holds the bookings nobody has confirmed yet — the guest
            booking page creates them `pending`, and the night audit
            deliberately never sweeps them. Keeping them off the room-type rows
            is the point: a pending booking is not sold, and a bar sitting on a
            type reads as though it were.

            CANCELLED is the same argument from the other end — released rooms
            that would read as sold if they sat among the live ones.
          */}
          <ExtraRow
            label="Holding area"
            hint={
              holdingBars.length === 0
                ? "Nothing waiting"
                : `${holdingBars.length} awaiting confirmation`
            }
            bars={holdingBars}
            dates={dates}
            businessDate={businessDate}
            railW={railW}
            gridW={gridW}
            railCell={railCell}
          />
          <ExtraRow
            label="Cancelled"
            hint={
              canceledBars.length === 0
                ? "None in these dates"
                : "Rooms back on sale"
            }
            bars={canceledBars}
            dates={dates}
            businessDate={businessDate}
            railW={railW}
            gridW={gridW}
            railCell={railCell}
          />

          {/*
            Takes whatever height is left so the rail and the grid surface run
            to the bottom of the board. Without it the rows stop mid-card and
            the remainder is flat white, which reads as the board having failed
            to load rather than as a hotel with four room types.
          */}
          <div className="flex min-h-0 flex-1 items-stretch" aria-hidden>
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-chrome-700 bg-chrome-800"
              style={{ width: railW }}
            />
            <div className="bg-board" style={{ width: gridW }} />
          </div>
        </div>
      </div>
    </div>
  );
}
