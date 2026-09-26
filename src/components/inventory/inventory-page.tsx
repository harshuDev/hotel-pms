import { getT } from "@/lib/i18n/server";
import { isValid, parseISO } from "date-fns";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { INVENTORY_VISIBILITY, isInventoryFieldHidden } from "@/lib/inventory-settings";
import { InventoryScreen } from "@/components/inventory/inventory-screen";
import { SCREENS } from "@/components/inventory/field-spec";
import {
  INVENTORY_NIGHTS,
  getBusinessDate,
  getCurrentStaffUser,
  getInventoryGrid,
  getInventorySettings,
  getRatePlans,
} from "@/lib/queries";
import type { InventoryField } from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every Inventory route is this page with a different field.
 *
 * Nine separate screens would be nine places to get the same grid subtly
 * different, and the client asked for nine entries in a menu, not nine
 * different ways of looking at a calendar.
 */
export async function InventoryPage({
  fieldName,
  searchParams,
  lockedToDefaultPlan = false,
  title,
}: {
  fieldName: InventoryField;
  searchParams: Promise<{ plan?: string; from?: string }>;
  /** Rates (Main) pins the default plan; Rates (All) lets you pick. */
  lockedToDefaultPlan?: boolean;
  /** Two routes share the `rate` field and need different headings. */
  title?: string;
}) {
  const tr = await getT();
  const spec = SCREENS[fieldName];
  const sp = await searchParams;

  // Inventory -> Settings -> Inventory Options Visibility (0088). The menu
  // entry goes with the tick; this answers a bookmark or a typed address.
  if (isInventoryFieldHidden(await getInventorySettings(), fieldName)) {
    const label = INVENTORY_VISIBILITY.find((v) => v.field === fieldName)?.label;
    return (
      <div>
        <PageHeader title={title ?? spec.title} />
        <div className="rounded-lg border border-line bg-white p-5 text-[13px] text-ink shadow-card">
          {tr("This screen is switched off.")}{" "}
          <Link
            href="/settings?tab=inventory-settings"
            className="text-brass underline-offset-2 hover:underline"
          >
            {label} {tr("in Inventory Settings")}
          </Link>{" "}
          {tr("turns it back on.")}
        </div>
      </div>
    );
  }

  const [staff, businessDate, plans] = await Promise.all([
    getCurrentStaffUser(),
    getBusinessDate(),
    getRatePlans(),
  ]);

  const from =
    sp.from && ISO_DATE.test(sp.from) && isValid(parseISO(sp.from))
      ? sp.from
      : businessDate;

  // The named plan, else the default, else the first. Null is fine for the two
  // screens that set the room type itself.
  const planId = lockedToDefaultPlan
    ? // The default is the "main" rate by definition. `?plan=` is ignored here
      // rather than honoured, or the pinned screen would silently become the
      // unpinned one for anyone who arrived by a link carrying it.
      (plans.find((p) => p.isDefault)?.id ?? plans[0]?.id ?? null)
    : ((sp.plan && plans.some((p) => p.id === sp.plan) ? sp.plan : null) ??
      plans.find((p) => p.isDefault)?.id ??
      plans[0]?.id ??
      null);

  const cells = await getInventoryGrid(
    spec.needsPlan ? planId : null,
    from,
    INVENTORY_NIGHTS,
  );

  return (
    <div>
      <PageHeader
        title={title ?? spec.title}
      />
      <InventoryScreen
        fieldName={fieldName}
        plans={plans}
        planId={planId}
        from={from}
        cells={cells}
        nights={INVENTORY_NIGHTS}
        canEdit={
          staff !== null && ["admin", "manager"].includes(staff.role)
        }
        lockedToDefaultPlan={lockedToDefaultPlan}
      />
    </div>
  );
}
