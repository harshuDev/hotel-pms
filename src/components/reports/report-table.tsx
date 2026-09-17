import { EmptyState, cn } from "@/components/ui";

/**
 * The table every report shares.
 *
 * Ten reports differ in their columns and in nothing else, and ten hand-rolled
 * copies of the same thead/tbody drift apart within a fortnight. A column
 * describes its own header, alignment, cell and footer, so a page is a list of
 * columns rather than a page of markup.
 */
export interface ReportColumn<T> {
  header: string;
  /** Figures go right, everything else left. */
  align?: "left" | "right";
  cell: (row: T) => React.ReactNode;
  /** Rendered in the footer row. Omit for no total under this column. */
  foot?: React.ReactNode;
}

export function ReportTable<T>({
  columns,
  rows,
  rowKey,
  minWidth = "760px",
  emptyTitle,
  emptyHint,
  footLabel,
  note,
}: {
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  minWidth?: string;
  emptyTitle: string;
  emptyHint: string;
  /** Sits in the first column of the footer, e.g. "12 bookings". */
  footLabel?: React.ReactNode;
  note?: React.ReactNode;
}) {
  const hasFoot = footLabel !== undefined || columns.some((c) => c.foot !== undefined);

  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-card">
      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth }}>
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  {columns.map((c) => (
                    <th
                      key={c.header}
                      className={cn(
                        "whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                        c.align === "right" && "text-right",
                      )}
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={rowKey(row)} className="hover:bg-shell">
                    {columns.map((c) => (
                      <td
                        key={c.header}
                        className={cn(
                          "px-3 py-2.5 align-top",
                          c.align === "right" && "tnum whitespace-nowrap text-right",
                        )}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {hasFoot && (
                <tfoot>
                  <tr className="border-t border-line-strong">
                    {columns.map((c, i) => (
                      <td
                        key={c.header}
                        className={cn(
                          "px-3 pt-3 font-semibold text-ink",
                          c.align === "right" && "tnum whitespace-nowrap text-right",
                        )}
                      >
                        {c.foot ?? (i === 0 ? footLabel : null)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {note && (
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">{note}</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Shown instead of a report when the signed-in role may not see revenue.
 *
 * Housekeeping is refused in Postgres, not here — this only explains the
 * refusal. Showing an empty report instead would read as "the hotel took
 * nothing today", which is worse than saying no.
 */
export function ReportNoAccess() {
  return (
    <div className="rounded-lg border border-line bg-white p-8 text-center shadow-card">
      <p className="font-display text-lg font-semibold tracking-tightest text-ink">
        This report is not available to your role
      </p>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
        Revenue and payment reports are open to front desk, cashier, manager and
        admin accounts. Ask a manager if you need access.
      </p>
    </div>
  );
}
