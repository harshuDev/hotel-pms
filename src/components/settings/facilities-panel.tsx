"use client";

import { Fragment, useState } from "react";
import { cn } from "@/components/ui";
import { FacilityIcon } from "@/components/settings/facility-icon";
import { FACILITY_ICONS, type Facility, type FacilityIcon as IconName } from "@/lib/facilities";
import { deleteFacility, saveFacility } from "@/lib/actions/settings";

/*
 * Hotel Content -> Room Type Facilities (0070), cloned from the client's
 * reference: an Icon column (glyph and its name), a Title column, an edit
 * and a delete on each row, and "+ Add Facility" underneath.
 *
 * Which room types have which facility is ticked on the Room Types form, as
 * the reference's name implies -- this screen is the list to tick from.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink";
const iconButton =
  "grid h-7 w-7 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";

type Draft = { id: string | null; title: string; icon: IconName };

export function FacilitiesPanel({
  facilities,
  canEdit,
  pending,
  run,
}: {
  facilities: Facility[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);

  function save() {
    if (!draft) return;
    const d = draft;
    run(async () => {
      const result = await saveFacility(d);
      if (result.ok) setDraft(null);
      return result;
    }, d.id ? "Facility saved." : "Facility added.");
  }

  function editorRow() {
    if (!draft) return null;
    return (
      <tr className="border-b border-line bg-shell/60">
        <td className="py-2 pr-3">
          <div className="flex items-center gap-2">
            <span className="text-ink">
              <FacilityIcon name={draft.icon} />
            </span>
            <select
              aria-label="Icon"
              value={draft.icon}
              onChange={(e) => setDraft({ ...draft, icon: e.target.value as IconName })}
              className={cn(field, "max-w-[11rem]")}
            >
              {FACILITY_ICONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </td>
        <td className="py-2 pr-3">
          <input
            autoFocus
            aria-label="Facility title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setDraft(null);
            }}
            className={field}
          />
        </td>
        <td className="whitespace-nowrap py-2 text-right">
          <button type="button" onClick={() => setDraft(null)} className={cn(secondary, "mr-2")}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={pending} className={primary}>
            Save
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <h2 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
        Facilities
      </h2>
      <div className="rounded-lg border border-line bg-white px-6 py-7 shadow-card sm:px-8">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-[13px]">
            <thead>
              <tr className="border-b-2 border-line text-left text-ink">
                <th className="w-[45%] pb-2 pl-1 font-semibold">Icon</th>
                <th className="pb-2 font-semibold">Title</th>
                <th className="w-40 pb-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {facilities.map((f) =>
                draft?.id === f.id ? (
                  <Fragment key={f.id}>{editorRow()}</Fragment>
                ) : (
                  <tr key={f.id} className="border-b border-line">
                    <td className="py-2 pl-1">
                      <span className="inline-flex items-center gap-1.5 text-ink">
                        <FacilityIcon name={f.icon} className="h-[15px] w-[15px]" />
                        <span className="text-brass">{f.icon}</span>
                      </span>
                    </td>
                    <td className="py-2 text-ink">{f.title}</td>
                    <td className="py-1">
                      {canEdit && (
                        <span className="flex justify-end gap-0.5">
                          <button
                            type="button"
                            title="Edit"
                            aria-label={`Edit ${f.title}`}
                            onClick={() => setDraft({ id: f.id, title: f.title, icon: f.icon })}
                            className={iconButton}
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor"
                              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                              <path d="M17.5 3.5l3 3L12 15H9v-3z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            aria-label={`Delete ${f.title}`}
                            disabled={pending}
                            onClick={() => {
                              if (!confirm(`Delete ${f.title}? It comes off every room type it is on.`)) {
                                return;
                              }
                              run(() => deleteFacility(f.id), `${f.title} deleted.`);
                            }}
                            className={cn(iconButton, "text-[15px] font-bold leading-none")}
                          >
                            <span aria-hidden="true">✕</span>
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ),
              )}
              {draft?.id === null && editorRow()}
            </tbody>
          </table>
        </div>
        {facilities.length === 0 && draft === null && (
          <p className="py-4 text-[13px] text-ink-muted">
            None yet. Add one, then tick it on the room types that have it.
          </p>
        )}
        {canEdit && draft === null && (
          <button
            type="button"
            onClick={() => setDraft({ id: null, title: "", icon: "check" })}
            className="mt-3 text-[13px] font-semibold text-brass hover:underline"
          >
            + Add Facility
          </button>
        )}
      </div>
    </div>
  );
}
