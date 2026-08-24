import Link from "next/link";
import { format, parseISO } from "date-fns";
import { EmptyState, PageHeader, cn } from "@/components/ui";
import { formatDue, formatMoney } from "@/lib/money";
import { getCustomers } from "@/lib/mock/queries";

const TABS = [
  { key: "all", label: "All" },
  { key: "personal", label: "Personal" },
  { key: "company", label: "Company" },
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind ?? "all";
  const q = sp.q ?? "";
  const { rows, total, page, perPage } = await getCustomers({
    q,
    kind,
    page: Number(sp.page ?? 1),
  });
  const pages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-card">
      <PageHeader
        title="Customer Profiles"
        subtitle="Here you can manage all your customers and their history"
        action={
          <div className="flex gap-2">
            {["Create Customer", "Merge Selected", "Export to Excel"].map(
              (label) => (
                <button
                  key={label}
                  disabled
                  title="Available in Phase 2"
                  className="cursor-not-allowed rounded-md border border-line px-3 py-1.5 text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint"
                >
                  {label}
                </button>
              ),
            )}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-4">
        <form className="flex flex-1 gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name, email or phone"
            className="min-w-[220px] flex-1 rounded-md border border-line px-3.5 py-2 text-[13px] placeholder:text-ink-faint"
          />
          <input type="hidden" name="kind" value={kind} />
          <button className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900">
            Search
          </button>
        </form>
        <div className="flex items-center gap-2 text-sm">
          {TABS.map((t, i) => (
            <span key={t.key} className="flex items-center gap-2">
              {i > 0 && <span className="text-line">|</span>}
              <Link
                href={`/customers?kind=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={cn(
                  kind === t.key
                    ? "font-medium text-ink"
                    : "text-nav hover:underline",
                )}
              >
                {t.label}
              </Link>
            </span>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No customers match this search"
          hint="Search covers name, email and phone number."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  <th className="w-10 px-3 py-2.5" />
                  <th className="px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]">Name</th>
                  <th className="px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]">National Id Number</th>
                  <th className="px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]">Email</th>
                  <th className="px-3 pb-2.5 text-center text-xxs font-semibold uppercase tracking-[0.1em]">
                    Exclude from email
                  </th>
                  <th className="px-3 pb-2.5 text-center text-xxs font-semibold uppercase tracking-[0.1em]">
                    No of Bookings
                  </th>
                  <th className="px-3 pb-2.5 text-right text-xxs font-semibold uppercase tracking-[0.1em]">
                    Total Revenue
                  </th>
                  <th className="px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]">Last Booking Date</th>
                  <th className="px-3 pb-2.5 text-right text-xxs font-semibold uppercase tracking-[0.1em]">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-shell">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        disabled
                        className="h-3.5 w-3.5 accent-brass"
                        aria-label={`Select ${c.name}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-medium text-ink">{c.name}</span>
                      <span className="ml-1.5 text-xxs text-ink-faint">
                        Id: {c.ref}
                      </span>
                      {c.kind === "company" && (
                        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          company
                        </span>
                      )}
                    </td>
                    <td className="tnum px-3 py-3 text-ink-muted">
                      {c.nationalIdNumber ?? ""}
                    </td>
                    <td
                      className="max-w-[190px] truncate px-3 py-3 text-ink-muted"
                      title={c.email ?? ""}
                    >
                      {c.email ?? ""}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={c.excludeFromEmail}
                        readOnly
                        className="h-3.5 w-3.5 accent-brass"
                        aria-label="Excluded from email"
                      />
                    </td>
                    <td className="tnum px-3 py-3 text-center text-ink-muted">
                      {c.bookingCount}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-right text-ink">
                      {formatMoney(c.totalRevenueCents)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-muted">
                      {c.lastBookingDate
                        ? format(parseISO(c.lastBookingDate), "MMM d, yyyy")
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "tnum whitespace-nowrap px-3 py-3 text-right font-medium",
                        c.balanceCents > 0 ? "text-rose-600" : "text-ink-muted",
                      )}
                    >
                      {formatDue(c.balanceCents)}
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
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <Link
                  key={p}
                  href={`/customers?kind=${kind}&page=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                  className={cn(
                    "rounded px-3 py-1.5",
                    p === page
                      ? "bg-chrome-800 font-medium text-white"
                      : "border border-line hover:bg-shell",
                  )}
                >
                  {p}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
