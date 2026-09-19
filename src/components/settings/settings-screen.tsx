"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import {
  createRooms,
  saveChannel,
  savePaymentMethod,
  saveProperty,
  saveRoom,
  saveRoomType,
  saveSeason,
  deleteSeason,
  saveStaffUser,
  saveTaxRate,
  saveRatePlan,
} from "@/lib/actions/settings";
import type {
  CalendarSeason,
  MealType,
  RatePlan,
  ChannelKind,
  ChannelSetting,
  PaymentMethodKind,
  PaymentMethodSetting,
  PropertySettings,
  RoomSettingsPage,
  RoomTypeSetting,
  StaffRole,
  StaffSetting,
  TaxRateSetting,
} from "@/lib/types";

export type SettingsTab =
  | "property"
  | "room-types"
  | "rooms"
  | "channels"
  | "tax"
  | "seasons"
  | "rate-plans"
  | "payment-methods"
  | "staff";

/** What a plan includes, in a guest's words. The set of meals IS the board type. */
const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "property", label: "Property" },
  { id: "room-types", label: "Room types" },
  { id: "rooms", label: "Rooms" },
  { id: "channels", label: "Booking sources" },
  { id: "tax", label: "Tax rates" },
  { id: "seasons", label: "Seasons" },
  { id: "rate-plans", label: "Rate plans" },
  { id: "payment-methods", label: "Payment methods" },
  { id: "staff", label: "Staff" },
];

const CHANNEL_KINDS: { value: ChannelKind; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "ota", label: "OTA" },
  { value: "wholesaler", label: "Wholesaler" },
  { value: "gds", label: "GDS" },
  { value: "offline", label: "Offline" },
];

const ROLES: { value: StaffRole; label: string; note: string }[] = [
  { value: "admin", label: "Administrator", note: "Everything, including staff" },
  { value: "manager", label: "Manager", note: "Rates, settings, the night audit, the drawer total" },
  { value: "front_desk", label: "Front desk", note: "Bookings, check-in and out, payments" },
  { value: "cashier", label: "Cashier", note: "Payments and the drawer" },
  { value: "housekeeping", label: "Housekeeping", note: "Room status, and no money at all" },
];

/**
 * payment_methods carries `unique (property_id, kind)`, so this list is the
 * whole space of methods a property can have — never a free-form list. A kind
 * already taken is offered only on the method that holds it.
 */
const PAYMENT_KINDS: { value: PaymentMethodKind; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "ota_prepaid", label: "Prepaid to the channel" },
  { value: "virtual_card", label: "Virtual card" },
  { value: "complimentary", label: "Complimentary" },
  { value: "other", label: "Other" },
];

const ROOM_STATUS_LABEL: Record<string, string> = {
  vacant_clean: "Vacant, clean",
  vacant_dirty: "Vacant, dirty",
  occupied: "Occupied",
  ooo: "Out of order",
};

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const card = "rounded-lg border border-line bg-white p-5 shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink";

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-xs leading-relaxed text-ink-faint">{children}</p>
  );
}

