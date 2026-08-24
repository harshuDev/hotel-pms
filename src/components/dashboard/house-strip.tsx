import { cn } from "@/components/ui";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import type { HouseSummary } from "@/lib/types";

function Metric({
  label,
  value,
  detail,
  bar,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  bar?: number;
  tone?: "neutral" | "brass" | "warn";
}) {
  return (
    <div className="flex-1 border-line px-5 py-4 [&:not(:last-child)]:border-r">
      <p className="text-xxs font-semibold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </p>
      <p
        className={cn(
          "tnum mt-1.5 font-display text-[27px] font-semibold leading-none tracking-tightest",
          tone === "brass" && "text-brass",
          tone === "warn" && "text-rose-600",
          tone === "neutral" && "text-ink",
        )}
      >
        {value}
      </p>
      {bar !== undefined && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-shell">
          <div
            className="h-full rounded-full bg-chrome-700"
            style={{ width: `${Math.min(100, bar)}%` }}
          />
        </div>
      )}
      {detail && <p className="mt-1.5 text-xs text-ink-faint">{detail}</p>}
    </div>
  );
}

export function HouseStrip({ s }: { s: HouseSummary }) {
  return (
    <div className="flex flex-wrap rounded-lg border border-line bg-white shadow-card">
      <Metric
        label="Occupancy"
        value={`${s.occupancyPct}%`}
        detail={`${s.occupied} of ${s.sellable} sellable`}
        bar={s.occupancyPct}
      />
      <Metric
        label="Arriving"
        value={String(s.arrivals)}
        detail={`${s.departures} due out`}
        tone="brass"
      />
      <Metric
        label="ADR tonight"
        value={formatMoneyShort(s.adrCents)}
        detail="Average of in-house rates"
      />
      <Metric
        label="In the drawer"
        value={formatMoney(s.drawerCents)}
        detail="Cash only, this shift"
      />
      <Metric
        label="Outstanding"
        value={formatMoneyShort(s.outstandingCents)}
        detail="Unsettled folios"
        tone={s.outstandingCents > 0 ? "warn" : "neutral"}
      />
      <Metric
        label="Housekeeping"
        value={String(s.vacantDirty)}
        detail={s.ooo > 0 ? `${s.ooo} out of order` : "Nothing out of order"}
      />
    </div>
  );
}
