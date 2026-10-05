"use client";

import { useT } from "@/components/i18n";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { logBookingEmail } from "@/lib/actions/booking-files";
import { sendBookingEmail } from "@/lib/actions/booking-email";
import { RichEditor } from "@/components/bookings/rich-editor";
import type { BookingEmail } from "@/lib/types";
import type { EmailTemplate } from "@/lib/email-preferences";

/**
 * The Email tab, as the reference's (0131): "Send email to clients" -- Send
 * to; "Edit email content" -- the Basic / Advanced template builder, Email
 * subject, Choose template, the editor with DROP IN'S; Attach Invoice,
 * Attach Confirmation and SEND EMAIL. Below it, everything already sent or
 * recorded for this booking.
 *
 * Basic is the rich-text editor. Advanced is the message's own HTML beside a
 * live preview, for a hotel that writes its own layout.
 *
 * It SENDS when SMTP is set up (`mailReady`): the server sanitises, fills
 * the drop-ins, adds the footer, makes the PDFs, sends, and records sent or
 * failed. Without it the button says Record email and only logs what was
 * sent from elsewhere -- the label matches the result, which is the rule.
 */

const underline =
  "w-full border-0 border-b border-line bg-transparent px-0 py-1.5 text-[13.5px] text-ink outline-none focus:border-brass";
