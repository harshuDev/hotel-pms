"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDays, format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import {
  applyInventory,
  createRatePlan,
  setRatePlanPublic,
} from "@/lib/actions/inventory";
import { SCREENS } from "@/components/inventory/field-spec";
import type { InventoryCell, InventoryField, RatePlan } from "@/lib/types";

const DOW = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

export function InventoryScreen({
  fieldName,
  plans,
  planId,
  from,
  cells,
  nights,
  canEdit,
}: {
  fieldName: InventoryField;
  plans: RatePlan[];
  planId: string | null;
  from: string;
  cells: InventoryCell[];
  nights: number;
  canEdit: boolean;
}) {
  const spec = SCREENS[fieldName];
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const dates = useMemo(
    () => [...new Set(cells.map((c) => c.date))].sort(),
    [cells],
  );
  const types = useMemo(
    () => [...new Map(cells.map((c) => [c.roomTypeId, c])).values()],
    [cells],
  );
  const at = useMemo(
    () => new Map(cells.map((c) => [`${c.roomTypeId}|${c.date}`, c])),
    [cells],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [editFrom, setEditFrom] = useState(from);
  const [editTo, setEditTo] = useState(
    dates.length > 0 ? dates[dates.length - 1] : from,
  );
  const [dow, setDow] = useState<number[]>([]);
  const [value, setValue] = useState("");
  const [flag, setFlag] = useState(true);
  const [message, setMessage] = useState<
    { ok: boolean; text: string } | null
  >(null);

  const [newPlan, setNewPlan] = useState<{
    code: string;
    name: string;
  } | null>(null);

  function toggle<T>(list: T[], item: T, set: (next: T[]) => void) {
    set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  /** The grid cell as the reader of this screen wants to see it. */
  function show(cell: InventoryCell | undefined) {
    if (!cell) return "—";
    const raw = spec.read(cell);
    if (spec.kind === "flag") return raw ? "Yes" : "";
    if (raw === null) return spec.kind === "count" ? "All" : "—";
    if (spec.kind === "money") return formatMoney(raw as number);
    return String(raw);
  }

  function tone(cell: InventoryCell | undefined) {
    if (!cell) return "text-ink-faint";
    const raw = spec.read(cell);
    if (spec.kind === "flag") {
      return raw ? "bg-rose-50 font-semibold text-rose-700" : "text-ink-faint";
    }
    if (raw === null) {
      // No rate loaded is a problem; no stay rule is the normal state.
      return spec.kind === "money"
        ? "bg-warn-wash text-warn-deep"
        : "text-ink-faint";
    }
    return "text-ink";
  }

  function submit() {
    setMessage(null);

    let parsed: number | boolean | null;
    if (spec.kind === "flag") {
      parsed = flag;
    } else if (value.trim() === "") {
      parsed = null;
    } else if (spec.kind === "money") {
      try {
        parsed = parseMoney(value);
      } catch {
        setMessage({ ok: false, text: "That is not an amount. Try 120 or 120.50." });
        return;
      }
    } else {
      const n = Number(value);
      if (!Number.isSafeInteger(n)) {
        setMessage({ ok: false, text: "Enter a whole number, or leave it blank to clear." });
        return;
      }
      parsed = n;
    }

    startTransition(async () => {
      const result = await applyInventory({
        field: fieldName,
        ratePlanId: planId,
        roomTypeIds: selected,
        from: editFrom,
        to: editTo,
        daysOfWeek: dow,
        value: parsed,
      });

      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }

      const n = result.data.nightsWritten;
      setMessage({
        ok: true,
        text: `${spec.title} set on ${n} room-night${n === 1 ? "" : "s"}.`,
      });
      router.refresh();
    });
  }

  const selectedPlan = plans.find((p) => p.id === planId) ?? null;

  function publish(plan: { id: string; name: string }, isPublic: boolean) {
    setMessage(null);
    startTransition(async () => {
      const result = await setRatePlanPublic({ ratePlanId: plan.id, isPublic });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({
        ok: true,
        text: isPublic
          ? `${plan.name} is now on the guest booking page.`
          : `${plan.name} is off the guest booking page.`,
      });
      router.refresh();
    });
  }

  function addPlan() {
    if (!newPlan) return;
    startTransition(async () => {
      const result = await createRatePlan({
        code: newPlan.code,
        name: newPlan.name,
        description: "",
        isDefault: plans.length === 0,
      });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setNewPlan(null);
      setMessage({ ok: true, text: `Rate plan ${newPlan.name} created.` });
      router.refresh();
    });
  }

  const href = (params: { plan?: string | null; from?: string }) => {
    const q = new URLSearchParams();
    const p = params.plan !== undefined ? params.plan : planId;
    if (p) q.set("plan", p);
    q.set("from", params.from ?? from);
    return `?${q.toString()}`;
  };

  return (
    <div className="space-y-3">
      {/* Plan and dates ------------------------------------------------ */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-line bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          {spec.needsPlan && (
            <div className="min-w-[200px]">
              <span className={label}>Rate plan</span>
              {plans.length === 0 ? (
                <p className="text-[13px] text-ink-muted">None yet</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {plans.map((p) => (
                    <Link
                      key={p.id}
                      href={href({ plan: p.id })}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-[13px]",
                        p.id === planId
                          ? "border-chrome-800 bg-chrome-800 text-white"
                          : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                      )}
                    >
                      {p.name}
                      {p.isDefault && (
                        <span className="ml-1.5 text-xxs opacity-70">default</span>
                      )}
                      {p.isPublic && (
                        <span className="ml-1.5 text-xxs opacity-70">published</span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
              {selectedPlan && (
                <label className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
                  <input
                    type="checkbox"
                    checked={selectedPlan.isPublic}
                    disabled={pending}
                    onChange={(e) => publish(selectedPlan, e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Sell this rate on the guest booking page. Off means a
                    stranger never sees it — which is what a corporate or
                    negotiated rate wants.
                  </span>
                </label>
              )}
            </div>
          )}
          {!spec.needsPlan && (
            <p className="max-w-sm text-xs leading-relaxed text-ink-faint">
              This applies to the room type itself, on every rate plan at once,
              so there is no plan to pick.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={href({ from: format(addDays(parseISO(from), -nights), "yyyy-MM-dd") })}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
          >
            Earlier
          </Link>
          <Link
            href={href({ from: format(addDays(parseISO(from), nights), "yyyy-MM-dd") })}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
          >
            Later
          </Link>
        </div>
      </div>

      {spec.needsPlan && plans.length === 0 && (
        <div className="rounded-lg border border-line bg-white p-6 shadow-card">
          <p className="font-display text-[15px] font-semibold tracking-tightest text-ink">
            No rate plan yet
          </p>
          <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-ink-muted">
            A rate plan is what the hotel sells — Best Available, Corporate, a
            non-refundable rate. Prices and stay rules are loaded onto one, so
            there has to be one before anything can be set.
          </p>
          {canEdit ? (
            newPlan ? (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="plan-code" className={label}>
                    Code
                  </label>
                  <input
                    id="plan-code"
                    value={newPlan.code}
                    placeholder="BAR"
                    onChange={(e) =>
                      setNewPlan({ ...newPlan, code: e.target.value })
                    }
                    className={cn(field, "w-28")}
                  />
                </div>
                <div>
                  <label htmlFor="plan-name" className={label}>
                    Name
                  </label>
                  <input
                    id="plan-name"
                    value={newPlan.name}
                    placeholder="Best available rate"
                    onChange={(e) =>
                      setNewPlan({ ...newPlan, name: e.target.value })
                    }
                    className={cn(field, "w-64")}
                  />
                </div>
                <button
                  onClick={addPlan}
                  disabled={pending}
                  className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
                >
                  Create it
                </button>
                <button
                  onClick={() => setNewPlan(null)}
                  className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNewPlan({ code: "", name: "" })}
                className="mt-4 rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900"
              >
                New rate plan
              </button>
            )
          ) : (
            <p className="mt-3 text-[13px] text-ink-faint">
              A manager or administrator can create one.
            </p>
          )}
        </div>
      )}

      {/* The grid ------------------------------------------------------ */}
      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        {types.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">
            No room types are set up. Add room types and rooms before loading
            rates.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white px-3 pb-2.5 text-left text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                      Room type
                    </th>
                    {dates.map((d) => {
                      const day = parseISO(d);
                      const weekend = [5, 6].includes(day.getDay());
                      return (
                        <th
                          key={d}
                          className={cn(
                            "min-w-[54px] px-1 pb-2.5 text-center text-xxs font-semibold uppercase tracking-[0.06em]",
                            weekend ? "text-ink-muted" : "text-ink-faint",
                          )}
                        >
                          <span className="block">{format(day, "EEEEE")}</span>
                          <span className="tnum block text-[11px] font-normal">
                            {format(day, "d")}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.roomTypeId}>
                      <td className="sticky left-0 z-10 whitespace-nowrap border-t border-line bg-white px-3 py-2.5">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected.includes(t.roomTypeId)}
                            onChange={() =>
                              toggle(selected, t.roomTypeId, setSelected)
                            }
                            disabled={!canEdit}
                          />
                          <span className="font-medium text-ink">
                            {t.roomTypeName}
                          </span>
                        </label>
                      </td>
                      {dates.map((d) => {
                        const cell = at.get(`${t.roomTypeId}|${d}`);
                        return (
                          <td
                            key={d}
                            title={
                              cell
                                ? `${cell.sold} sold of ${cell.sellable} sellable`
                                : undefined
                            }
                            className={cn(
                              "tnum whitespace-nowrap border-t border-line px-1 py-2.5 text-center",
                              tone(cell),
                            )}
                          >
                            {show(cell)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              {spec.note} Rows are room types, not rooms — a property can run
              well over a thousand rooms and this grid is the same height
              whatever the count.
            </p>
          </>
        )}
      </div>

      {/* Bulk edit ------------------------------------------------------ */}
      {canEdit && types.length > 0 && (!spec.needsPlan || planId) && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-card">
          <h2 className="mb-4 font-display text-[15px] font-semibold tracking-tightest text-ink">
            Set {spec.title.toLowerCase()}
          </h2>

          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label htmlFor="edit-from" className={label}>
                From
              </label>
              <input
                id="edit-from"
                type="date"
                value={editFrom}
                onChange={(e) => setEditFrom(e.target.value)}
                className={cn(field, "tnum")}
              />
            </div>
            <div>
              <label htmlFor="edit-to" className={label}>
                To
              </label>
              <input
                id="edit-to"
                type="date"
                value={editTo}
                onChange={(e) => setEditTo(e.target.value)}
                className={cn(field, "tnum")}
              />
            </div>
            <div className="sm:col-span-2">
              <span className={label}>Only on these days</span>
              <div className="flex flex-wrap gap-1">
                {DOW.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggle(dow, d.value, setDow)}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs",
                      dow.includes(d.value)
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell hover:text-ink",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
                {dow.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDow([])}
                    className="rounded-md px-2 py-1.5 text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline"
                  >
                    Every day
                  </button>
                )}
              </div>
            </div>
            <div>
              <label htmlFor="edit-value" className={label}>
                {spec.valueLabel}
              </label>
              {spec.kind === "flag" ? (
                <select
                  id="edit-value"
                  value={flag ? "on" : "off"}
                  onChange={(e) => setFlag(e.target.value === "on")}
                  className={field}
                >
                  <option value="on">Yes</option>
                  <option value="off">No</option>
                </select>
              ) : (
                <input
                  id="edit-value"
                  type="text"
                  inputMode={spec.kind === "money" ? "decimal" : "numeric"}
                  value={value}
                  placeholder={spec.kind === "money" ? "120.00" : "Blank clears"}
                  onChange={(e) => setValue(e.target.value)}
                  className={cn(field, "tnum")}
                />
              )}
            </div>
            <div className="sm:col-span-3 flex items-end">
              <p className="text-xs leading-relaxed text-ink-faint">
                {selected.length === 0
                  ? "Tick the room types on the left to apply this to."
                  : `${selected.length} room type${selected.length === 1 ? "" : "s"} selected.`}
              </p>
            </div>
          </div>

          {message && (
            <p
              className={cn(
                "mt-4 rounded-md px-3 py-2.5 text-[13px] leading-relaxed",
                message.ok
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-rose-50 text-rose-700",
              )}
            >
              {message.text}
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={pending || selected.length === 0}
              className="rounded-md bg-chrome-800 px-6 py-2.5 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
            >
              {pending ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      )}

      {!canEdit && types.length > 0 && (
        <p className="rounded-lg border border-line bg-white px-5 py-4 text-[13px] leading-relaxed text-ink-muted shadow-card">
          You can read the inventory but not change it. Rates, restrictions and
          availability are set by managers and administrators.
        </p>
      )}
    </div>
  );
}
