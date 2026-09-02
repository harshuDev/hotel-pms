import type { ReactNode } from "react";
import type { ActivityKind, BookingStatus } from "@/lib/types";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  title,
  eyebrow,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-lg border border-line bg-white shadow-card",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
          <div>
            {eyebrow && (
              <p className="mb-0.5 text-xxs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="font-display text-[15px] font-semibold tracking-tightest text-ink">
                {title}
              </h2>
            )}
          </div>
          {action}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

const STATUS_STYLE: Record<BookingStatus, string> = {
  // `warn`, not `brass` — pending sat on the accent token and read as pale
  // blue next to `confirmed`. `warn-deep` for text: `warn` DEFAULT on the
  // wash is only ~3:1, too low for the 10.5px badge.
  pending: "bg-warn-wash text-warn-deep ring-warn-light",
  confirmed: "bg-sky-50 text-sky-700 ring-sky-200",
  checked_in: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  checked_out: "bg-slate-100 text-slate-500 ring-slate-200",
  canceled: "bg-rose-50 text-rose-700 ring-rose-200",
  no_show: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xxs font-medium capitalize ring-1 ring-inset",
        STATUS_STYLE[status],
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}

const FEED_DOT: Record<ActivityKind, string> = {
  BOOKING: "bg-emerald-500",
  CANCELLATION: "bg-rose-500",
  MODIFICATION: "bg-brass",
  PAYMENT: "bg-sky-500",
  CHECKIN: "bg-chrome-600",
  CHECKOUT: "bg-slate-300",
};

export function FeedDot({ kind }: { kind: ActivityKind }) {
  return (
    <span
      className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", FEED_DOT[kind])}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-[13px] font-medium text-ink-muted">{title}</p>
      {hint && (
        <p className="max-w-[26ch] text-xs leading-relaxed text-ink-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[26px] font-semibold tracking-tightest text-ink">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function ComingSoon({ label, phase }: { label: string; phase: string }) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-line bg-white px-8 py-16 text-center shadow-card">
      <p className="text-xxs font-semibold uppercase tracking-[0.18em] text-brass">
        {phase}
      </p>
      <h1 className="mt-3 font-display text-[22px] font-semibold tracking-tightest text-ink">
        {label}
      </h1>
      <p className="mx-auto mt-3 max-w-[38ch] text-[13px] leading-relaxed text-ink-muted">
        Scoped and scheduled. The navigation, permissions and data model behind
        this screen are already in place — the interface lands in{" "}
        {phase.toLowerCase()}.
      </p>
    </div>
  );
}
