"use client";

import { useT } from "@/components/i18n";
import { Fragment, useState } from "react";
import { cn } from "@/components/ui";
import {
  CONFIRMATION_COLORS,
  type ConfirmationColorId,
  type EmailSetup,
  type EmailTemplate,
} from "@/lib/email-preferences";
import {
  deleteEmailTemplate,
  saveBookingConfirmationEmail,
  saveEmailFooter,
  saveEmailGeneral,
  saveEmailTemplate,
  savePaymentRequestEmail,
  savePostDepartureEmail,
  savePreArrivalEmail,
} from "@/lib/actions/settings";

/*
 * Settings -> Communications & Notifications -> Email Setup (0075), cloned
 * from the client's reference section by section, each with its own Save:
 * General Settings, Footer Template, Booking Confirmation Email settings,
 * Pre Arrival, Post Departure and Request Payment Email Setup, and Email
 * Templates.
 *
 * STORED, NOT YET SENT: there is no mail provider in this system. Email
 * Templates is the part with a reader today -- the booking screen's Email tab
 * offers them. See CLAUDE.md.
 *
 * Their "Open template editor" is a rich-text editor; here it opens a plain
 * text editor, for the reason the registration card's terms are plain: HTML
 * typed in a browser and sent back out needs a sanitiser this codebase does
 * not have. The LOCALE picker, per-field translate buttons and the "?" tips
 * are not copied, as elsewhere in Settings.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "rounded-lg border border-line bg-white shadow-card";
const underline =
  "w-full border-0 border-b border-line bg-transparent px-1 py-1.5 text-[14px] text-ink outline-none focus:border-brass";
const tiny = "text-[11.5px] text-ink-muted";
const save =
  "rounded-md bg-chrome-800 px-6 py-2 text-[12px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const editorButton =
  "rounded bg-brass px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:opacity-90";

function Section({
  title,
  subtitle,
  children,
  onSave,
  pending,
  canEdit,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onSave?: () => void;
  pending: boolean;
  canEdit: boolean;
}) {
  const tr = useT();
  return (
    <section className={cn(card, "overflow-hidden")}>
      <div className="px-6 pb-7 pt-7 sm:px-8">
        <h3 className={cn("text-[17px] text-ink", !subtitle && "border-b border-line pb-2")}>{title}</h3>
        {subtitle && <p className="border-b border-line pb-2 text-[12.5px] text-ink-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {onSave && canEdit && (
        <div className="flex justify-end border-t border-line bg-shell/60 px-6 py-4 sm:px-8">
          <button type="button" onClick={onSave} disabled={pending} className={save}>
            {tr("Save")}
          </button>
        </div>
      )}
    </section>
  );
}

function Counter({ value, max = 255 }: { value: string; max?: number }) {
  return (
    <p className={cn("tnum mt-0.5 text-right text-[11px]", value.length > max ? "text-rose-600" : "text-ink-faint")}>
      {value.length}/{max}
    </p>
  );
}

function EmailChips({
  id,
  label,
  emails,
  onChange,
  canEdit,
}: {
  id: string;
  label: string;
  emails: string[];
  onChange: (next: string[]) => void;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const next = draft.trim().toLowerCase();
    if (!next) return;
    if (!emails.includes(next)) onChange([...emails, next]);
    setDraft("");
  }
  return (
    <div>
      <p id={id} className={tiny}>{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2" aria-labelledby={id}>
        {emails.map((e) => (
          <span key={e} className="inline-flex items-center gap-2 rounded-full bg-shell px-3 py-1 text-[13px] text-ink">
            {e}
            {canEdit && (
              <button
                type="button"
                aria-label={tr("Remove {e}", { e: e })}
                onClick={() => onChange(emails.filter((x) => x !== e))}
                className="grid h-5 w-5 place-items-center rounded-full text-ink-muted hover:bg-white hover:text-ink"
              >
                <span aria-hidden="true" className="text-[14px] leading-none">✕</span>
              </button>
            )}
          </span>
        ))}
        {canEdit && (
          <span className="flex min-w-[12rem] flex-1 items-center gap-2">
            <input
              type="email"
              aria-label={tr("Add to {name}", { name: label })}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={add}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  add();
                }
              }}
              className={cn(underline, "min-w-0 flex-1")}
            />
            <button
              type="button"
              aria-label={tr("Add to {name}", { name: label })}
              onClick={add}
              className="grid h-8 w-8 place-items-center rounded text-[20px] leading-none text-ink-faint hover:bg-shell hover:text-ink"
            >
              +
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/** "Open template editor": a dialog with one text area, Cancel and Done. */
function TemplateField({
  label,
  value,
  onChange,
  canEdit,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  canEdit: boolean;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <div>
      {label && <p className="text-[13px] text-ink-muted">{label}</p>}
      <div className="mt-1.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setOpen(true);
          }}
          className={editorButton}
        >
          {tr("Open template editor")}
        </button>
        {value && <span className="truncate text-[12px] text-ink-faint">{value.split("\n")[0]}</span>}
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 pt-[10vh]"
          role="dialog"
          aria-modal="true"
          aria-label={label || tr("Template")}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h4 className="text-[15px] text-ink">{label || tr("Template")}</h4>
              <button
                type="button"
                aria-label={tr("Close")}
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-muted hover:bg-shell hover:text-ink"
              >
                <span aria-hidden="true" className="text-lg leading-none">✕</span>
              </button>
            </div>
            <div className="p-5">
              <textarea
                autoFocus
                rows={12}
                value={draft}
                disabled={!canEdit}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-[13.5px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
              >
                {tr("Cancel")}
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(draft);
                    setOpen(false);
                  }}
                  className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900"
                >
                  {tr("Done")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Radio({
  name,
  checked,
  onChange,
  label,
  disabled,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <label className="flex w-fit items-center gap-2 text-[13px] text-ink">
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled}
        className="h-4 w-4 accent-brass" />
      {label}
    </label>
  );
}

