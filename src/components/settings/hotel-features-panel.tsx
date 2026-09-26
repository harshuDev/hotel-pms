"use client";

import { useState } from "react";
import { cn } from "@/components/ui";
import { HOTEL_FEATURES, type HotelFeatures } from "@/lib/hotel-features";
import { saveHotelFeatures } from "@/lib/actions/settings";

/*
 * Settings -> System Settings -> Hotel Features (0076), cloned from the
 * client's reference: a Name / Active table of switches, saved together.
 *
 * Four switches change this application today and the rest are stored for
 * when their feature exists -- `HOTEL_FEATURES` says which, and CLAUDE.md
 * lists them. The reference's "Superadmin settings" heading has nothing under
 * it on their screen and nothing here to put under it, so it is not drawn.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;

const card = "rounded-lg border border-line bg-white shadow-card";
const primary =
  "rounded-md bg-chrome-800 px-8 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-chrome-900 disabled:opacity-50";

export function HotelFeaturesPanel({
  features,
  canEdit,
  pending,
  run,
}: {
  features: HotelFeatures;
  canEdit: boolean;
  pending: boolean;
  run: Run;
}) {
  const [values, setValues] = useState<HotelFeatures>(features);

  function save() {
    run(() => saveHotelFeatures(values), "Hotel features saved.");
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="border-b border-line pb-1 font-display text-[26px] font-semibold tracking-tightest text-ink">
        Hotel Features
      </h2>

      <section className={cn(card, "overflow-hidden")}>
        <div className="px-6 pt-8 sm:px-10">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-2 pr-4 font-semibold text-ink">Name</th>
                <th className="w-20 py-2 text-center font-semibold text-ink">Active</th>
              </tr>
            </thead>
            <tbody>
              {HOTEL_FEATURES.map((f) => (
                <tr key={f.id} className="border-b border-line last:border-b-0">
                  <td className="py-3 pr-4 text-ink">
                    <label htmlFor={`feature-${f.id}`}>{f.label}</label>
                  </td>
                  <td className="py-3 text-center">
                    <input
                      id={`feature-${f.id}`}
                      type="checkbox"
                      checked={values[f.id]}
                      disabled={!canEdit}
                      onChange={(e) => setValues({ ...values, [f.id]: e.target.checked })}
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
