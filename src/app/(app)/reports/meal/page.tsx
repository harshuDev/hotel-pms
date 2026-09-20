import { format, parseISO } from "date-fns";
import { EmptyState, cn } from "@/components/ui";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { reportRange } from "@/lib/reports";
import { getBusinessDate, getMealReport } from "@/lib/queries";
import type { MealType } from "@/lib/types";

export const metadata = { title: "Meal report" };

const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner"];

export default async function MealReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const businessDate = await getBusinessDate();
  const range = reportRange(businessDate, sp.from, sp.to);

  const rows = await getMealReport(range.from, range.to);

  // One line per service, per day. A kitchen reads down a day, not across a
  // meal, so the rows stay in date order and the meal is a column.
  const byDate = new Map<string, Partial<Record<MealType, (typeof rows)[number]>>>();
  for (const row of rows) {
    const day = byDate.get(row.serviceDate) ?? {};
    day[row.meal] = row;
    byDate.set(row.serviceDate, day);
  }

  const totals = MEAL_ORDER.map((meal) => ({
    meal,
    covers: rows
      .filter((r) => r.meal === meal)
      .reduce((sum, r) => sum + r.totalCovers, 0),
  })).filter((t) => t.covers > 0);

  return (
    <ReportShell
      title="Meals"
      action="/reports/meal"
      range={range}
    >
      {totals.length > 0 && (
        <ReportFigures>
          {totals.map((t, i) => (
            <ReportFigure
              key={t.meal}
              label={MEAL_LABEL[t.meal]}
              value={String(t.covers)}
              detail="covers in this range"
              emphasis={i === 0}
            />
          ))}
        </ReportFigures>
      )}

      <div className="rounded-lg border border-line bg-white p-4 shadow-card">
        {byDate.size === 0 ? (
          <EmptyState
            title="No meals to cater for in this range"
            hint="Meals come from the rate plan a stay was sold on. Set what a plan includes on the Inventory screen, under the rate plan."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  {["Day", "Meal", "Adults", "Children", "Covers"].map((c, i) => (
                    <th
                      key={c}
                      className={cn(
                        "whitespace-nowrap px-3 pb-2.5 text-xxs font-semibold uppercase tracking-[0.1em]",
                        i >= 2 && "text-right",
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...byDate.entries()].map(([date, meals]) =>
                  MEAL_ORDER.filter((m) => meals[m]).map((meal, index) => {
                    const row = meals[meal]!;
                    return (
                      <tr key={`${date}-${meal}`}>
                        <td className="whitespace-nowrap px-3 py-2.5 text-ink">
                          {index === 0
                            ? format(parseISO(date), "EEE d MMM")
                            : ""}
                        </td>
                        <td className="px-3 py-2.5 text-ink-muted">
                          {MEAL_LABEL[meal]}
                        </td>
                        <td className="tnum px-3 py-2.5 text-right text-ink-muted">
                          {row.adultCovers}
                        </td>
                        <td className="tnum px-3 py-2.5 text-right text-ink-muted">
                          {row.childCovers === 0 ? "—" : row.childCovers}
                        </td>
                        <td className="tnum px-3 py-2.5 text-right font-medium text-ink">
                          {row.totalCovers}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </ReportShell>
  );
}
