import { format, parseISO } from "date-fns";
import { PageHeader } from "@/components/ui";
import type { DateRange } from "@/lib/reports";

/**
 * The frame every report shares: a heading, an optional date range, and the
 * report itself. The range is a plain GET form, so a report is a URL that can
 * be bookmarked and sent to someone.
 */
export function ReportShell({
  title,
  subtitle,
  action,
  range,
  date,
  children,
}: {
  title: string;
  subtitle: string;
  action?: string;
  range?: DateRange;
  /** For a report that runs for one day rather than a range. */
  date?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={
          date && action ? (
            <form action={action} className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  htmlFor="date"
                  className="mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint"
                >
                  Business date
                </label>
                <input
                  id="date"
                  type="date"
                  name="date"
                  defaultValue={date}
                  className="tnum rounded-md border border-line px-3 py-1.5 text-[13px]"
                />
              </div>
              <button className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900">
                Run
              </button>
            </form>
          ) : range && action ? (
            <form action={action} className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  htmlFor="from"
                  className="mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint"
                >
                  From
                </label>
                <input
                  id="from"
                  type="date"
                  name="from"
                  defaultValue={range.from}
                  className="tnum rounded-md border border-line px-3 py-1.5 text-[13px]"
                />
              </div>
              <div>
                <label
                  htmlFor="to"
                  className="mb-1 block text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint"
                >
                  To
                </label>
                <input
                  id="to"
                  type="date"
                  name="to"
                  defaultValue={range.to}
                  className="tnum rounded-md border border-line px-3 py-1.5 text-[13px]"
                />
              </div>
              <button className="rounded-md bg-chrome-800 px-5 py-2 text-[13px] font-medium text-white hover:bg-chrome-900">
                Run
              </button>
            </form>
          ) : undefined
        }
      />
      {range && (
        <p className="mb-3 text-xs text-ink-faint">
          {format(parseISO(range.from), "d MMM yyyy")} to{" "}
          {format(parseISO(range.to), "d MMM yyyy")}
        </p>
      )}
      {date && !range && (
        <p className="mb-3 text-xs text-ink-faint">
          {format(parseISO(date), "EEEE d MMMM yyyy")}
        </p>
      )}
      {children}
    </div>
  );
}

/** A headline figure above a report's table. */
export function ReportFigure({
  label,
  value,
  detail,
  emphasis = false,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex-1 border-line px-5 py-4 [&:not(:last-child)]:border-r">
      <p className="text-xxs font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </p>
      <p
        className={`tnum mt-1.5 font-display text-[27px] font-semibold leading-none tracking-tightest ${
          emphasis ? "text-brass" : "text-ink"
        }`}
      >
        {value}
      </p>
      {detail && <p className="mt-1.5 text-xs text-ink-faint">{detail}</p>}
    </div>
  );
}

export function ReportFigures({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap rounded-lg border border-line bg-white shadow-card">
      {children}
    </div>
  );
}
