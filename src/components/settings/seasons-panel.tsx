"use client";

import { useT } from "@/components/i18n";
import { useMemo, useState } from "react";
import { addDays, format, getDay, getDaysInMonth, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { Dialog } from "@/components/settings/finance-panels";
import { inkOn } from "@/lib/calendar-settings";
import type { SeasonType } from "@/lib/types";
import {
  addSeasonRange,
  deleteSeason,
  deleteSeasonType,
  saveSeasonType,
} from "@/lib/actions/settings";

/*
 * Settings -> Inventory -> Seasons and Events (0095), cloned from the
 * client's reference: a year of month grids, each day in its season's colour
 * (the Default Season's grey where none covers it) with an event underlined in
 * its own, "Add season or event", and down the right the Seasons, the Default
 * Season and the Events, each with its ranges.
 *
 * A season changes no price. Seasons never overlap one another -- Postgres
 * refuses by name -- and events may overlap anything. The Default Season is
 * not stored: it is every day no season covers, worked out here for the
 * list, from the first season year to the last.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const DEFAULT_GREY = "#a3a8ae";
const MONTHS = Array.from({ length: 12 }, (_, i) => i);

const primary =
  "rounded-md bg-chrome-800 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-ink hover:bg-shell";
const label = "block text-[12px] text-ink-muted";
const field =
  "mt-1 w-full rounded-md border border-line px-3 py-2 text-[14px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const icon =
  "grid h-6 w-6 place-items-center rounded text-ink hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function day(d: string): string {
  return tr.date(d, "dd MMM yyyy");
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3H3v10h10V7" />
      <path d="M11.5 2l2.5 2.5L8.5 10H6V7.5z" />
    </svg>
  );
}

function BinIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-rose-700" aria-hidden="true">
      <path d="M6 1.5h4l.5 1H14v1.5H2V2.5h3.5zM3.5 5h9l-.7 9.5H4.2z" />
    </svg>
  );
}

type AddDraft = { kind: "season" | "event"; name: string; color: string; from: string; to: string };
type RangeDraft = { typeId: string; name: string; from: string; to: string };
type EditDraft = { id: string; kind: "season" | "event"; name: string; color: string };

export function SeasonsPanel({
  types,
  businessDate,
  canEdit,
  pending,
  run,
}: {
  types: SeasonType[];
  businessDate: string;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [year, setYear] = useState(Number(businessDate.slice(0, 4)));
  const [add, setAdd] = useState<AddDraft | null>(null);
  const [range, setRange] = useState<RangeDraft | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);

  const seasons = types.filter((t) => t.kind === "season");
  const events = types.filter((t) => t.kind === "event");

  /* One pass per day of the shown year: which season, which event. */
  const byDay = useMemo(() => {
    const season = new Map<string, SeasonType>();
    const event = new Map<string, SeasonType>();
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    for (const t of types) {
      for (const r of t.ranges) {
        if (r.endsOn < start || r.startsOn > end) continue;
        let d = parseISO(r.startsOn < start ? start : r.startsOn);
        const last = r.endsOn > end ? end : r.endsOn;
        for (let key = format(d, "yyyy-MM-dd"); key <= last; d = addDays(d, 1), key = format(d, "yyyy-MM-dd")) {
          (t.kind === "season" ? season : event).set(key, t);
        }
      }
    }
    return { season, event };
  }, [types, year]);

  /* The Default Season: the gaps between season ranges, first year to last. */
  const defaultRanges = useMemo(() => {
    const all = seasons.flatMap((t) => t.ranges).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    const firstYear = Math.min(year, ...all.map((r) => Number(r.startsOn.slice(0, 4))));
    const lastYear = Math.max(year, ...all.map((r) => Number(r.endsOn.slice(0, 4))));
    const out: { from: string; to: string }[] = [];
    let cursor = `${firstYear}-01-01`;
    for (const r of all) {
      if (r.startsOn > cursor) {
        out.push({ from: cursor, to: format(addDays(parseISO(r.startsOn), -1), "yyyy-MM-dd") });
      }
      const next = format(addDays(parseISO(r.endsOn), 1), "yyyy-MM-dd");
      if (next > cursor) cursor = next;
    }
    if (cursor <= `${lastYear}-12-31`) out.push({ from: cursor, to: `${lastYear}-12-31` });
    return out;
  }, [seasons, year]);

  function saveAdd(d: AddDraft) {
    run(async () => {
      const made = await saveSeasonType({ id: null, kind: d.kind, name: d.name, color: d.color });
      if (!made.ok) return made;
      const ranged = await addSeasonRange({ seasonTypeId: made.data.id, startsOn: d.from, endsOn: d.to });
      if (!ranged.ok) {
        // No dates, no season: take back the name rather than leave an empty one.
        await deleteSeasonType(made.data.id);
        return ranged;
      }
      setAdd(null);
      return { ok: true };
    }, `${d.name.trim() || (d.kind === "event" ? "Event" : "Season")} added.`);
  }

  function list(title: string, items: SeasonType[]) {
    return (
      <div className="mt-4">
        <h3 className="text-[17px] text-ink">{title}</h3>
        {items.length === 0 && <p className="mt-1 text-[12px] text-ink-muted">{tr("None yet.")}</p>}
        {items.map((t) => (
          <div key={t.id} className="mt-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: t.color }} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase text-ink">{t.name}</span>
              {canEdit && (
                <span className="flex shrink-0">
                  <button type="button" aria-label={tr("Add dates to {name}", { name: t.name })} className={icon}
                    onClick={() => setRange({ typeId: t.id, name: t.name, from: "", to: "" })}>
                    <PlusIcon />
                  </button>
                  <button type="button" aria-label={tr("Edit {name}", { name: t.name })} className={icon}
                    onClick={() => setEdit({ id: t.id, kind: t.kind, name: t.name, color: t.color })}>
                    <PencilIcon />
                  </button>
                  <button type="button" aria-label={tr("Delete {name}", { name: t.name })} className={icon}
                    onClick={() => {
                      if (!confirm(tr("Delete {name} and all its dates?", { name: t.name }))) return;
                      run(() => deleteSeasonType(t.id), tr("{name} deleted.", { name: t.name }));
                    }}>
                    <BinIcon />
                  </button>
                </span>
              )}
            </div>
            {t.ranges.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <span className="tnum text-[11.5px] text-ink">
                  {day(r.startsOn)} - {day(r.endsOn)}
                </span>
                {canEdit && (
                  <button type="button" aria-label={tr("Delete {name} {date} to {date2}", { name: t.name, date: day(r.startsOn), date2: day(r.endsOn) })}
                    className={icon}
                    onClick={() => {
                      if (!confirm(tr("Delete {name}, {date} - {date2}?", { name: t.name, date: day(r.startsOn), date2: day(r.endsOn) }))) return;
                      run(() => deleteSeason(r.id), tr("Dates deleted."));
                    }}>
                    <BinIcon />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-2">
      <h2 className="border-b border-line pb-1 text-[22px] text-ink">{tr("Seasons And Events")}</h2>
      <section className="grid gap-6 rounded border border-line bg-white p-4 shadow-card sm:p-7 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          <div className="flex items-center justify-between">
            <button type="button" aria-label={tr("Previous year")} onClick={() => setYear(year - 1)}
              className="rounded px-2 py-1 text-[18px] text-ink hover:bg-shell">‹</button>
            <span className="tnum text-[13px] text-ink">{year}</span>
            <button type="button" aria-label={tr("Next year")} onClick={() => setYear(year + 1)}
              className="rounded px-2 py-1 text-[18px] text-ink hover:bg-shell">›</button>
          </div>
          <div className="mt-3 grid gap-x-5 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
            {MONTHS.map((m) => {
              const lead = (getDay(new Date(year, m, 1)) + 6) % 7; // Monday first
              const days = getDaysInMonth(new Date(year, m, 1));
              return (
                <div key={m}>
                  <p className="mb-1 text-center text-[12.5px] text-ink">{tr.date(new Date(year, m, 1), "MMMM")}</p>
                  <div className="grid grid-cols-7 text-center">
                    {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
                    {Array.from({ length: days }, (_, i) => {
                      const key = iso(year, m, i + 1);
                      const s = byDay.season.get(key);
                      const e = byDay.event.get(key);
                      const bg = s?.color ?? DEFAULT_GREY;
                      return (
                        <span
                          key={key}
                          title={[s?.name ?? "Default Season", e?.name].filter(Boolean).join(" · ")}
                          className="tnum py-[3px] text-[11px]"
                          style={{
                            backgroundColor: bg,
                            color: inkOn(bg),
                            boxShadow: e ? `inset 0 -3px 0 ${e.color}` : undefined,
                          }}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="min-w-0">
          {canEdit && (
            <button type="button" className={primary}
              onClick={() => setAdd({ kind: "season", name: "", color: "#6b7f99", from: businessDate, to: businessDate })}>
              {tr("Add season or event")}
            </button>
          )}
          {list("Seasons", seasons)}
          <div className="mt-4">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: DEFAULT_GREY }} />
              <span className="text-[12px] font-bold text-ink">{tr("Default Season")}</span>
            </div>
            {defaultRanges.map((r) => (
              <p key={r.from} className="tnum text-[11.5px] text-ink">
                {day(r.from)} - {day(r.to)}
              </p>
            ))}
          </div>
          {list("Events", events)}
        </aside>
      </section>

      {add && (
        <Dialog
          title={tr("Add season or event")}
          onClose={() => setAdd(null)}
          footer={
            <>
              <button type="button" className={secondary} onClick={() => setAdd(null)}>{tr("Cancel")}</button>
              <button type="button" className={primary} disabled={pending} onClick={() => saveAdd(add)}>{tr("Save")}</button>
            </>
          }
        >
          <div role="radiogroup" aria-label={tr("Season or event")} className="flex">
            {(["season", "event"] as const).map((k, i) => (
              <button key={k} type="button" role="radio" aria-checked={add.kind === k}
                onClick={() => setAdd({ ...add, kind: k })}
                className={cn(
                  "border px-4 py-1.5 text-[12.5px]",
                  i === 0 ? "rounded-l-md" : "-ml-px rounded-r-md",
                  add.kind === k ? "relative z-10 border-chrome-800 bg-chrome-800 font-semibold text-white" : "border-line bg-white text-ink hover:bg-shell",
                )}>
                {k === "season" ? tr("Season") : tr("Event")}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <label className={label}>
              {tr("Name")}
              <input autoFocus value={add.name} maxLength={80} className={field}
                onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            </label>
            <label className={label}>
              {tr("Colour")}
              <input type="color" value={add.color} className="mt-1 block h-[38px] w-16 cursor-pointer rounded border border-line bg-white p-0.5"
                onChange={(e) => setAdd({ ...add, color: e.target.value })} />
            </label>
            <label className={label}>
              {tr("From")}
              <input type="date" value={add.from} className={cn(field, "tnum")}
                onChange={(e) => setAdd({ ...add, from: e.target.value, to: add.to < e.target.value ? e.target.value : add.to })} />
            </label>
            <label className={label}>
              {tr("To")}
              <input type="date" value={add.to} min={add.from} className={cn(field, "tnum")}
                onChange={(e) => setAdd({ ...add, to: e.target.value })} />
            </label>
          </div>
        </Dialog>
      )}

      {range && (
        <Dialog
          title={tr("Add dates to {name}", { name: range.name })}
          onClose={() => setRange(null)}
          footer={
            <>
              <button type="button" className={secondary} onClick={() => setRange(null)}>{tr("Cancel")}</button>
              <button type="button" className={primary} disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await addSeasonRange({ seasonTypeId: range.typeId, startsOn: range.from, endsOn: range.to });
                    if (result.ok) setRange(null);
                    return result;
                  }, tr("{name} dates added.", { name: range.name }))
                }>
                {tr("Save")}
              </button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              {tr("From")}
              <input type="date" autoFocus value={range.from} className={cn(field, "tnum")}
                onChange={(e) => setRange({ ...range, from: e.target.value, to: range.to < e.target.value ? e.target.value : range.to })} />
            </label>
            <label className={label}>
              {tr("To")}
              <input type="date" value={range.to} min={range.from} className={cn(field, "tnum")}
                onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </label>
          </div>
        </Dialog>
      )}

      {edit && (
        <Dialog
          title={`Edit ${edit.kind === "event" ? "event" : "season"}`}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button type="button" className={secondary} onClick={() => setEdit(null)}>{tr("Cancel")}</button>
              <button type="button" className={primary} disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await saveSeasonType({ id: edit.id, kind: edit.kind, name: edit.name, color: edit.color });
                    if (result.ok) setEdit(null);
                    return result;
                  }, tr("{name} saved.", { name: edit.name.trim() || tr("Season") }))
                }>
                {tr("Save")}
              </button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <label className={label}>
              {tr("Name")}
              <input autoFocus value={edit.name} maxLength={80} className={field}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <label className={label}>
              {tr("Colour")}
              <input type="color" value={edit.color} className="mt-1 block h-[38px] w-16 cursor-pointer rounded border border-line bg-white p-0.5"
                onChange={(e) => setEdit({ ...edit, color: e.target.value })} />
            </label>
          </div>
        </Dialog>
      )}
    </div>
  );
}
