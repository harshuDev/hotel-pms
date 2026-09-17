"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import { savePromotion } from "@/lib/actions/promotions";
import type { Promotion, PromotionKind, RatePlan } from "@/lib/types";

const DOW = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const KINDS: { value: PromotionKind; label: string; hint: string }[] = [
  {
    value: "percent_off",
    label: "Percentage off",
    hint: "Comes off every night the promotion covers.",
  },
  {
    value: "amount_off",
    label: "Amount off a night",
    hint: "A fixed sum off each night, never more than the night costs.",
  },
  {
    value: "free_nights",
    label: "Stay N, pay M",
    hint: "The cheapest qualifying nights go to zero. Stay 3 pay 2 gives one free night in every three.",
  },
];

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

/** What a promotion takes off, as a phrase rather than a column of nulls. */
function describe(p: Promotion) {
  switch (p.kind) {
    case "percent_off":
      return `${((p.percentBps ?? 0) / 100).toFixed(
        (p.percentBps ?? 0) % 100 === 0 ? 0 : 2,
      )}% off`;
    case "amount_off":
      return `${formatMoney(p.amountOffCents ?? 0)} off a night`;
    case "free_nights":
      return `Stay ${(p.paidNights ?? 0) + (p.freeNights ?? 0)}, pay ${p.paidNights ?? 0}`;
  }
}

/** The conditions, in the order a person would read them out. */
function conditions(p: Promotion): string[] {
  const out: string[] = [];
  if (p.minNights && p.maxNights) out.push(`${p.minNights}–${p.maxNights} nights`);
  else if (p.minNights) out.push(`${p.minNights}+ nights`);
  else if (p.maxNights) out.push(`up to ${p.maxNights} nights`);

  if (p.minAdvanceDays) out.push(`booked ${p.minAdvanceDays}+ days ahead`);
  if (p.maxAdvanceDays !== null && p.maxAdvanceDays !== undefined)
    out.push(`booked within ${p.maxAdvanceDays} days`);

  if (p.arrivalDaysOfWeek && p.arrivalDaysOfWeek.length > 0) {
    out.push(
      `arriving ${p.arrivalDaysOfWeek
        .map((d) => DOW.find((x) => x.value === d)?.label ?? d)
        .join(", ")}`,
    );
  }
  if (p.stayFrom || p.stayTo) {
    out.push(
      `nights ${p.stayFrom ? format(parseISO(p.stayFrom), "d MMM") : "any"} to ${
        p.stayTo ? format(parseISO(p.stayTo), "d MMM") : "any"
      }`,
    );
  }
  if (p.sellFrom || p.sellTo) {
    out.push(
      `sold ${p.sellFrom ? format(parseISO(p.sellFrom), "d MMM") : "any"} to ${
        p.sellTo ? format(parseISO(p.sellTo), "d MMM") : "any"
      }`,
    );
  }
  return out;
}

const EMPTY = {
  id: null as string | null,
  name: "",
  code: "",
  description: "",
  kind: "percent_off" as PromotionKind,
  percent: "",
  amount: "",
  freeNights: "1",
  paidNights: "2",
  sellFrom: "",
  sellTo: "",
  stayFrom: "",
  stayTo: "",
  minNights: "",
  maxNights: "",
  minAdvanceDays: "",
  maxAdvanceDays: "",
  arrivalDaysOfWeek: [] as number[],
  ratePlanIds: [] as string[],
  roomTypeIds: [] as string[],
  priority: "0",
  isActive: true,
};

