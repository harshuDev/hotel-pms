"use client";

import { useT } from "@/components/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { Dialog, EditIcon, HandleIcon } from "@/components/settings/finance-panels";
import { FacilityIcon } from "@/components/settings/facility-icon";
import { RoomPhoto } from "@/components/settings/room-photo";
import type { Facility } from "@/lib/facilities";
import type {
  RoomSetting,
  RoomSettingsPage,
  RoomTypeSetting,
  VirtualRoomType,
} from "@/lib/types";
import {
  createRooms,
  deleteRoom,
  deleteRoomType,
  deleteVirtualRoomType,
  saveKeyCodeSetting,
  saveRoom,
  saveRoomType,
  saveVirtualRoomType,
  setRoomEnabled,
  setRoomSetup,
  setRoomTypeDescription,
  setRoomTypeDisplayName,
  setRoomTypeFacilities,
  setRoomTypeOrder,
} from "@/lib/actions/settings";

/*
 * Settings -> Inventory -> Room Type and Room Setup (0091), cloned from the
 * client's reference. See the migration and CLAUDE.md for what each column
 * does: Display Name, the order, Available Online, Enabled, Color and Divider
 * are live; Virtual Room Types, Priority, Key Code, Common Door Name and the
 * key-code setting are stored.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell disabled:opacity-50";
const addLink =
  "inline-flex items-center gap-1 text-[13px] font-semibold text-brass hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const th = "px-2 py-2.5 text-left text-[12.5px] font-semibold text-ink";
const iconButton =
  "grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const label = "block text-[12px] text-ink-muted";
const field =
  "mt-1 w-full rounded-md border border-line px-3 py-2 text-[14px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const tick = "h-4 w-4 accent-brass";

function PageHeading({ title }: { title: string }) {
  return <h2 className="border-b border-line pb-1 text-[22px] text-ink">{title}</h2>;
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Check({ label: l }: { label: string }) {
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={l} className="mx-auto h-3.5 w-3.5">
      <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-ink" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-ink" aria-hidden="true">
      <circle cx="8" cy="4.5" r="3" />
      <path d="M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5z" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Room Type                                                                  */
/* -------------------------------------------------------------------------- */

type TypeDraft = {
  id: string | null;
  code: string;
  name: string;
  displayName: string;
  baseOccupancy: string;
  maxOccupancy: string;
  facilityIds: string[];
  description: string;
};

function draftOf(t: RoomTypeSetting): TypeDraft {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    displayName: t.displayName ?? "",
    baseOccupancy: String(t.baseOccupancy),
    maxOccupancy: String(t.maxOccupancy),
    facilityIds: t.facilityIds,
    description: t.description ?? "",
  };
}

