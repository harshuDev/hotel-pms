"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import {
  createBooking,
  loadAvailability,
  searchCustomers,
} from "@/lib/actions/bookings";
import type {
  BookableRoomType,
  Channel,
  RatePlan,
  Settlement,
  TaxRate,
} from "@/lib/types";
import type { BookingBlock } from "@/lib/actions/bookings";
import { useCurrency } from "@/components/currency";

interface Line {
  /** Local key, so two lines of the same room type stay distinct while editing. */
  key: string;
  roomTypeId: string;
  quantity: number;
  rate: string;
  adults: number;
  children: number;
}

type Guest =
  | { mode: "existing"; id: string; name: string }
  | { mode: "new" };

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
/*
 * The stay band is dark, matching the client's reference system: its Create
 * Booking panel puts the dates, the rate and the cancellation policy on a
 * charcoal band and everything else on white. Same component wherever the form
 * appears, so the calendar's dialog gets it too.
 */
const labelDark =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-white/60";
const fieldDark =
  "w-full rounded-md border border-white/15 bg-white/10 px-3 py-2 text-[13px] text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/40 [color-scheme:dark]";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

export function NewBookingForm({
  businessDate,
  channels,
  taxRates,
  ratePlans,
  initialTypes,
  initialCheckIn,
  initialRoomTypeId,
}: {
  businessDate: string;
  channels: Channel[];
  taxRates: TaxRate[];
  ratePlans: RatePlan[];
  initialTypes: BookableRoomType[];
  /** Arrival the calendar was clicked on, if the form was reached that way. */
  initialCheckIn?: string;
  /** The room type whose row was clicked. */
  initialRoomTypeId?: string;
}) {
  const currency = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Clicking an empty cell on the calendar lands here with that night and that
  // room type already chosen, which is the whole point of clicking it.
  const arrival = initialCheckIn ?? businessDate;
  const [checkIn, setCheckIn] = useState(arrival);
  const [checkOut, setCheckOut] = useState(
    format(addDays(parseISO(arrival), 1), "yyyy-MM-dd"),
  );
  const [types, setTypes] = useState(initialTypes);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [loadingTypes, setLoadingTypes] = useState(false);

  const [lines, setLines] = useState<Line[]>(() => {
    const type = initialTypes.find((t) => t.roomTypeId === initialRoomTypeId);
    if (!type) return [];
    return [
      {
        // A fixed key, not a random one: this line exists on the server render
        // as well, and a fresh uuid each time is a hydration mismatch.
        key: "from-calendar",
        roomTypeId: type.roomTypeId,
        quantity: 1,
        rate: "",
        adults: Math.max(type.baseOccupancy, 1),
        children: 0,
      },
    ];
  });
  const [guest, setGuest] = useState<Guest>({ mode: "new" });
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<
    { id: string; name: string; detail: string }[]
  >([]);
  const [newGuest, setNewGuest] = useState({
    kind: "personal" as "personal" | "company",
    firstName: "",
    lastName: "",
    companyName: "",
    email: "",
    phone: "",
  });

  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [ratePlanId, setRatePlanId] = useState(
    ratePlans.find((p) => p.isDefault)?.id ?? ratePlans[0]?.id ?? "",
  );
  const [status, setStatus] = useState<"pending" | "confirmed">("confirmed");
  const [settlement, setSettlement] = useState<Settlement>("at_property");
  /*
   * THE PROPERTY'S OWN RATE, NOT "No tax".
   *
   * This was seeded empty, and empty is the "No tax" option, so every booking
   * taken without somebody remembering to pick VAT went out with none. It was
   * not theoretical: sixteen of the nineteen bookings on the hosted property
   * carry zero tax, against roughly £616 of VAT that should have been on them.
   *
   * `taxRates` is already filtered to the active rates, so the first is the
   * one this hotel charges. "No tax" stays in the list, because a zero-rated
   * booking is a real thing -- it is now something you choose rather than
   * something you get by not noticing.
   */
  const [taxRateId, setTaxRateId] = useState(taxRates[0]?.id ?? "");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [guestNotes, setGuestNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [allowOverbook, setAllowOverbook] = useState(false);
  const [ignoreRestrictions, setIgnoreRestrictions] = useState(false);
  const [promotionCode, setPromotionCode] = useState("");

  const [error, setError] = useState<string | null>(null);
  // Set when Postgres refuses something a person is allowed to wave through.
  const [block, setBlock] = useState<BookingBlock | null>(null);
  const [taken, setTaken] = useState<{
    reference: string;
    bookingId: string;
    promotionName: string | null;
    discountCents: number;
  } | null>(null);

  const nights =
    checkOut > checkIn
      ? differenceInCalendarDays(parseISO(checkOut), parseISO(checkIn))
      : 0;

  // Availability is a property of the dates, so it is reloaded whenever they
  // change rather than held from page load. It is re-checked in Postgres when
  // the booking is taken; this is only so the form can show a number.
  useEffect(() => {
    if (checkOut <= checkIn) {
      setTypes([]);
      return;
    }
    let live = true;
    setLoadingTypes(true);
    loadAvailability(checkIn, checkOut).then((result) => {
      if (!live) return;
      setLoadingTypes(false);
      if (result.ok) {
        setTypes(result.data);
        setTypesError(null);
      } else {
        setTypesError(result.error);
      }
    });
    return () => {
      live = false;
    };
  }, [checkIn, checkOut]);

  useEffect(() => {
    if (guest.mode !== "existing" && query.trim().length < 2) {
      setMatches([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      searchCustomers(query).then((result) => {
        if (live && result.ok) setMatches(result.data);
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, guest.mode]);

  const typeById = useMemo(
    () => new Map(types.map((t) => [t.roomTypeId, t])),
    [types],
  );

  /** What each room type has left once the lines already added are counted. */
  function remaining(roomTypeId: string, exceptKey?: string) {
    const type = typeById.get(roomTypeId);
    if (!type) return 0;
    const claimed = lines
      .filter((l) => l.roomTypeId === roomTypeId && l.key !== exceptKey)
      .reduce((sum, l) => sum + l.quantity, 0);
    return type.available - claimed;
  }

  function addLine() {
    const free = types.find((t) => remaining(t.roomTypeId) > 0) ?? types[0];
    if (!free) return;
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        roomTypeId: free.roomTypeId,
        quantity: 1,
        rate: "",
        /*
         * The Stay band's occupancy, capped at what the type sleeps. It used
         * to come from `baseOccupancy` alone, which ignored the figure
         * somebody had just typed at the top of the form -- so the Stay band
         * was a number that changed nothing anywhere.
         */
        adults: Math.min(Math.max(adults, 1), Math.max(free.maxOccupancy, 1)),
        children: Math.max(children, 0),
      },
    ]);
  }

  function setLine(key: string, patch: Partial<Line>) {
    setLines((current) =>
      current.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  /**
   * Rate in pence, or null. Null is a real answer once a rate plan is picked:
   * it means "use the plan's rate", which varies night by night and is the
   * reason daily rates exist. Without a plan it means the line has no price.
   */
  function rateCents(line: Line): number | null {
    if (line.rate.trim() === "") return null;
    try {
      return parseMoney(line.rate);
    } catch {
      return null;
    }
  }

  /** True when the box holds something that is not an amount at all. */
  function rateIsNonsense(line: Line) {
    if (line.rate.trim() === "") return false;
    try {
      parseMoney(line.rate);
      return false;
    } catch {
      return true;
    }
  }

  const total = lines.reduce((sum, l) => {
    const cents = rateCents(l);
    return cents === null ? sum : sum + cents * l.quantity * nights;
  }, 0);

  // The form predicts overselling from what it loaded; Postgres decides it for
  // real, inside the transaction. Either is reason to offer the tickbox.
  const oversold =
    lines.some((l) => remaining(l.roomTypeId, l.key) < l.quantity) ||
    block === "overbook";

  function submit() {
    setError(null);
    setBlock(null);

    if (nights < 1) {
      setError("The departure date must be after the arrival date.");
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one room to the booking.");
      return;
    }
    for (const line of lines) {
      const name = typeById.get(line.roomTypeId)?.name ?? "this room";
      if (rateIsNonsense(line)) {
        setError(`The rate for ${name} is not an amount. Try 120 or 120.50.`);
        return;
      }
      if (rateCents(line) === null && !ratePlanId) {
        setError(
          `Enter a nightly rate for ${name}, or pick a rate plan that has one loaded.`,
        );
        return;
      }
    }
    if (guest.mode === "new") {
      const named =
        newGuest.kind === "company"
          ? newGuest.companyName.trim()
          : `${newGuest.firstName} ${newGuest.lastName}`.trim();
      if (named === "") {
        setError(
          newGuest.kind === "company"
            ? "Enter the company name."
            : "Enter the guest's name.",
        );
        return;
      }
    }
    if (!channelId) {
      setError("Pick where the booking came from.");
      return;
    }

    startTransition(async () => {
      const result = await createBooking({
        checkIn,
        checkOut,
        rooms: lines.map((l) => ({
          roomTypeId: l.roomTypeId,
          quantity: l.quantity,
          rateCents: rateCents(l),
          adults: l.adults,
          children: l.children,
        })),
        channelId,
        customerId: guest.mode === "existing" ? guest.id : null,
        newCustomer: guest.mode === "new" ? newGuest : null,
        /*
         * THE BOOKING'S PARTY SIZE IS THE SUM OF ITS ROOMS.
         *
         * These used to be sent straight from the Stay band, which is a
         * separate number from the per-room occupancy and never had to agree
         * with it. On one room nobody noticed. On a group it was plainly
         * wrong: twenty-seven rooms recorded "2 adults", and that is the
         * figure the booking header and every report then showed.
         *
         * The Stay band is not removed -- it seeds each room as it is added,
         * which is what somebody typing "2 adults" first actually means.
         * Falling back to it when there are no lines keeps the refusal below
         * the one that fires on an empty booking.
         */
        adults: lines.length
          ? lines.reduce((sum, l) => sum + l.adults * l.quantity, 0)
          : adults,
        children: lines.length
          ? lines.reduce((sum, l) => sum + l.children * l.quantity, 0)
          : children,
        status,
        settlement,
        taxRateId: taxRateId || null,
        guestNotes,
        internalNotes,
        externalReference,
        allowOverbook,
        ratePlanId: ratePlanId || null,
        ignoreRestrictions,
        promotionCode,
      });

      if (!result.ok) {
        setError(result.error);
        setBlock(result.block ?? null);
        return;
      }

      setTaken({
        reference: result.data.reference,
        bookingId: result.data.bookingId,
        promotionName: result.data.promotionName,
        discountCents: result.data.discountCents,
      });
      router.refresh();
    });
  }

  if (taken) {
    return (
      <div className="rounded-lg border border-line bg-white p-8 text-center shadow-card">
        <p className="font-display text-2xl font-semibold tracking-tightest text-ink">
          Booking {taken.reference} taken
        </p>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
          {nights} night{nights === 1 ? "" : "s"} from{" "}
          {format(parseISO(checkIn), "d MMM")}, {lines.reduce((s, l) => s + l.quantity, 0)}{" "}
          room{lines.reduce((s, l) => s + l.quantity, 0) === 1 ? "" : "s"}. No room
          has been assigned yet — that happens at check-in.
        </p>
        {taken.promotionName && (
          <p className="mx-auto mt-3 max-w-md rounded-md bg-emerald-50 px-3 py-2.5 text-[13px] leading-relaxed text-emerald-800">
            <span className="font-medium">{taken.promotionName}</span> applied,
            taking {formatMoney(taken.discountCents, currency)} off the stay.
          </p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <a
            href={`/bookings/${taken.bookingId}`}
            className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900"
          >
            Open the booking
          </a>
          <a
            href="/bookings"
            className="rounded-md border border-line px-5 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
          >
            See all bookings
          </a>
          <button
            onClick={() => {
              setTaken(null);
              setLines([]);
              setGuest({ mode: "new" });
              setNewGuest({
                kind: "personal",
                firstName: "",
                lastName: "",
                companyName: "",
                email: "",
                phone: "",
              });
              setGuestNotes("");
              setInternalNotes("");
              setExternalReference("");
              setAllowOverbook(false);
              setIgnoreRestrictions(false);
              setPromotionCode("");
            }}
            className="rounded-md border border-line px-5 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
          >
            Take another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stay ---------------------------------------------------------- */}
      <section className="rounded-lg border border-chrome-700 bg-chrome-800 p-5 shadow-card">
        <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-white">
          Stay
        </h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="check-in" className={labelDark}>
              Arrival
            </label>
            <input
              id="check-in"
              type="date"
              value={checkIn}
              onChange={(e) => {
                setCheckIn(e.target.value);
                if (e.target.value >= checkOut) {
                  setCheckOut(
                    format(addDays(parseISO(e.target.value), 1), "yyyy-MM-dd"),
                  );
                }
              }}
              className={cn(fieldDark, "tnum")}
            />
          </div>
          <div>
            <label htmlFor="check-out" className={labelDark}>
              Departure
            </label>
            <input
              id="check-out"
              type="date"
              value={checkOut}
              min={format(addDays(parseISO(checkIn), 1), "yyyy-MM-dd")}
              onChange={(e) => setCheckOut(e.target.value)}
              className={cn(fieldDark, "tnum")}
            />
          </div>
          <div>
            <label htmlFor="adults" className={labelDark}>
              Adults
            </label>
            <input
              id="adults"
              type="number"
              min={1}
              value={adults}
              onChange={(e) => setAdults(Math.max(Number(e.target.value) || 1, 1))}
              className={cn(fieldDark, "tnum")}
            />
          </div>
          <div>
            <label htmlFor="children" className={labelDark}>
              Children
            </label>
            <input
              id="children"
              type="number"
              min={0}
              value={children}
              onChange={(e) => setChildren(Math.max(Number(e.target.value) || 0, 0))}
              className={cn(fieldDark, "tnum")}
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-white/60">
          {nights > 0
            ? `${nights} night${nights === 1 ? "" : "s"}, ${format(parseISO(checkIn), "EEE d MMM")} to ${format(parseISO(checkOut), "EEE d MMM")}`
            : "Pick a departure date after the arrival date."}
        </p>
      </section>

      {/* Rooms --------------------------------------------------------- */}
      <section className="rounded-lg border border-line bg-white p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
            Rooms
          </h2>
          <button
            type="button"
            onClick={addLine}
            disabled={types.length === 0}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink disabled:opacity-40"
          >
            Add a room
          </button>
        </div>

        {typesError && (
          <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            {typesError}
          </p>
        )}

        {types.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-muted">
            {loadingTypes
              ? "Checking what is free…"
              : nights < 1
                ? "Pick the dates first."
                : "No room types are set up. Add room types and rooms before taking a booking."}
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {types.map((t) => {
                const left = remaining(t.roomTypeId);
                return (
                  <span
                    key={t.roomTypeId}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xxs font-medium",
                      left <= 0
                        ? "bg-rose-50 text-rose-700"
                        : left <= 2
                          ? "bg-warn-wash text-warn-deep"
                          : "bg-shell text-ink-muted",
                    )}
                  >
                    {t.name}: {left} free of {t.totalRooms}
                  </span>
                );
              })}
            </div>

            {lines.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-ink-muted">
                No rooms on this booking yet. Add one.
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((line) => {
                  const left = remaining(line.roomTypeId, line.key);
                  const over = line.quantity > left;
                  return (
                    <div
                      key={line.key}
                      className={cn(
                        "grid gap-3 rounded-md border p-3 sm:grid-cols-[2fr_repeat(4,1fr)_auto]",
                        over ? "border-rose-300 bg-rose-50/40" : "border-line",
                      )}
                    >
                      <div>
                        <label className={label}>Room type</label>
                        <select
                          value={line.roomTypeId}
                          onChange={(e) =>
                            setLine(line.key, { roomTypeId: e.target.value })
                          }
                          className={field}
                        >
                          {types.map((t) => (
                            <option key={t.roomTypeId} value={t.roomTypeId}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={label}>Rooms</label>
                        <input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) =>
                            setLine(line.key, {
                              quantity: Math.max(Number(e.target.value) || 1, 1),
                            })
                          }
                          className={cn(fieldDark, "tnum")}
                        />
                      </div>
                      <div>
                        <label className={label}>Rate a night</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={ratePlanId ? "From the plan" : "0.00"}
                          value={line.rate}
                          onChange={(e) => setLine(line.key, { rate: e.target.value })}
                          className={cn(fieldDark, "tnum")}
                        />
                      </div>
                      <div>
                        <label className={label}>Adults</label>
                        <input
                          type="number"
                          min={1}
                          value={line.adults}
                          onChange={(e) =>
                            setLine(line.key, {
                              adults: Math.max(Number(e.target.value) || 1, 1),
                            })
                          }
                          className={cn(fieldDark, "tnum")}
                        />
                      </div>
                      <div>
                        <label className={label}>Children</label>
                        <input
                          type="number"
                          min={0}
                          value={line.children}
                          onChange={(e) =>
                            setLine(line.key, {
                              children: Math.max(Number(e.target.value) || 0, 0),
                            })
                          }
                          className={cn(fieldDark, "tnum")}
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() =>
                            setLines((c) => c.filter((l) => l.key !== line.key))
                          }
                          className="rounded-md border border-line px-3 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
                        >
                          Remove
                        </button>
                      </div>
                      {over && (
                        <p className="text-xs text-rose-700 sm:col-span-6">
                          Only {Math.max(left, 0)} free for these dates. Reduce the
                          count, change the dates, or tick overbook below.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </>
        )}
      </section>

      {/* Guest --------------------------------------------------------- */}
      <section className="rounded-lg border border-line bg-white p-5 shadow-card">
        <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
          Guest
        </h2>

        {guest.mode === "existing" ? (
          <div className="flex items-center justify-between rounded-md border border-line bg-shell px-3 py-2.5">
            <span className="text-[13px] font-medium text-ink">{guest.name}</span>
            <button
              type="button"
              onClick={() => {
                setGuest({ mode: "new" });
                setQuery("");
              }}
              className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label htmlFor="guest-search" className={label}>
                Find an existing guest
              </label>
              <input
                id="guest-search"
                type="search"
                value={query}
                placeholder="Name, email, phone or customer number"
                onChange={(e) => setQuery(e.target.value)}
                className={field}
              />
              {matches.length > 0 && (
                <ul className="mt-1.5 divide-y divide-line rounded-md border border-line">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setGuest({ mode: "existing", id: m.id, name: m.name });
                          setMatches([]);
                        }}
                        className="flex w-full items-baseline justify-between px-3 py-2 text-left hover:bg-shell"
                      >
                        <span className="text-[13px] text-ink">{m.name}</span>
                        <span className="text-xxs text-ink-faint">{m.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim().length >= 2 && matches.length === 0 && (
                <p className="mt-1.5 text-xs text-ink-faint">
                  Nobody found. Enter the guest below and they will be created
                  with the booking.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="guest-kind" className={label}>
                  Booking for
                </label>
                <select
                  id="guest-kind"
                  value={newGuest.kind}
                  onChange={(e) =>
                    setNewGuest((g) => ({
                      ...g,
                      kind: e.target.value as "personal" | "company",
                    }))
                  }
                  className={field}
                >
                  <option value="personal">A person</option>
                  <option value="company">A company</option>
                </select>
              </div>
              {newGuest.kind === "company" ? (
                <div className="sm:col-span-2">
                  <label htmlFor="company" className={label}>
                    Company name
                  </label>
                  <input
                    id="company"
                    value={newGuest.companyName}
                    onChange={(e) =>
                      setNewGuest((g) => ({ ...g, companyName: e.target.value }))
                    }
                    className={field}
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="first-name" className={label}>
                      First name
                    </label>
                    <input
                      id="first-name"
                      value={newGuest.firstName}
                      onChange={(e) =>
                        setNewGuest((g) => ({ ...g, firstName: e.target.value }))
                      }
                      className={field}
                    />
                  </div>
                  <div>
                    <label htmlFor="last-name" className={label}>
                      Last name
                    </label>
                    <input
                      id="last-name"
                      value={newGuest.lastName}
                      onChange={(e) =>
                        setNewGuest((g) => ({ ...g, lastName: e.target.value }))
                      }
                      className={field}
                    />
                  </div>
                </>
              )}
              <div>
                <label htmlFor="email" className={label}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={newGuest.email}
                  onChange={(e) =>
                    setNewGuest((g) => ({ ...g, email: e.target.value }))
                  }
                  className={field}
                />
              </div>
              <div>
                <label htmlFor="phone" className={label}>
                  Phone
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={newGuest.phone}
                  onChange={(e) =>
                    setNewGuest((g) => ({ ...g, phone: e.target.value }))
                  }
                  className={field}
                />
              </div>
            </div>
          </>
        )}
      </section>

      {/* Source and terms ---------------------------------------------- */}
      <section className="rounded-lg border border-line bg-white p-5 shadow-card">
        <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
          Source and terms
        </h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="rate-plan" className={label}>
              Rate plan
            </label>
            <select
              id="rate-plan"
              value={ratePlanId}
              onChange={(e) => setRatePlanId(e.target.value)}
              className={field}
            >
              <option value="">No plan — type the rate</option>
              {ratePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="channel" className={label}>
              Came from
            </label>
            <select
              id="channel"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className={field}
            >
              {channels.length === 0 && <option value="">No sources set up</option>}
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className={label}>
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "pending" | "confirmed")
              }
              className={field}
            >
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <label htmlFor="settlement" className={label}>
              Settlement
            </label>
            <select
              id="settlement"
              value={settlement}
              onChange={(e) => setSettlement(e.target.value as Settlement)}
              className={field}
            >
              <option value="at_property">Pays at the property</option>
              <option value="prepaid_to_channel">Prepaid to the channel</option>
              <option value="virtual_card">Virtual card</option>
            </select>
          </div>
          <div>
            <label htmlFor="tax" className={label}>
              Tax rate
            </label>
            <select
              id="tax"
              value={taxRateId}
              onChange={(e) => setTaxRateId(e.target.value)}
              className={field}
            >
              <option value="">No tax</option>
              {taxRates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            {/*
              "Offer", not "Promotion". The client had the section renamed and
              every piece of copy follows; the schema still says `promotions`
              and deliberately stays that way. Read one as the other.
            */}
            <label htmlFor="promo" className={label}>
              Offer code
            </label>
            <input
              id="promo"
              value={promotionCode}
              onChange={(e) => setPromotionCode(e.target.value.toUpperCase())}
              placeholder="Optional"
              className={cn(field, "uppercase")}
            />
          </div>
          <div>
            <label htmlFor="external" className={label}>
              The channel&apos;s own reference
            </label>
            <input
              id="external"
              value={externalReference}
              onChange={(e) => setExternalReference(e.target.value)}
              placeholder="Optional"
              className={field}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="guest-notes" className={label}>
              Notes for the guest
            </label>
            <input
              id="guest-notes"
              value={guestNotes}
              onChange={(e) => setGuestNotes(e.target.value)}
              placeholder="Optional"
              className={field}
            />
          </div>
          <div className="sm:col-span-4">
            <label htmlFor="internal-notes" className={label}>
              Notes for staff
            </label>
            <input
              id="internal-notes"
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Optional — the guest never sees these"
              className={field}
            />
          </div>
        </div>
      </section>

      {/* Take it ------------------------------------------------------- */}
      <section className="rounded-lg border border-line bg-white p-5 shadow-card">
        {error && (
          <p className="mb-4 rounded-md bg-rose-50 px-3 py-2.5 text-[13px] leading-relaxed text-rose-700">
            {error}
          </p>
        )}
        {block === "restriction" && (
          <label className="mb-4 flex items-start gap-2.5 rounded-md border border-warn/40 bg-warn-wash px-3 py-2.5">
            <input
              type="checkbox"
              checked={ignoreRestrictions}
              onChange={(e) => setIgnoreRestrictions(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-[13px] leading-relaxed text-warn-deep">
              Take this booking against the restriction above.
            </span>
          </label>
        )}
        {oversold && (
          <label className="mb-4 flex items-start gap-2.5 rounded-md border border-warn/40 bg-warn-wash px-3 py-2.5">
            <input
              type="checkbox"
              checked={allowOverbook}
              onChange={(e) => setAllowOverbook(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-[13px] leading-relaxed text-warn-deep">
              Take this booking anyway, overbooking the house.
            </span>
          </label>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-chrome-800 px-6 py-2.5 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
          >
            {pending ? "Taking the booking…" : "Take the booking"}
          </button>
        </div>
      </section>
    </div>
  );
}
