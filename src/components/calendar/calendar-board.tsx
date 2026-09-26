import { Fragment } from "react";
import Link from "next/link";
import { AssignRoom } from "@/components/calendar/assign-room";
import type { AssignTypeGroup } from "@/components/calendar/assign-room";
import { RestoreBooking } from "@/components/calendar/restore-booking";
import { RoomStatusMenu } from "@/components/calendar/room-status-menu";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { DateJump } from "@/components/calendar/date-jump";
import { OpenOnToday } from "@/components/calendar/open-on-today";
import type {
  AvailabilityCell,
  BookingStatus,
  CalendarNote,
  CalendarRoom,
  CalendarRoomBar,
  RoomStatus,
  CalendarSeason,
} from "@/lib/types";
import { getPropertyCurrency } from "@/lib/queries";

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
 * The subtraction is the chrome above it: the two sticky bars and the page's
 * own padding. It dropped from 200 to 150 when the "Calendar" heading was
 * removed -- that row of height belongs to the board now.
 */
const MAX_H = "calc(100vh - 150px)";
/** Never so short that the header, the band and a row do not fit. */
const MIN_H = 360;
/**
 * The scroller's id.
 *
 * `OpenOnToday` is a client component and the board is a Server Component, so
 * it cannot be handed a ref -- React refuses to serialise one across that
 * boundary, the same wall the date picker's `hrefFor` and the search button's
 * `onSearchClick` both hit. An id crosses it as a string.
 */
const SCROLLER_ID = "calendar-scroller";

/**
 * A bar carries its booking's status on its edge, which the reference's do not.
 * White fill with a coloured edge keeps the look and says which kind of booking
 * it is without a legend.
 */
const BAR_TONE: Record<
  BookingStatus,
  { edge: string; badge: string; text: string }
> = {
  pending: { edge: "border-warn", badge: "bg-warn", text: "text-warn-deep" },
  confirmed: { edge: "border-brass", badge: "bg-brass", text: "text-brass" },
  checked_in: {
    edge: "border-emerald-500",
    badge: "bg-emerald-600",
    text: "text-emerald-700",
  },
  checked_out: {
    edge: "border-slate-400",
    badge: "bg-slate-500",
    text: "text-slate-600",
  },
  canceled: { edge: "border-rose-400", badge: "bg-rose-500", text: "text-rose-600" },
  no_show: { edge: "border-rose-400", badge: "bg-rose-500", text: "text-rose-600" },
};

/**
 * The status, in the words a front desk uses rather than the enum's.
 *
 * THE COLOUR IS NOT ENOUGH ON ITS OWN. A bar's edge has carried the status
 * since the board was built, but the legend that explained the colours was
 * removed at the client's request, so blue-means-confirmed and
 * green-means-in-house became something you either already knew or did not.
 * The word costs one line inside the bar and removes the guesswork; the colour
 * stays, because scanning forty bars for a colour is faster than reading them.
 */
const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  checked_in: "In house",
  checked_out: "Departed",
  canceled: "Cancelled",
  no_show: "No show",
};

/**
 * What the board needs of a bar, whichever read it came from.
 *
 * The board draws two shapes now: `CalendarBar` from the old type-keyed read,
 * which still feeds the Cancelled row, and `CalendarRoomBar` from the
 * room-keyed one. They agree on everything the layout and the bar markup
 * touch, so the helpers take this rather than either concrete type -- the
 * alternative is two copies of the lane packing, which would drift.
 *
 * `roomNumber` is optional because on a room row the row IS the room number,
 * so the bar has no need to repeat it.
 */
interface BoardBar {
  bookingId: string;
  bookingRoomId: string;
  reference: string;
  guestName: string;
  status: BookingStatus;
  checkIn: string;
  checkOut: string;
  guests: number;
  valueCents: number;
  hasNotes: boolean;
  roomNumber?: string | null;
  /**
   * What the room was sold as. Optional because the Cancelled row is fed by
   * `calendar_bookings()`, which does not return it, and null for any stay
   * taken before 0037 recorded a plan at all.
   */
  ratePlanName?: string | null;
}

