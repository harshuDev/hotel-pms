"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/components/ui";
import { useT } from "@/components/i18n";
import { saveOwnLocale } from "@/lib/actions/profile";
import { STAFF_LOCALES, type StaffLocale } from "@/lib/i18n/staff-locales";

/*
 * The language switch in the user menu (0106), cloned from the client's
 * reference: the twelve codes in a grid of four, and a confirmation before
 * the page reloads in the chosen language.
 *
 * THIS IS WHY THE MENU HAS A LANGUAGE ITEM AGAIN. It was taken out because the
 * staff app spoke only English, so the control changed nothing; the app is
 * translated now, and this changes every screen.
 */

/** The grid, inside the user menu. Each code is a menu item the arrow keys reach. */
export function LanguageChoices({ onChoose }: { onChoose: (locale: StaffLocale) => void }) {
  const tr = useT();
  return (
    <div role="group" aria-label={tr("Language")} className="grid grid-cols-4 gap-0.5 border-y border-line px-1 py-1.5">
      {STAFF_LOCALES.map((l) => {
        const current = l.code === tr.locale;
        return (
          <button
            key={l.code}
            type="button"
            data-menu-item
            role="menuitemradio"
            aria-checked={current}
            aria-label={l.label}
            title={l.label}
            onClick={() => onChoose(l.code)}
            className={cn(
              "rounded px-1 py-1.5 text-center text-[12px] outline-none transition-colors",
              "focus-visible:bg-brass-wash focus-visible:text-brass",
              current ? "bg-brass-wash font-semibold text-brass" : "text-ink-muted hover:bg-shell hover:text-ink",
            )}
          >
            {l.code}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "You're changing the language": Cancel or Confirm. Confirm saves the choice
 * and reloads, so every Server Component is rendered again in it. Portalled
 * to <body>, because the top bar is a sticky z-50 stacking context -- the
 * trap the calendar's room menu documents.
 */
export function LanguageConfirm({ locale, onCancel }: { locale: StaffLocale; onCancel: () => void }) {
  const tr = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 px-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="language-confirm-title"
        aria-describedby="language-confirm-body"
        className="w-full max-w-lg rounded-md bg-white p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="language-confirm-title" className="text-[16px] font-semibold text-ink">
          {tr("Confirm")}
        </h2>
        <p id="language-confirm-body" className="mt-2 text-[13px] text-ink">
          {tr("You're changing the language. The page will reload, so save anything you are working on first.")}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-[12.5px] text-rose-700">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-brass hover:bg-shell"
          >
            {tr("Cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              const result = await saveOwnLocale(locale);
              if (!result.ok) {
                setPending(false);
                setError(result.error);
                return;
              }
              window.location.reload();
            }}
            className="rounded bg-shell px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-brass hover:bg-line disabled:opacity-50"
          >
            {tr("Confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
