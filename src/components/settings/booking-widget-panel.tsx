"use client";

import { useEffect, useState } from "react";
import { cn } from "@/components/ui";
import { EditIcon } from "@/components/settings/finance-panels";
import { NEW_WIDGET, widgetEmbedCode, type BookingWidget } from "@/lib/booking-widgets";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { deleteBookingWidget, saveBookingWidget } from "@/lib/actions/settings";

/*
 * Settings -> Connectivity Settings -> Booking Widget (0100), cloned from the
 * client's reference: Saved Widgets by hash code with edit and delete,
 * "Create new widget", and the widget form -- five texts with their 0/255
 * counters, two switches, month and weekday names, five colours each with a
 * swatch, a language, and "Save widget to get embed code".
 *
 * LIVE: the embed code is an iframe of /book/widget/<hash>, which draws this
 * widget on the hotel's website and sends the guest to the booking page. The
 * reference's "Currency (optional)" is not copied -- a property sells in one
 * currency and nothing converts, so it would change nothing.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;
type Draft = Omit<BookingWidget, "hash" | "id"> & { id: string | null; hash: string | null };

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell";
const line =
  "w-full border-0 border-b border-line bg-transparent px-0.5 py-1.5 text-[13.5px] text-ink outline-none placeholder:text-ink-muted focus:border-brass";
const small = "block text-[10.5px] text-ink-muted";

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor"
      strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
}) {
  const v = value ?? "";
  return (
    <label className="block">
      {v !== "" && <span className={small}>{label}</span>}
      <input aria-label={label} placeholder={label} value={v} maxLength={255}
        onChange={(e) => onChange(e.target.value)} className={line} />
      <span className="tnum block text-right text-[10px] text-ink-faint">{v.length}/255</span>
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="grid items-end gap-4 sm:grid-cols-2">
      <label className="block">
        <span className={small}>{label}</span>
        <input aria-label={label} value={value} maxLength={7}
          onChange={(e) => onChange(e.target.value.trim())} className={line} />
      </label>
      <label className="block">
        <span className="sr-only">{label} picker</span>
        <input
          type="color"
          value={valid ? value.toLowerCase() : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="block h-3.5 w-full cursor-pointer appearance-none border border-ink/60 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0"
        />
      </label>
    </div>
  );
}

export function BookingWidgetPanel({
  widgets,
  supportedLocales,
  canEdit,
  pending,
  run,
}: {
  widgets: BookingWidget[];
  supportedLocales: Locale[];
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<Draft | null>(
    widgets.length === 0 && canEdit ? { ...NEW_WIDGET, id: null, hash: null } : null,
  );
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  // The origin is the browser's, read after mount: reading it during render
  // would differ between the server and the browser.
  useEffect(() => setOrigin(window.location.origin), []);

  // A widget saved for the first time comes back as a hash; once the list
  // refreshes, take its id so the next Save edits it rather than making
  // another.
  useEffect(() => {
    if (draft && draft.hash && !draft.id) {
      const saved = widgets.find((w) => w.hash === draft.hash);
      if (saved) setDraft({ ...draft, id: saved.id });
    }
  }, [widgets, draft]);

  function set(patch: Partial<Draft>) {
    if (draft) setDraft({ ...draft, ...patch });
  }

  function save(d: Draft) {
    run(async () => {
      const { hash: _hash, ...rest } = d;
      void _hash;
      const result = await saveBookingWidget(rest);
      // Stay on the widget, now saved, so its embed code is on screen.
      if (result.ok) setDraft({ ...d, hash: result.data.hash });
      return result;
    }, "Widget saved.");
  }

  const embed = draft?.hash && origin ? widgetEmbedCode(origin, { ...draft, hash: draft.hash }) : null;

  return (
    <div className="max-w-6xl space-y-4">
      <h2 className="border-b border-line pb-1 text-[20px] text-ink">Booking Widget Generation</h2>

      <section className={cn(card, "px-4 py-5 sm:px-6")}>
        <h3 className="border-b border-line pb-2 text-[15px] text-ink">Saved Widgets</h3>
        <table className="mt-2 w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line">
              <th className="px-2 py-2 text-left font-semibold text-ink">Hash code</th>
              <th className="w-20" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {widgets.map((w) => (
              <tr key={w.id} className={cn("border-b border-line", draft?.id === w.id ? "bg-shell" : "bg-shell/40")}>
                <td className="tnum px-2 py-1.5 font-mono text-ink">{w.hash}</td>
                <td className="py-0.5">
                  {canEdit && (
                    <span className="flex justify-end">
                      <button type="button" aria-label={`Edit widget ${w.hash}`}
                        className="grid h-7 w-7 place-items-center rounded text-brass hover:bg-white"
                        onClick={() => { setCopied(false); setDraft({ ...w }); }}>
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete widget ${w.hash}`}
                        className="grid h-7 w-7 place-items-center rounded text-brass hover:bg-white"
                        onClick={() => {
                          if (!confirm(`Delete widget ${w.hash}? Its embed code stops showing a widget.`)) return;
                          run(async () => {
                            const result = await deleteBookingWidget(w.id);
                            if (result.ok && draft?.id === w.id) setDraft(null);
                            return result;
                          }, `Widget ${w.hash} deleted.`);
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
        {canEdit && (
          <button type="button" className="mt-2 text-[12px] text-brass hover:underline"
            onClick={() => { setCopied(false); setDraft({ ...NEW_WIDGET, id: null, hash: null }); }}>
            Create new widget
          </button>
        )}
      </section>

      {draft && (
        <form
          className={cn(card, "px-4 py-5 sm:px-6")}
          onSubmit={(e) => {
            e.preventDefault();
            save(draft);
          }}
        >
          <h3 className="border-b border-line pb-2 text-[15px] text-ink">
            {draft.hash ? `Booking Widget ${draft.hash}` : "New Booking Widget"}
          </h3>
          <div className="mt-3 space-y-3">
            <TextField label="Title Text" value={draft.titleText} onChange={(titleText) => set({ titleText })} />
            <TextField label="Button Text" value={draft.buttonText} onChange={(buttonText) => set({ buttonText })} />
            <TextField label="Check-In Text" value={draft.checkInText} onChange={(checkInText) => set({ checkInText })} />
            <TextField label="Check-Out Text" value={draft.checkOutText} onChange={(checkOutText) => set({ checkOutText })} />
            <TextField label="Nights Text" value={draft.nightsText} onChange={(nightsText) => set({ nightsText })} />
            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.showOccupancy}
                onChange={(e) => set({ showOccupancy: e.target.checked })} />
              Show occupancy options
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <input type="checkbox" className="h-4 w-4 accent-brass" checked={draft.useCheckoutDate}
                onChange={(e) => set({ useCheckoutDate: e.target.checked })} />
              Use Checkout Date Instead Nights Count
            </label>
            <TextField label="Month names" value={draft.monthNames} onChange={(monthNames) => set({ monthNames })} />
            <TextField label="Week day names" value={draft.weekdayNames} onChange={(weekdayNames) => set({ weekdayNames })} />
            <ColorField label="Primary color" value={draft.primaryColor} onChange={(primaryColor) => set({ primaryColor })} />
            <ColorField label="Text color" value={draft.textColor} onChange={(textColor) => set({ textColor })} />
            <ColorField label="Background color" value={draft.backgroundColor} onChange={(backgroundColor) => set({ backgroundColor })} />
            <ColorField label="Label color" value={draft.labelColor} onChange={(labelColor) => set({ labelColor })} />
            <ColorField label="Border color" value={draft.borderColor} onChange={(borderColor) => set({ borderColor })} />
            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <div />
              <div>
                <select aria-label="Language (optional)" value={draft.language ?? ""}
                  onChange={(e) => set({ language: e.target.value || null })}
                  className={cn(line, "cursor-pointer", !draft.language && "text-ink-muted")}>
                  <option value="">Language (optional)</option>
                  {LOCALES.filter((l) => supportedLocales.includes(l.code)).map((l) => (
                    <option key={l.code} value={l.code} className="text-ink">{l.label}</option>
                  ))}
                </select>
                {!draft.hash && <p className="mt-1 text-[11px] text-ink">Save widget to get embed code</p>}
              </div>
            </div>
            {embed && (
              <div>
                <span className={small}>Embed code</span>
                <textarea readOnly value={embed} rows={3} onFocus={(e) => e.target.select()}
                  className="mt-1 w-full rounded border border-line bg-shell px-2.5 py-2 font-mono text-[11.5px] text-ink" />
                <div className="mt-1 flex items-center gap-4 text-[12px]">
                  <button type="button" className="text-brass hover:underline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(embed);
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <a href={`/book/widget/${draft.hash}`} target="_blank" rel="noopener" className="text-brass hover:underline">
                    Open
                  </a>
                </div>
              </div>
            )}
          </div>
          {canEdit && (
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className={secondary} onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" className={primary} disabled={pending}>Save</button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
