"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n";
import { cn } from "@/components/ui";
import { countriesIn } from "@/lib/countries";
import { CURRENCIES, currencyOptionLabel } from "@/lib/currencies";
import { addStaffMember, createProperty, switchProperty } from "@/lib/actions/platform";
import type { PlatformProperty, StaffRole } from "@/lib/types";

/*
 * Onboarding (0135). The client's own team sets every hotel up before the
 * hotel sees it: Add New Property creates it and moves the team member into
 * it, the existing Settings screens fill it in, and Add staff member puts
 * the hotel's manager -- invited from Supabase Auth -- on its staff.
 */

const label = "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";
const primary =
  "rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50";
const secondary =
  "rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink";

/** Every hotel, with Open and Add New Property. Drawn only for the platform team. */
export function PlatformHotels({
  properties,
  timezones,
  defaultTimezone,
  onEditCurrent,
}: {
  properties: PlatformProperty[];
  timezones: string[];
  defaultTimezone: string;
  /** The pencil on the hotel you are in: its check-in, check-out and audit times. */
  onEditCurrent: (() => void) | null;
}) {
  const tr = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", country: "", currency: "USD", timezone: defaultTimezone });
  const countries = countriesIn(tr);

  function open(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await switchProperty(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/settings?tab=property");
      router.refresh();
    });
  }

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await createProperty(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Straight into the new hotel's details, which is the next thing to fill in.
      router.push("/settings?tab=property");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h3 className="text-[16px] text-ink">{tr("Properties list")}</h3>
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className={primary}>
              {tr("+ Add New Property")}
            </button>
          )}
        </div>
        <div className="overflow-x-auto px-6 py-6">
          <table className="w-full min-w-[40rem] text-[13.5px]">
            <thead>
              <tr className="bg-shell text-left text-ink">
                <th className="w-[34%] px-4 py-4 font-normal">{tr("Property name")}</th>
                <th className="px-4 py-4 font-normal">{tr("Country")}</th>
                <th className="px-4 py-4 text-right font-normal">{tr("Rooms")}</th>
                <th className="px-4 py-4 text-right font-normal">{tr("Staff")}</th>
                <th className="w-32 px-4 py-4" aria-label={tr("Actions")} />
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => {
                const country = p.country ? countries.find((c) => c.code === p.country)?.name ?? p.country : "—";
                return (
                  <tr key={p.id} className={cn("border-b border-line", p.isCurrent && "bg-brass/[0.04]")}>
                    <td className="px-4 py-4 text-ink">
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xxs text-ink-faint">{p.currency}</span>
                    </td>
                    <td className="px-4 py-4 text-ink-muted">
                      {[p.city, country].filter((x) => x && x !== "—").join(", ") || "—"}
                    </td>
                    <td className="tnum px-4 py-4 text-right text-ink">{p.roomCount}</td>
                    <td className="tnum px-4 py-4 text-right text-ink">{p.staffCount}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-right">
                      {p.isCurrent ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="rounded bg-brass/10 px-1.5 py-0.5 text-xxs font-semibold text-brass">
                            {tr("Current")}
                          </span>
                          {onEditCurrent && (
                            <button
                              type="button"
                              onClick={onEditCurrent}
                              aria-label={tr("Edit {name}", { name: p.name })}
                              title={tr("Edit")}
                              className="rounded p-1 text-ink hover:bg-shell"
                            >
                              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M4 20h16" />
                                <path d="M14.5 5.5l3 3L8 18H5v-3z" />
                              </svg>
                            </button>
                          )}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => open(p.id)}
                          className="rounded-md border border-line px-3 py-1 text-[12.5px] text-ink hover:bg-shell disabled:opacity-50"
                        >
                          {tr("Open")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <div className="rounded-lg border border-line bg-white p-6 shadow-card sm:p-7">
          <h3 className="mb-5 font-display text-[18px] font-semibold tracking-tightest text-ink">
            {tr("Add New Property")}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className={label}>{tr("Property name")}</span>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={field}
              />
            </label>
            <label className="block">
              <span className={label}>{tr("Country")}</span>
              <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className={field}>
                <option value="">—</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>{tr("Currency")}</span>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={field}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{currencyOptionLabel(c.code)}</option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className={label}>{tr("Time zone")}</span>
              <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={field}>
                {(timezones.includes(form.timezone) ? timezones : [form.timezone, ...timezones]).map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className={secondary}>
              {tr("Cancel")}
            </button>
            <button type="button" onClick={add} disabled={pending} className={primary}>
              {pending ? tr("Saving…") : tr("Create property")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
      )}
    </div>
  );
}

/** Puts an invited login on this hotel's staff. */
export function AddStaffMember({
  roles,
}: {
  roles: { value: StaffRole; label: string }[];
}) {
  const tr = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ email: "", fullName: "", role: "front_desk" as StaffRole });
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function add() {
    setResult(null);
    startTransition(async () => {
      const r = await addStaffMember(form);
      if (!r.ok) {
        setResult({ ok: false, text: r.error });
        return;
      }
      setResult({ ok: true, text: tr("{name} added.", { name: form.fullName.trim() }) });
      setForm({ email: "", fullName: "", role: form.role });
      router.refresh();
    });
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="mb-3 text-[13.5px] font-semibold text-ink">{tr("Add staff member")}</h3>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1.2fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className={label}>{tr("Email")}</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>{tr("Name")}</span>
          <input
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>{tr("Role")}</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })} className={field}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>{tr(r.label)}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={add} disabled={pending} className={primary}>
          {pending ? tr("Saving…") : tr("Add")}
        </button>
      </div>
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={cn(
            "mt-3 rounded-md px-3 py-2 text-[13px]",
            result.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
          )}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
