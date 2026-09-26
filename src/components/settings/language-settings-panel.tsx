"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import type { LanguageSettings } from "@/lib/language-settings";
import { saveDefaultLanguage, saveSupportedLanguages } from "@/lib/actions/settings";

/*
 * Settings -> System Settings -> Language Settings (0078), cloned from the
 * client's reference: Default language and Supported languages, two cards
 * with a Save each, because they are two decisions.
 *
 * WIRED to the guest booking page: the default is the language a guest lands
 * on, and the supported set is what its language picker offers. The staff
 * application stays in English -- see CLAUDE.md.
 *
 * The reference's "LOCALE: ES" button beside the heading is not copied, as on
 * Hotel Details: it picks which language the hotel's own content is edited
 * in, and nothing here is stored per language.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-8 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const field =
  "w-full border-0 border-b border-line bg-transparent px-0.5 py-1.5 text-left text-[14px] text-ink outline-none focus:border-brass disabled:text-ink-muted";

const labelOf = (code: Locale) => LOCALES.find((l) => l.code === code)?.label ?? code;

export function LanguageSettingsPanel({
  settings,
  canEdit,
  pending,
  run,
}: {
  settings: LanguageSettings;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [defaultLocale, setDefaultLocale] = useState<Locale>(settings.defaultLocale);
  const [supported, setSupported] = useState<Locale[]>(settings.supportedLocales);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(code: Locale) {
    setSupported((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : LOCALES.map((l) => l.code).filter((c) => c === code || current.includes(c)),
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      <h2 className="border-b border-line pb-1 font-display text-[26px] font-semibold tracking-tightest text-ink">
        Language Settings
      </h2>

      <section className={cn(card, "overflow-hidden")}>
        <div className="px-6 pb-6 pt-7 sm:px-8">
          <h3 className="border-b border-line pb-1 text-[19px] text-ink">Default language</h3>
          <label htmlFor="default-language" className="mt-2 block text-[11.5px] text-ink-muted">
            Default language
          </label>
          {/* Only the languages the hotel supports -- the guest page falls
              back to this one, so it has to be one the page offers. */}
          <select
            id="default-language"
            value={defaultLocale}
            disabled={!canEdit}
            onChange={(e) => setDefaultLocale(e.target.value as Locale)}
            className={cn(field, "cursor-pointer")}
          >
            {settings.supportedLocales.map((code) => (
              <option key={code} value={code}>
                {labelOf(code)}
              </option>
            ))}
          </select>
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-line bg-shell/60 px-6 py-4 sm:px-8">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => saveDefaultLanguage(defaultLocale), "Default language saved.")}
              className={primary}
            >
              Save
            </button>
          </div>
        )}
      </section>

      <section className={card}>
        <div className="px-6 pb-6 pt-7 sm:px-8">
          <h3 className="text-[19px] text-ink">Supported languages</h3>
          <p className="border-b border-line pb-1 text-[14px] text-ink">
            Here you can choose subset of languages you want to support
          </p>
          <span id="locales-label" className="mt-2 block text-[11.5px] text-ink-muted">
            Locales
          </span>
          <div ref={pickerRef} className="relative">
            <button
              type="button"
              aria-labelledby="locales-label"
              aria-haspopup="listbox"
              aria-expanded={open}
              disabled={!canEdit}
              onClick={() => setOpen((o) => !o)}
              className={cn(field, "flex items-center justify-between gap-3")}
            >
              <span className="truncate">
                {supported.length === 0 ? "None" : supported.map(labelOf).join(", ")}
              </span>
              <span aria-hidden className="shrink-0 text-[11px] text-ink">
                ▼
              </span>
            </button>
            {open && (
              <ul
                role="listbox"
                aria-multiselectable="true"
                aria-labelledby="locales-label"
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lift"
              >
                {LOCALES.map((l) => (
                  <li key={l.code} role="option" aria-selected={supported.includes(l.code)}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[14px] text-ink hover:bg-shell">
                      <input
                        type="checkbox"
                        checked={supported.includes(l.code)}
                        onChange={() => toggle(l.code)}
                        className="h-4 w-4 accent-brass"
                      />
                      {l.label}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex justify-end rounded-b-lg border-t border-line bg-shell/60 px-6 py-4 sm:px-8">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                run(() => saveSupportedLanguages(supported), "Supported languages saved.");
              }}
              className={primary}
            >
              Save
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
