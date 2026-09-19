import { Fragment } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { cn } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import type { InventoryCell } from "@/lib/types";

/**
 * Every inventory field at once, for one rate plan.
 *
 * The other nine screens each bring one field forward so it can be edited in
 * bulk. This one brings all of them forward and edits nothing — it answers "why
 * will this date not sell", which is a question no single-field screen can
 * answer because the reason is usually on a different screen from the one you
 * are looking at.
 *
 * READ ONLY, DELIBERATELY. Nine setters exist, one per field, each taking a
 * date range and a set of room types; a grid that edited any cell of any field
 * would either need a tenth generic setter — which the field coming from the
 * browser is exactly the argument against — or nine bulk editors stacked on one
 * screen. Each row heading links to the screen that does edit it, so this is
 * one click from the fix rather than a dead end.
 */

interface FieldRow {
  key: string;
  label: string;
  href: string;
  /** What the cell shows. Null renders as the "no rule" dash. */
  read: (c: InventoryCell) => string | null;
  /** A rule that is actively stopping a sale, so it can be marked. */
  blocking?: (c: InventoryCell) => boolean;
}

const ROWS: FieldRow[] = [
  {
    key: "rate",
    label: "Rate",
    href: "/inventory/rates-all",
    // A null rate is not free: nothing can be sold on this plan that night.
    read: (c) => (c.rateCents === null ? null : formatMoney(c.rateCents)),
    blocking: (c) => c.rateCents === null,
  },
  {
    key: "allotment",
    label: "Availability",
    href: "/inventory/availability",
    // The sellable figure, not the allotment: that is what can actually go.
    read: (c) => String(c.sellable),
    blocking: (c) => c.sellable <= 0,
  },
  {
    key: "sold",
    label: "Sold",
    href: "/inventory/availability",
    read: (c) => String(c.sold),
  },
  {
    key: "min_stay_through",
    label: "Min stay through",
    href: "/inventory/min-stay-through",
    read: (c) => (c.minStayThrough === null ? null : String(c.minStayThrough)),
  },
  {
    key: "min_stay_arrival",
    label: "Min stay arrival",
    href: "/inventory/min-stay-arrival",
    read: (c) => (c.minStayArrival === null ? null : String(c.minStayArrival)),
  },
  {
    key: "max_stay",
    label: "Max stay",
    href: "/inventory/max-stay",
    read: (c) => (c.maxStay === null ? null : String(c.maxStay)),
  },
  {
    key: "cta",
    label: "Closed to arrival",
    href: "/inventory/cta",
    read: (c) => (c.closedToArrival ? "Yes" : null),
    blocking: (c) => c.closedToArrival,
  },
  {
    key: "ctd",
    label: "Closed to departure",
    href: "/inventory/ctd",
    read: (c) => (c.closedToDeparture ? "Yes" : null),
    blocking: (c) => c.closedToDeparture,
  },
  {
    key: "stop_sell",
    label: "Stop sell",
    href: "/inventory/stop-sell",
    read: (c) => (c.stopSell ? "Yes" : null),
    blocking: (c) => c.stopSell,
  },
  {
    key: "close_out",
    label: "Close out",
    href: "/inventory/close-out",
    read: (c) => (c.closeOut ? "Yes" : null),
    blocking: (c) => c.closeOut,
  },
];

export function InventoryAll({ cells }: { cells: InventoryCell[] }) {
  const dates = [...new Set(cells.map((c) => c.date))].sort();
  const types = [...new Map(cells.map((c) => [c.roomTypeId, c])).values()];
  const at = new Map(cells.map((c) => [`${c.roomTypeId}|${c.date}`, c]));

  if (dates.length === 0 || types.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-white p-4 text-[13px] text-ink-muted shadow-card">
        No room types are set up yet, so there is nothing to show. Add one under
        Settings and the grid fills in.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-card">
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
              // One block of rows per room type, which is how every channel
              // manager draws this and how the reference's own All screen does.
              //
              // A real Fragment rather than <>: this is the element the map
              // returns, so it is the one that needs the key, and shorthand
              // fragments cannot take one.
              <Fragment key={t.roomTypeId}>
                <tr>
                  <td
                    colSpan={dates.length + 1}
                    className="sticky left-0 z-10 whitespace-nowrap border-t border-line bg-shell px-3 py-2 font-medium text-ink"
                  >
                    {t.roomTypeName}
                    <span className="ml-2 text-xxs font-normal text-ink-faint">
                      {t.physicalRooms} room{t.physicalRooms === 1 ? "" : "s"}
                      {t.outOfOrder > 0 ? `, ${t.outOfOrder} out of order` : ""}
                    </span>
                  </td>
                </tr>
                {ROWS.map((row) => (
                  <tr key={`${t.roomTypeId}-${row.key}`}>
                    <td className="sticky left-0 z-10 whitespace-nowrap border-t border-line bg-white px-3 py-1.5">
                      <Link
                        href={row.href}
                        className="text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                      >
                        {row.label}
                      </Link>
                    </td>
                    {dates.map((d) => {
                      const cell = at.get(`${t.roomTypeId}|${d}`);
                      const value = cell ? row.read(cell) : null;
                      const blocking = cell ? (row.blocking?.(cell) ?? false) : false;
                      return (
                        <td
                          key={d}
                          className={cn(
                            "tnum border-t border-line px-1 py-1.5 text-center",
                            blocking
                              ? "bg-rose-50 font-medium text-rose-600"
                              : value === null
                                ? "text-ink-faint"
                                : "text-ink-muted",
                          )}
                        >
                          {/* A dash, not a blank: "no rule" is an answer, and an
                              empty cell reads as a grid that failed to load. */}
                          {value ?? "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        Everything on this screen is read-only — each row heading links to the
        screen that sets it, where it can be applied across a date range and a
        set of room types at once. A dash means no rule, which is not the same as
        a rule of zero. Cells shaded rose are actively stopping a sale: no rate
        loaded, nothing left to sell, or a closure. Availability shows what can
        actually go, so rooms out of order are already off it.
      </p>
    </div>
  );
}
