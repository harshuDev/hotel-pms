"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/components/ui";
import { formatStampInProperty } from "@/lib/dates";
import { deleteCalendarNote, saveCalendarNote } from "@/lib/actions/calendar-notes";
import type { CalendarNote } from "@/lib/types";

/**
 * The Add Note dialog's contents: the day's existing notes, and a field to
 * write another.
 *
 * The frame around this is `BookingDialog`, which the calendar already uses
 * for taking a booking — one dialog component rather than a second one that
 * would drift from it.
 */
export function NoteForm({
  noteDate,
  notes,
  closeHref,
  timezone,
  canEdit,
}: {
  noteDate: string;
  notes: CalendarNote[];
  closeHref: string;
  /** The property's own timezone, so a posting time is the hotel's clock and
      renders the same on the server as in the browser. */
  timezone: string;
  /** Front office writes; everyone else reads. Postgres decides either way. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      after();
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-card">
      {notes.length > 0 && (
        <ul className="mb-4 space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-md border border-line bg-shell px-3 py-2.5"
            >
              {editing === n.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            saveCalendarNote({ noteDate, body: editBody, id: n.id }),
                          () => setEditing(null),
                        )
                      }
                      className="rounded-md bg-chrome-800 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-white hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">
                    {n.body}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <span className="text-xxs text-ink-faint">
                      {n.author ?? "Unknown"} ·{" "}
                      {formatStampInProperty(n.createdAt, timezone)}
                    </span>
                    {canEdit && (
                      <span className="flex gap-3 text-xxs">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(n.id);
                            setEditBody(n.body);
                          }}
                          className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            if (!confirm("Delete this note?")) return;
                            run(() => deleteCalendarNote(n.id), () => {});
                          }}
                          className="text-rose-600 underline-offset-2 hover:underline disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <>
          <label
            htmlFor="note-body"
            className="mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint"
          >
            Note
          </label>
          <textarea
            id="note-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            autoFocus
            className="w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass"
          />

          {error && (
            <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-[12.5px] leading-snug text-rose-700">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Link
              href={closeHref}
              className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              Cancel
            </Link>
            <button
              type="button"
              disabled={pending || body.trim() === ""}
              onClick={() =>
                run(() => saveCalendarNote({ noteDate, body, id: null }), () =>
                  setBody(""),
                )
              }
              className={cn(
                "rounded-md bg-chrome-800 px-4 py-2 text-[13px] font-medium text-white hover:bg-chrome-900",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-ink-muted">
            Notes are added by front desk, manager and admin accounts.
          </p>
          <Link
            href={closeHref}
            className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
          >
            Close
          </Link>
        </div>
      )}
    </div>
  );
}
