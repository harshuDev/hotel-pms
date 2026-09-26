"use client";

import { Fragment, useState } from "react";
import { cn } from "@/components/ui";
import {
  GUEST_FIELD_KINDS,
  type GuestField,
  type GuestFieldKind,
  type IdentificationType,
  type RegistrationForm,
} from "@/lib/guest-config";
import {
  deleteIdentificationType,
  saveGuestFields,
  saveIdentificationType,
  saveRegistrationForm,
} from "@/lib/actions/settings";

/*
 * Settings -> Guest Configuration (0073), cloned from the client's reference:
 * Guest Registration Form, Identification Types and Guest Details Settings.
 *
 * Each is read by something, so none is a setting that changes nothing:
 *   - the registration form prints on a booking's Guest Registration Card;
 *   - identification types are the pick-list on a guest's Identity band;
 *   - additional guest fields appear on the guest's edit form, and on the card.
 *
 * Not copied from theirs: the LOCALE picker and per-field translate buttons,
 * since nothing here is stored per language, and the rich-text toolbar on the
 * terms. The terms are plain text with line breaks kept -- HTML typed in a
 * browser and printed back out is a script-injection path with no sanitiser
 * in this codebase, and a card someone signs needs paragraphs, not fonts.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
// The same field without the full width, for a row that sits several across.
const fieldInline = field.replace("w-full ", "");
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink";
const iconButton =
  "grid h-7 w-7 place-items-center rounded text-brass hover:bg-shell focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
const card = "rounded-lg border border-line bg-white shadow-card";

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="M17.5 3.5l3 3L12 15H9v-3z" />
    </svg>
  );
}

/* -- Guest Registration Form --------------------------------------------- */

