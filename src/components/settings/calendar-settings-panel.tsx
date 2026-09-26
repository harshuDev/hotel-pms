"use client";

import { useState } from "react";
import { cn } from "@/components/ui";
import {
  CALENDAR_COLORS,
  CALENDAR_SWITCHES,
  DEFAULT_CALENDAR_SETTINGS,
  isHexColor,
  type CalendarSettings,
} from "@/lib/calendar-settings";
import { saveCalendarSettings } from "@/lib/actions/settings";

/*
 * Settings -> System Settings -> Calendar Settings (0077), cloned from the
 * client's reference: seven colours, each a hex field beside a swatch you can
 * click to pick from, then nine switches, with Reset and Save at the foot.
 *
 * Reset puts the form back to the reference's values; nothing is stored until
 * Save, so a Reset pressed by mistake costs nothing.
 *
 * Which settings change the board and which are stored for later is in
 * `src/lib/calendar-settings.ts` and CLAUDE.md.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-8 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line bg-white px-6 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-ink hover:bg-shell disabled:opacity-50";

export function CalendarSettingsPanel({
  settings,
  canEdit,
  pending,
  run,
}: {
  settings: CalendarSettings;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [values, setValues] = useState<CalendarSettings>(settings);

  function save() {
    // Lower-cased the way Postgres stores them, so the field shows what was
    // saved rather than what was typed.
    const next = { ...values };
    for (const c of CALENDAR_COLORS) next[c.id] = next[c.id].trim().toLowerCase();
    run(async () => {
      const result = await saveCalendarSettings(next);
      if (result.ok) setValues(next);
      return result;
    }, "Calendar settings saved.");
  }

  return (
    <div className="max-w-4xl">
      <section className={card}>
        <h2 className="border-b border-line px-5 py-4 text-[19px] text-ink">Calendar Settings</h2>

        <div className="px-5 pb-6 pt-2">
          {CALENDAR_COLORS.map((c) => {
            const value = values[c.id];
            const valid = isHexColor(value);
            return (
              <div key={c.id} className="mt-5">
                <label htmlFor={`cal-${c.id}`} className="block text-[11.5px] text-ink-muted">
                  {c.label}
                </label>
                <div className="mt-1 grid grid-cols-2 gap-4 sm:gap-7">
                  <input
                    id={`cal-${c.id}`}
                    type="text"
                    value={value}
                    disabled={!canEdit}
                    spellCheck={false}
                    maxLength={7}
                    onChange={(e) => setValues({ ...values, [c.id]: e.target.value })}
                    aria-invalid={!valid}
                    className={cn(
                      "min-w-0 border-0 border-b bg-transparent px-0.5 py-1.5 text-[14px] text-ink outline-none focus:border-brass disabled:text-ink-muted",
                      valid ? "border-line" : "border-rose-500",
                    )}
                  />
                  <span className="flex items-center border-b border-line pb-1">
                    {/*
                      The swatch IS the colour picker, as the reference's is.
                      A typed value that is not yet a whole colour leaves the
                      swatch on the last one that was.
                    */}
                    <input
                      type="color"
                      aria-label={`Pick the ${c.label.toLowerCase()}`}
                      value={valid ? value.trim().toLowerCase() : c.default}
                      disabled={!canEdit}
                      onChange={(e) => setValues({ ...values, [c.id]: e.target.value })}
                      className="h-4 w-full cursor-pointer appearance-none border border-ink-faint bg-transparent p-0 disabled:cursor-default [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0"
                    />
                  </span>
                </div>
              </div>
            );
          })}

          <div className="mt-6 space-y-3">
            {CALENDAR_SWITCHES.map((s) => (
              <label key={s.id} className="flex items-center gap-2.5 text-[14px] text-ink">
                <input
                  type="checkbox"
                  checked={values[s.id]}
                  disabled={!canEdit}
                  onChange={(e) => setValues({ ...values, [s.id]: e.target.checked })}
                  className="h-[18px] w-[18px] accent-brass"
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center justify-between border-t border-line bg-shell/60 px-5 py-4">
            <button
              type="button"
              onClick={() => setValues(DEFAULT_CALENDAR_SETTINGS)}
              disabled={pending}
              className={secondary}
            >
              Reset
            </button>
            <button type="button" onClick={save} disabled={pending} className={primary}>
              Save
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
