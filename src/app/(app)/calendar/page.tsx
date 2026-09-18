import { addDays, format, isValid, parseISO, subDays } from "date-fns";
import { EmptyState, PageHeader } from "@/components/ui";
import {
  CalendarBoard,
  RAIL_STEP,
  clampRail,
} from "@/components/calendar/calendar-board";
import { BookingDialog } from "@/components/calendar/booking-dialog";
import { NewBookingForm } from "@/components/bookings/new-booking-form";
import {
  CALENDAR_MAX_BARS_PER_TYPE,
  CALENDAR_NIGHTS,
  getBookableRoomTypes,
  getBusinessDate,
  getCalendarAvailability,
  getCalendarBookings,
  getCalendarSeasons,
  getChannels,
  getCurrentStaffUser,
  getRatePlans,
  getRoomStatusByType,
  getTaxRates,
} from "@/lib/queries";

export const metadata = { title: "Calendar" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Roles Postgres will let take a booking. `create_booking()` checks too. */
const CAN_BOOK = ["admin", "manager", "front_desk"];

function startDate(businessDate: string, from: string | undefined) {
  if (from && ISO_DATE.test(from) && isValid(parseISO(from))) return from;
  return businessDate;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    rail?: string;
    /** The night a cell was clicked on, which opens the booking dialog. */
    book?: string;
    /** The room type whose row it was on. */
    type?: string;
  }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const from = startDate(businessDate, sp.from);
  /*
   * The window is fixed at a month and is no longer a URL knob.
   *
   * It used to be one, moved by the + and − controls before those were
   * corrected to size the rail. Anybody who pressed "−" while they were still
   * wired that way got `days=7` stuck in their URL, every link threaded it
   * onward, and once + and − meant something else there was no way back: the
   * calendar showed a week and stayed that way. A setting with no control is
   * worse than no setting.
   */
  const days = CALENDAR_NIGHTS;
  // How wide the blue room column is. The + and − controls move this; they do
  // not change the date range, which is what they were first built to do.
  const railW = clampRail(Number(sp.rail) || 180);

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

  const href = (nextFrom: string, nextRail: number) =>
    `/calendar?from=${nextFrom}&rail=${nextRail}`;

  const shiftHref = (by: number) =>
    href(
      format(
        by < 0
          ? subDays(parseISO(from), Math.abs(by))
          : addDays(parseISO(from), by),
        "yyyy-MM-dd",
      ),
      railW,
    );

  const railHref = (delta: number) => href(from, clampRail(railW + delta));

  const capped = [...barsByType.values()].some(
    (list) => (list[0]?.typeTotal ?? 0) > list.length,
  );

  /*
   * The dialog, when a cell has been clicked.
   *
   * The reference system opens "Create Booking" over the board rather than
   * navigating away, so this does too — but what opens is the same
   * `NewBookingForm` the /bookings/new page renders, not a second form. Taking
   * a booking goes through `create_booking()` and nothing else, and a smaller
   * copy of the form would either duplicate its rate lookup, override flags and
   * promotion handling or quietly do less than it.
   *
   * The date is validated the same way /bookings/new validates it: a URL is not
   * a form, and an arrival before the business date is refused rather than
   * silently moved to a night nobody asked for.
   */
  const wanted = sp.book;
  const bookDate =
    wanted && ISO_DATE.test(wanted) && isValid(parseISO(wanted)) && wanted >= businessDate
      ? wanted
      : undefined;
  const staff = bookDate ? await getCurrentStaffUser() : null;
  const mayBook = !staff || CAN_BOOK.includes(staff.role);
  const openBooking = Boolean(bookDate) && mayBook;

  const nextDay = bookDate
    ? format(addDays(parseISO(bookDate), 1), "yyyy-MM-dd")
    : null;

  // Loaded only when the dialog is actually opening, so the board costs nothing
  // extra on an ordinary visit.
  const [channels, taxRates, ratePlans, bookableTypes] = openBooking
    ? await Promise.all([
        getChannels(),
        getTaxRates(),
        getRatePlans(),
        getBookableRoomTypes(bookDate!, nextDay!),
      ])
    : [null, null, null, null];

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
            shiftHref={shiftHref}
            railHref={railHref}
            todayHref={href(businessDate, railW)}
            jumpAction="/calendar"
            // Stays on the board: the dialog opens over it.
            bookHref={(date, roomTypeId) =>
              `${href(from, railW)}&book=${date}&type=${roomTypeId}`
            }
            days={days}
            railW={railW}
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
              bookings; click one to open it, or click any empty night to take
              one. The faint figure in each cell is rooms still free to sell
              that night.
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

      {openBooking && bookDate && (
        <BookingDialog
          title="Take a booking"
          subtitle={`Arriving ${format(parseISO(bookDate), "EEEE d MMMM yyyy")}`}
          closeHref={href(from, railW)}
        >
          <NewBookingForm
            businessDate={businessDate}
            channels={channels!}
            taxRates={taxRates!}
            ratePlans={ratePlans!}
            initialTypes={bookableTypes!}
            initialCheckIn={bookDate}
            initialRoomTypeId={sp.type?.trim() || undefined}
          />
        </BookingDialog>
      )}

      {/*
        A housekeeper who clicks a night is told why rather than being shown a
        form Postgres will refuse. Same wording as /bookings/new.
      */}
      {bookDate && !mayBook && (
        <BookingDialog
          title="Take a booking"
          subtitle={format(parseISO(bookDate), "EEEE d MMMM yyyy")}
          closeHref={href(from, railW)}
        >
          <div className="rounded-lg border border-line bg-white p-8 text-center shadow-card">
            <p className="font-display text-lg font-semibold tracking-tightest text-ink">
              Taking bookings is not available to your role
            </p>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
              Front desk, manager and admin accounts can take a booking. Ask a
              manager if you need access.
            </p>
          </div>
        </BookingDialog>
      )}
    </div>
  );
}
