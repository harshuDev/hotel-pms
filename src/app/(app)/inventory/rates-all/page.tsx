import { getT } from "@/lib/i18n/server";
import { isValid, parseISO } from "date-fns";
import { format, addDays } from "date-fns";
import { PageHeader } from "@/components/ui";
import { RatesScreen } from "@/components/inventory/rates-screen";
import {
  INVENTORY_NIGHTS,
  getBusinessDate,
  getCurrentStaffUser,
  getRatePlans,
  getRatesGrid,
} from "@/lib/queries";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Rates (All)"));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every rate plan, under every room type, priced per night.
 *
 * This used to be the shared nine-screen grid with a rate-plan picker at the
 * top, showing one plan at a time. The client asked for the hierarchy instead:
 * "you will see the room and then below the room all the rates and then you
 * will be able to change the price on those rates". A hotel sells Room Only,
 * B&B and Non-refundable on the same room and needs the three prices next to
 * each other.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const tr = await getT();
  const sp = await searchParams;
  const [staff, businessDate] = await Promise.all([
    getCurrentStaffUser(),
    getBusinessDate(),
  ]);

  const from =
    sp.from && ISO_DATE.test(sp.from) && isValid(parseISO(sp.from))
      ? sp.from
      : businessDate;

  const [cells, plans] = await Promise.all([getRatesGrid(from, INVENTORY_NIGHTS), getRatePlans()]);
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
      <PageHeader
        title={tr("Rates (All)")}
      />
      <RatesScreen
        cells={cells}
        dates={dates}
        from={from}
        derivedFrom={derivedFrom}
        canEdit={staff !== null && ["admin", "manager"].includes(staff.role)}
      />
    </div>
  );
}
