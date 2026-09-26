"use client";

import { useState } from "react";
import { cn } from "@/components/ui";
import { EditIcon } from "@/components/settings/finance-panels";
import { COUNTRIES } from "@/lib/countries";
import {
  BOOKING_STATUS_CHOICES,
  CONDITION_FIELDS,
  CONDITION_OPS,
  REACTION_EVENTS,
  REACTION_TASKS,
  SETTLEMENT_CHOICES,
  isGroup,
  reactionEventLabel,
  type Reaction,
  type ReactionCondition,
  type ReactionGroup,
} from "@/lib/reactions";
import { deleteReaction, saveReaction } from "@/lib/actions/settings";

/*
 * Settings -> Other -> Reactions (0104), cloned from the client's reference:
 * the list with copy, edit and delete, the Triggers | Tasks switch, "ADD
 * REACTION", and the form -- Task, Title, Description, Conditions (All / Any,
 * Add Condition, Add Group), Triggers ("Create new trigger") and Enabled.
 * STORED, NOT YET RUN: nothing fires a reaction.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;
type Option = { id: string; label: string };

// Every row in the builder carries a key that exists only on screen, so
// React keeps a half-typed row in place when one above it is removed.
type DraftCondition = ReactionCondition & { key: number };
type DraftGroup = { key: number; match: "all" | "any"; items: (DraftCondition | DraftGroup)[] };
type Draft = {
  id: string | null;
  task: string;
  title: string;
  description: string;
  conditions: DraftGroup;
  events: { key: number; event: string }[];
  isEnabled: boolean;
};

let nextKey = 1;
const key = () => nextKey++;

const emptyCondition = (): DraftCondition => ({ key: key(), field: "", op: "eq", value: "" });

function toDraftGroup(g: ReactionGroup): DraftGroup {
  return {
    key: key(),
    match: g.match,
    items: g.items.map((it) => (isGroup(it) ? toDraftGroup(it) : { ...it, key: key() })),
  };
}

/** Drops rows nobody chose a field for, and groups left empty by that. */
function toStored(g: DraftGroup): ReactionGroup {
  return {
    match: g.match,
    items: g.items.flatMap((it): ReactionGroup["items"] => {
      if ("match" in it) {
        const inner = toStored(it);
        return inner.items.length > 0 ? [inner] : [];
      }
      return it.field ? [{ field: it.field, op: it.op, value: it.value.trim() }] : [];
    }),
  };
}

function newDraft(): Draft {
  return {
    id: null,
    task: "",
    title: "",
    description: "",
    conditions: { key: key(), match: "all", items: [emptyCondition()] },
    events: [],
    isEnabled: true,
  };
}

function fromReaction(r: Reaction, copy = false): Draft {
  const conditions = toDraftGroup(r.conditions);
  if (conditions.items.length === 0) conditions.items.push(emptyCondition());
  return {
    id: copy ? null : r.id,
    task: r.task,
    title: copy ? `${r.title} (copy)` : r.title,
    description: r.description ?? "",
    conditions,
    events: r.events.map((event) => ({ key: key(), event })),
    isEnabled: r.isEnabled,
  };
}

const card = "rounded-lg border border-line bg-white shadow-card";
const field =
  "w-full rounded border border-line bg-white px-2 py-1.5 text-[13px] text-ink outline-none focus:border-brass";
const small =
  "rounded border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-shell";
const iconBtn = "grid h-7 w-7 place-items-center rounded text-brass hover:bg-shell";

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M8 3h9a2 2 0 0 1 2 2v11h-2V5H8V3Zm-3 4h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function CrossIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function TickIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4 text-ink" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <path d="M8 12.5l2.7 2.7L16 10" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="pt-1.5 text-[13px] text-ink-muted">
      {children}
    </label>
  );
}

