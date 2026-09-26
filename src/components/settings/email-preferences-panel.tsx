"use client";

import { useState } from "react";
import { cn } from "@/components/ui";
import {
  EMAIL_PREFERENCES,
  type EmailPreferenceId,
  type HotelEmailSettings,
} from "@/lib/email-preferences";
import { saveHotelEmailSettings } from "@/lib/actions/settings";

/*
 * Settings -> Communications & Notifications -> Hotel Emails Preferences
 * (0074), cloned from the client's reference: General Settings (the addresses
 * notifications go to, as removable chips with an add field) and Email
 * preferences (a Name / Description / Active table), saved together.
 *
 * STORED, NOT YET LIVE: nothing in this system sends email yet. The choices
 * are kept so they are in place the moment it does. See CLAUDE.md.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-8 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";

export function EmailPreferencesPanel({
  settings,
  canEdit,
  pending,
  run,
}: {
  settings: HotelEmailSettings;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [emails, setEmails] = useState<string[]>(settings.notificationEmails);
  const [draft, setDraft] = useState("");
  const [prefs, setPrefs] = useState<Record<EmailPreferenceId, boolean>>(settings.preferences);

  function add() {
    const next = draft.trim().toLowerCase();
    if (!next) return;
    if (!emails.includes(next)) setEmails([...emails, next]);
    setDraft("");
  }

  function save() {
    // An address typed but not yet added with + goes in with the save, rather
    // than being silently dropped by it.
    const pendingAddress = draft.trim().toLowerCase();
    const list = pendingAddress && !emails.includes(pendingAddress) ? [...emails, pendingAddress] : emails;
    run(async () => {
      const result = await saveHotelEmailSettings({ notificationEmails: list, preferences: prefs });
      if (result.ok) {
        setEmails(list);
        setDraft("");
      }
      return result;
    }, "Email preferences saved.");
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
        Hotel Emails Preferences
      </h2>

      <section className={cn(card, "px-6 py-8 sm:px-10")}>
        <h3 className="border-b border-line pb-2 text-[20px] text-ink">General Settings</h3>
        <p className="mt-7 text-[12px] text-ink-muted" id="notify-label">
          Emails that will be used for notifications
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2" aria-labelledby="notify-label">
          {emails.map((e) => (
            <span
              key={e}
              className="inline-flex items-center gap-2 rounded-full bg-shell px-3 py-1.5 text-[14px] text-ink"
            >
              {e}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${e}`}
                  onClick={() => setEmails(emails.filter((x) => x !== e))}
                  className="grid h-5 w-5 place-items-center rounded-full text-ink-muted hover:bg-white hover:text-ink"
                >
                  <span aria-hidden="true" className="text-[15px] leading-none">✕</span>
                </button>
              )}
            </span>
          ))}
          {canEdit && (
            <span className="flex min-w-[14rem] flex-1 items-center gap-2">
              <input
                type="email"
                aria-label="Add an email address"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    add();
                  }
                }}
                className="min-w-0 flex-1 border-0 border-b border-line bg-transparent px-1 py-1.5 text-[14px] text-ink outline-none focus:border-brass"
              />
              <button
                type="button"
                aria-label="Add email address"
                onClick={add}
                className="grid h-8 w-8 place-items-center rounded text-[22px] leading-none text-ink-faint hover:bg-shell hover:text-ink"
              >
                +
              </button>
            </span>
          )}
        </div>
      </section>

      <section className={cn(card, "overflow-hidden")}>
        <div className="px-6 pt-8 sm:px-10">
          <h3 className="text-[20px] text-ink">Email preferences</h3>
          <p className="mt-1 border-b border-line pb-2 text-[14px] text-ink">
            Here you can choose what type of emails you want to receive
          </p>
          <table className="mt-4 w-full text-[13.5px]">
            <thead>
              <tr className="border-b-2 border-line text-left">
                <th className="w-[36%] py-2 pr-4 font-semibold text-ink">Name</th>
                <th className="py-2 pr-4 font-semibold text-ink">Description</th>
                <th className="w-16 py-2 text-center font-semibold text-ink">Active</th>
              </tr>
            </thead>
            <tbody>
              {EMAIL_PREFERENCES.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-3 pr-4 text-ink">{p.name}</td>
                  <td className="py-3 pr-4 text-ink">{p.description}</td>
                  <td className="py-3 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${p.name} active`}
                      checked={prefs[p.id]}
                      disabled={!canEdit}
                      onChange={(e) => setPrefs({ ...prefs, [p.id]: e.target.checked })}
                      className="h-5 w-5 accent-brass"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="mt-6 flex justify-end bg-shell/60 px-6 py-5 sm:px-10">
            <button type="button" onClick={save} disabled={pending} className={primary}>
              Save
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
