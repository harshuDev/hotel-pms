"use client";

import { useT } from "@/components/i18n";
import { msg } from "@/lib/i18n/translate";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";
import { Dialog, EditIcon } from "@/components/settings/finance-panels";
import type { ChannelKind, ChannelSetting } from "@/lib/types";
import { mergeChannels, saveChannel, searchCustomersForPicker } from "@/lib/actions/settings";

/*
 * Settings -> Connectivity Settings -> Sales Channels (0099), cloned from the
 * client's reference: Active | All | Draft, a tickbox per row and MERGE, Name,
 * Abbreviation, Status and a pencil, a Create form opening under the table,
 * and ADD NEW SALES CHANNEL.
 *
 * A sales channel IS a booking source (`channels`), so this replaced the
 * Booking Sources screen rather than sitting beside it. Abbreviation is
 * `code`; Draft is not selling, which `create_booking()` refuses. Kind and
 * commission are not on the reference's form but stay on ours: settlement and
 * the channel report's commission are worked out from them.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;
type Filter = "active" | "all" | "draft";

const KINDS: { value: ChannelKind; label: string }[] = [
  { value: "direct", label: msg("Direct") },
  { value: "ota", label: msg("OTA") },
  { value: "wholesaler", label: msg("Wholesaler") },
  { value: "gds", label: msg("GDS") },
  { value: "offline", label: msg("Offline") },
];

type Draft = {
  id: string | null;
  name: string;
  code: string;
  isActive: boolean;
  kind: ChannelKind;
  commission: string;
  customer: { id: string; name: string } | null;
};

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell disabled:opacity-50";
const th = "px-2 py-2.5 text-left text-[12px] font-semibold text-ink";
const td = "px-2 py-2 text-[12.5px] text-ink";
const line =
  "w-full border-0 border-b border-line bg-transparent px-0.5 py-1.5 text-[13.5px] text-ink outline-none placeholder:text-ink-muted focus:border-brass";

function CustomerPicker({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
}) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [open, setOpen] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ticket = ++latest.current;
    const t = setTimeout(async () => {
      const r = await searchCustomersForPicker(q);
      // A slow early answer must not land over a newer one.
      if (ticket === latest.current && r.ok) setResults(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  if (value) {
    return (
      <p className="flex items-center gap-3 border-b border-line py-1.5 text-[13.5px] text-ink">
        {value.name}
        <button type="button" className="text-[12px] text-rose-700 hover:underline" onClick={() => onChange(null)}>
          {tr("Remove")}
        </button>
      </p>
    );
  }
  return (
    <div className="relative">
      <input
        aria-label={tr("Associated Customer")}
        placeholder={tr("Associated Customer")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={line}
      />
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md border border-line bg-white py-1 shadow-lift">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-[13px] text-ink hover:bg-shell"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ id: c.id, name: c.name });
                  setQ("");
                  setOpen(false);
                }}
              >
                {c.name}
                <span className="ml-2 text-[11.5px] text-ink-faint">{c.kind === "company" ? tr("Company") : tr("Guest")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SalesChannelsPanel({
  channels,
  canEdit,
  pending,
  run,
}: {
  channels: ChannelSetting[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [filter, setFilter] = useState<Filter>("active");
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const shown = channels.filter((c) =>
    filter === "all" ? true : filter === "active" ? c.isActive : !c.isActive,
  );
  const picked = channels.filter((c) => selected.includes(c.id));

  function save(d: Draft) {
    run(async () => {
      const result = await saveChannel({
        id: d.id,
        code: d.code,
        name: d.name,
        kind: d.kind,
        // Basis points, like every other rate here.
        commissionBps: Math.round((Number(d.commission) || 0) * 100),
        isActive: d.isActive,
        customerId: d.customer?.id ?? null,
      });
      if (result.ok) setDraft(null);
      return result;
    }, tr("{name} saved.", { name: d.name.trim() || tr("Sales channel") }));
  }

  function openMerge() {
    setNote(null);
    if (picked.length < 2) {
      setNote(tr("Tick two or more sales channels to merge them into one."));
      return;
    }
    setMerging(picked[0].id);
  }

  const filters: { id: Filter; label: string }[] = [
    { id: "active", label: tr("Active") },
    { id: "all", label: tr("All") },
    { id: "draft", label: tr("Draft") },
  ];

  return (
    <div className="max-w-6xl">
      <section className={card}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line px-4 py-4 sm:px-6">
          <h2 className="text-[15px] text-ink">{tr("Sales Channels")}</h2>
          <nav aria-label={tr("Status")} className="flex items-center gap-2 text-[13px]">
            {filters.map((f, i) => (
              <span key={f.id} className="flex items-center gap-2">
                {i > 0 && <span className="text-ink-faint" aria-hidden="true">|</span>}
                <button
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={filter === f.id ? "text-ink" : "text-brass hover:underline"}
                >
                  {f.label}
                </button>
              </span>
            ))}
          </nav>
          <div className="flex justify-end">
            {canEdit && (
              <button type="button" className={secondary} onClick={openMerge}>
                {tr("Merge")}
              </button>
            )}
          </div>
        </div>
        {note && <p role="alert" className="px-6 pt-3 text-[12.5px] text-rose-700">{note}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="w-10" aria-label={tr("Select")} />
                <th className={th}>{tr("Name")}</th>
                <th className={th}>{tr("Abbreviation")}</th>
                <th className={th}>{tr("Status")}</th>
                <th className="w-12" aria-label={tr("Edit")} />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-[13px] text-ink-muted">
                    {channels.length === 0
                      ? tr("None yet. Add at least Direct — a booking cannot be taken without a sales channel.")
                      : filter === "draft"
                        ? tr("No draft sales channels.")
                        : tr("No active sales channels.")}
                  </td>
                </tr>
              ) : (
                shown.map((c) => (
                  <tr key={c.id} className={cn("border-b border-line", draft?.id === c.id && "bg-shell/70")}>
                    <td className="px-3 py-2">
                      {canEdit && (
                        <input
                          type="checkbox"
                          aria-label={tr("Select {name}", { name: c.name })}
                          className="h-4 w-4 accent-brass"
                          checked={selected.includes(c.id)}
                          onChange={(e) =>
                            setSelected(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))
                          }
                        />
                      )}
                    </td>
                    <td className={td}>
                      {c.name}
                      {c.customerName && <span className="ml-2 text-[11.5px] text-ink-muted">{c.customerName}</span>}
                    </td>
                    <td className={td}>{c.code}</td>
                    <td className={cn(td, !c.isActive && "text-ink-muted")}>{c.isActive ? tr("Active") : tr("Draft")}</td>
                    <td className="py-1 pr-3 text-right">
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={tr("Edit {name}", { name: c.name })}
                          className="grid h-8 w-8 place-items-center rounded text-brass hover:bg-shell"
                          onClick={() =>
                            setDraft({
                              id: c.id,
                              name: c.name,
                              code: c.code,
                              isActive: c.isActive,
                              kind: c.kind,
                              commission: String(c.commissionBps / 100),
                              customer: c.customerId ? { id: c.customerId, name: c.customerName ?? "" } : null,
                            })
                          }
                        >
                          <EditIcon />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {draft && (
          <form
            className="mx-4 mt-2 rounded border border-line sm:mx-6"
            onSubmit={(e) => {
              e.preventDefault();
              save(draft);
            }}
          >
            <div className="space-y-4 px-4 py-4">
              <h3 className="border-b border-line pb-1.5 text-[15px] text-ink">{draft.id ? tr("Edit") : tr("Create")}</h3>
              <input aria-label={tr("Name")} placeholder={tr("Name")} value={draft.name} maxLength={80} autoFocus
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={line} />
              <input aria-label={tr("Abbreviation")} placeholder={tr("Abbreviation")} value={draft.code} maxLength={12}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} className={line} />
              <div className="flex items-center gap-5 text-[13px] text-ink" role="radiogroup" aria-label={tr("Status")}>
                {[
                  { v: true, l: msg("Active") },
                  { v: false, l: msg("Draft") },
                ].map((o) => (
                  <label key={o.l} className="flex items-center gap-1.5">
                    <input type="radio" name="sc-status" className="h-4 w-4 accent-brass"
                      checked={draft.isActive === o.v} onChange={() => setDraft({ ...draft, isActive: o.v })} />
                    {tr(o.l)}
                  </label>
                ))}
              </div>
              <CustomerPicker value={draft.customer} onChange={(customer) => setDraft({ ...draft, customer })} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-[11.5px] text-ink-muted">
                  {tr("Kind")}
                  <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ChannelKind })}
                    className={cn(line, "cursor-pointer")}>
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{tr(k.label)}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11.5px] text-ink-muted">
                  {tr("Commission %")}
                  <input inputMode="decimal" value={draft.commission}
                    onChange={(e) => setDraft({ ...draft, commission: e.target.value })} className={cn(line, "tnum")} />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-line bg-shell px-4 py-3">
              <button type="button" className={secondary} onClick={() => setDraft(null)}>{tr("Cancel")}</button>
              <button type="submit" className={primary} disabled={pending}>{tr("Save")}</button>
            </div>
          </form>
        )}

        <div className="mt-4 rounded-b-lg border-t border-line bg-shell px-4 py-3 sm:px-6">
          {canEdit && !draft ? (
            <button
              type="button"
              className={primary}
              onClick={() =>
                setDraft({ id: null, name: "", code: "", isActive: true, kind: "ota", commission: "0", customer: null })
              }
            >
              {tr("Add new sales channel")}
            </button>
          ) : (
            <span className="block h-2" />
          )}
        </div>
      </section>

      {merging && (
        <Dialog
          title={tr("Merge sales channels")}
          onClose={() => setMerging(null)}
          footer={
            <>
              <button type="button" className={secondary} onClick={() => setMerging(null)}>{tr("Cancel")}</button>
              <button
                type="button"
                className={primary}
                disabled={pending}
                onClick={() => {
                  const keep = channels.find((c) => c.id === merging);
                  run(async () => {
                    const result = await mergeChannels(merging, selected.filter((id) => id !== merging));
                    if (result.ok) {
                      setMerging(null);
                      setSelected([]);
                    }
                    return result;
                  }, keep ? tr("Merged into {name}.", { name: keep.name }) : tr("Merged into the channel kept."));
                }}
              >
                {tr("Merge")}
              </button>
            </>
          }
        >
          <p className="text-[13px] text-ink">{tr("Keep:")}</p>
          <div className="space-y-1.5">
            {picked.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-[13px] text-ink">
                <input type="radio" name="sc-keep" className="h-4 w-4 accent-brass"
                  checked={merging === c.id} onChange={() => setMerging(c.id)} />
                {c.name} <span className="text-ink-muted">{c.code}</span>
              </label>
            ))}
          </div>
          <p className="text-[12.5px] text-ink-muted">
            {tr("The others are removed and their bookings move to the one kept, at its commission.")}
          </p>
        </Dialog>
      )}
    </div>
  );
}