function ConditionRow({
  c,
  onChange,
  onRemove,
  lists,
}: {
  c: DraftCondition;
  onChange: (c: DraftCondition) => void;
  onRemove: () => void;
  lists: Record<"channel" | "room_type" | "rate_plan", Option[]>;
}) {
  const spec = CONDITION_FIELDS.find((f) => f.id === c.field);
  const numeric = spec?.kind === "number";
  const ops = CONDITION_OPS.filter((o) => !o.numeric || numeric);
  const choices: Option[] | null =
    spec?.kind === "status" ? [...BOOKING_STATUS_CHOICES]
    : spec?.kind === "settlement" ? [...SETTLEMENT_CHOICES]
    : spec?.kind === "country" ? COUNTRIES.map((k) => ({ id: k.code, label: k.name }))
    : spec?.kind === "channel" || spec?.kind === "room_type" || spec?.kind === "rate_plan" ? lists[spec.kind]
    : null;

  return (
    <div className="grid grid-cols-[1fr_1.75rem] items-center gap-2 sm:grid-cols-[2fr_1fr_2fr_1.75rem] sm:gap-4">
      <select
        aria-label="Condition"
        value={c.field}
        className={cn(field, "col-span-2 sm:col-span-1")}
        onChange={(e) => {
          const next = CONDITION_FIELDS.find((f) => f.id === e.target.value);
          // A field change keeps the comparison only where it still applies.
          const op = next?.kind !== "number" && (c.op === "gt" || c.op === "lt") ? "eq" : c.op;
          onChange({ ...c, field: e.target.value, op, value: "" });
        }}
      >
        <option value="" />
        {CONDITION_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      <select aria-label="Comparison" value={c.op} className={cn(field, "col-span-2 sm:col-span-1")}
        onChange={(e) => onChange({ ...c, op: e.target.value })}>
        {ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {choices ? (
        <select aria-label="Value" value={c.value} className={field}
          onChange={(e) => onChange({ ...c, value: e.target.value })}>
          <option value="" />
          {choices.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : (
        <input aria-label="Value" value={c.value} className={field}
          inputMode={numeric ? "numeric" : undefined} maxLength={numeric ? 4 : 200}
          onChange={(e) => onChange({ ...c, value: e.target.value })} />
      )}
      <button type="button" aria-label="Remove condition" className="grid h-7 w-7 place-items-center rounded text-brass hover:bg-shell"
        onClick={onRemove}>
        <CrossIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  depth,
  onChange,
  onRemove,
  lists,
}: {
  group: DraftGroup;
  depth: number;
  onChange: (g: DraftGroup) => void;
  onRemove?: () => void;
  lists: Record<"channel" | "room_type" | "rate_plan", Option[]>;
}) {
  function setItem(i: number, item: DraftCondition | DraftGroup) {
    onChange({ ...group, items: group.items.map((x, j) => (j === i ? item : x)) });
  }
  function removeItem(i: number) {
    onChange({ ...group, items: group.items.filter((_, j) => j !== i) });
  }
  const seg = (on: boolean) =>
    cn("px-2 py-1 text-[11.5px] font-semibold", on ? "bg-shell text-ink shadow-inner" : "bg-white text-ink hover:bg-shell");

  return (
    <div className={cn("space-y-3 rounded border border-line p-3", depth > 1 && "bg-shell/40")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex divide-x divide-line overflow-hidden rounded border border-line" role="group" aria-label="Match">
          <button type="button" aria-pressed={group.match === "all"} className={seg(group.match === "all")}
            onClick={() => onChange({ ...group, match: "all" })}>
            All Conditions Match
          </button>
          <button type="button" aria-pressed={group.match === "any"} className={seg(group.match === "any")}
            onClick={() => onChange({ ...group, match: "any" })}>
            Any Conditions Matches
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={small}
            onClick={() => onChange({ ...group, items: [...group.items, emptyCondition()] })}>
            Add Condition
          </button>
          {depth < 3 && (
            <button type="button" className={small}
              onClick={() => onChange({ ...group, items: [...group.items, { key: key(), match: "all", items: [emptyCondition()] }] })}>
              Add Group
            </button>
          )}
          {onRemove && (
            <button type="button" aria-label="Remove group" className={iconBtn} onClick={onRemove}>
              <CrossIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {group.items.map((it, i) =>
        "match" in it ? (
          <GroupEditor key={it.key} group={it} depth={depth + 1} lists={lists}
            onChange={(g) => setItem(i, g)} onRemove={() => removeItem(i)} />
        ) : (
          <ConditionRow key={it.key} c={it} lists={lists}
            onChange={(c) => setItem(i, c)} onRemove={() => removeItem(i)} />
        ),
      )}
    </div>
  );
}

export function ReactionsPanel({
  reactions,
  channels,
  roomTypes,
  ratePlans,
  canEdit,
  pending,
  run,
}: {
  reactions: Reaction[];
  channels: Option[];
  roomTypes: Option[];
  ratePlans: Option[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [view, setView] = useState<"tasks" | "triggers">("tasks");
  const [draft, setDraft] = useState<Draft | null>(null);
  const lists = { channel: channels, room_type: roomTypes, rate_plan: ratePlans };

  function set(patch: Partial<Draft>) {
    if (draft) setDraft({ ...draft, ...patch });
  }

  function save(d: Draft) {
    run(async () => {
      const result = await saveReaction({
        id: d.id,
        task: d.task,
        title: d.title,
        description: d.description,
        conditions: toStored(d.conditions),
        events: d.events.map((e) => e.event).filter(Boolean),
        isEnabled: d.isEnabled,
      });
      if (result.ok) setDraft(null);
      return result;
    }, `${d.title.trim() || "Reaction"} saved.`);
  }

  const form = draft && (
    <form
      className="border-t border-line bg-white px-4 py-5 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        save(draft);
      }}
    >
      <div className="space-y-3">
        <div className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <Label htmlFor="reaction-task">Task:</Label>
          <select
            id="reaction-task"
            value={draft.task}
            className={field}
            onChange={(e) => {
              const task = REACTION_TASKS.find((t) => t.id === e.target.value);
              // A new reaction takes the task's own wording until somebody writes theirs.
              set({
                task: e.target.value,
                title: draft.title || task?.label || "",
                description: draft.description || task?.description || "",
              });
            }}
          >
            <option value="" />
            {REACTION_TASKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <Label htmlFor="reaction-title">Title</Label>
          <input id="reaction-title" value={draft.title} maxLength={120} className={field}
            onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <Label htmlFor="reaction-description">Description</Label>
          <input id="reaction-description" value={draft.description} maxLength={500} className={field}
            onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div>
          <Label>Conditions:</Label>
          <div className="mt-3">
            <GroupEditor group={draft.conditions} depth={1} lists={lists}
              onChange={(conditions) => set({ conditions })} />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[14px] text-ink">Triggers</h4>
            {draft.events.length < REACTION_EVENTS.length && (
              <button type="button" className={cn(small, "uppercase tracking-wide text-ink-muted")}
                onClick={() => set({ events: [...draft.events, { key: key(), event: "" }] })}>
                Create new trigger
              </button>
            )}
          </div>
          {draft.events.map((ev, i) => {
            const taken = new Set(draft.events.filter((_, j) => j !== i).map((x) => x.event));
            return (
              <div key={ev.key} className="grid grid-cols-[1fr_1.75rem] items-center gap-2 sm:grid-cols-[2fr_3fr_1.75rem] sm:gap-4">
                <select aria-label="Event" value={ev.event} className={field}
                  onChange={(e) => set({ events: draft.events.map((x, j) => (j === i ? { ...x, event: e.target.value } : x)) })}>
                  <option value="" />
                  {REACTION_EVENTS.filter((o) => !taken.has(o.id)).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <span className="hidden sm:block" />
                <button type="button" aria-label="Remove trigger" className={iconBtn}
                  onClick={() => set({ events: draft.events.filter((_, j) => j !== i) })}>
                  <CrossIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="-mx-4 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-shell/60 px-4 pt-4 sm:-mx-6 sm:px-6">
        <label className="flex items-center gap-2 text-[13px] text-ink-muted">
          <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.isEnabled}
            onChange={(e) => set({ isEnabled: e.target.checked })} />
          Enabled
        </label>
        <div className="flex gap-3">
          <button type="button" onClick={() => setDraft(null)}
            className="rounded-md border border-line bg-white px-5 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell">
            Cancel
          </button>
          <button type="submit" disabled={pending}
            className="rounded-md bg-chrome-800 px-6 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50">
            Save
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <div className="max-w-6xl space-y-4">
      <section className={cn(card, "overflow-hidden")}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-6">
          <h2 className="text-[18px] text-ink">Reactions</h2>
          <div className="flex items-center gap-2 text-[15px]">
            <button type="button" aria-pressed={view === "triggers"} onClick={() => setView("triggers")}
              className={view === "triggers" ? "text-ink" : "text-brass hover:underline"}>
              Triggers
            </button>
            <span className="text-brass">|</span>
            <button type="button" aria-pressed={view === "tasks"} onClick={() => setView("tasks")}
              className={view === "tasks" ? "text-ink" : "text-brass hover:underline"}>
              Tasks
            </button>
          </div>
        </div>

        {view === "tasks" ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-2 py-2 font-semibold text-ink">Title / Description</th>
                  <th className="px-2 py-2 font-semibold text-ink">Event</th>
                  <th className="px-2 py-2 text-center font-semibold text-ink">Enabled</th>
                  <th className="w-24" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {reactions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-3 text-center text-ink-muted">None yet. Add a reaction.</td>
                  </tr>
                )}
                {reactions.map((r) => (
                  <tr key={r.id} className={cn("border-b border-line", draft?.id === r.id && "bg-shell")}>
                    <td className="px-2 py-2">
                      <span className="block font-semibold text-ink">{r.title}</span>
                      {r.description && <span className="block text-ink">{r.description}</span>}
                    </td>
                    <td className="px-2 py-2">
                      <ul className="list-disc pl-5 text-ink">
                        {r.events.map((e) => <li key={e}>{reactionEventLabel(e)}</li>)}
                      </ul>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {r.isEnabled ? <TickIcon /> : <span className="sr-only">No</span>}
                    </td>
                    <td className="px-2 py-1">
                      {canEdit && (
                        <span className="flex justify-end">
                          <button type="button" aria-label={`Copy ${r.title}`} className={iconBtn}
                            onClick={() => setDraft(fromReaction(r, true))}>
                            <CopyIcon />
                          </button>
                          <button type="button" aria-label={`Edit ${r.title}`} className={iconBtn}
                            onClick={() => setDraft(fromReaction(r))}>
                            <EditIcon />
                          </button>
                          <button type="button" aria-label={`Delete ${r.title}`} className={iconBtn}
                            onClick={() => {
                              if (!confirm(`Delete ${r.title}?`)) return;
                              run(async () => {
                                const result = await deleteReaction(r.id);
                                if (result.ok && draft?.id === r.id) setDraft(null);
                                return result;
                              }, `${r.title} deleted.`);
                            }}>
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
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-2 py-2 font-semibold text-ink">Event</th>
                <th className="px-2 py-2 font-semibold text-ink">Reactions</th>
              </tr>
            </thead>
            <tbody>
              {REACTION_EVENTS.map((ev) => {
                const on = reactions.filter((r) => r.events.includes(ev.id));
                return (
                  <tr key={ev.id} className="border-b border-line">
                    <td className="px-2 py-2 text-ink">{ev.label}</td>
                    <td className="px-2 py-2">
                      {on.length === 0 ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <ul className="list-disc pl-5">
                          {on.map((r) => (
                            <li key={r.id} className={r.isEnabled ? "text-ink" : "text-ink-faint"}>{r.title}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {view === "tasks" && form}

        {canEdit && (
          <div className="border-t border-line bg-shell/40 px-4 py-4 sm:px-6">
            <button type="button" onClick={() => { setView("tasks"); setDraft(newDraft()); }}
              className="rounded-md bg-chrome-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900">
              Add Reaction
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