const small = "block text-[11.5px] text-ink-muted";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function EmailTab({
  bookingId,
  reference,
  hotelName,
  mailReady,
  emails,
  defaultTo,
  timezone,
  canEdit,
  templates,
}: {
  bookingId: string;
  reference: string;
  hotelName: string;
  /** SMTP is set up in this deployment; without it the tab records only. */
  mailReady: boolean;
  emails: BookingEmail[];
  /** The guest's address, so the commonest case is already filled in. */
  defaultTo: string | null;
  timezone: string;
  canEdit: boolean;
  /** Settings -> Email Setup -> Email Templates (0075). */
  templates: EmailTemplate[];
}) {
  const tr = useT();
  const router = useRouter();
  const blank = `<p>${escapeHtml(hotelName)}</p>`;
  const [to, setTo] = useState(defaultTo ?? "");
  const [builder, setBuilder] = useState<"basic" | "advanced">("basic");
  const [subject, setSubject] = useState(tr("Your booking at {hotel} #{reference}", { hotel: hotelName, reference }));
  const [template, setTemplate] = useState("");
  const [html, setHtml] = useState(blank);
  const [invoice, setInvoice] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function chooseTemplate(id: string) {
    setTemplate(id);
    const t = templates.find((x) => x.id === id);
    if (!t) {
      setHtml(blank);
      return;
    }
    if (t.subject) setSubject(t.subject);
    // Email Setup's templates are plain text; each line becomes a line.
    setHtml(
      (t.body ?? "")
        .split(/\n{2,}/)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
        .join("") || blank,
    );
  }

  function submit() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      if (mailReady) {
        const r = await sendBookingEmail({
          bookingId,
          to,
          subject,
          html,
          attachInvoice: invoice,
          attachConfirmation: confirmation,
        });
        if (!r.ok) {
          setError(r.error);
          router.refresh();
          return;
        }
        setDone(tr("Email sent."));
      } else {
        const text = new DOMParser().parseFromString(html, "text/html").body.innerText.trim();
        const r = await logBookingEmail({ bookingId, toAddress: to, subject, body: text });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setDone(tr("Email recorded."));
      }
      router.refresh();
    });
  }

  const status = (e: BookingEmail) =>
    e.status === "sent"
      ? { label: tr("Sent"), cls: "bg-emerald-50 text-emerald-700" }
      : e.status === "failed"
        ? { label: tr("Failed"), cls: "bg-rose-50 text-rose-700" }
        : { label: tr("Recorded"), cls: "bg-shell text-ink-muted" };

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-card">
          <h2 className="font-display text-[22px] font-light tracking-tightest text-ink">{tr("Send email to clients")}</h2>
          <label className="mt-3 block">
            <span className={small}>{tr("Send to")}</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} className={underline}
              placeholder={tr("guest@example.com")} />
          </label>

          <h2 className="mt-8 font-display text-[22px] font-light tracking-tightest text-ink">{tr("Edit email content")}</h2>
          <p className="mt-3 text-[12.5px] text-ink">{tr("Please choose email template builder")}</p>
          <div className="mt-2 inline-flex overflow-hidden rounded border border-brass">
            {(["basic", "advanced"] as const).map((b) => (
              <button key={b} type="button" onClick={() => setBuilder(b)}
                className={cn("px-4 py-1.5 text-[12.5px]", builder === b ? "bg-brass text-white" : "bg-white text-brass hover:bg-brass/5")}>
                {b === "basic" ? tr("Basic") : tr("Advanced")}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <label className="block">
              <span className={small}>{tr("Email subject")}</span>
              <input value={subject} maxLength={500} onChange={(e) => setSubject(e.target.value)} className={underline} />
            </label>
            <label className="block">
              <span className={small}>{tr("Choose template")}</span>
              <select value={template} onChange={(e) => chooseTemplate(e.target.value)} className={underline}>
                <option value="">{tr("Blank Template")}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4">
            {builder === "basic" ? (
              <RichEditor value={html} onChange={setHtml} />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                <textarea value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false}
                  aria-label={tr("HTML")}
                  className="min-h-[320px] w-full rounded border border-line p-3 font-mono text-[12px] text-ink outline-none focus:border-brass" />
                <iframe title={tr("Preview")} sandbox="" srcDoc={html}
                  className="min-h-[320px] w-full rounded border border-line bg-white" />
              </div>
            )}
          </div>

          <div className="mt-6 grid items-end gap-6 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="block">
                <span className="sr-only">{tr("Attach Invoice")}</span>
                <select value={invoice ? "invoice" : ""} onChange={(e) => setInvoice(e.target.value === "invoice")} className={underline}>
                  <option value="">{tr("Attach Invoice")}</option>
                  <option value="invoice">{tr("Invoice {reference}", { reference })}</option>
                </select>
              </label>
              <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" checked={confirmation} onChange={(e) => setConfirmation(e.target.checked)}
                  className="h-4 w-4 accent-brass" />
                {tr("Attach Confirmation")}
              </label>
            </div>
            <div className="text-right">
              <button type="button" onClick={submit} disabled={pending}
                className="rounded bg-chrome-800 px-5 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-60">
                {pending ? tr("Sending…") : mailReady ? tr("Send email") : tr("Record email")}
              </button>
            </div>
          </div>
          {!mailReady && (
            <p className="mt-2 text-right text-[12px] text-ink-muted">{tr("Email sending is not set up")}</p>
          )}
          {error && <p role="alert" className="mt-3 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
          {done && <p role="status" className="mt-3 rounded bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{done}</p>}
        </div>
      )}

      <div className="rounded-lg border border-line bg-white shadow-card">
        <h2 className="border-b border-line px-4 py-3 font-display text-[15px] font-semibold tracking-tightest text-ink">
          {tr("Correspondence")}
        </h2>
        {emails.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-ink-muted">{tr("No email sent yet.")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {emails.map((e) => {
              const s = status(e);
              const shown = open === e.id;
              return (
                <li key={e.id} className="px-4 py-3">
                  <button type="button" onClick={() => setOpen(shown ? null : e.id)}
                    className="flex w-full items-baseline justify-between gap-3 text-left">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xxs font-medium", s.cls)}>{s.label}</span>
                        <span className="truncate text-[13px] font-medium text-ink">{e.subject}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xxs text-ink-muted">
                        {e.toAddress}
                        {e.sentByName ? ` · ${e.sentByName}` : ""}
                        {e.attachments.length > 0 ? ` · ${e.attachments.join(", ")}` : ""}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-xxs text-ink-faint">{tr.stamp(e.sentAt, timezone)} {shown ? "▴" : "▾"}</span>
                  </button>
                  {e.error && <p className="mt-1.5 text-[12px] text-rose-700">{e.error}</p>}
                  {shown &&
                    (e.bodyHtml ? (
                      // Sanitised on the server when sent, and shown in a
                      // frame with no script and no origin besides.
                      <iframe title={e.subject} sandbox="" srcDoc={e.bodyHtml}
                        className="mt-2 h-72 w-full rounded border border-line bg-white" />
                    ) : (
                      e.body.trim() && (
                        <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-muted">{e.body}</p>
                      )
                    ))}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