export function RoomTypesPanel({
  roomTypes,
  virtualRoomTypes,
  facilities,
  editRoomTypeId,
  canEdit,
  pending,
  run,
}: {
  roomTypes: RoomTypeSetting[];
  virtualRoomTypes: VirtualRoomType[];
  facilities: Facility[];
  /** The calendar rail's pencil links here with a type to open. */
  editRoomTypeId: string | null;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  // The calendar's rail links here to rename a type, so arriving with that id
  // opens its form. An id that no longer exists opens nothing.
  const [draft, setDraft] = useState<TypeDraft | null>(() => {
    const t = roomTypes.find((x) => x.id === editRoomTypeId);
    return t ? draftOf(t) : null;
  });
  const [order, setOrder] = useState<string[]>(roomTypes.map((t) => t.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const [virtual, setVirtual] = useState<{ id: string | null; displayName: string; parent: string } | null>(null);

  const byId = new Map(roomTypes.map((t) => [t.id, t]));
  const rows = order.map((id) => byId.get(id)).filter((t): t is RoomTypeSetting => Boolean(t));

  function move(id: string, to: number) {
    const from = order.indexOf(id);
    if (from < 0 || to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    setOrder(next);
    run(() => setRoomTypeOrder(next), tr("Order saved."));
  }

  function save(d: TypeDraft) {
    run(async () => {
      const saved = await saveRoomType({
        id: d.id,
        code: d.code,
        name: d.name,
        baseOccupancy: Number(d.baseOccupancy) || 1,
        maxOccupancy: Number(d.maxOccupancy) || 1,
      });
      if (!saved.ok) return saved;
      // The room type first, so a new one has an id to hang the rest on.
      const named = await setRoomTypeDisplayName({ roomTypeId: saved.data.id, displayName: d.displayName });
      if (!named.ok) return named;
      const described = await setRoomTypeDescription({ roomTypeId: saved.data.id, description: d.description });
      if (!described.ok) return described;
      if (facilities.length > 0) {
        const ticked = await setRoomTypeFacilities({ roomTypeId: saved.data.id, facilityIds: d.facilityIds });
        if (!ticked.ok) return ticked;
      }
      setDraft(null);
      return { ok: true };
    }, tr("{name} saved.", { name: d.name.trim() || tr("Room type") }));
  }

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeading title={tr("Room Type")} />

      <section className={cn(card, "px-4 pb-5 pt-4 sm:px-7")}>
        <h3 className="border-b border-line pb-3 text-[17px] text-ink">{tr("Room types")}</h3>
        {rows.length === 0 ? (
          <p className="py-5 text-[13px] text-ink-muted">{tr("None yet. Add a room type before anything else.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={cn(th, "w-[40%]")}>{tr("Display Name")}</th>
                  <th className={cn(th, "w-[34%]")}>{tr("Room Type")}</th>
                  <th className={th}>{tr("Occupancy")}</th>
                  <th className="w-20" aria-label={tr("Actions")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr
                    key={t.id}
                    draggable={canEdit}
                    onDragStart={(e) => {
                      setDragging(t.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (dragging) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging) move(dragging, i);
                      setDragging(null);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      "border-b border-line",
                      dragging === t.id && "opacity-50",
                      draft?.id === t.id && "bg-shell/70",
                    )}
                  >
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        {canEdit && (
                          <button
                            type="button"
                            aria-label={tr("Move {name}. Use the arrow keys.", { name: t.name })}
                            className="cursor-grab rounded p-0.5 text-ink hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                            onKeyDown={(e) => {
                              if (e.key === "ArrowUp") {
                                e.preventDefault();
                                move(t.id, i - 1);
                              } else if (e.key === "ArrowDown") {
                                e.preventDefault();
                                move(t.id, i + 1);
                              }
                            }}
                          >
                            <HandleIcon />
                          </button>
                        )}
                        <span className="text-ink">{t.displayName ?? t.name}</span>
                        <span className="text-[10.5px] text-ink-faint">({t.code})</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-ink">{t.name}</td>
                    <td className="tnum px-2 py-1.5 text-ink">
                      <span className="inline-flex items-center gap-1" title={tr("Sleeps {baseOccupancy}, at most {maxOccupancy}", { baseOccupancy: t.baseOccupancy, maxOccupancy: t.maxOccupancy })}>
                        <PersonIcon />
                        {t.baseOccupancy}
                        {t.maxOccupancy > t.baseOccupancy && <span className="text-ink-muted">+ {t.maxOccupancy - t.baseOccupancy}</span>}
                      </span>
                    </td>
                    <td className="py-0.5">
                      {canEdit && (
                        <span className="flex justify-end">
                          <button type="button" aria-label={tr("Edit {name}", { name: t.name })} className={iconButton} onClick={() => setDraft(draftOf(t))}>
                            <EditIcon />
                          </button>
                          {/* A type with rooms in it is not offered for deletion;
                              Postgres refuses the other reasons by name. */}
                          {t.roomCount === 0 && (
                            <button
                              type="button"
                              aria-label={tr("Delete {name}", { name: t.name })}
                              className={iconButton}
                              onClick={() => {
                                if (!confirm(tr("Delete {name}? Its prices and restrictions go with it.", { name: t.name }))) return;
                                run(async () => {
                                  const result = await deleteRoomType(t.id);
                                  if (result.ok && draft?.id === t.id) setDraft(null);
                                  return result;
                                }, tr("{name} deleted.", { name: t.name }));
                              }}
                            >
                              <CrossIcon />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draft && (
          <form
            className="mt-4 rounded border border-line p-4"
            onSubmit={(e) => {
              e.preventDefault();
              save(draft);
            }}
          >
            <h4 className="border-b border-line pb-1 text-[16px] text-ink">
              {draft.id ? (draft.name ? tr("Edit {name}", { name: draft.name }) : tr("Edit room type")) : tr("Add Room Type")}
            </h4>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              <label className={label}>
                {tr("Code")}
                <input
                  value={draft.code}
                  placeholder={tr("DBL")}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                  className={cn(field, "uppercase")}
                />
              </label>
              <label className={cn(label, "sm:col-span-3")}>
                {tr("Room Type")}
                <input
                  value={draft.name}
                  placeholder={tr("Double")}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className={field}
                />
              </label>
              <label className={cn(label, "sm:col-span-2")}>
                {tr("Display Name")}
                <input
                  value={draft.displayName}
                  placeholder={draft.name || tr("As the room type")}
                  maxLength={120}
                  onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                  className={field}
                />
              </label>
              <label className={label}>
                {tr("Sleeps")}
                <input
                  inputMode="numeric"
                  value={draft.baseOccupancy}
                  onChange={(e) => setDraft({ ...draft, baseOccupancy: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </label>
              <label className={label}>
                {tr("Max")}
                <input
                  inputMode="numeric"
                  value={draft.maxOccupancy}
                  onChange={(e) => setDraft({ ...draft, maxOccupancy: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </label>
            </div>
            <label className={cn(label, "mt-4")}>
              {tr("Description")}
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className={field}
              />
            </label>
            {facilities.length > 0 && (
              <fieldset className="mt-4">
                <legend className={label}>{tr("Facilities")}</legend>
                <div className="mt-1 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {facilities.map((f) => (
                    <label key={f.id} className="flex items-center gap-2 text-[13px] text-ink">
                      <input
                        type="checkbox"
                        checked={draft.facilityIds.includes(f.id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            facilityIds: e.target.checked
                              ? [...draft.facilityIds, f.id]
                              : draft.facilityIds.filter((id) => id !== f.id),
                          })
                        }
                        className="h-3.5 w-3.5 accent-brass"
                      />
                      <FacilityIcon name={f.icon} className="h-[15px] w-[15px] text-ink-muted" />
                      {f.title}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className={secondary} onClick={() => setDraft(null)}>
                {tr("Cancel")}
              </button>
              <button type="submit" className={primary} disabled={pending}>
                {tr("Save")}
              </button>
            </div>
          </form>
        )}

        {canEdit && !draft && (
          <button
            type="button"
            className={cn(addLink, "mt-3")}
            onClick={() =>
              setDraft({
                id: null,
                code: "",
                name: "",
                displayName: "",
                baseOccupancy: "2",
                maxOccupancy: "2",
                facilityIds: [],
                description: "",
              })
            }
          >
            {tr("+ Add Room Type")}
          </button>
        )}
      </section>

      {/* Virtual Room Types -- stored, not yet sold. */}
      <section className={cn(card, "px-4 pb-5 pt-4 sm:px-7")}>
        <h3 className="border-b border-line pb-3 text-[17px] text-ink">{tr("Virtual Room Types")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <th className={cn(th, "w-[50%]")}>{tr("Display Name")}</th>
                <th className={th}>{tr("Parent Room Type")}</th>
                <th className="w-20" aria-label={tr("Actions")} />
              </tr>
            </thead>
            <tbody>
              {virtualRoomTypes.map((v) => (
                <tr key={v.id} className={cn("border-b border-line", virtual?.id === v.id && "bg-shell/70")}>
                  <td className="px-2 py-1.5 text-ink">{v.displayName}</td>
                  <td className="px-2 py-1.5 text-ink">{byId.get(v.parentRoomTypeId)?.name ?? ""}</td>
                  <td className="py-0.5">
                    {canEdit && (
                      <span className="flex justify-end">
                        <button
                          type="button"
                          aria-label={tr("Edit {name}", { name: v.displayName })}
                          className={iconButton}
                          onClick={() => setVirtual({ id: v.id, displayName: v.displayName, parent: v.parentRoomTypeId })}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          aria-label={tr("Delete {name}", { name: v.displayName })}
                          className={iconButton}
                          onClick={() => {
                            if (!confirm(tr("Delete {name}?", { name: v.displayName }))) return;
                            run(() => deleteVirtualRoomType(v.id), tr("{name} deleted.", { name: v.displayName }));
                          }}
                        >
                          <CrossIcon />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {virtual && (
          <form
            className="mt-4 rounded border border-line p-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const result = await saveVirtualRoomType({
                  id: virtual.id,
                  displayName: virtual.displayName,
                  parentRoomTypeId: virtual.parent,
                });
                if (result.ok) setVirtual(null);
                return result;
              }, tr("{name} saved.", { name: virtual.displayName.trim() || tr("Virtual room type") }));
            }}
          >
            <h4 className="border-b border-line pb-1 text-[16px] text-ink">
              {virtual.id ? tr("Edit Virtual Room Type") : tr("Add Virtual Room Type")}
            </h4>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className={label}>
                {tr("Display Name")}
                <input
                  autoFocus
                  value={virtual.displayName}
                  maxLength={120}
                  onChange={(e) => setVirtual({ ...virtual, displayName: e.target.value })}
                  className={field}
                />
              </label>
              <label className={label}>
                {tr("Parent Room Type")}
                <select
                  value={virtual.parent}
                  onChange={(e) => setVirtual({ ...virtual, parent: e.target.value })}
                  className={field}
                >
                  <option value="">{tr("Choose")}</option>
                  {rows.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className={secondary} onClick={() => setVirtual(null)}>
                {tr("Cancel")}
              </button>
              <button type="submit" className={primary} disabled={pending}>
                {tr("Save")}
              </button>
            </div>
          </form>
        )}

        {canEdit && !virtual && rows.length > 0 && (
          <button
            type="button"
            className={cn(addLink, "mt-3")}
            onClick={() => setVirtual({ id: null, displayName: "", parent: rows[0].id })}
          >
            {tr("+ Add Virtual Room Type")}
          </button>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Room Setup                                                                 */
/* -------------------------------------------------------------------------- */

type RoomDraft = {
  id: string | null;
  number: string;
  roomTypeId: string;
  floor: string;
  priority: string;
  availableOnline: boolean;
  isEnabled: boolean;
  keyCode: string;
  doorName: string;
  color: string | null;
  hasDivider: boolean;
  /** What Enabled was when the dialog opened, so only a change is sent. */
  wasEnabled: boolean;
};

function roomDraftOf(r: RoomSetting): RoomDraft {
  return {
    id: r.id,
    number: r.number,
    roomTypeId: r.roomTypeId,
    floor: r.floor === null ? "" : String(r.floor),
    priority: String(r.priority),
    availableOnline: r.availableOnline,
    isEnabled: r.isEnabled,
    keyCode: r.keyCode ?? "",
    doorName: r.doorName ?? "",
    color: r.color,
    hasDivider: r.hasDivider,
    wasEnabled: r.isEnabled,
  };
}

export function RoomSetupPanel({
  propertyId,
  propertyName,
  roomTypes,
  rooms,
  roomQuery,
  keyCodeFromBookingRoom,
  canEdit,
  pending,
  run,
}: {
  propertyId: string;
  propertyName: string;
  roomTypes: RoomTypeSetting[];
  rooms: RoomSettingsPage;
  roomQuery: string;
  keyCodeFromBookingRoom: boolean;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const router = useRouter();
  const [search, setSearch] = useState(roomQuery);
  const [draft, setDraft] = useState<RoomDraft | null>(null);
  const [runForm, setRunForm] = useState<{ roomTypeId: string; first: string; last: string; floor: string } | null>(null);
  const [keyCode, setKeyCode] = useState(keyCodeFromBookingRoom);

  function go(q: string, page: number) {
    const params = new URLSearchParams({ tab: "rooms" });
    if (q.trim() !== "") params.set("q", q.trim());
    if (page > 1) params.set("page", String(page));
    router.push(`/settings?${params.toString()}`);
  }

  function save(d: RoomDraft) {
    const floor = d.floor.trim() === "" ? null : Number(d.floor);
    const priority = Number(d.priority);
    run(async () => {
      const saved = await saveRoom({ id: d.id, number: d.number, roomTypeId: d.roomTypeId, floor });
      if (!saved.ok) return saved;
      const setup = await setRoomSetup({
        roomId: saved.data.id,
        priority: d.priority.trim() === "" ? Number.NaN : priority,
        availableOnline: d.availableOnline,
        keyCode: d.keyCode,
        doorName: d.doorName,
        color: d.color,
        hasDivider: d.hasDivider,
      });
      if (!setup.ok) return setup;
      if (d.isEnabled !== d.wasEnabled) {
        const enabled = await setRoomEnabled({ roomId: saved.data.id, enabled: d.isEnabled });
        if (!enabled.ok) return enabled;
      }
      setDraft(null);
      return { ok: true };
    }, tr("Room {number} saved.", { number: d.number.trim() }));
  }

  const current = draft?.id ? rooms.rows.find((r) => r.id === draft.id) ?? null : null;

  return (
    <div className="max-w-6xl space-y-2">
      <PageHeading title={tr("Room Setup")} />
      <section className={cn(card, "px-4 pb-6 pt-5 sm:px-7")}>
        {/* Paged and searched in Postgres: a property can hold ~1,800 rooms. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(search, 1);
          }}
          className="mb-3 flex flex-wrap items-center justify-end gap-2"
        >
          <label htmlFor="room-setup-q" className="sr-only">
            {tr("Search rooms")}
          </label>
          <input
            id="room-setup-q"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("Room number or type")}
            className="w-56 rounded-md border border-line px-3 py-1.5 text-[13px] text-ink outline-none focus:border-brass"
          />
          <button type="submit" className={cn(secondary, "px-3 py-1.5")}>
            {tr("Search")}
          </button>
          {roomQuery !== "" && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                go("", 1);
              }}
              className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {tr("Clear")}
            </button>
          )}
        </form>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] text-[12.5px]">
            <thead>
              <tr className="border-b border-line align-bottom">
                <th className={th}>{tr("Name / Number")}</th>
                <th className={th}>{tr("Room Type")}</th>
                <th className={th}>{tr("Property")}</th>
                <th className={cn(th, "text-center")}>{tr("Priority")}</th>
                <th className={cn(th, "text-center")}>{tr("Available Online")}</th>
                <th className={cn(th, "text-center")}>{tr("Enabled")}</th>
                <th className={cn(th, "text-center")}>{tr("Key Code")}</th>
                <th className={cn(th, "text-center")}>{tr("Common Door Name")}</th>
                <th className={cn(th, "text-center")}>{tr("Color")}</th>
                <th className={cn(th, "text-center")}>{tr("Divider")}</th>
                <th className="w-20" aria-label={tr("Actions")} />
              </tr>
            </thead>
            <tbody>
              {rooms.rows.map((r) => (
                <tr key={r.id} className={cn("border-b border-line", draft?.id === r.id && "bg-shell/70")}>
                  <td className="tnum px-2 py-2.5 font-medium text-ink">{r.number}</td>
                  <td className="px-2 py-2.5 text-ink">{r.roomTypeName}</td>
                  <td className="px-2 py-2.5 uppercase text-ink">{propertyName}</td>
                  <td className="tnum px-2 py-2.5 text-center text-ink">{r.priority}</td>
                  <td className="px-2 py-2.5">{r.availableOnline && <Check label={tr("Available online")} />}</td>
                  <td className="px-2 py-2.5">{r.isEnabled && <Check label={tr("Enabled")} />}</td>
                  <td className="px-2 py-2.5 text-center text-ink">{r.keyCode ?? ""}</td>
                  <td className="px-2 py-2.5 text-center text-ink">{r.doorName ?? ""}</td>
                  <td className="px-2 py-2.5">
                    {r.color && (
                      <span className="mx-auto block h-3.5 w-6 rounded-sm" style={{ backgroundColor: r.color }} title={r.color} />
                    )}
                  </td>
                  <td className="px-2 py-2.5">{r.hasDivider && <Check label={tr("Divider")} />}</td>
                  <td className="py-1">
                    {canEdit && (
                      <span className="flex justify-end">
                        <button type="button" aria-label={tr("Edit room {number}", { number: r.number })} className={iconButton} onClick={() => setDraft(roomDraftOf(r))}>
                          <EditIcon />
                        </button>
                        {/* Only a room nobody has been booked into can go;
                            delete_room() refuses the rest by name. */}
                        {!r.hasBookings && (
                          <button
                            type="button"
                            aria-label={tr("Delete room {number}", { number: r.number })}
                            className={iconButton}
                            onClick={() => {
                              if (!confirm(tr("Delete room {number}? This cannot be undone.", { number: r.number }))) return;
                              run(() => deleteRoom(r.id), tr("Room {number} deleted.", { number: r.number }));
                            }}
                          >
                            <CrossIcon />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rooms.rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-2 py-5 text-[13px] text-ink-muted">
                    {roomQuery !== ""
                      ? tr("No room matches “{roomQuery}”.", { roomQuery: roomQuery })
                      : roomTypes.length === 0
                        ? tr("Add a room type first. Every room belongs to one.")
                        : tr("None yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {rooms.total > rooms.perPage && (
          <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
            <button
              type="button"
              onClick={() => go(roomQuery, rooms.page - 1)}
              disabled={rooms.page <= 1}
              className={cn(secondary, "px-3 py-1.5 disabled:opacity-40")}
            >
              {tr("Previous")}
            </button>
            <span className="tnum text-ink-faint">
              {tr("{from}–{to} of {total}", {
                from: (rooms.page - 1) * rooms.perPage + 1,
                to: Math.min(rooms.page * rooms.perPage, rooms.total),
                total: rooms.total,
              })}
            </span>
            <button
              type="button"
              onClick={() => go(roomQuery, rooms.page + 1)}
              disabled={rooms.page * rooms.perPage >= rooms.total}
              className={cn(secondary, "px-3 py-1.5 disabled:opacity-40")}
            >
              {tr("Next")}
            </button>
          </div>
        )}

        {canEdit && roomTypes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <button
              type="button"
              className={addLink}
              onClick={() =>
                setDraft({
                  id: null,
                  number: "",
                  roomTypeId: roomTypes[0].id,
                  floor: "",
                  priority: "1",
                  availableOnline: true,
                  isEnabled: true,
                  keyCode: "",
                  doorName: "",
                  color: null,
                  hasDivider: false,
                  wasEnabled: true,
                })
              }
            >
              {tr("+ Add Room")}
            </button>
            {/* Rooms in a run: a property can hold ~1,800 of them. */}
            <button
              type="button"
              className={addLink}
              onClick={() => setRunForm({ roomTypeId: roomTypes[0].id, first: "", last: "", floor: "" })}
            >
              {tr("+ Add Rooms in a Run")}
            </button>
          </div>
        )}

        {runForm && (
          <form
            className="mt-4 rounded border border-line p-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const result = await createRooms({
                  roomTypeId: runForm.roomTypeId,
                  first: Number(runForm.first),
                  last: Number(runForm.last),
                  floor: runForm.floor.trim() === "" ? null : Number(runForm.floor),
                  prefix: "",
                });
                if (result.ok) setRunForm(null);
                return result;
              }, tr("Rooms added."));
            }}
          >
            <h4 className="border-b border-line pb-1 text-[16px] text-ink">{tr("Add Rooms in a Run")}</h4>
            <div className="mt-4 grid gap-4 sm:grid-cols-5">
              <label className={cn(label, "sm:col-span-2")}>
                {tr("Room Type")}
                <select
                  value={runForm.roomTypeId}
                  onChange={(e) => setRunForm({ ...runForm, roomTypeId: e.target.value })}
                  className={field}
                >
                  {roomTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {tr("From")}
                <input inputMode="numeric" placeholder="101" value={runForm.first}
                  onChange={(e) => setRunForm({ ...runForm, first: e.target.value })} className={cn(field, "tnum")} />
              </label>
              <label className={label}>
                {tr("To")}
                <input inputMode="numeric" placeholder="120" value={runForm.last}
                  onChange={(e) => setRunForm({ ...runForm, last: e.target.value })} className={cn(field, "tnum")} />
              </label>
              <label className={label}>
                {tr("Floor")}
                <input inputMode="numeric" placeholder="1" value={runForm.floor}
                  onChange={(e) => setRunForm({ ...runForm, floor: e.target.value })} className={cn(field, "tnum")} />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className={secondary} onClick={() => setRunForm(null)}>
                {tr("Cancel")}
              </button>
              <button type="submit" className={primary} disabled={pending}>
                {tr("Add the run")}
              </button>
            </div>
          </form>
        )}

        <label className="mt-6 flex w-fit items-center gap-2.5 text-[14px] text-ink">
          <input
            type="checkbox"
            checked={keyCode}
            disabled={!canEdit}
            onChange={(e) => {
              const on = e.target.checked;
              setKeyCode(on);
              run(async () => {
                const result = await saveKeyCodeSetting(on);
                if (!result.ok) setKeyCode(!on);
                return result;
              }, on ? tr("Booking room id is the key code.") : tr("Key codes are set per room."));
            }}
            className="h-[18px] w-[18px] accent-brass"
          />
          {tr("Use Booking Room id as Key Code")}
        </label>
      </section>

      {draft && (
        <Dialog
          title={draft.id ? tr("Room {number}", { number: current?.number ?? draft.number }) : tr("Add Room")}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button type="button" className={secondary} onClick={() => setDraft(null)}>
                {tr("Cancel")}
              </button>
              <button type="button" className={primary} disabled={pending} onClick={() => save(draft)}>
                {tr("Save")}
              </button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              {tr("Name / Number")}
              <input
                autoFocus
                value={draft.number}
                onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                className={cn(field, "tnum")}
              />
            </label>
            <label className={label}>
              {tr("Room Type")}
              <select
                value={draft.roomTypeId}
                onChange={(e) => setDraft({ ...draft, roomTypeId: e.target.value })}
                className={field}
              >
                {roomTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              {tr("Floor")}
              <input
                inputMode="numeric"
                value={draft.floor}
                onChange={(e) => setDraft({ ...draft, floor: e.target.value })}
                className={cn(field, "tnum")}
              />
            </label>
            <label className={label}>
              {tr("Priority")}
              <input
                inputMode="numeric"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                className={cn(field, "tnum")}
              />
            </label>
            <label className={label}>
              {tr("Key Code")}
              <input
                value={draft.keyCode}
                maxLength={60}
                onChange={(e) => setDraft({ ...draft, keyCode: e.target.value })}
                className={field}
              />
            </label>
            <label className={label}>
              {tr("Common Door Name")}
              <input
                value={draft.doorName}
                maxLength={60}
                onChange={(e) => setDraft({ ...draft, doorName: e.target.value })}
                className={field}
              />
            </label>
            <div>
              <span className={label}>{tr("Color")}</span>
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  aria-label={tr("Color")}
                  value={draft.color ?? "#7fa7dc"}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                  className="h-9 w-14 cursor-pointer rounded border border-line bg-white p-0.5"
                />
                {draft.color ? (
                  <button
                    type="button"
                    className="text-[12.5px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                    onClick={() => setDraft({ ...draft, color: null })}
                  >
                    {tr("No colour")}
                  </button>
                ) : (
                  <span className="text-[12.5px] text-ink-faint">{tr("None")}</span>
                )}
              </span>
            </div>
            <div className="flex flex-col justify-end gap-2 text-[14px] text-ink">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.availableOnline} className={tick}
                  onChange={(e) => setDraft({ ...draft, availableOnline: e.target.checked })} />
                {tr("Available Online")}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.isEnabled} className={tick}
                  onChange={(e) => setDraft({ ...draft, isEnabled: e.target.checked })} />
                {tr("Enabled")}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.hasDivider} className={tick}
                  onChange={(e) => setDraft({ ...draft, hasDivider: e.target.checked })} />
                {tr("Divider")}
              </label>
            </div>
          </div>
          {!draft.isEnabled && draft.wasEnabled && (
            <p className="text-[12.5px] text-warn-deep">{tr("A disabled room is out of order and cannot be sold.")}</p>
          )}
          {current && (
            <div className="border-t border-line pt-4">
              <span className={label}>{tr("Picture")}</span>
              <RoomPhoto
                propertyId={propertyId}
                roomId={current.id}
                roomNumber={current.number}
                photoUrl={current.photoUrl}
                photoPath={current.photoPath}
              />
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