export function EmailSetupPanel({
  setup,
  templates,
  propertyName,
  canEdit,
  pending,
  run,
}: {
  setup: EmailSetup;
  templates: EmailTemplate[];
  propertyName: string;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  // General Settings
  const [replyTo, setReplyTo] = useState(setup.replyToEmails);
  const [fromText, setFromText] = useState(setup.fromText ?? "");
  const [notify, setNotify] = useState(setup.notificationEmails);
  // Footer
  const [footer, setFooter] = useState(setup.footerTemplate ?? "");
  // Booking confirmation
  const [checkinNotes, setCheckinNotes] = useState(setup.checkinNotes ?? "");
  const [directions, setDirections] = useState(setup.directions ?? "");
  const [single, setSingle] = useState(setup.singlePropertyAddress);
  const [multi, setMulti] = useState(setup.multiPropertyAddress);
  const [message, setMessage] = useState(setup.confirmationMessage ?? "");
  const [colors, setColors] = useState<Record<ConfirmationColorId, string>>(setup.colors);
  const [showLogo, setShowLogo] = useState(setup.showHotelLogo);
  const [includeFooter, setIncludeFooter] = useState(setup.includeFooter);
  // Pre arrival, post departure, payment request
  const [preArrival, setPreArrival] = useState(setup.preArrivalEnabled);
  const [postEnabled, setPostEnabled] = useState(setup.postDepartureEnabled);
  const [postSubject, setPostSubject] = useState(setup.postDepartureSubject ?? "");
  const [postBody, setPostBody] = useState(setup.postDepartureBody ?? "");
  const [paySubject, setPaySubject] = useState(setup.paymentRequestSubject ?? "");
  const [payBody, setPayBody] = useState(setup.paymentRequestBody ?? "");
  // Templates
  const [tpl, setTpl] = useState<{ id: string | null; title: string; subject: string; body: string } | null>(null);

  const disabled = !canEdit;
  const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

  function saveTemplate() {
    if (!tpl) return;
    const d = tpl;
    run(async () => {
      const result = await saveEmailTemplate(d);
      if (result.ok) setTpl(null);
      return result;
    }, d.id ? "Email template saved." : "Email template added.");
  }

  function templateEditor() {
    if (!tpl) return null;
    return (
      <tr className="border-b border-line bg-shell/60">
        <td colSpan={2} className="px-2 py-4">
          <div className="grid gap-3">
            <input aria-label={tr("Template title")} placeholder={tr("Title")} autoFocus value={tpl.title}
              onChange={(e) => setTpl({ ...tpl, title: e.target.value })} className={underline} />
            <div>
              <input aria-label={tr("Template subject")} placeholder={tr("Email subject")} value={tpl.subject}
                onChange={(e) => setTpl({ ...tpl, subject: e.target.value })} className={underline} />
              <Counter value={tpl.subject} />
            </div>
            <textarea aria-label={tr("Template body")} placeholder={tr("Mail body")} rows={6} value={tpl.body}
              onChange={(e) => setTpl({ ...tpl, body: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-[13.5px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setTpl(null)}
                className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink">
                {tr("Cancel")}
              </button>
              <button type="button" onClick={saveTemplate} disabled={pending}
                className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50">
                {tr("Save")}
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <h2 className="font-display text-[26px] font-semibold tracking-tightest text-ink">{tr("Email Setup")}</h2>

      {/* General Settings ------------------------------------------------ */}
      <Section
        title={tr("General Settings")}
        canEdit={canEdit}
        pending={pending}
        onSave={() =>
          run(
            () => saveEmailGeneral({ replyToEmails: replyTo, fromText, notificationEmails: notify }),
            tr("General settings saved."),
          )
        }
      >
        <div className="space-y-6">
          <EmailChips id="reply-to" label={tr("Reply to Email Address")} emails={replyTo} onChange={setReplyTo} canEdit={canEdit} />
          <div>
            <label htmlFor="from-text" className={tiny}>{tr("From text")}</label>
            <input id="from-text" value={fromText} disabled={disabled} placeholder={propertyName}
              onChange={(e) => setFromText(e.target.value)} className={underline} />
            <Counter value={fromText} />
          </div>
          <EmailChips id="notify" label={tr("Booking Notification Email Address")} emails={notify} onChange={setNotify} canEdit={canEdit} />
        </div>
      </Section>

      {/* Footer Template -------------------------------------------------- */}
      <Section
        title={tr("Footer Template")}
        subtitle={tr("Please add a footer which will be added to all new emails")}
        canEdit={canEdit}
        pending={pending}
        onSave={() => run(() => saveEmailFooter(footer), tr("Footer saved."))}
      >
        <TemplateField label="" value={footer} onChange={setFooter} canEdit={canEdit} />
      </Section>

      {/* Booking Confirmation Email settings ------------------------------ */}
      <Section
        title={tr("Booking Confirmation Email settings")}
        canEdit={canEdit}
        pending={pending}
        onSave={() => {
          const bad = CONFIRMATION_COLORS.find((c) => !isHex(colors[c.id]));
          if (bad) {
            run(async () => ({ ok: false, error: `${bad.label} must be a colour like #003580.` }), "");
            return;
          }
          run(
            () =>
              saveBookingConfirmationEmail({
                checkinNotes,
                directions,
                singlePropertyAddress: single,
                multiPropertyAddress: multi,
                confirmationMessage: message,
                colors,
                showHotelLogo: showLogo,
                includeFooter,
              }),
            tr("Booking confirmation email saved."),
          );
        }}
      >
        <div className="space-y-5">
          <TemplateField label={tr("Check In Notes:")} value={checkinNotes} onChange={setCheckinNotes} canEdit={canEdit} />
          <TemplateField label={tr("Directions:")} value={directions} onChange={setDirections} canEdit={canEdit} />

          <fieldset>
            <legend className="text-[13px] text-ink-muted">{tr("Single-property bookings:")}</legend>
            <div className="mt-1.5 space-y-1.5">
              <Radio name="single" checked={single === "hotel"} onChange={() => setSingle("hotel")} disabled={disabled}
                label={tr("Use hotel address in greetings section")} />
              <Radio name="single" checked={single === "property"} onChange={() => setSingle("property")} disabled={disabled}
                label={tr("Use property address in greetings section")} />
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-[13px] text-ink-muted">{tr("Multi-property bookings:")}</legend>
            <div className="mt-1.5 space-y-1.5">
              <Radio name="multi" checked={multi === "hotel_hide_properties"} onChange={() => setMulti("hotel_hide_properties")}
                disabled={disabled} label={tr("Use hotel address in greetings section and hide properties")} />
              <Radio name="multi" checked={multi === "show_properties"} onChange={() => setMulti("show_properties")}
                disabled={disabled} label={tr("Hide hotel address in greetings section and show properties addresses and maps")} />
            </div>
          </fieldset>

          <div>
            <label htmlFor="confirm-message" className="text-[13px] text-ink-muted">{tr("Custom confirmation message")}</label>
            <textarea id="confirm-message" rows={2} value={message} disabled={disabled}
              onChange={(e) => setMessage(e.target.value)} className={cn(underline, "resize-y")} />
          </div>

          <div className="border-t border-line pt-5">
            <p className="text-[13px] text-ink-muted">{tr("Customize Confirmation Email Reservation Colors:")}</p>
            <div className="mt-2 space-y-3">
              {CONFIRMATION_COLORS.map((c) => (
                <div key={c.id} className="grid items-end gap-3 sm:grid-cols-2 sm:gap-6">
                  <div>
                    <label htmlFor={`color-${c.id}`} className={tiny}>{c.label}</label>
                    <input
                      id={`color-${c.id}`}
                      value={colors[c.id]}
                      disabled={disabled}
                      onChange={(e) => setColors({ ...colors, [c.id]: e.target.value })}
                      className={cn(underline, "tnum", !isHex(colors[c.id]) && "border-rose-400")}
                    />
                  </div>
                  <input
                    type="color"
                    aria-label={tr("{name} picker", { name: c.label })}
                    value={isHex(colors[c.id]) ? colors[c.id] : c.fallback}
                    disabled={disabled}
                    onChange={(e) => setColors({ ...colors, [c.id]: e.target.value })}
                    className="h-4 w-full cursor-pointer appearance-none border border-ink/60 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex w-fit items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" checked={showLogo} disabled={disabled}
                onChange={(e) => setShowLogo(e.target.checked)} className="h-4 w-4 accent-brass" />
              {tr("Show hotel logo on the top of the email")}
            </label>
            <label className="flex w-fit items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" checked={includeFooter} disabled={disabled}
                onChange={(e) => setIncludeFooter(e.target.checked)} className="h-4 w-4 accent-brass" />
              {tr("Include footer template")}
            </label>
          </div>
        </div>
      </Section>

      {/* Pre Arrival Email Setup ------------------------------------------ */}
      <Section
        title={tr("Pre Arrival Email Setup")}
        canEdit={canEdit}
        pending={pending}
        onSave={() => run(() => savePreArrivalEmail(preArrival), tr("Pre arrival email saved."))}
      >
        <label className="flex w-fit items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={preArrival} disabled={disabled}
            onChange={(e) => setPreArrival(e.target.checked)} className="h-4 w-4 accent-brass" />
          {tr("Send Email to customer before arrival")}
        </label>
      </Section>

      {/* Post Departure Email Setup --------------------------------------- */}
      <Section
        title={tr("Post Departure Email Setup")}
        canEdit={canEdit}
        pending={pending}
        onSave={() =>
          run(
            () => savePostDepartureEmail({ enabled: postEnabled, subject: postSubject, body: postBody }),
            tr("Post departure email saved."),
          )
        }
      >
        <div className="space-y-4">
          <label className="flex w-fit items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={postEnabled} disabled={disabled}
              onChange={(e) => setPostEnabled(e.target.checked)} className="h-4 w-4 accent-brass" />
            {tr("Send Email to customer after departure")}
          </label>
          <div>
            <label htmlFor="post-subject" className={tiny}>{tr("Email subject")}</label>
            <input id="post-subject" value={postSubject} disabled={disabled}
              placeholder={tr("Your Recent Stay at {propertyName}", { propertyName: propertyName })}
              onChange={(e) => setPostSubject(e.target.value)} className={underline} />
            <Counter value={postSubject} />
          </div>
          <TemplateField label={tr("Mail Body:")} value={postBody} onChange={setPostBody} canEdit={canEdit} />
        </div>
      </Section>

      {/* Request Payment Email Setup -------------------------------------- */}
      <Section
        title={tr("Request Payment Email Setup")}
        canEdit={canEdit}
        pending={pending}
        onSave={() =>
          run(() => savePaymentRequestEmail({ subject: paySubject, body: payBody }), tr("Request payment email saved."))
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="pay-subject" className={tiny}>{tr("Email subject")}</label>
            <input id="pay-subject" value={paySubject} disabled={disabled}
              onChange={(e) => setPaySubject(e.target.value)} className={underline} />
            <Counter value={paySubject} />
          </div>
          <TemplateField label={tr("Mail Body:")} value={payBody} onChange={setPayBody} canEdit={canEdit} />
        </div>
      </Section>

      {/* Email Templates -------------------------------------------------- */}
      <Section
        title={tr("Email Templates")}
        subtitle={tr("Here you can add templates for faster communication with your guests")}
        canEdit={canEdit}
        pending={pending}
      >
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-2 py-2 font-semibold text-ink">{tr("Title")}</th>
              <th className="w-24 py-2" aria-label={tr("Actions")} />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) =>
              tpl?.id === t.id ? (
                <Fragment key={t.id}>{templateEditor()}</Fragment>
              ) : (
                <tr key={t.id} className="border-b border-line">
                  <td className="px-2 py-3 text-ink">
                    {t.title}
                    {t.subject && <span className="ml-2 text-[12px] text-ink-faint">{t.subject}</span>}
                  </td>
                  <td className="py-2 text-right">
                    {canEdit && (
                      <span className="flex justify-end gap-1">
                        <button
                          type="button"
                          title={tr("Edit")}
                          aria-label={tr("Edit {name}", { name: t.title })}
                          onClick={() => setTpl({ id: t.id, title: t.title, subject: t.subject ?? "", body: t.body ?? "" })}
                          className="grid h-7 w-7 place-items-center rounded text-brass hover:bg-shell"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                            <path d="M17.5 3.5l3 3L12 15H9v-3z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          title={tr("Delete")}
                          aria-label={tr("Delete {name}", { name: t.title })}
                          disabled={pending}
                          onClick={() => {
                            if (!confirm(tr("Delete the template {name}?", { name: t.title }))) return;
                            run(() => deleteEmailTemplate(t.id), tr("{name} deleted.", { name: t.title }));
                          }}
                          className="grid h-7 w-7 place-items-center rounded text-[15px] font-bold leading-none text-brass hover:bg-shell"
                        >
                          <span aria-hidden="true">✕</span>
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ),
            )}
            {tpl?.id === null && templateEditor()}
          </tbody>
        </table>
        {canEdit && tpl === null && (
          <button
            type="button"
            onClick={() => setTpl({ id: null, title: "", subject: "", body: "" })}
            className={cn(editorButton, "mt-4")}
          >
            {tr("+ Add email template")}
          </button>
        )}
      </Section>
    </div>
  );
}
