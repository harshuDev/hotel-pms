"use client";

import { useT } from "@/components/i18n";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";
import {
  DEFAULT_FOLIO_CSS,
  DEFAULT_FOLIO_LIQUID,
  TEMPLATE_VARIABLES,
} from "@/lib/invoice-template-defaults";
import { previewInvoiceTemplate, saveDocumentTemplate } from "@/lib/actions/settings";

/*
 * Settings -> Other -> Templates (0105), cloned from the client's reference:
 * "Folio/invoice template", Preview Folio Number, a Liquid editor and a CSS
 * editor side by side (each with an expand control), Is Active, PREVIEW,
 * LOAD DEFAULTS and SAVE TEMPLATE; "?" lists the variables and the columns
 * icon stacks or splits the editors.
 *
 * LIVE: an active template is what /bookings/[id]/invoice prints. The preview
 * is rendered and sanitised on the server exactly as the invoice is, then
 * shown in a sandboxed frame -- no script, no same origin -- so even a gap in
 * the sanitiser could not reach this session from here.
 *
 * Not copied: the pencil beside the title, whose action has not been seen.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const EDITOR_H = "h-[26rem]";

function CodeEditor({
  id,
  label,
  value,
  onChange,
  readOnly,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}) {
  const [full, setFull] = useState(false);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-ink">{label}</label>
      <div className={cn("relative flex overflow-hidden bg-[#272935]", full ? "fixed inset-0 z-50" : cn("rounded-sm", EDITOR_H))}>
        <div
          ref={gutter}
          aria-hidden="true"
          className="tnum w-10 shrink-0 select-none overflow-hidden py-2 pr-2 text-right font-mono text-[11.5px] leading-5 text-slate-500"
        >
          {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          id={id}
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          className="h-full min-w-0 flex-1 resize-none bg-transparent py-2 pr-10 font-mono text-[12px] leading-5 text-slate-100 caret-white outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass"
        />
        <button
          type="button"
          aria-label={full ? `Leave full screen, ${label}` : `Full screen, ${label}`}
          onClick={() => setFull(!full)}
          className="absolute bottom-2 right-3 grid h-7 w-7 place-items-center rounded text-white hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {full ? (
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            ) : (
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M4 4l6 6M20 4l-6 6M4 20l6-6M20 20l-6-6" />
            )}
          </svg>
        </button>
      </div>
    </div>
  );
}

export function TemplatesPanel({
  template,
  canEdit,
  pending,
  run,
}: {
  template: { liquid: string; css: string; isActive: boolean } | null;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const tr = useT();
  const [liquid, setLiquid] = useState(template?.liquid ?? "");
  const [css, setCss] = useState(template?.css ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? false);
  const [folioNumber, setFolioNumber] = useState("");
  const [stacked, setStacked] = useState(false);
  const [help, setHelp] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <div className="max-w-6xl space-y-4">
      <section className="rounded-lg border border-line bg-white shadow-card">
        <div className="relative flex items-center justify-between border-b border-line px-4 py-3 sm:px-6">
          <h2 className="text-[16px] text-ink">{tr("Folio/invoice template")}</h2>
          <div className="flex items-center gap-1 text-ink-muted">
            <button type="button" aria-label={tr("Template variables")} aria-expanded={help}
              onClick={() => setHelp(!help)}
              className="grid h-7 w-7 place-items-center rounded hover:bg-shell">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.4" strokeLinecap="round" />
                <circle cx="12" cy="17" r=".6" fill="currentColor" />
              </svg>
            </button>
            <button type="button" aria-label={stacked ? tr("Editors side by side") : tr("Editors one above the other")}
              aria-pressed={stacked}
              onClick={() => setStacked(!stacked)}
              className="grid h-7 w-7 place-items-center rounded hover:bg-shell">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                {stacked ? (
                  <path d="M3 4h18v7H3zM3 13h18v7H3z" />
                ) : (
                  <path d="M3 4h8v16H3zM13 4h8v16h-8z" />
                )}
              </svg>
            </button>
          </div>
          {help && (
            <div className="absolute right-4 top-12 z-20 w-[min(26rem,calc(100vw-3rem))] rounded-md border border-line bg-white p-3 text-[12px] shadow-card">
              <p className="mb-2 font-mono text-ink">{tr("{{ guest.name }}  {% for line in lines %}")}</p>
              <dl className="space-y-1.5">
                {TEMPLATE_VARIABLES.map((g) => (
                  <div key={g.name}>
                    <dt className="font-mono font-semibold text-ink">{g.name}</dt>
                    <dd className="font-mono text-ink-muted">{g.items.join(", ")}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-3">
          <input
            aria-label={tr("Preview Folio Number")}
            placeholder={tr("Preview Folio Number")}
            inputMode="numeric"
            value={folioNumber}
            onChange={(e) => setFolioNumber(e.target.value)}
            className="w-full max-w-xl border-0 border-b border-line bg-transparent px-0.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-brass"
          />
          <div className={cn("grid gap-3", !stacked && "lg:grid-cols-2")}>
            <CodeEditor id="template-liquid" label={tr("Liquid Editor")} value={liquid} onChange={setLiquid} readOnly={!canEdit} />
            <CodeEditor id="template-css" label={tr("CSS Editor")} value={css} onChange={setCss} readOnly={!canEdit} />
          </div>
          {preview !== null && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">{tr("Preview")}</span>
                <button type="button" aria-label={tr("Close preview")} onClick={() => setPreview(null)}
                  className="grid h-7 w-7 place-items-center rounded text-brass hover:bg-shell">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor"
                    strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <iframe
                title={tr("Template preview")}
                sandbox=""
                srcDoc={preview}
                className="h-[40rem] w-full rounded border border-line bg-white"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-shell/60 px-4 py-3 sm:px-6">
          {canEdit ? (
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" className="h-4 w-4 accent-brass" checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)} />
              {tr("Is Active")}
            </label>
          ) : (
            <span className="text-[13px] text-ink">{isActive ? tr("Active") : tr("Not active")}</span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              className="px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink hover:underline disabled:opacity-50"
              onClick={() =>
                run(async () => {
                  const result = await previewInvoiceTemplate({ folioNumber, liquid, css });
                  if (result.ok) {
                    setPreview(
                      `<!doctype html><html><head><meta charset="utf-8"><style>${result.data.css}</style></head><body>${result.data.html}</body></html>`,
                    );
                  }
                  return result;
                }, tr("Preview ready."))
              }
            >
              {tr("Preview")}
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  className="rounded-md border border-line bg-white px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell"
                  onClick={() => {
                    if ((liquid.trim() || css.trim()) && !confirm(tr("Replace both editors with the default template?"))) return;
                    setLiquid(DEFAULT_FOLIO_LIQUID);
                    setCss(DEFAULT_FOLIO_CSS);
                  }}
                >
                  {tr("Load Defaults")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="rounded-md bg-chrome-800 px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50"
                  onClick={() => run(() => saveDocumentTemplate({ liquid, css, isActive }), tr("Template saved."))}
                >
                  {tr("Save Template")}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
