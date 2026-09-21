import { addDays, format, isValid, parseISO, subDays } from "date-fns";
import { formatMoney } from "@/lib/money";
import { EmptyState } from "@/components/ui";
import {
  CalendarBoard,
  RAIL_STEP,
  clampRail,
} from "@/components/calendar/calendar-board";
import { BookingDialog } from "@/components/calendar/booking-dialog";
import { NewBookingForm } from "@/components/bookings/new-booking-form";
import { NoteForm } from "@/components/calendar/note-form";
import { BookingDetailView } from "@/components/bookings/booking-detail";
import { getCustomerForEdit } from "@/lib/actions/customers";
import {
  CALENDAR_LOOKBACK,
  CALENDAR_MAX_BARS_PER_TYPE,
  CALENDAR_NIGHTS,
  getBookableRoomTypes,
  getBusinessDate,
  getCalendarAvailability,
  getCalendarBookings,
  getCalendarNotes,
  getBookingDetail,
  getBookingRoomLines,
  getBookingCancellationTerms,
  getBookingNights,
  getBookingFolioLines,
  getBookingActivity,
  getCalendarRoomBars,
  getCalendarRooms,
  getCalendarSeasons,
  getChannels,
  getCurrentStaffUser,
  getProperty,
  getRatePlans,
  getTaxRates,
} from "@/lib/queries";

