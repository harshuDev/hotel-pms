import Link from "next/link";
import { format, parseISO } from "date-fns";
import { EmptyState, PageHeader, StatusBadge, cn } from "@/components/ui";
import { formatDue, formatMoney } from "@/lib/money";
import { getBookings } from "@/lib/mock/queries";

const STATUSES = [
  "all",
  "pending",
  "confirmed",
  "checked_in",
  "checked_out",
  "canceled",
  "no_show",
];

const COLS = [
  "Booking Reference",
  "Arrival Date",
  "Booking Date",
  "Nights",
  "Amount Of Rooms",
  "Booking Source",
  "Status",
  "Total",
  "Total Due",
];

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status ?? "all";
  const q = sp.q ?? "";
  const { rows, total, page, perPage } = await getBookings({
    q,
    status,
    page: Number(sp.page ?? 1),
  });
  const pages = Math.max(1, Math.ceil(total / perPage));

  const href = (next: Record<string, string>) => {
    const p = new URLSearchParams({ q, status, page: String(page), ...next });
    return `/bookings?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle="Every reservation across every channel"
      />
      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
      <form className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search bookings by reservation id, token or invoice number"
          className="min-w-[240px] flex-1 rounded-md border border-line px-3.5 py-2 text-[13px] placeholder:text-ink-faint"
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded-md border border-line px-3 py-2 text-[13px] capitalize"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <button className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No bookings match these filters"
          hint="Try clearing the search box or setting status back to all."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  {COLS.map((c, i) => (
                    <th
                      key={c}
                      className={cn(
                        "whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                        i >= 7 && "text-right",
                        (i === 3 || i === 4) && "text-center",
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
                      {b.reference}
                      <span className="block text-xxs font-normal text-ink-faint">
                        {b.customerName}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-muted">
                      {format(parseISO(b.arrivalDate), "MMM d, yyyy")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-muted">
                      {format(parseISO(b.bookedAt), "MMM d, yyyy")}
                    </td>
                    <td className="tnum px-3 py-3 text-center text-ink-muted">
                      {b.nights}
                    </td>
                    <td className="tnum px-3 py-3 text-center text-ink-muted">
                      {b.roomCount}
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

          <div className="mt-3 flex items-center justify-between text-sm text-ink-muted">
            <p>
              {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of{" "}
              {total}
            </p>
            <div className="flex gap-1">
              <Link
                href={href({ page: String(Math.max(1, page - 1)) })}
                className={cn(
                  "rounded-md border border-line px-3 py-1.5 hover:bg-shell",
                  page === 1 && "pointer-events-none opacity-40",
                )}
              >
                Previous
              </Link>
              <Link
                href={href({ page: String(Math.min(pages, page + 1)) })}
                className={cn(
                  "rounded-md border border-line px-3 py-1.5 hover:bg-shell",
                  page === pages && "pointer-events-none opacity-40",
                )}
              >
                Next
              </Link>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
