"use client";

import { format, parseISO } from "date-fns";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import type { SeriesPoint } from "@/lib/types";

// Recharts takes SVG colour props, not Tailwind classes, so these have to be
// literal hex. Keep them in sync with `tailwind.config.ts` by hand — a search
// for a stale palette hex will not find them inside JSX attributes otherwise.
const ACCENT = "#1D6FE0"; // brass.DEFAULT — revenue line, today's marker
const BAR_SOLD = "#153B63"; // chrome-700 — nights already sold
const BAR_ONBOOKS = "#C9D5E2"; // line-strong — rooms on the books
const GRID = "#E2E8F0"; // line.DEFAULT
const AXIS_TEXT = "#8A99A9"; // ink-faint

interface Row {
  date: string;
  occupancy: number;
  revenue: number;
  future: boolean;
}

function Tip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
}) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 shadow-lift">
      <p className="text-xxs uppercase tracking-wide text-ink-faint">
        {format(parseISO(r.date), "EEE d MMM")}
        {r.future && " · forecast"}
      </p>
      <p className="tnum mt-1 text-[13px] font-semibold text-ink">
        {r.occupancy.toFixed(1)}% occupied
      </p>
      <p className="tnum text-xs text-ink-muted">{formatMoney(r.revenue)}</p>
    </div>
  );
}

export function Pace({
  occupancy,
  revenue,
  today,
}: {
  occupancy: SeriesPoint[];
  revenue: SeriesPoint[];
  today: string;
}) {
  // Revenue runs backwards 28 days, occupancy forwards 28. Stitch into one
  // continuous timeline so the eye reads past and future as one story.
  const map = new Map<string, Row>();
  for (const p of revenue) {
    map.set(p.date, {
      date: p.date,
      occupancy: 0,
      revenue: p.value,
      future: false,
    });
  }
  for (const p of occupancy) {
    const existing = map.get(p.date);
    if (existing) {
      existing.occupancy = p.value;
    } else {
      map.set(p.date, {
        date: p.date,
        occupancy: p.value,
        revenue: 0,
        future: true,
      });
    }
  }
  const rows = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));

  const past = rows.filter((r) => !r.future);
  const future = rows.filter((r) => r.future);
  const totalPast = past.reduce((s, r) => s + r.revenue, 0);
  const avgFuture =
    future.reduce((s, r) => s + r.occupancy, 0) / Math.max(1, future.length);

  return (
    <Card
      eyebrow="Pace"
      title="Where the month is going"
      bodyClassName="px-4 pb-4"
      action={
        <div className="flex gap-6 text-right">
          <div>
            <p className="tnum font-display text-[15px] font-semibold text-ink">
              {formatMoneyShort(totalPast)}
            </p>
            <p className="text-xxs text-ink-faint">Revenue, 28 days back</p>
          </div>
          <div>
            <p className="tnum font-display text-[15px] font-semibold text-brass">
              {avgFuture.toFixed(1)}%
            </p>
            <p className="text-xxs text-ink-faint">On the books, 28 ahead</p>
          </div>
        </div>
      }
    >
      <div className="h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: AXIS_TEXT }}
              tickFormatter={(d: string) => format(parseISO(d), "d MMM")}
              interval={6}
            />
            <YAxis
              yAxisId="occ"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: AXIS_TEXT }}
              tickFormatter={(v: number) => `${v}%`}
              domain={[0, 100]}
            />
            <YAxis yAxisId="rev" orientation="right" hide />
            <Tooltip content={<Tip />} cursor={{ fill: "rgba(8,32,58,0.04)" }} />
            <ReferenceLine
              yAxisId="occ"
              x={today}
              stroke={ACCENT}
              strokeDasharray="3 3"
              label={{
                value: "today",
                position: "insideTopRight",
                fontSize: 10,
                fill: ACCENT,
              }}
            />
            <Bar yAxisId="occ" dataKey="occupancy" radius={[2, 2, 0, 0]} maxBarSize={11}>
              {rows.map((r) => (
                <Cell key={r.date} fill={r.future ? BAR_ONBOOKS : BAR_SOLD} />
              ))}
            </Bar>
            <Line
              yAxisId="rev"
              type="monotone"
              dataKey="revenue"
              stroke={ACCENT}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 px-1 text-xs text-ink-faint">
        Solid bars are nights already sold. Pale bars are rooms on the books for
        nights still to come. The blue line is room revenue.
      </p>
    </Card>
  );
}
