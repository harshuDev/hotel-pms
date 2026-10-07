import { isValid, parseISO, format, addDays } from "date-fns";
import { PageHeader } from "@/components/ui";
import { RatesScreen } from "@/components/inventory/rates-screen";
import {
  INVENTORY_NIGHTS,
  getBusinessDate,
  getCurrentStaffUser,
  getOccupancyGrid,
  getRatePlans,
  getRatesGrid,
  getRoomTypeOccupancies,
} from "@/lib/queries";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rates (All) and Rates (Main) are one screen (0110): every plan, or only the
 * property's main one. Main used to be the shared nine-screen grid, which
 * could not type a single day's price or show occupancy rows -- the two
 * things the client asked this screen for.
 */
export async function RatesPage({
  title,
  basePath,
  mainOnly,
  from: fromParam,
  plan: planParam,
}: {
  title: string;
  basePath: string;
  mainOnly: boolean;
  from: string | undefined;
  plan?: string;
}) {
  const [staff, businessDate] = await Promise.all([getCurrentStaffUser(), getBusinessDate()]);
  const from =
    fromParam && ISO_DATE.test(fromParam) && isValid(parseISO(fromParam)) ? fromParam : businessDate;

  const [allCells, plans, occupancy, roomTypes] = await Promise.all([
    getRatesGrid(from, INVENTORY_NIGHTS),
    getRatePlans(),
    getOccupancyGrid(from, INVENTORY_NIGHTS),
    getRoomTypeOccupancies(),
  ]);
  // ?plan= narrows Rates (All) to one plan -- the rate plan form's "Daily
  // rates" link lands here. Ignored on Main, and when it names no plan.
  const plan = !mainOnly && plans.some((p) => p.id === planParam) ? planParam! : null;
  const cells = mainOnly
    ? allCells.filter((c) => c.ratePlanIsDefault)
    : plan
      ? allCells.filter((c) => c.ratePlanId === plan)
      : allCells;
  const derivedFrom = Object.fromEntries(
    plans
      .filter((p) => p.parentRatePlanId)
      .map((p) => [p.id, plans.find((x) => x.id === p.parentRatePlanId)?.name ?? ""]),
  );
  const dates = Array.from({ length: INVENTORY_NIGHTS }, (_, i) =>
    format(addDays(parseISO(from), i), "yyyy-MM-dd"),
  );

  return (
    <div>
      <PageHeader title={title} />
      <RatesScreen
        cells={cells}
        occupancy={occupancy}
        plans={plans}
        roomTypes={roomTypes}
        dates={dates}
        from={from}
        businessDate={businessDate}
        basePath={basePath}
        plan={plan}
        derivedFrom={derivedFrom}
        canEdit={staff !== null && ["admin", "manager"].includes(staff.role)}
      />
    </div>
  );
}
