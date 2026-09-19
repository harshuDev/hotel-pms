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
  getCalendarRoomBars,
  getCalendarRooms,
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
  const [cells, rooms, roomBars, canceledBars, seasons, status] = await Promise.all([
    getCalendarAvailability(from, days),
    // The rail. Every room, grouped by type in Postgres.
    getCalendarRooms(),
    getCalendarRoomBars(from, days),
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

  /*
   * Pending bookings go to the Holding area, not to their room type.
   *
   * The client asked for the reference system's Holding row and said it holds
   * what nobody has confirmed yet. That fits this schema exactly: the guest
   * booking page creates `pending` bookings, and the night audit deliberately
   * never sweeps them. A pending booking is not sold, and a bar sitting on a
   * room type reads as though it were — which is the same argument that keeps
   * cancelled bookings off the live rows.
   *
   * No migration for this: `calendar_bookings()` already returns the status.
   */
  const holdingBars = roomBars.filter((b) => b.status === "pending");

  /*
   * Everything else splits three ways: onto its room, or into the Unassigned
   * band for its type.
   *
   * UNASSIGNED IS NOT THE SAME AS HOLDING, and they are deliberately two rows.
   * Holding is "nobody has confirmed this booking". Unassigned is "confirmed,
   * but no room picked yet" — which is every booking between being taken and
   * being checked in. Collapsing them would tell a receptionist that a
   * confirmed stay was still unconfirmed.
   */
  const barsByRoom = new Map<string, typeof roomBars>();
  const unassignedByType = new Map<string, typeof roomBars>();
  for (const bar of roomBars) {
    if (bar.status === "pending") continue;
    if (bar.roomId) {
      const list = barsByRoom.get(bar.roomId);
      if (list) list.push(bar);
      else barsByRoom.set(bar.roomId, [bar]);
    } else {
      const list = unassignedByType.get(bar.roomTypeId);
      if (list) list.push(bar);
      else unassignedByType.set(bar.roomTypeId, [bar]);
    }
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
            rooms={rooms}
            barsByRoom={barsByRoom}
            unassignedByType={unassignedByType}
            holdingBars={holdingBars}
            canceledBars={canceledBars}
            seasons={seasons}
            statusByType={statusByType}
            shiftHref={shiftHref}
            railHref={railHref}
            todayHref={href(businessDate, railW)}
            basePath="/calendar"
            // Stays on the board: the dialog opens over it.
            bookHref={(date, roomTypeId) =>
              `${href(from, railW)}&book=${date}&type=${roomTypeId}`
            }
            days={days}
            railW={railW}
          />

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