export const metadata = { title: "Calendar" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles Postgres will let take a booking. `create_booking()` checks too. */
const CAN_BOOK = ["admin", "manager", "front_desk"];

/**
 * Where the board opens when the URL does not say.
 *
 * A week before the business date, not on it. The client asked to be able to
 * see past dates, and the reference's board carries several days of history to
 * the left of today. Paging and the date picker have always reached backwards;
 * what they had to reach past was a default that put today hard against the
 * left edge.
 */
function defaultStart(businessDate: string) {
  return format(subDays(parseISO(businessDate), CALENDAR_LOOKBACK), "yyyy-MM-dd");
}

function startDate(businessDate: string, from: string | undefined) {
  if (from && ISO_DATE.test(from) && isValid(parseISO(from))) return from;
  return defaultStart(businessDate);
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
    /** The day whose notes are open, which is the Add Note dialog. */
    note?: string;
    /** The booking whose details are open over the board. */
    booking?: string;
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
  const [cells, rooms, roomBars, canceledBars, seasons, notes, property] =
    await Promise.all([
    getCalendarAvailability(from, days),
    // The rail. Every room, grouped by type in Postgres.
    getCalendarRooms(),
    getCalendarRoomBars(from, days),
    getCalendarBookings(from, days, CALENDAR_MAX_BARS_PER_TYPE, true),
    getCalendarSeasons(from, days),
    // NO per-type housekeeping read any more. `getRoomStatusByType()` fed a
    // summary dot on the room-type header, and the client asked twice for the
    // housekeeping mark to be on the room rows only -- where `getCalendarRooms()`
    // already returns each room's own status. One fewer round trip per board.
    // Day notes for the window, one call for the whole board.
    getCalendarNotes(from, days),
    // Free: cache()d, and the app layout has already called it in this same
    // request. It carries the timezone a note's posting time is rendered on.
    getProperty(),
  ]);

  const dates = Array.from({ length: days }, (_, i) =>
    format(addDays(parseISO(from), i), "yyyy-MM-dd"),
  );
  const types = [...new Map(cells.map((c) => [c.roomTypeId, c])).values()];
  const cellAt = new Map(cells.map((c) => [`${c.roomTypeId}|${c.date}`, c]));

  const notesByDate = new Map<string, typeof notes>();
  for (const note of notes) {
    const list = notesByDate.get(note.noteDate);
    if (list) list.push(note);
    else notesByDate.set(note.noteDate, [note]);
  }

  /*
   * THE HOLDING AREA IS GONE, AND UNASSIGNED IS NOW BOTH. This reverses an
   * earlier decision, at the client's direction: "unassigned bhi holding ke
   * hi liye hai ... to holding area vala remove krdo". The Unassigned band
   * carries "(Holding area)" under its label so the reference's word is still
   * where somebody would look for it.
   *
   * It used to be two bands. Holding held every `pending` booking, and
   * Unassigned held the confirmed ones nobody had put in a room yet, on the
   * argument that "nobody has confirmed this" and "confirmed, but no room" are
   * different facts. They ARE different facts — but they are both "this
   * booking is being held and occupies no room", which is the one thing the
   * band is telling a receptionist, and the client judged one band enough.
   *
   * NOTHING IS LOST FROM THE BAR ITSELF: a pending booking still draws its
   * amber edge and still says "Pending" in words, which is how it stays
   * distinguishable from a confirmed one sitting beside it.
   *
   * So pending bookings no longer get filtered out here. They fall through the
   * ordinary split like every other bar: onto their room if one was assigned,
   * into their room type's Unassigned band if not.
   */
  const barsByRoom = new Map<string, typeof roomBars>();
  const unassignedByType = new Map<string, typeof roomBars>();
  for (const bar of roomBars) {
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
  /*
   * The note dialog's date. Validated like the booking one -- a URL is not a
   * form -- but a PAST date is allowed here: writing down what happened
   * yesterday is a normal thing to do, where taking a booking for it is not.
   */
  const wantedNote = sp.note;
  const noteDate =
    wantedNote && ISO_DATE.test(wantedNote) && isValid(parseISO(wantedNote))
      ? wantedNote
      : undefined;

  /*
   * The booking popup. The client asked for their reference's behaviour:
   * opening a booking shows its details over the board rather than navigating
   * away and losing the dates and rail width you were looking at.
   *
   * URL state like the other two dialogs, so the server renders it, a reload
   * keeps it open and the back button closes it. An id that is not a uuid, or
   * names a booking on another property, simply returns nothing and the dialog
   * does not open -- RLS decides that, not this page.
   */
  const peekId = sp.booking && UUID.test(sp.booking) ? sp.booking : undefined;
  const peek = peekId
    ? await (async () => {
        const d = await getBookingDetail(peekId);
        if (!d) return null;
        /*
         * The SAME reads `/bookings/[id]` makes, because what opens is the
         * same component. Loaded only when the dialog is actually opening, so
         * an ordinary visit to the board costs none of them.
         */
        const [lines, nights, folio, activity, channels, terms, guest] =
          await Promise.all([
            getBookingRoomLines(peekId),
            getBookingNights(peekId),
            getBookingFolioLines(peekId),
            getBookingActivity(peekId),
            getChannels(),
            getBookingCancellationTerms(peekId),
            getCustomerForEdit(d.customerId),
          ]);
        return { detail: d, lines, nights, folio, activity, channels, terms, guest };
      })()
    : null;

  const staff = bookDate || noteDate || peekId ? await getCurrentStaffUser() : null;
  /* Named apart so the booking dialog's own gate reads for itself. */
  const peekStaff = peekId ? staff : null;
  const noteStaff = noteDate ? staff : null;
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
    /*
     * NO PAGE HEADING ON THIS SCREEN. The client: "eliminate the written
     * calendar it does not make sense to have it there".
     *
     * They are right and the reference agrees: its board starts immediately
     * under the nav. An <h1> reading "Calendar" on the Calendar screen, with
     * Calendar already marked as the active section in the bar above it, says
     * the same thing a third time and costs the board a row of height on a
     * screen that wants every pixel.
     */
    <div>
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
            canceledBars={canceledBars}
            seasons={seasons}
            shiftHref={shiftHref}
            railHref={railHref}
            todayHref={href(defaultStart(businessDate), railW)}
            todayFrom={defaultStart(businessDate)}
            selfHref={href(from, railW)}
            bookingHref={(id) => `${href(from, railW)}&booking=${id}`}
            notesByDate={notesByDate}
            noteHref={(date) => `${href(from, railW)}&note=${date}`}
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
          {/*
            THE KEY IS THE FIX, not decoration.

            `NewBookingForm` seeds its check-in and check-out from props with
            `useState(arrival)`, which runs ONCE per mount. Clicking a second
            cell only changes `?book=`, and React reconciles the same instance
            at the same position in the tree -- so the state never re-seeded
            and the form went on showing the FIRST night it was ever opened
            with. The dialog's own subtitle updated, because that is a prop
            rendered directly, so the header said one date and the field said
            another; the field is what gets submitted, so the booking was
            taken on the wrong night.

            The client: "Date ko fix kro vrna ye by default mein jo date
            dikha rha hai vhi date confirmed krne pr or hold krne pr dikha
            rha hai."

            Keying on the night and the room type remounts the form whenever
            either changes, which re-seeds every piece of derived state at
            once -- the dates and the prefilled room line. Syncing them in an
            effect instead would need one per field and would fight anything
            the user had already typed.
          */}
          <NewBookingForm
            key={`${bookDate}|${sp.type?.trim() ?? ""}`}
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
        The Add Note dialog. Open state is `?note=<date>` on the board rather
        than React state, so the server renders the day's notes, a reload keeps
        the dialog open, and the back button closes it -- the same shape the
        booking dialog uses.
      */}
      {noteDate && (
        <BookingDialog
          title="Add note"
          subtitle={format(parseISO(noteDate), "EEEE d MMMM yyyy")}
          closeHref={href(from, railW)}
        >
          <NoteForm
            noteDate={noteDate}
            notes={notesByDate.get(noteDate) ?? []}
            closeHref={href(from, railW)}
            timezone={property.timezone}
            canEdit={noteStaff === null || CAN_BOOK.includes(noteStaff.role)}
          />
        </BookingDialog>
      )}

      {/*
        The booking details, over the board. A frame around a read-only panel:
        everything that WRITES still lives on /bookings/[id], which the panel
        links to, because two editors for one booking drift apart.
      */}
      {peek && (
        <BookingDialog
          /* Their popup titles itself with the reference and the channel's
             own booking number, which is what somebody matching an OTA email
             against the board is holding. */
          title={peek.detail.reference}
          subtitle={
            peek.detail.externalReference
              ? `${peek.detail.channelName ?? "Channel"} booking ${peek.detail.externalReference}`
              : (peek.detail.channelName ?? peek.detail.customerName)
          }
          closeHref={href(from, railW)}
          closeLabel="Close the booking"
          side
          /*
            The three figures the reference's panel carries along its top.
            Read off the detail the server already loaded rather than worked
            out here -- `chargesCents` and `paymentsCents` are what the folio
            says, and `balanceCents` is their difference under the sign
            convention, so nothing new is being computed and the bar cannot
            disagree with the folio a few centimetres below it.
          */
          meta={[
            {
              label: "Total",
              value: formatMoney(peek.detail.chargesCents),
            },
            {
              label: "Paid",
              value: formatMoney(peek.detail.paymentsCents),
              tone: "paid" as const,
            },
            {
              label: "Due",
              value: formatMoney(peek.detail.balanceCents),
              tone: peek.detail.balanceCents > 0 ? ("due" as const) : undefined,
            },
          ]}
        >
          <BookingDetailView
            detail={peek.detail}
            rooms={peek.lines}
            nights={peek.nights}
            folio={peek.folio}
            activity={peek.activity}
            channels={peek.channels}
            guest={peek.guest.ok ? peek.guest.data : null}
            cancellationTerms={peek.terms}
            timezone={property.timezone}
            backHref={href(from, railW)}
            backLabel="Back to the calendar"
            inDialog
            canEdit={
              peekStaff !== null &&
              ["admin", "manager", "front_desk"].includes(peekStaff.role)
            }
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