interface Placed extends BoardBar {
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
function packLanes(bars: BoardBar[], dates: string[]) {
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

async function Bars({
  placed,
  roomsByType,
  soldTypeId,
  currentRoomId,
  backHref,
  bookingHref,
  canRestore,
}: {
  placed: Placed[];
  /**
   * The board's own URL, threaded onto every bar as `?back=`.
   *
   * A booking opened from the calendar is still a navigation to the booking
   * screen -- that screen IS the reservation workflow, and a second smaller
   * copy of it inside a dialog is the thing this codebase keeps refusing to
   * build. What it should not do is lose where you were, so the booking screen
   * sends you back to these dates and this rail width rather than to a board
   * reset to today.
   */
  backHref?: string;
  /**
   * Every room type and its rooms, so a bar can be placed in the type it was
   * sold or — deliberately, behind a second confirmation — upgraded into
   * another. Supplied on rows where placing a booking makes sense: the
   * Unassigned band, and the room rows themselves, where it becomes a move.
   * Omitted on Cancelled, where the booking holds nothing and giving it a room
   * would be a promise the hotel has not made.
   *
   * The board builds it ONCE and hands the same array to every bar, so the
   * room list crosses the server boundary once rather than once per booking.
   */
  roomsByType?: AssignTypeGroup[];
  /** The type this bar's booking was sold; its rooms open expanded. */
  soldTypeId?: string;
  currentRoomId?: string | null;
  /**
   * Opens the details popup over the board instead of navigating away, which
   * is what the client asked for. Absent, the bar falls back to the old
   * navigation, so a caller not given one still works.
   */
  bookingHref?: (bookingId: string) => string;
  /** Set only by the Cancelled band, which is the only place restoring makes
      sense: a live booking has nothing to restore. */
  canRestore?: boolean;
}) {
  const currency = await getPropertyCurrency();
  return (
    <>
      {placed.map((bar) => {
        const tone = BAR_TONE[bar.status];
        /*
         * How many date columns this bar spans, which is how much room its
         * bottom line has.
         *
         * Decided here rather than left to CSS truncation, because the width
         * is known exactly -- it is arithmetic over COL_W, the same arithmetic
         * that positions the bar. A one-night bar is 112px, and status, party
         * size, rate and value do not fit in it: the value badge sits at the
         * right and the status ran underneath it. Truncating instead would
         * have given "Confi...", which is worse than showing less.
         *
         * So the line sheds from the least useful end: the rate goes first,
         * then the party size. The status and the value never go.
         */
        const cols = bar.endIdx - bar.startIdx;
        return (
          <Link
            key={bar.bookingRoomId}
            /*
              The booking screen, which is where a reservation is read and
              changed. A page rather than a dialog because that IS the
              reservation workflow here -- the board does not hold a second,
              smaller copy of it.
            */
            /*
              The popup over the board, as the reference does. It used to
              navigate straight to /bookings/[id], which meant losing the dates
              and the rail width just to read a reference and a balance. The
              panel it opens links on to that page for anything that writes.
            */
            href={
              bookingHref
                ? bookingHref(bar.bookingId)
                : backHref
                  ? `/bookings/${bar.bookingId}?back=${encodeURIComponent(backHref)}`
                  : `/bookings/${bar.bookingId}`
            }
            title={[
              bar.reference,
              bar.guestName,
              `${format(parseISO(bar.checkIn), "d MMM")} to ${format(
                parseISO(bar.checkOut),
                "d MMM",
              )}`,
              STATUS_LABEL[bar.status],
              `${bar.guests} guest${bar.guests === 1 ? "" : "s"}`,
              bar.ratePlanName,
              bar.roomNumber ? `room ${bar.roomNumber}` : null,
              formatMoney(bar.valueCents, currency),
            ]
              .filter(Boolean)
              .join(" · ")}
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
              <span className="mb-1 flex min-w-0 items-center gap-1.5 text-xxs">
                {/*
                  Measured, not guessed: a one-night bar leaves 100px inside
                  its border, the value badge takes 56 of it, and "Confirmed"
                  wants 52. Something has to go, and the status is the one
                  thing on this bar with a second encoding — the edge colour
                  says it, and the tooltip spells it out. The value has no
                  such fallback, so it stays.
                */}
                {cols >= 2 && (
                  <span className={cn("shrink-0 font-semibold", tone.text)}>
                    {STATUS_LABEL[bar.status]}
                  </span>
                )}
                {cols >= 2 && (
                  <span className="tnum flex shrink-0 items-center gap-0.5 text-ink-muted">
                    <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 fill-current">
                      <circle cx="8" cy="5" r="2.6" />
                      <path d="M2.6 14a5.4 5.4 0 0 1 10.8 0z" />
                    </svg>
                    {bar.guests}
                  </span>
                )}
                {/*
                  What the room was sold as. Nothing is drawn when no plan was
                  recorded — a stay taken before 0037 has none, and a guess
                  would be worse than a blank.
                */}
                {cols >= 3 && bar.ratePlanName && (
                  <span className="truncate text-ink-faint">
                    {bar.ratePlanName}
                  </span>
                )}
              </span>
              <span
                // Flush into the corner, like the reference's, rather than
                // floating inside the bar with padding all round it.
                className={cn(
                  "tnum shrink-0 rounded-tl px-1 text-xxs font-semibold text-white",
                  tone.badge,
                )}
              >
                {formatMoney(bar.valueCents, currency)}
              </span>
            </span>
          </Link>
        );
      })}

      {/*
        The room picker sits OVER each bar, not inside it, for two separate
        reasons that happen to share a fix.

        A `<button>` inside an `<a>` is invalid HTML and browsers rearrange it
        during parsing, so the control simply vanished. And `Bars` is a Server
        Component: the wrapper that was going to stop the click from following
        the link carried an `onClick`, which React cannot serialise — the page
        500'd. As a sibling it needs neither. Same trap as the calendar's date
        picker and the search button before it.
      */}
      {roomsByType &&
        soldTypeId &&
        placed.map((bar) => (
          <span
            key={`assign-${bar.bookingRoomId}`}
            className="absolute"
            style={{
              left:
                bar.startIdx * COL_W +
                (bar.endIdx - bar.startIdx) * COL_W -
                (bar.clipRight ? 2 : 5) -
                20,
              top: ROW_PAD + bar.lane * (BAR_H + BAR_GAP) + 4,
            }}
          >
            <AssignRoom
              bookingRoomId={bar.bookingRoomId}
              soldTypeId={soldTypeId}
              roomsByType={roomsByType}
              currentRoomId={currentRoomId}
            />
          </span>
        ))}

      {/*
        RESTORE, on a cancelled bar (0061). A sibling of the bar for the same
        reason AssignRoom is one: a button inside an anchor is invalid HTML
        and the browser throws it away during parsing.

        Only on cancelled and no-show bars, which is exactly the Cancelled
        band -- `canRestore` is passed by the row that draws that band, so a
        live bar never gets one.
      */}
      {canRestore &&
        placed.map((bar) => (
          <span
            key={`restore-${bar.bookingRoomId}`}
            className="absolute"
            style={{
              left:
                bar.startIdx * COL_W +
                (bar.endIdx - bar.startIdx) * COL_W -
                (bar.clipRight ? 2 : 5) -
                48,
              top: ROW_PAD + bar.lane * (BAR_H + BAR_GAP) + 4,
            }}
          >
            <RestoreBooking bookingId={bar.bookingId} />
          </span>
        ))}
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
              /*
                BOLD, at the client's request: "ye jo 60 60 dekh rhe ho likha
                hua hai, inko bold krna hai".

                It used to be faint -- `text-ink-faint/70` and no weight --
                which was deliberate at the time, to keep it from competing
                with the bars. But it is the one thing on this board that
                answers "can I sell tonight", and at 10.5px in a washed-out
                grey it was the hardest figure on the screen to read.

                The weight is now the same on all three states and only the
                COLOUR carries meaning -- rose oversold, amber none left,
                ordinary ink otherwise. Bold on the faint grey alone would
                still have read as washed out, so the ordinary state moves up
                to `text-ink-muted` as well.
              */
              className={cn(
                "tnum px-1.5 pb-1 text-right text-xxs font-semibold leading-none",
                cell.available < 0
                  ? "text-rose-600"
                  : cell.available === 0
                    ? "text-warn-deep"
                    : "text-ink-muted",
              )}
            >
              {cell.available}
            </span>
          ) : null;

        /*
         * Two branches rather than a component held in a variable: the union
         * of a Link and a div does not typecheck, and spreading props onto it
         * hides which element actually renders.
         *
         * A NIGHT THAT HAS ALREADY PASSED IS NOT A LINK. The board shows past
         * dates now, and `create_booking()` refuses an arrival before the
         * business date -- so a link there is a click that opens a dialog only
         * to have the server throw the date away. Better that the cell simply
         * is not clickable.
         */
        if (!bookHref || d < businessDate) {
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
  bars,
  dates,
  businessDate,
  railW,
  gridW,
  railCell,
  backHref,
  bookingHref,
  canRestore,
  pinned,
}: {
  label: string;
  /** Hold the row against the foot of the scroller. See the note below. */
  pinned?: boolean;
  bars: BoardBar[];
  backHref?: string;
  bookingHref?: (bookingId: string) => string;
  /** True on the Cancelled band only. */
  canRestore?: boolean;
  dates: string[];
  businessDate: string;
  railW: number;
  gridW: number;
  railCell: string;
}) {
  const { placed, lanes } = packLanes(bars, dates);
  const rowH = rowHeight(lanes, false);

  return (
    <div
      className={cn(
        "flex items-stretch",
        /*
          PINNED TO THE FOOT OF THE SCROLLER when it has something in it.

          The Cancelled band sits below every room row, which is fine at four
          rooms and useless at 120: the client cancelled a booking, looked at
          the board, and reported that cancelling "cancel mein ja hi nhi rha
          hai" -- it is not going into Cancelled at all. It was. It was a
          hundred and twenty rows down, past every room in the hotel.
          `calendar_bookings(..., true)` was returning all three cancelled
          bookings correctly the whole time, which was checked against the
          hosted database before anything here was touched.

          Sticky rather than moved to the top: the band belongs under the
          rooms, and pinning keeps its place in the document while putting it
          where somebody can see it. Only when it HAS bars -- an empty band
          pinned across the foot of the board would cost a row of height to
          say nothing.
        */
        pinned && "sticky bottom-0 z-20 shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.45)]",
      )}
    >
      <div
        className={cn(railCell, "flex items-center px-3 py-2")}
        style={{ width: railW }}
      >
        <div className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-white/80">
          {label}
        </div>
      </div>
      <div
        className="relative border-b border-board-line"
        style={{ width: gridW, minHeight: rowH }}
      >
        <DayCells dates={dates} businessDate={businessDate} withFoot={false} />
        <Bars
          placed={placed}
          backHref={backHref}
          bookingHref={bookingHref}
          canRestore={canRestore}
        />
      </div>
    </div>
  );
}


/**
 * A break in the board, above Holding and above Cancelled.
 *
 * The client asked for "a small space between the rooms, Holding Area and
 * Cancelled area", pointing at the reference, whose two standing bands sit
 * below a plain gap rather than butted against the last room row. It is doing
 * real work: those two rows are not rooms, and without the gap the eye reads
 * "Holding area" as one more room in the last room type.
 *
 * It spans the rail as well as the grid, so the blue column breaks with
 * everything else -- a gap in the dates with the rail running straight past it
 * would look like a rendering fault rather than a division.
 */
const GUTTER_H = 10;

function Gutter({ railW, gridW }: { railW: number; gridW: number }) {
  return (
    <div className="flex items-stretch" aria-hidden style={{ height: GUTTER_H }}>
      <div
        className="sticky left-0 z-10 shrink-0 bg-shell"
        style={{ width: railW }}
      />
      <div className="bg-shell" style={{ width: gridW }} />
    </div>
  );
}

/**
 * Housekeeping, per room, on the rail.
 *
 * The type header keeps its own dot, which summarises the whole type. This one
 * is the room's own status and is the more useful of the two now that rooms are
 * rows — "101 is dirty" is actionable in a way that "something in Deluxe is
 * dirty" was not.
 */
const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  vacant_clean: "Ready for a guest",
  vacant_dirty: "Waiting to be cleaned",
  occupied: "Occupied",
  ooo: "Out of order",
};

const ROOM_STATUS_DOT: Record<RoomStatus, string> = {
  vacant_clean: "bg-emerald-400",
  vacant_dirty: "bg-rose-400",
  occupied: "bg-white/35",
  ooo: "bg-slate-500",
};

/*
 * THE TWO FLAGS SHOW ON THE RAIL, because otherwise setting one has no visible
 * result and the menu reads as broken.
 *
 * The client on what the dot is for: "The housekeeping, does not affect
 * availability. It's there for the hotel reception and housekeeping staff to
 * use ... If the 101 is showing as dirty, the receptionist knows that the room
 * is not ready and will offer a room that's is shown ready in the system."
 *
 * So the dot answers "is this one ready", and inspected is the strongest yes
 * there is -- a deeper green than merely clean, the same two greens the menu
 * itself uses so the board and the menu cannot say different things. Do not
 * disturb rides on an occupied room and takes amber, which on this board means
 * "a person needs to know about this" rather than any cleaning state.
 */
function roomDot(room: CalendarRoom) {
  if (room.roomStatus === "vacant_clean" && room.isInspected)
    return "bg-emerald-500 ring-1 ring-emerald-200";
  if (room.roomStatus === "occupied" && room.doNotDisturb) return "bg-warn";
  return ROOM_STATUS_DOT[room.roomStatus];
}

function roomDotLabel(room: CalendarRoom) {
  if (room.roomStatus === "vacant_clean" && room.isInspected)
    return "Ready for a guest, inspected";
  if (room.roomStatus === "occupied" && room.doNotDisturb)
    return "Occupied, do not disturb";
  return ROOM_STATUS_LABEL[room.roomStatus];
}

/**
 * A room row draws no availability figure, so it needs no cells to read from.
 * Hoisted rather than built per row: a fresh Map for every room on an 1,800
 * room property is 1,800 allocations per render for an object that is always
 * empty.
 */
const EMPTY_CELLS = new Map<string, AvailabilityCell>();

/**
 * Bookings sold on a room type that nobody has allocated a room to yet.
 *
 * Every booking is in this state between being taken and being checked in,
 * unless somebody placed it by hand — so this is a normal band, not an error
 * one. It keeps its height when empty so the board does not jump as rooms are
 * allocated through the day.
 */
function UnassignedRow({
  bars,
  dates,
  railW,
  gridW,
  total,
  railCell,
  roomsByType,
  soldTypeId,
  backHref,
  bookingHref,
}: {
  bars: CalendarRoomBar[];
  dates: string[];
  railW: number;
  gridW: number;
  total: number;
  /** Passed in like ExtraRow's, because the class is built inside the board. */
  railCell: string;
  /**
   * Every type and its rooms, so a booking can be placed straight from the
   * band — into the type it was sold, or into another as an upgrade.
   */
  roomsByType: AssignTypeGroup[];
  /** The type this band belongs to; its rooms open expanded in the picker. */
  soldTypeId: string;
  backHref?: string;
  /** Opens the details popup instead of navigating away. */
  bookingHref?: (bookingId: string) => string;
}) {
  const { placed, lanes } = packLanes(bars, dates);
  return (
    <div className="flex items-stretch">
      <div
        className={cn(railCell, "flex flex-col justify-center px-3 py-1.5")}
        style={{ width: railW }}
      >
        <span className="truncate text-[12px] font-medium uppercase tracking-[0.06em] text-white/70">
          Unassigned
        </span>
        {/*
          HOLDING AREA IS THIS BAND NOW. The client removed the standalone
          Holding row: "unassigned bhi holding ke liye hi hai" -- a booking
          with no room is being held, whether or not anybody has confirmed it,
          and two bands for one idea made the board say it twice. The bracket
          keeps the reference's word where somebody moving between the two
          systems will look for it.
        */}
        <span className="truncate text-xxs uppercase tracking-[0.06em] text-white/40">
          (Holding area)
        </span>
        {/*
          The count and nothing else. There was a line of prose under this
          saying what "unassigned" meant; the client read the explanatory copy
          across the application as leftover prompt text and asked for it gone,
          and the reference's own band carries a label alone.
        */}
        {total > 0 && (
          <span className="tnum text-xxs text-white/45">{total}</span>
        )}
      </div>
      <div
        className="relative border-b border-board-line bg-board-wash"
        style={{ width: gridW, minHeight: rowHeight(Math.max(lanes, 1), false) }}
      >
        <DayCells
          dates={dates}
          businessDate={""}
          cells={EMPTY_CELLS}
          withFoot={false}
        />
        <Bars
          placed={placed}
          roomsByType={roomsByType}
          soldTypeId={soldTypeId}
          backHref={backHref}
          bookingHref={bookingHref}
        />
      </div>
    </div>
  );
}

export function CalendarBoard({
  dates,
  businessDate,
  types,
  cellAt,
  rooms,
  barsByRoom,
  unassignedByType,
  canceledBars,
  seasons,
  shiftHref,
  railHref,
  todayHref,
  todayFrom,
  notesByDate,
  noteHref,
  selfHref,
  bookingHref,
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
  /** Rooms for the rail, already in type-then-number order from Postgres. */
  rooms: CalendarRoom[];
  /** Bars that have a room, keyed by room id. */
  barsByRoom: Map<string, CalendarRoomBar[]>;
  /**
   * Confirmed bookings with no room allocated yet, keyed by room type.
   *
   * These get a band under their type rather than being guessed into a room:
   * a bar sitting on 101 that nobody put there reads as settled when it is not.
   */
  unassignedByType: Map<string, CalendarRoomBar[]>;
  canceledBars: BoardBar[];
  seasons: CalendarSeason[];
  shiftHref: (days: number) => string;
  /** Where + and − go: they size the rail, not the date range. */
  railHref: (delta: number) => string;
  todayHref: string;
  /** The first date of the default window, for the picker's own Today. */
  todayFrom: string;
  /**
   * Day notes, keyed by date. The header shows a marker and a count -- never
   * the text, which would put a paragraph in a 118px column. The note itself
   * is one click away in the dialog.
   */
  notesByDate: Map<string, CalendarNote[]>;
  /** Opens the Add Note dialog for a day, as `?note=<date>` on the board. */
  noteHref: (date: string) => string;
  /**
   * The board's own URL. Every bar carries it as `?back=`, so opening a
   * booking and coming back lands on these dates and this rail width.
   */
  selfHref: string;
  /** Opens a booking's details over the board rather than navigating away. */
  bookingHref?: (bookingId: string) => string;
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

  /*
   * How far in the business date sits, in pixels -- the board's opening
   * scroll position.
   *
   * `indexOf` rather than arithmetic over the lookback constant, because the
   * window does not always start a week before today: paging and the date
   * picker both move it, and on those the business date is usually not in the
   * window at all. -1 then gives an offset of 0, which leaves the board where
   * the URL put it, which is the whole point of the URL being the state.
   */
  const todayIdx = dates.indexOf(businessDate);
  const openOffset = todayIdx > 0 ? todayIdx * COL_W : 0;
  /* What the corner should name: the column the board actually opens on. */
  const opensOn = todayIdx > 0 ? businessDate : dates[0];

  /*
   * THE ROOM PICKER'S LIST, BUILT ONCE FOR THE WHOLE BOARD.
   *
   * Every bar that can be placed gets this same array by reference, so the
   * rooms cross the server boundary once rather than once per booking. Built
   * per bar -- which is what it was, filtered to the bar's own type -- a full
   * house on a large property would ship the room list forty times over.
   *
   * It carries EVERY type, not just the one the booking was sold, because of
   * the upgrade (0062). The client: "hotels do offer upgrades ... The way the
   * system is build now, the hotel cannot upgrade the guest room in the
   * system." The picker opens on the sold type and keeps the others collapsed;
   * Postgres is what decides whether a cross-type move is allowed, and refuses
   * it with `HP003` until somebody says they meant it.
   */
  const roomsByType: AssignTypeGroup[] = types.map((t) => ({
    roomTypeId: t.roomTypeId,
    code: t.roomTypeCode,
    name: t.roomTypeName,
    rooms: rooms
      .filter((r) => r.roomTypeId === t.roomTypeId)
      .map((r) => ({ roomId: r.roomId, roomNumber: r.roomNumber })),
  }));

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
      {/*
        THE BOARD OPENS ON THE BUSINESS DATE, not on the first column it
        loaded. The lookback week is still there -- one swipe to the left,
        which is where a tape chart keeps the past -- but the day the hotel is
        actually operating is what you land on.

        This was wrong in a way only a phone showed up. On a wide screen eight
        or nine columns fit, so today was on screen even when the board began a
        week earlier; on a phone exactly one column fits, so the client opened
        the calendar, saw 12 September, and read it against a top bar saying
        "Business date Sat 19 Sep 2026". Two figures that disagreed, with the
        one that mattered seven columns off the edge.
      */}
      <OpenOnToday scrollerId={SCROLLER_ID} offset={openOffset} />
      <div
        id={SCROLLER_ID}
        className="overflow-auto"
        style={{ height: MAX_H, minHeight: MIN_H }}
      >
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
              {/*
                A CONTROL, NOT A CAPTION -- and it has to look like one.

                This used to carry the same styling as the "Date" heading
                above it: uppercase, tracked, semibold. Stacked straight on
                top of the date picker, the three lines read as
                "DATE / TODAY / 12 Sep 2026" -- a heading, a sub-heading and a
                value -- so the board appeared to be announcing that today was
                the date in the field. It is not: the field shows where the
                BOARD STARTS, which is a week before the business date since
                the lookback was added, so the two could never agree and the
                client rightly flagged it against the top bar's business date.

                Chip styling, matching the + and - beside it and the picker
                below it, so all four read as things you press.
              */}
              <Link
                href={todayHref}
                title="Back to the current dates"
                className="mt-0.5 inline-flex rounded-sm bg-white/15 px-1.5 py-[1px] text-xxs font-medium text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
                {/*
                  The date you LAND ON, which is the business date whenever it
                  is in the window, because the board now scrolls there on
                  arrival. Handing it `dates[0]` made the field name a column
                  seven to the left of the first one on screen -- true of the
                  data range and useless to the person reading it.
                */}
                <DateJump
                  from={opensOn}
                  businessDate={businessDate}
                  basePath={basePath}
                  railW={railW}
                  todayFrom={todayFrom}
                />
              </div>
            </div>

            <div className="flex bg-white" style={{ width: gridW }}>
              {dates.map((d) => {
                const day = parseISO(d);
                const isToday = d === businessDate;
                const dayNotes = notesByDate.get(d) ?? [];
                return (
                  <div
                    key={d}
                    className={cn(
                      "group/day shrink-0 border-b border-r border-board-line px-2 py-1.5 text-center last:border-r-0",
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
                    <div className="flex items-center justify-center gap-1 text-xxs text-ink-faint">
                      {/* CAPITALS, as the client asked. */}
                      <span className="uppercase">{format(day, "MMMM")}</span>
                      {/*
                        The day's notes: a marker and a count, never the words.
                        A column is 118px wide and an operational note is a
                        sentence, so the board says one exists and the dialog
                        is where it is read.
                      */}
                      <Link
                        href={noteHref(d)}
                        title={
                          dayNotes.length === 0
                            ? `Add a note for ${format(day, "d MMM")}`
                            : dayNotes.map((n) => n.body).join("\n")
                        }
                        aria-label={
                          dayNotes.length === 0
                            ? `Add a note for ${format(day, "d MMM")}`
                            : `${dayNotes.length} note${dayNotes.length === 1 ? "" : "s"} on ${format(day, "d MMM")}`
                        }
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded border px-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass",
                          dayNotes.length > 0
                            ? "border-warn/40 bg-warn-wash text-warn-deep"
                            : "border-board-line bg-white text-ink-muted opacity-0 hover:bg-shell hover:text-ink group-hover/day:opacity-100",
                        )}
                      >
                        {/*
                          A PENCIL, IN A BOX, matching the reference: the
                          client circled theirs and it is an edit affordance,
                          not a speech bubble.

                          The two are deliberately different marks now. A
                          speech bubble on a BAR means "this booking carries a
                          note somebody wrote about the guest"; a pencil in the
                          DATE HEADER means "write a note about this day". They
                          are different things and drawing both as a bubble
                          made the board say one word for two.
                        */}
                        <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3 fill-current">
                          <path d="M11.6 1.8a1.3 1.3 0 0 1 1.9 0l.7.7a1.3 1.3 0 0 1 0 1.9l-.9.9-2.6-2.6zM9.8 3.6l2.6 2.6-6.1 6.1a1 1 0 0 1-.45.26l-2.7.73a.4.4 0 0 1-.5-.5l.73-2.7a1 1 0 0 1 .26-.45z" />
                        </svg>
                        {dayNotes.length > 0 && (
                          <span className="tnum font-semibold">{dayNotes.length}</span>
                        )}
                      </Link>
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

          {/*
            THE RAIL IS ROOMS NOW, GROUPED UNDER THEIR TYPE.

            It used to be one row per room type. The client was plain about why
            that was wrong: "in the calendar you should use the room setup
            because it allows the hotel to see all the rooms they have and the
            guest staying in each room". A row aggregated to type cannot answer
            "who is in 101", which is the first question anybody on a front desk
            asks.

            The type still gets a header row, because it carries the
            availability figure at the foot of each cell -- the one thing on
            this board that answers "can I sell tonight", and a number that
            belongs to the type rather than to any one room. Its bars have moved
            down onto the rooms.
          */}
          {types.map((t) => {
            const typeRooms = rooms.filter((r) => r.roomTypeId === t.roomTypeId);
            const unassigned = unassignedByType.get(t.roomTypeId) ?? [];
            const byDate = new Map(
              dates
                .map((d) => cellAt.get(`${t.roomTypeId}|${d}`))
                .filter((c): c is AvailabilityCell => Boolean(c))
                .map((c) => [c.date, c] as const),
            );

            return (
              <Fragment key={t.roomTypeId}>
                {/* The type header: availability, and the way in to Settings. */}
                <div className="flex items-stretch">
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

                    {/*
                      NO HOUSEKEEPING DOT ON A ROOM TYPE. The client, twice:
                      "the housekeeping button has to be next to each room.
                      Not the room type" and "isme room type ke aage nhi
                      ayega vo ... sbhi room number ke aage ayega".

                      There used to be an aggregated clean-status dot here. It
                      was not a control -- the control has always been on the
                      room rows -- but it was drawn exactly like one: same
                      size, same shape, same colours, one row above sixty dots
                      that DO open the menu. So the board offered a mark that
                      looked pressable and did nothing, which is the thing
                      this application keeps refusing to ship. Removing it
                      loses no information: every room under this header
                      carries its own status, which is what the client asked
                      for and is more use than a summary -- "101 is dirty" is
                      actionable in a way "something in DBL is dirty" is not.
                    */}
                    <div className="min-w-0">
                      <div className="truncate pr-6 text-[12.5px] font-bold uppercase tracking-[0.06em] text-white">
                        {t.roomTypeCode}
                      </div>
                      <div className="text-xxs leading-tight text-white/75">
                        {t.roomTypeName}
                      </div>
                      <div className="tnum mt-0.5 text-xxs text-white/50">
                        {typeRooms.length} room{typeRooms.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  <div
                    className="relative border-b border-board-line"
                    style={{ width: gridW, minHeight: rowHeight(1, true) }}
                  >
                    <DayCells
                      dates={dates}
                      businessDate={businessDate}
                      cells={byDate}
                      withFoot
                      bookHref={(d) => bookHref(d, t.roomTypeId)}
                    />
                  </div>
                </div>

                {/*
                  Bookings sold on this type that nobody has put in a room yet.
                  Kept even when empty so the board does not jump as rooms are
                  allocated, and so there is somewhere obvious to look.
                */}
                <UnassignedRow
                  bars={unassigned}
                  dates={dates}
                  railW={railW}
                  gridW={gridW}
                  total={unassigned[0]?.unassignedTotal ?? unassigned.length}
                  railCell={railCell}
                  roomsByType={roomsByType}
                  soldTypeId={t.roomTypeId}
                  backHref={selfHref}
                />

                {/* One row per room. This is the part the client asked for. */}
                {typeRooms.map((room) => {
                  const bars = barsByRoom.get(room.roomId) ?? [];
                  const { placed, lanes } = packLanes(bars, dates);
                  return (
                    <div key={room.roomId} className="flex items-stretch">
                      <div
                        className={cn(railCell, "flex items-center gap-2 px-3 py-1.5")}
                        style={{ width: railW }}
                      >
                        {/*
                          The dot is a control now, not just a light. The
                          reference opens a housekeeping menu off it, and the
                          board is where somebody is already looking at the
                          room when they learn it has been cleaned.
                        */}
                        <RoomStatusMenu
                          roomId={room.roomId}
                          roomNumber={room.roomNumber}
                          status={room.roomStatus}
                          isInspected={room.isInspected}
                          doNotDisturb={room.doNotDisturb}
                          dotClass={roomDot(room)}
                          label={roomDotLabel(room)}
                        />
                        <span className="tnum truncate text-[13px] font-medium text-white">
                          {room.roomNumber}
                        </span>
                        {room.floor && (
                          <span className="ml-auto shrink-0 text-xxs text-white/45">
                            {room.floor}
                          </span>
                        )}
                      </div>

                      <div
                        className="relative border-b border-board-line"
                        style={{ width: gridW, minHeight: rowHeight(lanes, false) }}
                      >
                        {/*
                          No availability foot on a room row: a single room is
                          free or it is not, which the bars already say. The
                          figure belongs to the type header above.
                        */}
                        <DayCells
                          dates={dates}
                          businessDate={businessDate}
                          cells={EMPTY_CELLS}
                          withFoot={false}
                          bookHref={(d) => bookHref(d, t.roomTypeId)}
                        />
                        {/*
                          `bookingHref` IS NOT OPTIONAL HERE, whatever the
                          prop's type says. It was missing, and this is the
                          row that matters: a booking with a room is nearly
                          every booking, so clicking a bar navigated away to
                          /bookings/[id] instead of opening the popup. The
                          Unassigned and Cancelled bands had it, which is why
                          the feature looked built and was not -- the client
                          clicked a live booking and got a full page.
                        */}
                        <Bars
                          placed={placed}
                          roomsByType={roomsByType}
                          soldTypeId={t.roomTypeId}
                          currentRoomId={room.roomId}
                          backHref={selfHref}
                          bookingHref={bookingHref}
                        />
                      </div>
                    </div>
                  );
                })}
              </Fragment>
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

          {/*
            Cancelled comes AFTER the filler now, so `sticky bottom-0` has
            something to stick against -- an element cannot pin to the foot of
            a scroller when a flex-grow sibling sits below it.
          */}
          <Gutter railW={railW} gridW={gridW} />
          <ExtraRow
            label="Cancelled"
            canRestore
            pinned={canceledBars.length > 0}
            backHref={selfHref}
            bars={canceledBars}
            dates={dates}
            businessDate={businessDate}
            railW={railW}
            gridW={gridW}
            railCell={railCell}
          />
        </div>
      </div>
    </div>
  );
}