export function SettingsScreen({
  tab,
  property,
  roomTypes,
  rooms,
  roomQuery,
  channels,
  taxRates,
  seasons,
  ratePlans,
  paymentMethods,
  staff,
  editRoomTypeId,
  meId,
  canEdit,
  isAdmin,
}: {
  tab: SettingsTab;
  property: PropertySettings;
  roomTypes: RoomTypeSetting[];
  rooms: RoomSettingsPage;
  roomQuery: string;
  channels: ChannelSetting[];
  taxRates: TaxRateSetting[];
  seasons: CalendarSeason[];
  ratePlans: RatePlan[];
  paymentMethods: PaymentMethodSetting[];
  /** A room type to open for editing on arrival, from the calendar's rail. */
  editRoomTypeId: string | null;
  staff: StaffSetting[];
  meId: string | null;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setMessage({ ok: false, text: result.error ?? "That did not work." });
        return;
      }
      setMessage({ ok: true, text: done });
      router.refresh();
    });
  }

  /* -- Property ------------------------------------------------------- */
  const [prop, setProp] = useState({
    name: property.name,
    timezone: property.timezone,
    currency: property.currency,
    checkInTime: property.checkInTime?.slice(0, 5) ?? "15:00",
    checkOutTime: property.checkOutTime?.slice(0, 5) ?? "11:00",
  });

  /* -- Room types ----------------------------------------------------- */
  const [rt, setRt] = useState<{
    id: string | null;
    code: string;
    name: string;
    baseOccupancy: string;
    maxOccupancy: string;
  } | null>(() => {
    // The calendar's rail links here to rename a type, so arriving with that
    // id opens its form rather than a list somebody then has to search. An id
    // that no longer exists opens nothing, which is the right nothing.
    const t = roomTypes.find((x) => x.id === editRoomTypeId);
    if (!t) return null;
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      baseOccupancy: String(t.baseOccupancy),
      maxOccupancy: String(t.maxOccupancy),
    };
  });

  /* -- Rooms ---------------------------------------------------------- */
  const [run_, setRun] = useState({
    roomTypeId: roomTypes[0]?.id ?? "",
    first: "",
    last: "",
    floor: "",
    prefix: "",
  });

  /* -- One room ------------------------------------------------------- */
  const [room, setRoom] = useState<{
    id: string;
    number: string;
    roomTypeId: string;
    floor: string;
  } | null>(null);
  const [roomSearch, setRoomSearch] = useState(roomQuery);

  function goToRooms(q: string, page: number) {
    const params = new URLSearchParams({ tab: "rooms" });
    if (q.trim() !== "") params.set("q", q.trim());
    if (page > 1) params.set("page", String(page));
    router.push(`/settings?${params.toString()}`);
  }

  /* -- Payment methods ------------------------------------------------- */
  const [pm, setPm] = useState<{
    id: string | null;
    name: string;
    kind: PaymentMethodKind;
    isActive: boolean;
    frozen: boolean;
  } | null>(null);

  /* -- Channels ------------------------------------------------------- */
  const [ch, setCh] = useState<{
    id: string | null;
    code: string;
    name: string;
    kind: ChannelKind;
    commission: string;
    isActive: boolean;
  } | null>(null);

  /* -- Tax ------------------------------------------------------------ */
  const [tx, setTx] = useState<{
    id: string | null;
    name: string;
    percent: string;
    inclusion: "inclusive" | "exclusive";
    isActive: boolean;
  } | null>(null);

  const [sn, setSn] = useState<{
    id: string | null;
    name: string;
    startsOn: string;
    endsOn: string;
  } | null>(null);

  const [rp, setRp] = useState<{
    id: string | null;
    code: string;
    name: string;
    description: string;
    isDefault: boolean;
    isActive: boolean;
  } | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-white p-2 shadow-card">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/settings?tab=${t.id}`}
            className={cn(
              "rounded-md px-3.5 py-2 text-[13px]",
              t.id === tab
                ? "bg-chrome-800 font-medium text-white"
                : "text-ink-muted hover:bg-shell hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {message && (
        <p
          className={cn(
            "rounded-md px-3 py-2.5 text-[13px] leading-relaxed",
            message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700",
          )}
        >
          {message.text}
        </p>
      )}

      {!canEdit && (
        <p className={cn(card, "text-[13px] leading-relaxed text-ink-muted")}>
          You can read the settings but not change them. Rooms, rates and
          booking sources are set by managers and administrators.
        </p>
      )}

      {/* Property ------------------------------------------------------ */}
      {tab === "property" && (
        <div className={card}>
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            The property
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="p-name" className={label}>Name</label>
              <input
                id="p-name"
                value={prop.name}
                disabled={!canEdit}
                onChange={(e) => setProp({ ...prop, name: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="p-cur" className={label}>Currency</label>
              <input
                id="p-cur"
                value={prop.currency}
                maxLength={3}
                disabled={!canEdit}
                onChange={(e) => setProp({ ...prop, currency: e.target.value.toUpperCase() })}
                className={cn(field, "uppercase")}
              />
            </div>
            <div>
              <label htmlFor="p-tz" className={label}>Timezone</label>
              <input
                id="p-tz"
                value={prop.timezone}
                disabled={!canEdit}
                onChange={(e) => setProp({ ...prop, timezone: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="p-in" className={label}>Check-in from</label>
              <input
                id="p-in"
                type="time"
                value={prop.checkInTime}
                disabled={!canEdit}
                onChange={(e) => setProp({ ...prop, checkInTime: e.target.value })}
                className={cn(field, "tnum")}
              />
            </div>
            <div>
              <label htmlFor="p-out" className={label}>Check-out by</label>
              <input
                id="p-out"
                type="time"
                value={prop.checkOutTime}
                disabled={!canEdit}
                onChange={(e) => setProp({ ...prop, checkOutTime: e.target.value })}
                className={cn(field, "tnum")}
              />
            </div>
          </div>
          <Note>
            The timezone decides every business date this property computes, so
            an unknown one is refused rather than stored. Changing the currency
            does not restate money already posted — amounts are held in minor
            units and only the symbol moves.
          </Note>
          {canEdit && (
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => run(() => saveProperty(prop), "Property saved.")}
                disabled={pending}
                className={primary}
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}

      {/* Room types ---------------------------------------------------- */}
      {tab === "room-types" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Room types
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setRt({ id: null, code: "", name: "", baseOccupancy: "2", maxOccupancy: "2" })
                  }
                  className={secondary}
                >
                  New room type
                </button>
              )}
            </div>

            {roomTypes.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-muted">
                None yet. A room type is what you sell — Double, Twin, Suite —
                and rooms belong to one. Add these before anything else.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Code", "Name", "Sleeps", "Rooms", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {roomTypes.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2.5 font-medium text-ink">{t.code}</td>
                      <td className="px-3 py-2.5 text-ink">{t.name}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">
                        {t.baseOccupancy}
                        {t.maxOccupancy > t.baseOccupancy && `–${t.maxOccupancy}`}
                      </td>
                      <td
                        className={cn(
                          "tnum px-3 py-2.5",
                          t.roomCount === 0 ? "text-warn-deep" : "text-ink-muted",
                        )}
                      >
                        {t.roomCount === 0 ? "none yet" : t.roomCount}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <button
                            onClick={() =>
                              setRt({
                                id: t.id,
                                code: t.code,
                                name: t.name,
                                baseOccupancy: String(t.baseOccupancy),
                                maxOccupancy: String(t.maxOccupancy),
                              })
                            }
                            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>
              A room type cannot be deleted once bookings reference it. Rename
              it or stop selling it on the rate plan instead.
            </Note>
          </div>

          {rt && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {rt.id ? "Edit room type" : "New room type"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <label htmlFor="rt-code" className={label}>Code</label>
                  <input
                    id="rt-code"
                    value={rt.code}
                    placeholder="DBL"
                    onChange={(e) => setRt({ ...rt, code: e.target.value.toUpperCase() })}
                    className={cn(field, "uppercase")}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="rt-name" className={label}>Name</label>
                  <input
                    id="rt-name"
                    value={rt.name}
                    placeholder="Double"
                    onChange={(e) => setRt({ ...rt, name: e.target.value })}
                    className={field}
                  />
                </div>
                <div className="flex gap-2">
                  <div>
                    <label htmlFor="rt-base" className={label}>Sleeps</label>
                    <input
                      id="rt-base"
                      inputMode="numeric"
                      value={rt.baseOccupancy}
                      onChange={(e) => setRt({ ...rt, baseOccupancy: e.target.value })}
                      className={cn(field, "tnum")}
                    />
                  </div>
                  <div>
                    <label htmlFor="rt-max" className={label}>Max</label>
                    <input
                      id="rt-max"
                      inputMode="numeric"
                      value={rt.maxOccupancy}
                      onChange={(e) => setRt({ ...rt, maxOccupancy: e.target.value })}
                      className={cn(field, "tnum")}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setRt(null)} className={secondary}>Cancel</button>
                <button
                  onClick={() =>
                    run(
                      () =>
                        saveRoomType({
                          id: rt.id,
                          code: rt.code,
                          name: rt.name,
                          baseOccupancy: Number(rt.baseOccupancy) || 1,
                          maxOccupancy: Number(rt.maxOccupancy) || 1,
                        }),
                      `${rt.name || "Room type"} saved.`,
                    )
                  }
                  disabled={pending}
                  className={primary}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Rooms --------------------------------------------------------- */}
      {tab === "rooms" && (
        <>
        <div className={card}>
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            Add rooms
          </h2>

          {roomTypes.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              Add a room type first — every room belongs to one.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-5">
                <div className="sm:col-span-2">
                  <label htmlFor="r-type" className={label}>Room type</label>
                  <select
                    id="r-type"
                    value={run_.roomTypeId}
                    disabled={!canEdit}
                    onChange={(e) => setRun({ ...run_, roomTypeId: e.target.value })}
                    className={field}
                  >
                    {roomTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="r-first" className={label}>From</label>
                  <input
                    id="r-first"
                    inputMode="numeric"
                    placeholder="101"
                    value={run_.first}
                    disabled={!canEdit}
                    onChange={(e) => setRun({ ...run_, first: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
                <div>
                  <label htmlFor="r-last" className={label}>To</label>
                  <input
                    id="r-last"
                    inputMode="numeric"
                    placeholder="120"
                    value={run_.last}
                    disabled={!canEdit}
                    onChange={(e) => setRun({ ...run_, last: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
                <div>
                  <label htmlFor="r-floor" className={label}>Floor</label>
                  <input
                    id="r-floor"
                    inputMode="numeric"
                    placeholder="1"
                    value={run_.floor}
                    disabled={!canEdit}
                    onChange={(e) => setRun({ ...run_, floor: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
              </div>
              <Note>
                Rooms are made in runs because a property can run well over a
                thousand of them. &ldquo;Double, floor 1, 101 to 120&rdquo;
                makes twenty rooms, all vacant and clean. Up to 500 at a time,
                and a run that would collide with a room that already exists is
                refused by name before anything is written.
              </Note>
              {canEdit && (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-ink-faint">
                    Correct a room afterwards from the list below.
                  </p>
                  <button
                    onClick={() =>
                      run(
                        () =>
                          createRooms({
                            roomTypeId: run_.roomTypeId,
                            first: Number(run_.first),
                            last: Number(run_.last),
                            floor: run_.floor.trim() === "" ? null : Number(run_.floor),
                            prefix: run_.prefix,
                          }),
                        "Rooms added.",
                      )
                    }
                    disabled={pending || run_.first === "" || run_.last === ""}
                    className={primary}
                  >
                    {pending ? "Adding…" : "Add the run"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* The rooms themselves ---------------------------------------- */}
        <div className={card}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
              Rooms
              {rooms.total > 0 && (
                <span className="tnum ml-2 text-[13px] font-normal text-ink-faint">
                  {rooms.total}
                </span>
              )}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                goToRooms(roomSearch, 1);
              }}
              className="flex items-center gap-2"
            >
              <label htmlFor="room-q" className="sr-only">
                Search rooms
              </label>
              <input
                id="room-q"
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                placeholder="Room number or type"
                className={cn(field, "w-56")}
              />
              <button type="submit" className={secondary}>
                Search
              </button>
              {roomQuery !== "" && (
                <button
                  type="button"
                  onClick={() => {
                    setRoomSearch("");
                    goToRooms("", 1);
                  }}
                  className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Clear
                </button>
              )}
            </form>
          </div>

          {rooms.rows.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              {roomQuery !== ""
                ? `No room matches \u201C${roomQuery}\u201D. Try the number on its own, or the room type.`
                : "No rooms yet \u2014 add a run above."}
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  {["Room", "Floor", "Type", "Status", ""].map((c, i) => (
                    <th
                      key={c || i}
                      className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rooms.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="tnum px-3 py-2.5 font-medium text-ink">
                      {r.number}
                    </td>
                    <td className="tnum px-3 py-2.5 text-ink-muted">
                      {r.floor ?? "\u2014"}
                    </td>
                    <td className="px-3 py-2.5 text-ink">{r.roomTypeName}</td>
                    <td className="px-3 py-2.5 text-ink-muted">
                      {ROOM_STATUS_LABEL[r.status] ?? r.status}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canEdit && (
                        <button
                          onClick={() =>
                            setRoom({
                              id: r.id,
                              number: r.number,
                              roomTypeId: r.roomTypeId,
                              floor: r.floor === null ? "" : String(r.floor),
                            })
                          }
                          className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {rooms.total > rooms.perPage && (
            <div className="mt-4 flex items-center justify-between gap-3 text-[13px]">
              <button
                onClick={() => goToRooms(roomQuery, rooms.page - 1)}
                disabled={rooms.page <= 1}
                className={cn(secondary, "disabled:opacity-40")}
              >
                Previous
              </button>
              <span className="tnum text-ink-faint">
                {(rooms.page - 1) * rooms.perPage + 1}
                {"\u2013"}
                {Math.min(rooms.page * rooms.perPage, rooms.total)} of {rooms.total}
              </span>
              <button
                onClick={() => goToRooms(roomQuery, rooms.page + 1)}
                disabled={rooms.page * rooms.perPage >= rooms.total}
                className={cn(secondary, "disabled:opacity-40")}
              >
                Next
              </button>
            </div>
          )}

          <Note>
            Paged in Postgres, because a property may hold well over a thousand
            rooms. Status is changed where the work happens — the
            housekeeping report and the house board — not here. A room
            cannot be deleted: reservations point at it. Take one out of service
            by setting it out of order.
          </Note>
        </div>

        {room && (
          <div className={card}>
            <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
              Room {room.number}
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="room-number" className={label}>Number</label>
                <input
                  id="room-number"
                  value={room.number}
                  onChange={(e) => setRoom({ ...room, number: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </div>
              <div>
                <label htmlFor="room-type" className={label}>Room type</label>
                <select
                  id="room-type"
                  value={room.roomTypeId}
                  onChange={(e) => setRoom({ ...room, roomTypeId: e.target.value })}
                  className={field}
                >
                  {roomTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="room-floor" className={label}>Floor</label>
                <input
                  id="room-floor"
                  inputMode="numeric"
                  placeholder="Leave blank if none"
                  value={room.floor}
                  onChange={(e) => setRoom({ ...room, floor: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </div>
            </div>
            <Note>
              Moving a room to another type leaves every booking alone: a
              reservation records the type it was sold at, so nothing already
              taken is re-priced or re-counted by the move.
            </Note>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() =>
                  run(
                    () =>
                      saveRoom({
                        id: room.id,
                        number: room.number,
                        roomTypeId: room.roomTypeId,
                        floor:
                          room.floor.trim() === "" ? null : Number(room.floor),
                      }).then((r) => {
                        if (r.ok) setRoom(null);
                        return r;
                      }),
                    "Room saved.",
                  )
                }
                disabled={pending}
                className={primary}
              >
                {pending ? "Saving\u2026" : "Save the room"}
              </button>
              <button onClick={() => setRoom(null)} className={secondary}>
                Cancel
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {/* Channels ------------------------------------------------------ */}
      {tab === "channels" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Booking sources
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setCh({
                      id: null,
                      code: "",
                      name: "",
                      kind: "direct",
                      commission: "0",
                      isActive: true,
                    })
                  }
                  className={secondary}
                >
                  New source
                </button>
              )}
            </div>

            {channels.length === 0 ? (
              <p className="rounded-md bg-warn-wash px-3 py-3 text-center text-[13px] leading-relaxed text-warn-deep">
                None yet — and every booking must have one, so no booking can be
                taken at all until there is. Add at least &ldquo;Direct&rdquo;.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Code", "Name", "Kind", "Commission", "", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {channels.map((c) => (
                    <tr key={c.id} className={cn(!c.isActive && "opacity-55")}>
                      <td className="px-3 py-2.5 font-medium text-ink">{c.code}</td>
                      <td className="px-3 py-2.5 text-ink">{c.name}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{c.kind}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">
                        {c.commissionBps === 0 ? "—" : `${(c.commissionBps / 100).toFixed(2)}%`}
                      </td>
                      <td className="px-3 py-2.5 text-xxs text-ink-faint">
                        {c.isActive ? "" : "retired"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <button
                            onClick={() =>
                              setCh({
                                id: c.id,
                                code: c.code,
                                name: c.name,
                                kind: c.kind,
                                commission: String(c.commissionBps / 100),
                                isActive: c.isActive,
                              })
                            }
                            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>
              Commission is what the channel report works out as owed on the
              room revenue. Nothing records it being invoiced or paid, so the
              figure is what is owed, never a balance.
            </Note>
          </div>

          {ch && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {ch.id ? "Edit booking source" : "New booking source"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <label htmlFor="c-code" className={label}>Code</label>
                  <input
                    id="c-code"
                    value={ch.code}
                    placeholder="DIR"
                    onChange={(e) => setCh({ ...ch, code: e.target.value.toUpperCase() })}
                    className={cn(field, "uppercase")}
                  />
                </div>
                <div>
                  <label htmlFor="c-name" className={label}>Name</label>
                  <input
                    id="c-name"
                    value={ch.name}
                    placeholder="Direct"
                    onChange={(e) => setCh({ ...ch, name: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="c-kind" className={label}>Kind</label>
                  <select
                    id="c-kind"
                    value={ch.kind}
                    onChange={(e) => setCh({ ...ch, kind: e.target.value as ChannelKind })}
                    className={field}
                  >
                    {CHANNEL_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="c-comm" className={label}>Commission %</label>
                  <input
                    id="c-comm"
                    inputMode="decimal"
                    value={ch.commission}
                    onChange={(e) => setCh({ ...ch, commission: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
              </div>
              {ch.id && (
                <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-muted">
                  <input
                    type="checkbox"
                    checked={ch.isActive}
                    onChange={(e) => setCh({ ...ch, isActive: e.target.checked })}
                  />
                  Still selling. Turning this off stops new bookings from it and
                  leaves the old ones alone.
                </label>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setCh(null)} className={secondary}>Cancel</button>
                <button
                  onClick={() =>
                    run(
                      () =>
                        saveChannel({
                          id: ch.id,
                          code: ch.code,
                          name: ch.name,
                          kind: ch.kind,
                          // Basis points, like every other rate here.
                          commissionBps: Math.round((Number(ch.commission) || 0) * 100),
                          isActive: ch.isActive,
                        }),
                      `${ch.name || "Source"} saved.`,
                    )
                  }
                  disabled={pending}
                  className={primary}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tax ----------------------------------------------------------- */}
      {tab === "tax" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Tax rates
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setTx({
                      id: null,
                      name: "VAT",
                      percent: "20",
                      inclusion: "exclusive",
                      isActive: true,
                    })
                  }
                  className={secondary}
                >
                  New tax rate
                </button>
              )}
            </div>

            {taxRates.length === 0 ? (
              <p className="py-6 text-center text-[13px] leading-relaxed text-ink-muted">
                None yet. Without one, charges post with no tax at all — which
                is right only if this property genuinely charges none.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Name", "Rate", "Quoted", "", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {taxRates.map((t) => (
                    <tr key={t.id} className={cn(!t.isActive && "opacity-55")}>
                      <td className="px-3 py-2.5 font-medium text-ink">{t.name}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">
                        {(t.rateBps / 100).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {t.inclusion === "inclusive" ? "tax included" : "tax on top"}
                      </td>
                      <td className="px-3 py-2.5 text-xxs text-ink-faint">
                        {t.isActive ? "" : "retired"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <button
                            onClick={() =>
                              setTx({
                                id: t.id,
                                name: t.name,
                                percent: String(t.rateBps / 100),
                                inclusion: t.inclusion,
                                isActive: t.isActive,
                              })
                            }
                            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>
              Tax on top means the rate you quote is before tax; tax included
              means the guest&rsquo;s price already contains it, and the split
              is worked out backwards. The difference on a £120 room is about
              £20, so it is worth being sure. Once charges have been posted at a
              rate, that rate can be renamed or retired but not moved — a folio
              item records which rate it used, and changing it would restate
              history.
            </Note>
          </div>

          {tx && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {tx.id ? "Edit tax rate" : "New tax rate"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="t-name" className={label}>Name</label>
                  <input
                    id="t-name"
                    value={tx.name}
                    onChange={(e) => setTx({ ...tx, name: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="t-pct" className={label}>Rate %</label>
                  <input
                    id="t-pct"
                    inputMode="decimal"
                    value={tx.percent}
                    onChange={(e) => setTx({ ...tx, percent: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
                <div>
                  <label htmlFor="t-inc" className={label}>How it is quoted</label>
                  <select
                    id="t-inc"
                    value={tx.inclusion}
                    onChange={(e) =>
                      setTx({ ...tx, inclusion: e.target.value as "inclusive" | "exclusive" })
                    }
                    className={field}
                  >
                    <option value="exclusive">Tax on top of the rate</option>
                    <option value="inclusive">Rate already includes tax</option>
                  </select>
                </div>
              </div>
              {tx.id && (
                <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-muted">
                  <input
                    type="checkbox"
                    checked={tx.isActive}
                    onChange={(e) => setTx({ ...tx, isActive: e.target.checked })}
                  />
                  In use.
                </label>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setTx(null)} className={secondary}>Cancel</button>
                <button
                  onClick={() =>
                    run(
                      () =>
                        saveTaxRate({
                          id: tx.id,
                          name: tx.name,
                          rateBps: Math.round((Number(tx.percent) || 0) * 100),
                          inclusion: tx.inclusion,
                          isActive: tx.isActive,
                        }),
                      `${tx.name || "Tax rate"} saved.`,
                    )
                  }
                  disabled={pending}
                  className={primary}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Payment methods ----------------------------------------------- */}
      {tab === "seasons" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Seasons
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setSn({ id: null, name: "", startsOn: "", endsOn: "" })
                  }
                  className={secondary}
                >
                  New season
                </button>
              )}
            </div>

            {seasons.length === 0 ? (
              <p className="py-6 text-center text-[13px] leading-relaxed text-ink-muted">
                None yet. Name one and it appears as a band across the top of
                the calendar for those dates.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Season", "First day", "Last day", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {seasons.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2.5 font-medium text-ink">{s.name}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">{s.startsOn}</td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">{s.endsOn}</td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <span className="flex justify-end gap-3">
                            <button
                              onClick={() =>
                                setSn({
                                  id: s.id,
                                  name: s.name,
                                  startsOn: s.startsOn,
                                  endsOn: s.endsOn,
                                })
                              }
                              className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await deleteSeason(s.id);
                                  if (!result.ok) {
                                    setMessage({ ok: false, text: result.error });
                                    return;
                                  }
                                  setMessage({ ok: true, text: `${s.name} removed.` });
                                  router.refresh();
                                })
                              }
                              className="text-rose-600 underline-offset-2 hover:underline"
                            >
                              Remove
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>
              A season labels the calendar and changes no price. Rates are set
              per plan, per room type, per night in Inventory, and nothing here
              touches them — a season that quietly moved rates would be a second
              price list nobody could see. Seasons cannot overlap: two bands
              over one date has no sensible drawing. The last day is included,
              so a season runs to the end of it.
            </Note>
          </div>

          {sn && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {sn.id ? "Edit season" : "New season"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={label} htmlFor="season-name">Name</label>
                  <input
                    id="season-name"
                    value={sn.name}
                    onChange={(e) => setSn({ ...sn, name: e.target.value })}
                    placeholder="Low season"
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="season-from">First day</label>
                  <input
                    id="season-from"
                    type="date"
                    value={sn.startsOn}
                    onChange={(e) => setSn({ ...sn, startsOn: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="season-to">Last day</label>
                  <input
                    id="season-to"
                    type="date"
                    value={sn.endsOn}
                    onChange={(e) => setSn({ ...sn, endsOn: e.target.value })}
                    className={field}
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await saveSeason(sn);
                      if (!result.ok) {
                        setMessage({ ok: false, text: result.error });
                        return;
                      }
                      setMessage({ ok: true, text: `${sn.name} saved.` });
                      setSn(null);
                      router.refresh();
                    })
                  }
                  className={primary}
                >
                  {pending ? "Saving…" : "Save season"}
                </button>
                <button onClick={() => setSn(null)} className={secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Rate plans ------------------------------------------------------ */}
      {tab === "rate-plans" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Rate plans
              </h2>
              {canEdit && (
                <button
                  onClick={() =>
                    setRp({
                      id: null,
                      code: "",
                      name: "",
                      description: "",
                      isDefault: false,
                      isActive: true,
                    })
                  }
                  className={secondary}
                >
                  New rate plan
                </button>
              )}
            </div>

            {ratePlans.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                No rate plans yet. A hotel usually sells several — Room Only,
                Bed and Breakfast, Non-refundable — and each is priced per room
                type on the Rates screen.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-faint">
                      {["Code", "Name", "Includes", "Guest page", "Status", ""].map(
                        (c, i) => (
                          <th
                            key={c || `c${i}`}
                            className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                          >
                            {c}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {ratePlans.map((p) => (
                      <tr key={p.id}>
                        <td className="tnum px-3 py-2.5 font-medium text-ink">
                          {p.code}
                        </td>
                        <td className="px-3 py-2.5 text-ink">
                          {p.name}
                          {p.isDefault && (
                            <span className="ml-2 text-xxs text-ink-faint">main</span>
                          )}
                          {p.description && (
                            <span className="block text-xxs text-ink-faint">
                              {p.description}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-ink-muted">
                          {/* The board type IS the set of meals. "Half board" is
                              two rows here and "B&B" is one, which is why there
                              is no board-type enum to keep in step. */}
                          {p.meals.length === 0
                            ? "Room only"
                            : p.meals
                                .map((m) => MEAL_LABEL[m])
                                .join(", ")}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={
                              p.isPublic ? "text-emerald-600" : "text-ink-faint"
                            }
                          >
                            {p.isPublic ? "Published" : "Not published"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={p.isActive ? "text-ink" : "text-ink-faint"}
                          >
                            {p.isActive ? "Selling" : "Retired"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {canEdit && (
                            <button
                              onClick={() =>
                                setRp({
                                  id: p.id,
                                  code: p.code,
                                  name: p.name,
                                  description: p.description ?? "",
                                  isDefault: p.isDefault,
                                  isActive: p.isActive,
                                })
                              }
                              className="rounded border border-line px-2 py-1 text-xxs text-ink-muted hover:bg-shell"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              A rate plan is what the hotel sells — the price itself is set per
              room type and per night on{" "}
              <Link
                href="/inventory/rates-all"
                className="underline underline-offset-2"
              >
                Inventory → Rates
              </Link>
              , where every plan shows under each room type. What a plan
              includes is set there too. There is no delete: bookings and prices
              point at a plan, so one no longer sold is retired and keeps saying
              what it was sold as.
            </p>
          </div>

          {rp && canEdit && (
            <div className={card}>
              <h2 className="mb-3 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {rp.id ? "Edit rate plan" : "New rate plan"}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label} htmlFor="rp-code">Code</label>
                  <input
                    id="rp-code"
                    value={rp.code}
                    onChange={(e) => setRp({ ...rp, code: e.target.value })}
                    placeholder="BB"
                    className={field}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="rp-name">Name</label>
                  <input
                    id="rp-name"
                    value={rp.name}
                    onChange={(e) => setRp({ ...rp, name: e.target.value })}
                    placeholder="Bed and Breakfast"
                    className={field}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="rp-desc">Description</label>
                  <input
                    id="rp-desc"
                    value={rp.description}
                    onChange={(e) => setRp({ ...rp, description: e.target.value })}
                    placeholder="What a guest gets on this rate"
                    className={field}
                  />
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={rp.isDefault}
                  onChange={(e) => setRp({ ...rp, isDefault: e.target.checked })}
                  className="h-3.5 w-3.5 accent-brass"
                />
                The main rate — used when a booking names no plan
              </label>
              <label className="mt-2 flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={rp.isActive}
                  onChange={(e) => setRp({ ...rp, isActive: e.target.checked })}
                  className="h-3.5 w-3.5 accent-brass"
                />
                Still selling
              </label>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() =>
                    run(() => saveRatePlan(rp), rp.id ? "Rate plan saved." : "Rate plan created.")
                  }
                  disabled={pending}
                  className={primary}
                >
                  {pending ? "Saving\u2026" : "Save"}
                </button>
                <button onClick={() => setRp(null)} className={secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}


      {tab === "payment-methods" && (
        <>
          <div className={card}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                Payment methods
              </h2>
              {canEdit && paymentMethods.length < PAYMENT_KINDS.length && (
                <button
                  onClick={() =>
                    setPm({
                      id: null,
                      name: "",
                      kind:
                        PAYMENT_KINDS.find(
                          (k) => !paymentMethods.some((m) => m.kind === k.value),
                        )?.value ?? "other",
                      isActive: true,
                      frozen: false,
                    })
                  }
                  className={secondary}
                >
                  New method
                </button>
              )}
            </div>

            {paymentMethods.length === 0 ? (
              <p className="rounded-md bg-warn-wash px-3 py-3 text-center text-[13px] leading-relaxed text-warn-deep">
                None yet — so the cashier cannot take a payment at all. Add
                at least cash and card.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-faint">
                    {["Name", "Kind", "Drawer", "Taken", "", ""].map((c, i) => (
                      <th
                        key={c || i}
                        className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {paymentMethods.map((m) => (
                    <tr key={m.id} className={cn(!m.isActive && "opacity-55")}>
                      <td className="px-3 py-2.5 font-medium text-ink">{m.name}</td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {PAYMENT_KINDS.find((k) => k.value === m.kind)?.label ??
                          m.kind}
                      </td>
                      <td className="px-3 py-2.5">
                        {m.affectsDrawer ? (
                          <span className="rounded bg-warn-wash px-1.5 py-0.5 text-xxs font-semibold uppercase tracking-[0.08em] text-warn-deep">
                            Physical cash
                          </span>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="tnum px-3 py-2.5 text-ink-muted">
                        {m.paymentCount === 0 ? "\u2014" : m.paymentCount}
                      </td>
                      <td className="px-3 py-2.5 text-xxs text-ink-faint">
                        {m.isActive ? "" : "retired"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canEdit && (
                          <button
                            onClick={() =>
                              setPm({
                                id: m.id,
                                name: m.name,
                                kind: m.kind,
                                isActive: m.isActive,
                                frozen: m.paymentCount > 0,
                              })
                            }
                            className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Note>
              Whether a method takes physical cash follows from its kind and is
              not a separate setting: cash does, nothing else does. That one
              column is what the drawer total and every blind count are worked
              out from, which is also why a method&rsquo;s kind is fixed once a
              payment has come in through it — moving it across the cash
              line afterwards would restate every shift already counted. A
              method cannot be deleted, because payments point at it; retiring
              one takes it off the cashier&rsquo;s list and leaves its history
              intact.
            </Note>
          </div>

          {pm && (
            <div className={card}>
              <h3 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
                {pm.id ? "Edit payment method" : "New payment method"}
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="pm-name" className={label}>Name</label>
                  <input
                    id="pm-name"
                    value={pm.name}
                    placeholder="Card (Worldpay)"
                    onChange={(e) => setPm({ ...pm, name: e.target.value })}
                    className={field}
                  />
                </div>
                <div>
                  <label htmlFor="pm-kind" className={label}>Kind</label>
                  <select
                    id="pm-kind"
                    value={pm.kind}
                    disabled={pm.frozen}
                    onChange={(e) =>
                      setPm({ ...pm, kind: e.target.value as PaymentMethodKind })
                    }
                    className={cn(field, pm.frozen && "bg-shell text-ink-muted")}
                  >
                    {PAYMENT_KINDS.filter(
                      (k) =>
                        k.value === pm.kind ||
                        !paymentMethods.some((m) => m.kind === k.value),
                    ).map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-ink-faint">
                    {pm.frozen
                      ? "Fixed \u2014 payments have already been taken by this method."
                      : pm.kind === "cash"
                        ? "Takes physical cash, so it counts towards the drawer."
                        : "Does not touch the drawer."}
                  </p>
                </div>
                <div>
                  <label htmlFor="pm-active" className={label}>Offered</label>
                  <select
                    id="pm-active"
                    value={pm.isActive ? "yes" : "no"}
                    onChange={(e) =>
                      setPm({ ...pm, isActive: e.target.value === "yes" })
                    }
                    className={field}
                  >
                    <option value="yes">On the cashier&rsquo;s list</option>
                    <option value="no">Retired</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() =>
                    run(
                      () =>
                        savePaymentMethod({
                          id: pm.id,
                          name: pm.name,
                          kind: pm.kind,
                          isActive: pm.isActive,
                        }).then((r) => {
                          if (r.ok) setPm(null);
                          return r;
                        }),
                      pm.id ? "Payment method saved." : "Payment method added.",
                    )
                  }
                  disabled={pending || pm.name.trim() === ""}
                  className={primary}
                >
                  {pending ? "Saving\u2026" : "Save the method"}
                </button>
                <button onClick={() => setPm(null)} className={secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Staff --------------------------------------------------------- */}
      {tab === "staff" && (
        <div className={card}>
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            Staff
          </h2>

          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-ink-faint">
                {["Name", "Role", "", ""].map((c, i) => (
                  <th
                    key={c || i}
                    className="whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {staff.map((s) => (
                <StaffRow
                  key={s.id}
                  staff={s}
                  isMe={s.id === meId}
                  canEdit={isAdmin}
                  pending={pending}
                  onSave={(next) =>
                    run(() => saveStaffUser(next), `${next.fullName} saved.`)
                  }
                />
              ))}
            </tbody>
          </table>

          <Note>
            Deactivating somebody withdraws their access everywhere at once —
            they resolve to no property and no role, so every table returns
            nothing and every role-gated action refuses. Reinstating them
            restores it.
          </Note>
          <Note>
            <strong className="font-medium text-ink">Adding a new login is not here.</strong>{" "}
            A member of staff needs a Supabase Auth account before a row can
            point at one, so creating one is an invite flow with its own
            decisions about who may send it. For now a new person signs up or is
            invited in Supabase, and then appears in this list.
          </Note>
        </div>
      )}
    </div>
  );
}

function StaffRow({
  staff,
  isMe,
  canEdit,
  pending,
  onSave,
}: {
  staff: StaffSetting;
  isMe: boolean;
  canEdit: boolean;
  pending: boolean;
  onSave: (next: {
    id: string;
    fullName: string;
    role: StaffRole;
    isActive: boolean;
  }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(staff.fullName);
  const [role, setRole] = useState<StaffRole>(staff.role);
  const [active, setActive] = useState(staff.isActive);

  if (!editing) {
    return (
      <tr className={cn(!staff.isActive && "opacity-55")}>
        <td className="px-3 py-2.5 font-medium text-ink">
          {staff.fullName}
          {isMe && <span className="ml-1.5 text-xxs font-normal text-ink-faint">you</span>}
        </td>
        <td className="px-3 py-2.5 text-ink-muted">
          {ROLES.find((r) => r.value === staff.role)?.label ?? staff.role}
        </td>
        <td className="px-3 py-2.5 text-xxs text-ink-faint">
          {staff.isActive ? "" : "no access"}
        </td>
        <td className="px-3 py-2.5 text-right">
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Edit
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="px-3 py-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
          aria-label="Name"
        />
      </td>
      <td className="px-3 py-2.5">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
          className={field}
          aria-label="Role"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <span className="mt-1 block text-xxs text-ink-faint">
          {ROLES.find((r) => r.value === role)?.note}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <label className="flex items-center gap-2 text-xxs text-ink-muted">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Has access
        </label>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <button
          onClick={() => setEditing(false)}
          className="mr-2 text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            onSave({ id: staff.id, fullName: name, role, isActive: active });
            setEditing(false);
          }}
          disabled={pending}
          className="font-medium text-brass underline-offset-2 hover:underline disabled:opacity-50"
        >
          Save
        </button>
      </td>
    </tr>
  );
}
