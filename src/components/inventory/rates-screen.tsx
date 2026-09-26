"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import { applyRates } from "@/lib/actions/inventory";
import type { RatesGridCell } from "@/lib/types";
import { useCurrency } from "@/components/currency";

/**
 * Rates: every rate plan, under every room type, priced per night.
 *
 * The client asked for exactly this — "when you click on rates you will see the
 * room and then below the room all the rates and then you will be able to
 * change the price on those rates". A hotel sells Room Only, B&B and
 * Non-refundable on the same room, and the comparison anybody setting rates is
 * making is between those three prices side by side. The old screen took one
 * plan at a time behind a picker, so seeing three meant visiting it three times
 * and holding the numbers in your head.
 *
 * WHY THIS IS NOT A TENTH COPY OF THE INVENTORY GRID. The rule against that
 * covers the nine screens that are each one field across room types — they are
 * genuinely the same screen and share one component. This is one field across
 * TWO dimensions, plan and type. Folding it into the nine would mean every one
 * of them growing a rate-plan axis it has no use for.
 *
 * A BLANK CELL IS "NOT LOADED", NOT FREE. `create_booking()` refuses a stay
 * against a night with no rate, so a blank is also how a hotel says "we do not
 * sell this plan on this room type" — the link between plans and room types,
 * expressed as the absence of a price rather than a second table to maintain.
 */

const DOW = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 0, label: "S" },
];

const label =
  "mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint";
const field =
  "w-full rounded-md border border-line px-3 py-2 text-[13px] text-ink focus:border-brass focus:outline-none focus:ring-1 focus:ring-brass";

/** A selection is a (room type, rate plan) pair, so it needs a composite key. */
const pairKey = (roomTypeId: string, ratePlanId: string) =>
  `${roomTypeId}|${ratePlanId}`;

