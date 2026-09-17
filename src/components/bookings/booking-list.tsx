import Link from "next/link";
import { format, parseISO } from "date-fns";
import { EmptyState, StatusBadge, cn } from "@/components/ui";
import { formatDue, formatMoney } from "@/lib/money";
import type { Booking } from "@/lib/types";

const COLS = [
  "Booking",
  "Room",
  "Arrival",
  "Departure",
  "Nights",
  "Guests",
  "Source",
  "Status",
  "Total",
  "Total Due",
];

/**
 * The operational booking list behind arrivals, departures and in house.
 *
 * Deliberately not the same table as /bookings: those three are worked from
 * the desk, so the room and the guest count earn their place and the booking
 * date does not.
 */
export function BookingList({
  rows,
  empty,
  hint,
}: {
  rows: Booking[];
  empty: string;
  hint: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        <EmptyState title={empty} hint={hint} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-ink-faint">
              {COLS.map((c, i) => (
                <th
                  key={c}
                  className={cn(
                    "whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                    i >= 8 && "text-right",
                    (i === 4 || i === 5) && "text-center",
                  )}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((b) => (
              <tr key={b.id} className="hover:bg-shell">
                <td className="whitespace-nowrap px-3 py-3 font-medium text-ink">
                  <Link
                    href={`/bookings/${b.id}`}
                    className="underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {b.reference}
                  </Link>
                  <span className="block text-xxs font-normal text-ink-faint">
                    {b.customerName}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={cn(
                      "tnum inline-grid h-7 min-w-[2.5rem] place-items-center rounded border px-1.5 text-xs font-medium",
                      b.roomNumber
                        ? "border-chrome-700 bg-chrome-700 text-white"
                        : "border-dashed border-line-strong text-ink-faint",
                    )}
                  >
                    {b.roomNumber ?? "—"}
                  </span>
                  <span className="mt-0.5 block text-xxs text-ink-faint">
                    {b.roomTypeName}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-muted">
                  {format(parseISO(b.arrivalDate), "d MMM yyyy")}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-muted">
                  {format(parseISO(b.departureDate), "d MMM yyyy")}
                </td>
                <td className="tnum px-3 py-3 text-center text-ink-muted">
                  {b.nights}
                </td>
                <td className="tnum px-3 py-3 text-center text-ink-muted">
                  {b.adults + b.children}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-ink-muted">
                  {b.channelName}
                  {b.settlement !== "at_property" && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      prepaid
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={b.status} />
                </td>
                <td className="tnum whitespace-nowrap px-3 py-3 text-right text-ink">
                  {formatMoney(b.totalCents)}
                </td>
                <td
                  className={cn(
                    "tnum whitespace-nowrap px-3 py-3 text-right font-medium",
                    b.balanceCents > 0 ? "text-rose-600" : "text-ink-muted",
                  )}
                >
                  {formatDue(b.balanceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