export function RegistrationFormPanel({
  form,
  canEdit,
  pending,
  run,
}: {
  form: RegistrationForm;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState({
    question1: form.question1 ?? "",
    question2: form.question2 ?? "",
    terms: form.terms ?? "",
  });
  const row = "grid gap-2 sm:grid-cols-[11rem_1fr] sm:gap-5";
  const labelCls = "pt-2 text-[14px] leading-snug text-ink-muted";

  return (
    <div className="max-w-4xl space-y-4">
      <h2 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
        Guest Registration Form Settings
      </h2>
      <div className={cn(card, "px-6 py-8 sm:px-10")}>
        <div className="space-y-4">
          <div className={row}>
            <label htmlFor="reg-q1" className={labelCls}>Custom Question 1 Title:</label>
            <textarea id="reg-q1" rows={2} value={draft.question1} disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, question1: e.target.value })} className={field} />
          </div>
          <div className={row}>
            <label htmlFor="reg-q2" className={labelCls}>Custom Question 2 Title:</label>
            <textarea id="reg-q2" rows={2} value={draft.question2} disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, question2: e.target.value })} className={field} />
          </div>
          <div className={row}>
            <label htmlFor="reg-terms" className={labelCls}>Your Terms and Conditions:</label>
            <textarea id="reg-terms" rows={9} value={draft.terms} disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, terms: e.target.value })} className={field} />
          </div>
        </div>
        {canEdit && (
          <div className="mt-7 flex justify-center">
            <button
              type="button"
              onClick={() => run(() => saveRegistrationForm(draft), "Registration form saved.")}
              disabled={pending}
              className={primary}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -- Identification Types ------------------------------------------------ */

export function IdentificationTypesPanel({
  types,
  canEdit,
  pending,
  run,
}: {
  types: IdentificationType[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<{ id: string | null; title: string } | null>(null);

  function save() {
    if (!draft) return;
    const d = draft;
    run(async () => {
      const result = await saveIdentificationType(d);
      if (result.ok) setDraft(null);
      return result;
    }, d.id ? "Identification type saved." : "Identification type added.");
  }

  function editorRow() {
    if (!draft) return null;
    return (
      <tr className="border-b border-line bg-shell/60">
        <td className="px-5 py-3">
          <input
            autoFocus
            aria-label="Identification type title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setDraft(null);
            }}
            className={field}
          />
        </td>
        <td className="whitespace-nowrap px-5 py-3 text-right">
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
    <div className={cn(card, "max-w-4xl overflow-hidden")}>
      <h2 className="border-b border-line px-5 py-5 text-[20px] text-ink">Identification Types</h2>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b-2 border-line text-left">
            <th className="px-2 py-3 font-semibold text-ink">Title</th>
            <th className="w-48 py-3" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {types.map((t) =>
            draft?.id === t.id ? (
              <Fragment key={t.id}>{editorRow()}</Fragment>
            ) : (
              <tr key={t.id} className="border-b border-line">
                <td className="px-2 py-5 text-ink">{t.title}</td>
                <td className="px-3 py-2">
                  {canEdit && (
                    <span className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        title="Edit"
                        aria-label={`Edit ${t.title}`}
                        onClick={() => setDraft({ id: t.id, title: t.title })}
                        className={iconButton}
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        aria-label={`Delete ${t.title}`}
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(`Delete ${t.title}?`)) return;
                          run(() => deleteIdentificationType(t.id), `${t.title} deleted.`);
                        }}
                        className={cn(iconButton, "text-[16px] font-bold leading-none")}
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
          {types.length === 0 && draft === null && (
            <tr>
              <td colSpan={2} className="px-5 py-6 text-center text-[13px] text-ink-muted">
                None yet. Add Passport, National Identity Card or whatever your guests show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {canEdit && draft === null && (
        <div className="bg-shell/60 px-5 py-5">
          <button
            type="button"
            onClick={() => setDraft({ id: null, title: "" })}
            className={cn(primary, "text-[12.5px] font-semibold uppercase tracking-wide")}
          >
            Create new identification type
          </button>
        </div>
      )}
    </div>
  );
}

/* -- Guest Details Settings ---------------------------------------------- */

type FieldDraft = { key: string; id: string | null; label: string; kind: GuestFieldKind };

export function GuestDetailsPanel({
  fields,
  canEdit,
  pending,
  run,
}: {
  fields: GuestField[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  // A stable React key per row, because a new row has no id until it is saved.
  const [rows, setRows] = useState<FieldDraft[]>(() =>
    fields.map((f) => ({ key: f.id, id: f.id, label: f.label, kind: f.kind })),
  );
  const [counter, setCounter] = useState(0);

  function update(key: string, patch: Partial<FieldDraft>) {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save() {
    const removed = fields.filter((f) => !rows.some((r) => r.id === f.id));
    if (
      removed.length > 0 &&
      !confirm(
        `Remove ${removed.map((f) => f.label).join(", ")}? Values already entered on guests will no longer show.`,
      )
    ) {
      return;
    }
    run(
      () => saveGuestFields(rows.map((r) => ({ id: r.id, label: r.label, kind: r.kind }))),
      "Guest details saved.",
    );
  }

  return (
    <div className={cn(card, "max-w-4xl overflow-hidden")}>
      <h2 className="border-b border-line px-5 py-5 text-[20px] text-ink">Guest Details Settings</h2>
      {rows.length === 0 ? (
        <p className="border-b border-line px-5 py-6 text-center text-[14px] text-ink">
          You do not have any additional guest fields.
        </p>
      ) : (
        <ul className="divide-y divide-line border-b border-line">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-3 px-5 py-3">
              <span className="tnum w-5 text-[13px] text-ink-faint">{i + 1}</span>
              <input
                aria-label={`Field ${i + 1} name`}
                placeholder="Field name"
                value={r.label}
                disabled={!canEdit}
                onChange={(e) => update(r.key, { label: e.target.value })}
                className={cn(fieldInline, "min-w-0 flex-1")}
              />
              <select
                aria-label={`Field ${i + 1} type`}
                value={r.kind}
                disabled={!canEdit}
                onChange={(e) => update(r.key, { kind: e.target.value as GuestFieldKind })}
                className={cn(fieldInline, "w-32 shrink-0 sm:w-40")}
              >
                {GUEST_FIELD_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              {canEdit && (
                <button
                  type="button"
                  title="Remove"
                  aria-label={`Remove ${r.label || `field ${i + 1}`}`}
                  onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                  className={cn(iconButton, "text-[16px] font-bold leading-none")}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex items-center justify-between bg-shell/60 px-5 py-5">
          <button
            type="button"
            onClick={() => {
              setRows([...rows, { key: `new-${counter}`, id: null, label: "", kind: "text" }]);
              setCounter(counter + 1);
            }}
            className={cn(primary, "px-8 text-[12.5px] font-semibold uppercase tracking-wide")}
          >
            Add
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={cn(primary, "px-8 text-[12.5px] font-semibold uppercase tracking-wide")}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