export function RatesScreen({
  cells,
  dates,
  from,
  canEdit,
}: {
  cells: RatesGridCell[];
  dates: string[];
  from: string;
  canEdit: boolean;
}) {
  const currency = useCurrency();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [editFrom, setEditFrom] = useState(from);
  const [editTo, setEditTo] = useState(dates[dates.length - 1] ?? from);
  const [dow, setDow] = useState<number[]>([]);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Room types in the order Postgres returned them, each carrying its plans.
  const groups = useMemo(() => {
    const types = new Map<
      string,
      {
        roomTypeId: string;
        roomTypeCode: string;
        roomTypeName: string;
        plans: Map<
          string,
          { ratePlanId: string; ratePlanCode: string; ratePlanName: string; isDefault: boolean }
        >;
      }
    >();
    for (const c of cells) {
      let t = types.get(c.roomTypeId);
      if (!t) {
        t = {
          roomTypeId: c.roomTypeId,
          roomTypeCode: c.roomTypeCode,
          roomTypeName: c.roomTypeName,
          plans: new Map(),
        };
        types.set(c.roomTypeId, t);
      }
      if (!t.plans.has(c.ratePlanId)) {
        t.plans.set(c.ratePlanId, {
          ratePlanId: c.ratePlanId,
          ratePlanCode: c.ratePlanCode,
          ratePlanName: c.ratePlanName,
          isDefault: c.ratePlanIsDefault,
        });
      }
    }
    return [...types.values()];
  }, [cells]);

  const at = useMemo(
    () => new Map(cells.map((c) => [`${c.roomTypeId}|${c.ratePlanId}|${c.date}`, c])),
    [cells],
  );

  function toggle(key: string) {
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }

  function toggleType(roomTypeId: string, planIds: string[]) {
    const keys = planIds.map((p) => pairKey(roomTypeId, p));
    const allOn = keys.every((k) => selected.includes(k));
    setSelected((s) =>
      allOn ? s.filter((k) => !keys.includes(k)) : [...new Set([...s, ...keys])],
    );
  }

  function apply() {
    const pairs = selected.map((k) => {
      const [roomTypeId, ratePlanId] = k.split("|");
      return { roomTypeId, ratePlanId };
    });

    // Blank clears the rate back to "not loaded". That is a real thing to want
    // — it takes a plan off sale for a room type — so it is not an error.
    const trimmed = value.trim();
    let cents: number | null = null;
    if (trimmed !== "") {
      const parsed = parseMoney(trimmed);
      if (parsed === null) {
        setMessage({ ok: false, text: "That is not an amount. Try 120 or 120.50." });
        return;
      }
      cents = parsed;
    }

    startTransition(async () => {
      const result = await applyRates({
        pairs,
        from: editFrom,
        to: editTo,
        daysOfWeek: dow,
        value: cents,
      });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({
        ok: true,
        text:
          cents === null
            ? `Cleared ${result.data.nightsWritten} night${result.data.nightsWritten === 1 ? "" : "s"}.`
            : `Set ${formatMoney(cents, currency)} on ${result.data.nightsWritten} night${result.data.nightsWritten === 1 ? "" : "s"}.`,
      });
      router.refresh();
    });
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-white p-4 text-[13px] text-ink-muted shadow-card">
        There are no rate plans yet, so there is nothing to price. Create one
        under{" "}
        <Link href="/settings?tab=rate-plans" className="underline underline-offset-2">
          Settings → Rate plans
        </Link>{" "}
        — a hotel usually has several, like Room Only, Bed and Breakfast and
        Non-refundable.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {message && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-[13px]",
            message.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-3 pb-2.5 text-left text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  Room type / rate
                </th>
                {dates.map((d) => {
                  const day = parseISO(d);
                  const weekend = [5, 6].includes(day.getDay());
                  return (
                    <th
                      key={d}
                      className={cn(
                        "min-w-[66px] px-1 pb-2.5 text-center text-xxs font-semibold uppercase tracking-[0.06em]",
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
              {groups.map((t) => {
                const plans = [...t.plans.values()];
                const keys = plans.map((p) => pairKey(t.roomTypeId, p.ratePlanId));
                const allOn = keys.every((k) => selected.includes(k));
                return (
                  <Fragment key={t.roomTypeId}>
                    {/* The room. Ticking it takes every rate under it. */}
                    <tr>
                      <td
                        colSpan={dates.length + 1}
                        className="sticky left-0 z-10 whitespace-nowrap border-t border-line bg-shell px-3 py-2"
                      >
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={allOn}
                            onChange={() => toggleType(t.roomTypeId, plans.map((p) => p.ratePlanId))}
                            disabled={!canEdit}
                            className="h-3.5 w-3.5 accent-brass"
                          />
                          <span className="font-medium text-ink">{t.roomTypeName}</span>
                          <span className="text-xxs text-ink-faint">
                            {t.roomTypeCode} · {plans.length} rate
                            {plans.length === 1 ? "" : "s"}
                          </span>
                        </label>
                      </td>
                    </tr>

                    {/* The rates sold on it. */}
                    {plans.map((p) => {
                      const key = pairKey(t.roomTypeId, p.ratePlanId);
                      return (
                        <tr key={key}>
                          <td className="sticky left-0 z-10 whitespace-nowrap border-t border-line bg-white px-3 py-1.5">
                            <label className="flex cursor-pointer items-center gap-2 pl-4">
                              <input
                                type="checkbox"
                                checked={selected.includes(key)}
                                onChange={() => toggle(key)}
                                disabled={!canEdit}
                                className="h-3.5 w-3.5 accent-brass"
                              />
                              <span className="text-ink">{p.ratePlanName}</span>
                              {p.isDefault && (
                                <span className="text-xxs text-ink-faint">main</span>
                              )}
                            </label>
                          </td>
                          {dates.map((d) => {
                            const cell = at.get(`${t.roomTypeId}|${p.ratePlanId}|${d}`);
                            const rate = cell?.rateCents ?? null;
                            return (
                              <td
                                key={d}
                                title={
                                  rate === null
                                    ? `${p.ratePlanName} is not loaded on ${t.roomTypeName} for ${format(parseISO(d), "d MMM")}, so it cannot be sold`
                                    : undefined
                                }
                                className={cn(
                                  "tnum border-t border-line px-1 py-1.5 text-center",
                                  rate === null
                                    ? "bg-rose-50/60 text-ink-faint"
                                    : "text-ink-muted",
                                )}
                              >
                                {/* A dash, not a blank and never a zero: no rate
                                    loaded is not the same as free, and a booking
                                    against it is refused. */}
                                {rate === null ? "—" : formatMoney(rate, currency)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          A dash means no rate is loaded for that rate on that room type, which
          is not the same as free — a booking against it is refused. That is also
          how a room type is taken off a rate: clear the price rather than
          looking for a switch. Rates are created and renamed under{" "}
          <Link href="/settings?tab=rate-plans" className="underline underline-offset-2">
            Settings → Rate plans
          </Link>
          .
        </p>
      </div>

      {canEdit && (
        <div className="rounded-lg border border-line bg-white p-4 shadow-card">
          <h2 className="mb-3 font-display text-[15px] tracking-tightest text-ink">
            Set a price
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={label} htmlFor="r-from">From</label>
              <input
                id="r-from"
                type="date"
                value={editFrom}
                onChange={(e) => setEditFrom(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label className={label} htmlFor="r-to">To</label>
              <input
                id="r-to"
                type="date"
                value={editTo}
                onChange={(e) => setEditTo(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label className={label} htmlFor="r-value">Rate a night</label>
              <input
                id="r-value"
                type="text"
                inputMode="decimal"
                value={value}
                placeholder="120.00, or blank to clear"
                onChange={(e) => setValue(e.target.value)}
                className={cn(field, "tnum")}
              />
            </div>
            <div>
              <span className={label}>Only these days</span>
              <div className="flex gap-1">
                {DOW.map((d, i) => (
                  <button
                    key={`${d.value}-${i}`}
                    type="button"
                    onClick={() =>
                      setDow((s) =>
                        s.includes(d.value)
                          ? s.filter((x) => x !== d.value)
                          : [...s, d.value],
                      )
                    }
                    className={cn(
                      "h-8 w-8 rounded border text-[12px]",
                      dow.includes(d.value)
                        ? "border-chrome-800 bg-chrome-800 text-white"
                        : "border-line text-ink-muted hover:bg-shell",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={apply}
              disabled={pending || selected.length === 0}
              className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900 disabled:opacity-50"
            >
              {pending ? "Applying…" : "Apply"}
            </button>
            <p className="text-xs text-ink-faint">
              {selected.length === 0
                ? "Tick the rates on the left to apply this to."
                : `${selected.length} rate${selected.length === 1 ? "" : "s"} selected. Leave the box empty to clear the price and take them off sale.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
