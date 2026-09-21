"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { logBookingEmail } from "@/lib/actions/booking-files";
import { formatStampInProperty } from "@/lib/dates";
import type { BookingEmail } from "@/lib/types";

/**
 * The Email tab, which the client's reference PMS carries and this one did
 * not until 0063. "Copy them too, I just want to clone the application."
 *
 * IT IS A RECORD OF CORRESPONDENCE AND IT DOES NOT SEND, and the interface
 * says so in its labels rather than in a paragraph. There is no mail provider
 * in this deployment and no API key in any environment; a Send button that
 * cannot send is the dead control this application keeps refusing to ship.
 *
 * What a front desk actually reads this tab for is "what have we already told
 * them" — a confirmation on the 4th, a chaser on the 11th — and that is what
 * this holds. The control is labelled by its result, so it says "Record", and
 * the list is headed by what it is.
 *
 * Wiring a provider later changes this file and `logBookingEmail`, not the
 * schema: `booking_emails` already carries `sent_at` and a status with `sent`
 * and `failed` in it.
 */
export function EmailTab({
  bookingId,
  emails,
  defaultTo,
  timezone,
  canEdit,
}: {
  bookingId: string;
  emails: BookingEmail[];
  /** The guest's address, so the commonest case is already filled in. */
  defaultTo: string | null;
  timezone: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const field =
    "w-full rounded-md border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none transition focus:border-brass focus:ring-2 focus:ring-brass/20";
  const label = "mb-1 block text-xs font-medium text-ink";

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await logBookingEmail({
        bookingId,
        toAddress: to,
        subject,
        body,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSubject("");
      setBody("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-white shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
          Correspondence
        </h2>
        {canEdit && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md bg-chrome-800 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-chrome-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            Record an email
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3 border-b border-line bg-shell px-4 py-3">
          <div>
            <label htmlFor="email-to" className={label}>
              To
            </label>
            <input
              id="email-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={field}
              placeholder="guest@example.com"
            />
          </div>
          <div>
            <label htmlFor="email-subject" className={label}>
              Subject
            </label>
            <input
              id="email-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={field}
              placeholder="Booking confirmation"
            />
          </div>
          <div>
            <label htmlFor="email-body" className={label}>
              What was sent
            </label>
            <textarea
              id="email-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={field}
            />
          </div>

          {error && (
            <p className="rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            {/*
              "Record", not "Send". The label matches its result, which is the
              rule this application follows everywhere -- a button saying
              "Close shift" produces a confirmation saying "Shift closed".
              Calling this Send would be the one place the interface lied.
            */}
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="rounded-md bg-chrome-800 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-chrome-900 disabled:opacity-50"
            >
              {pending ? "Recording…" : "Record"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted transition hover:bg-shell hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {emails.length === 0 ? (
        <EmptyState
          title="Nothing recorded"
          hint={
            canEdit
              ? "Record what you have sent this guest, so the next person knows."
              : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {emails.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-medium text-ink">
                  {e.subject}
                </span>
                <span className="tnum shrink-0 text-xxs text-ink-faint">
                  {formatStampInProperty(e.sentAt, timezone)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xxs text-ink-muted">
                {e.toAddress}
                {e.sentByName ? ` · ${e.sentByName}` : ""}
              </div>
              {e.body.trim() && (
                <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-muted">
                  {e.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