export function PromotionsScreen({
  promotions,
  ratePlans,
  roomTypes,
  canEdit,
}: {
  promotions: Promotion[];
  ratePlans: RatePlan[];
  roomTypes: { id: string; code: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function edit(p: Promotion) {
    setMessage(null);
    setForm({
      id: p.promotionId,
      name: p.name,
      code: p.code ?? "",
      description: p.description ?? "",
      kind: p.kind,
      percent: p.percentBps === null ? "" : String(p.percentBps / 100),
      amount: p.amountOffCents === null ? "" : String(p.amountOffCents / 100),
      freeNights: String(p.freeNights ?? 1),
      paidNights: String(p.paidNights ?? 2),
      sellFrom: p.sellFrom ?? "",
      sellTo: p.sellTo ?? "",
      stayFrom: p.stayFrom ?? "",
      stayTo: p.stayTo ?? "",
      minNights: p.minNights === null ? "" : String(p.minNights),
      maxNights: p.maxNights === null ? "" : String(p.maxNights),
      minAdvanceDays: p.minAdvanceDays === null ? "" : String(p.minAdvanceDays),
      maxAdvanceDays: p.maxAdvanceDays === null ? "" : String(p.maxAdvanceDays),
      arrivalDaysOfWeek: p.arrivalDaysOfWeek ?? [],
      ratePlanIds: [],
      roomTypeIds: [],
      priority: String(p.priority),
      isActive: p.isActive,
    });
  }

  function num(value: string): number | null {
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }

  function submit() {
    if (!form) return;
    setMessage(null);

    let amountCents: number | null = null;
    if (form.kind === "amount_off") {
      try {
        amountCents = parseMoney(form.amount);
      } catch {
        setMessage({ ok: false, text: "That is not an amount. Try 25 or 25.50." });
        return;
      }
    }

    const percent = form.percent.trim() === "" ? null : Number(form.percent);
    if (form.kind === "percent_off" && (percent === null || Number.isNaN(percent))) {
      setMessage({ ok: false, text: "Enter a percentage, like 15." });
      return;
    }

    startTransition(async () => {
      const result = await savePromotion({
        id: form.id,
        name: form.name,
        code: form.code,
        description: form.description,
        kind: form.kind,
        // Basis points, like every other rate here: 15% is 1500.
        percentBps: percent === null ? null : Math.round(percent * 100),
        amountOffCents: amountCents,
        freeNights: num(form.freeNights),
        paidNights: num(form.paidNights),
        sellFrom: form.sellFrom,
        sellTo: form.sellTo,
        stayFrom: form.stayFrom,
        stayTo: form.stayTo,
        minNights: num(form.minNights),
        maxNights: num(form.maxNights),
        minAdvanceDays: num(form.minAdvanceDays),
        maxAdvanceDays: num(form.maxAdvanceDays),
        arrivalDaysOfWeek: form.arrivalDaysOfWeek,
        ratePlanIds: form.ratePlanIds,
        roomTypeIds: form.roomTypeIds,
        priority: num(form.priority) ?? 0,
        isActive: form.isActive,
      });

      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setForm(null);
      setMessage({ ok: true, text: `${form.name} saved.` });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex items-center justify-between rounded-lg border border-line bg-white px-5 py-4 shadow-card">
          <p className="max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            A promotion reduces what a stay costs. It is not a second price
            list — the rate plan still says what a room is worth, and the
            reduction is recorded against the nights so every revenue figure
            nets it off. When several qualify, the one that saves the guest most
            wins; they never stack.
          </p>
          <button
            onClick={() => {
              setMessage(null);
              setForm({ ...EMPTY });
            }}
            className="shrink-0 rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900"
          >
            New promotion
          </button>
        </div>
      )}

      {message && (
        <p
          className={cn(
            "rounded-md px-3 py-2.5 text-[13px] leading-relaxed",
            message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700",
          )}
        >
          {message.text}
        </p>
      )}

      {form && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-card">
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            {form.id ? "Edit promotion" : "New promotion"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="p-name" className={label}>Name</label>
              <input
                id="p-name"
                value={form.name}
                placeholder="Winter early bird"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="p-code" className={label}>Code</label>
              <input
                id="p-code"
                value={form.code}
                placeholder="Leave blank to apply automatically"
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="p-priority" className={label}>Priority</label>
              <input
                id="p-priority"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className={cn(field, "tnum")}
              />
              <p className="mt-1 text-xxs text-ink-faint">Breaks a tie only.</p>
            </div>

            <div className="sm:col-span-4">
              <span className={label}>What it takes off</span>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setForm({ ...form, kind: k.value })}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-[13px]",
                      form.kind === k.value
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">
                {KINDS.find((k) => k.value === form.kind)?.hint}
              </p>
            </div>

            {form.kind === "percent_off" && (
              <div>
                <label htmlFor="p-pct" className={label}>Percent off</label>
                <input
                  id="p-pct"
                  value={form.percent}
                  inputMode="decimal"
                  placeholder="15"
                  onChange={(e) => setForm({ ...form, percent: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </div>
            )}
            {form.kind === "amount_off" && (
              <div>
                <label htmlFor="p-amt" className={label}>Off each night</label>
                <input
                  id="p-amt"
                  value={form.amount}
                  inputMode="decimal"
                  placeholder="25.00"
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className={cn(field, "tnum")}
                />
              </div>
            )}
            {form.kind === "free_nights" && (
              <>
                <div>
                  <label htmlFor="p-paid" className={label}>Nights paid for</label>
                  <input
                    id="p-paid"
                    value={form.paidNights}
                    inputMode="numeric"
                    onChange={(e) => setForm({ ...form, paidNights: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
                <div>
                  <label htmlFor="p-free" className={label}>Nights free</label>
                  <input
                    id="p-free"
                    value={form.freeNights}
                    inputMode="numeric"
                    onChange={(e) => setForm({ ...form, freeNights: e.target.value })}
                    className={cn(field, "tnum")}
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="p-sf" className={label}>Sold from</label>
              <input id="p-sf" type="date" value={form.sellFrom}
                onChange={(e) => setForm({ ...form, sellFrom: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-st" className={label}>Sold to</label>
              <input id="p-st" type="date" value={form.sellTo}
                onChange={(e) => setForm({ ...form, sellTo: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-yf" className={label}>Nights from</label>
              <input id="p-yf" type="date" value={form.stayFrom}
                onChange={(e) => setForm({ ...form, stayFrom: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-yt" className={label}>Nights to</label>
              <input id="p-yt" type="date" value={form.stayTo}
                onChange={(e) => setForm({ ...form, stayTo: e.target.value })}
                className={cn(field, "tnum")} />
            </div>

            <div>
              <label htmlFor="p-min" className={label}>Min nights</label>
              <input id="p-min" value={form.minNights} inputMode="numeric"
                onChange={(e) => setForm({ ...form, minNights: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-max" className={label}>Max nights</label>
              <input id="p-max" value={form.maxNights} inputMode="numeric"
                onChange={(e) => setForm({ ...form, maxNights: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-adv" className={label}>Booked at least (days ahead)</label>
              <input id="p-adv" value={form.minAdvanceDays} inputMode="numeric"
                onChange={(e) => setForm({ ...form, minAdvanceDays: e.target.value })}
                className={cn(field, "tnum")} />
            </div>
            <div>
              <label htmlFor="p-last" className={label}>Booked within (days)</label>
              <input id="p-last" value={form.maxAdvanceDays} inputMode="numeric"
                onChange={(e) => setForm({ ...form, maxAdvanceDays: e.target.value })}
                className={cn(field, "tnum")} />
            </div>

            <div className="sm:col-span-2">
              <span className={label}>Only for arrivals on</span>
              <div className="flex flex-wrap gap-1">
                {DOW.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        arrivalDaysOfWeek: form.arrivalDaysOfWeek.includes(d.value)
                          ? form.arrivalDaysOfWeek.filter((x) => x !== d.value)
                          : [...form.arrivalDaysOfWeek, d.value],
                      })
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs",
                      form.arrivalDaysOfWeek.includes(d.value)
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className={label}>Rate plans</span>
              <div className="flex flex-wrap gap-1">
                {ratePlans.map((rp) => (
                  <button
                    key={rp.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        ratePlanIds: form.ratePlanIds.includes(rp.id)
                          ? form.ratePlanIds.filter((x) => x !== rp.id)
                          : [...form.ratePlanIds, rp.id],
                      })
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs",
                      form.ratePlanIds.includes(rp.id)
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {rp.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xxs text-ink-faint">None picked means every plan.</p>
            </div>
            <div>
              <span className={label}>Room types</span>
              <div className="flex flex-wrap gap-1">
                {roomTypes.map((rt) => (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        roomTypeIds: form.roomTypeIds.includes(rt.id)
                          ? form.roomTypeIds.filter((x) => x !== rt.id)
                          : [...form.roomTypeIds, rt.id],
                      })
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs",
                      form.roomTypeIds.includes(rt.id)
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {rt.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xxs text-ink-faint">None picked means every type.</p>
            </div>

            <div className="sm:col-span-4">
              <label htmlFor="p-desc" className={label}>Description</label>
              <input
                id="p-desc"
                value={form.description}
                placeholder="Optional — what staff should know about it"
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={field}
              />
            </div>
          </div>

          {form.id && (
            <label className="mt-4 flex items-center gap-2 text-[13px] text-ink-muted">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Live. Turning this off retires the promotion and frees its code for reuse.
            </label>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setForm(null)}
              className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-chrome-800 px-6 py-2.5 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save promotion"}
            </button>
          </div>
          {form.id && (
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              Saving replaces which rate plans and room types this applies to
              with whatever is picked above. Nothing is carried over, so check
              them even when only changing a date.
            </p>
          )}
        </div>
      )}

      {promotions.length === 0 ? (
        <div className="rounded-lg border border-line bg-white p-8 text-center shadow-card">
          <p className="font-display text-lg font-semibold tracking-tightest text-ink">
            No promotions yet
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
            {canEdit
              ? "Create one to take a percentage or an amount off, or to give a night free on a longer stay."
              : "A manager or administrator sets these up."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {promotions.map((p) => (
            <div
              key={p.promotionId}
              className={cn(
                "rounded-lg border bg-white p-5 shadow-card",
                p.isActive ? "border-line" : "border-line bg-shell/50",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                      {p.name}
                    </span>
                    <span className="rounded bg-brass/10 px-2 py-0.5 text-xxs font-medium text-brass">
                      {describe(p)}
                    </span>
                    {p.code ? (
                      <span className="tnum rounded bg-chrome-800 px-2 py-0.5 text-xxs font-medium text-white">
                        {p.code}
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xxs font-medium text-emerald-800">
                        Automatic
                      </span>
                    )}
                    {!p.isActive && (
                      <span className="rounded bg-line px-2 py-0.5 text-xxs font-medium text-ink-faint">
                        Retired
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p className="mt-1 text-[13px] text-ink-muted">{p.description}</p>
                  )}
                  <p className="mt-1.5 text-xs text-ink-faint">
                    {conditions(p).length > 0
                      ? conditions(p).join(" · ")
                      : "No conditions — any qualifying stay"}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {p.ratePlanNames ?? "Every rate plan"} · {p.roomTypeNames ?? "Every room type"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-right">
                  <div>
                    <p className="tnum font-display text-lg font-semibold tracking-tightest text-ink">
                      {p.bookingsTaken}
                    </p>
                    <p className="text-xxs text-ink-faint">
                      booking{p.bookingsTaken === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div>
                    <p className="tnum font-display text-lg font-semibold tracking-tightest text-brass">
                      {formatMoney(p.discountGivenCents)}
                    </p>
                    <p className="text-xxs text-ink-faint">given away</p>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => edit(p)}
                      className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
